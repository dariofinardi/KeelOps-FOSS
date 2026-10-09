import { randomUUID } from "node:crypto";

import path from "node:path";
import type { FastifyInstance } from "fastify";
import {
  AttachmentType,
  attachmentLabel,
  createLinkAttachmentSchema,
  drivePreviewUrl,
  isAllowedTicketAttachment,
  isWebUrl,
  viewableKind,
  type AttachmentTarget,
} from "@kancrm/shared";
import { extraAttachmentExtensions } from "./extensions";
import { config } from "../../config";
import { prisma } from "../../db";
import { badRequest, conflict, forbidden, notFound } from "../../lib/http-errors";
import { perUtente } from "../../lib/rate-limit";

/** Il magazzino non risponde: non è un file perduto, ed è bene non farlo credere. */
const magazzinoNonRaggiungibile = () =>
  badRequest("Il magazzino allegati non risponde: riprova fra poco");
import { requireUser } from "../../plugins/auth";
import { logActivity } from "../tasks/activity";
import { assertTaskEditAccess, assertTaskViewAccess } from "../tasks/routes";
import { toAttachmentDto } from "../tasks/serializers";
import { agganciTask } from "../tasks/lifecycle-hooks";
import { allegatiInSolaLettura, ruoloDelNucleo } from "../../edition/roles";
import type { User } from "../../generated/prisma/client";
import { sanitizeFilename } from "./storage";
import { attachmentStore } from "./store";
import { signDownloadToken, verifyDownloadToken } from "./download-token";
import { allegatiNascostiA } from "../tasks/comment-counts";
import { haModulo, moduliAttivi } from "../../edition/registry";
import { readMailSettings } from "../mail/settings";
import { taskIdFromLink } from "../tasks/task-link";

/**
 * L'intestazione `Range` di una richiesta, letta nella sola forma che i lettori
 * multimediali usano davvero: `bytes=inizio-` oppure `bytes=inizio-fine`.
 *
 * Restituisce `null` quando non c'è (si manda tutto il file) e la stringa
 * `"non-valido"` quando c'è ma non ha senso — un intervallo oltre la fine del
 * file va risposto con un 416, non con il file intero: un lettore che chiede il
 * minuto 40 di un video da 3 minuti deve sapere che sta sbagliando.
 */
export function parseRange(
  header: string | undefined,
  size: number,
): { start: number; end: number } | "non-valido" | null {
  if (!header) return null;
  const match = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!match) return "non-valido";
  const [, rawStart, rawEnd] = match;
  if (rawStart === "" && rawEnd === "") return "non-valido";
  // `bytes=-500` = gli ultimi 500 byte.
  const start = rawStart === "" ? Math.max(0, size - Number(rawEnd)) : Number(rawStart);
  const end = rawStart === "" || rawEnd === "" ? size - 1 : Math.min(Number(rawEnd), size - 1);
  if (!Number.isFinite(start) || !Number.isFinite(end) || start > end || start >= size) {
    return "non-valido";
  }
  return { start, end };
}

/**
 * Chi può **aggiungere** un allegato a un task.
 *
 * Di regola chi lo può modificare. In più — dal 12/08/2026 — il cliente del
 * portale sulla richiesta che ha aperto lui: uno scatto di schermo o il log
 * dell'errore *sono* la richiesta, e farglieli incollare nella chat come testo
 * era l'unica via. Non è una crepa nel "il portale non modifica": aggiunge un
 * documento alla propria pratica, esattamente come già scrive un messaggio; il
 * task — stato, assegnatario, testo — resta del supporto. Il ticket di un altro
 * cliente non esiste (404), come ovunque.
 *
 * Ritorna il task, e se chi carica è **fuori dall'azienda** anche la richiesta
 * di rispettare i formati ammessi: da fuori arriva quel che arriva.
 */
async function assertAttachmentAdd(
  taskId: string,
  user: User,
): Promise<{ limitedToTicketFormats: boolean }> {
  const task = await prisma.task.findUnique({ where: { id: taskId } });
  if (!task) throw notFound("Task non trovato");
  // Un modulo può decidere al posto del nucleo: il portale allega alle sue richieste.
  for (const aggancio of agganciTask()) {
    const esito = await aggancio.aggiuntaAllegato?.(task, user);
    if (esito) return esito;
  }
  await assertTaskEditAccess(user, task);
  return { limitedToTicketFormats: false };
}

/**
 * L'utente può scaricare l'allegato se può vedere almeno un task a cui è
 * collegato (rispettando progetti/gruppi/portale), oppure — per gli utenti
 * interni — se è un allegato-modello di una ricorrenza. Altrimenti 404: non si
 * rivela l'esistenza di allegati fuori dal proprio perimetro.
 */
export async function assertAttachmentDownloadAccess(
  user: User,
  attachmentId: string,
): Promise<void> {
  /**
   * Un file arrivato con un messaggio che chi guarda non vede — riservato agli
   * interni, o cifrato — per chi sta fuori non esiste: nascondere la frase e
   * lasciare scaricabile il documento vorrebbe dire non aver nascosto niente
   * (16/09/2026). Si chiede prima di tutto il resto: il perimetro del task
   * direbbe di sì.
   */
  if ((await allegatiNascostiA(user, [attachmentId])).has(attachmentId)) {
    throw notFound("Allegato non trovato");
  }
  const taskLinks = await prisma.taskAttachment.findMany({
    where: { attachmentId },
    select: {
      task: {
        select: {
          kind: true,
          projectId: true,
          creatorId: true,
          assigneeId: true,
          supervisorId: true,
          // Servono alle regole speciali: senza visibleToSalesMonitors
          // un'offerta esposta risulterebbe non esposta; senza createdViaTicket
          // il cliente non aprirebbe gli allegati del task nato dal suo ticket.
          visibleToSalesMonitors: true,
          createdViaTicket: true,
        },
      },
    },
  });
  for (const { task } of taskLinks) {
    try {
      await assertTaskViewAccess(user, task);
      return;
    } catch {
      // Prova il prossimo task collegato.
    }
  }
  // Allegati-modello delle ricorrenze: roba interna. I clienti del portale e i
  // monitor vendite non ci arrivano — loro vedono solo ciò che li riguarda.
  if (ruoloDelNucleo(user.role)) {
    const onTemplate = await prisma.recurrenceTemplateAttachment.findFirst({
      where: { attachmentId },
    });
    if (onTemplate) return;
  }
  // Gli allegati dei moduli: le note di rilascio in PDF, che legge anche il portale.
  for (const modulo of moduliAttivi()) {
    if (await modulo.leggeAllegato?.(user, attachmentId)) return;
  }
  throw notFound("Allegato non trovato");
}

export function attachmentRoutes(app: FastifyInstance): void {
  app.post("/api/tasks/:id/attachments/link", async (request, reply) => {
    const user = requireUser(request);
    const { id } = request.params as { id: string };
    const input = createLinkAttachmentSchema.parse(request.body);
    await assertAttachmentAdd(id, user);

    const attachment = await prisma.$transaction(async (tx) => {
      const created = await tx.attachment.create({
        data: {
          type: AttachmentType.LINK,
          name: input.name,
          url: input.url,
          // Il selettore Drive dichiara il tipo (documento, foglio, cartella…):
          // serve all'icona e all'anteprima, mai ai permessi.
          mimeType: input.mimeType ?? null,
          uploadedById: user.id,
          tasks: { create: { taskId: id } },
        },
        include: { uploadedBy: true },
      });
      await logActivity(tx, id, user.id, "attachment_added", { name: input.name, type: "LINK" });
      return created;
    });
    return reply.status(201).send(toAttachmentDto(attachment));
  });

  app.post(
    "/api/tasks/:id/attachments/file",
    { config: { rateLimit: perUtente(30, "1 minute") } },
    async (request, reply) => {
      const user = requireUser(request);
      const { id } = request.params as { id: string };
      const { limitedToTicketFormats } = await assertAttachmentAdd(id, user);

      const file = await request.file();
      if (!file) throw badRequest("Nessun file ricevuto");

      const filename = sanitizeFilename(file.filename);
      // Formati ammessi: la regola è condivisa col browser (`ticket-attachments`),
      // ma qui è dove viene applicata — l'attributo `accept` si aggira, questo no.
      const extra = limitedToTicketFormats ? await extraAttachmentExtensions() : [];
      if (limitedToTicketFormats && !isAllowedTicketAttachment(filename, extra)) {
        throw badRequest("Formato non ammesso: allega {{formats}}", {
          formats: attachmentLabel(extra),
        });
      }
      // Il file si scrive PRIMA della transazione, con un nome deterministico (uuid):
      // così la transazione resta puramente DB (su SQLite tiene il lock in scrittura,
      // e l'I/O su disco dentro lo bloccherebbe per tutta la durata). In caso di
      // rollback il file viene rimosso.
      const relativePath = path.join(id, `${randomUUID()}-${filename}`);
      // In streaming, non in un Buffer: 80 MB per richiesta in memoria, senza
      // tetto di concorrenza, erano il modo di mettere in ginocchio il server
      // con dieci caricamenti insieme (O5). Il limite di @fastify/multipart
      // tronca il flusso oltre la misura: il file a metà si toglie e si dice.
      const size = await attachmentStore().writeStream(relativePath, file.file);
      if (file.file.truncated) {
        await attachmentStore().remove(relativePath);
        throw badRequest("File troppo grande: il limite è {{mb}} MB", { mb: config.maxUploadMb });
      }
      try {
        const attachment = await prisma.$transaction(async (tx) => {
          const created = await tx.attachment.create({
            data: {
              type: AttachmentType.FILE,
              name: filename,
              mimeType: file.mimetype,
              size,
              path: relativePath,
              uploadedById: user.id,
              tasks: { create: { taskId: id } },
            },
            include: { uploadedBy: true },
          });
          await logActivity(tx, id, user.id, "attachment_added", { name: filename, type: "FILE" });
          return created;
        });
        return reply.status(201).send(toAttachmentDto(attachment));
      } catch (error) {
        await attachmentStore().remove(relativePath);
        throw error;
      }
    },
  );

  /**
   * Punto unico di apertura di un allegato: il client non conosce mai l'URL
   * grezzo, chiede qui dove andare. Vale sia per i file (token di download a
   * vita breve) sia per i link esterni — che così passano anch'essi dal
   * controllo dei permessi, prima invece bastava avere l'URL.
   *
   * Serve anche da innesto per il futuro: integrando Google Workspace o un
   * visualizzatore di documenti si aggiunge un `mode` qui, e tutte le pagine che
   * mostrano allegati lo seguono senza essere toccate.
   */
  app.get("/api/attachments/:id/open", async (request) => {
    const user = requireUser(request);
    const { id } = request.params as { id: string };
    // `intent=view`: chi apre vuole leggere il documento a schermo, non portarselo
    // via. Non è un permesso in più — è lo stesso allegato, servito inline invece
    // che come salvataggio (e per i formati che il lettore non sa disegnare si
    // torna al download, senza aprire un riquadro vuoto).
    const wantsViewer = (request.query as { intent?: string }).intent === "view";
    const soloLettura = allegatiInSolaLettura(user.role);
    const attachment = await prisma.attachment.findUnique({ where: { id } });
    if (!attachment) throw notFound("Allegato non trovato");
    await assertAttachmentDownloadAccess(user, id);

    if (attachment.type === AttachmentType.LINK) {
      // Difesa anche sui link storici: un URL javascript:/data: non deve mai
      // arrivare al browser di chi clicca (lo schema blocca solo i nuovi).
      if (!attachment.url || !isWebUrl(attachment.url)) throw notFound("Allegato non trovato");
      // Un link a un task di questa istanza si apre nel suo pannello. Al monitor
      // vendite no: i task sono lavoro interno, e il link non è un accesso.
      const taskId = taskIdFromLink(attachment.url, (await readMailSettings()).baseUrl);
      if (taskId) {
        if (soloLettura) throw forbidden("Questo collegamento è interno");
        const collegato = await prisma.task.findUnique({
          where: { id: taskId },
          select: { kind: true },
        });
        return {
          mode: "task",
          taskId,
          taskKind: collegato?.kind,
          url: attachment.url,
          name: attachment.name,
          mimeType: attachment.mimeType,
        } satisfies AttachmentTarget;
      }
      // Occhio su un link Google Workspace → anteprima nello **stesso pannello**
      // di PDF/Word/immagini, con la variante `/preview` che Google espone per
      // l'iframe. Per i monitor vendite è anche il percorso di default: prima i
      // link uscivano sempre esterni, unico varco nella regola "legge, non
      // scarica". Chi può davvero aprire il documento resta deciso dall'ACL di
      // Google: qui si controlla solo chi vede il collegamento.
      // The Drive preview is the commercial `google` module: elsewhere the link opens outside.
      const preview = haModulo("google") ? drivePreviewUrl(attachment.url) : null;
      if (preview && (wantsViewer || soloLettura)) {
        return {
          mode: "drive-preview",
          url: preview,
          name: attachment.name,
          mimeType: attachment.mimeType,
        } satisfies AttachmentTarget;
      }
      return {
        mode: "external",
        url: attachment.url,
        name: attachment.name,
        mimeType: attachment.mimeType,
      } satisfies AttachmentTarget;
    }
    if (!attachment.path) throw notFound("Allegato non trovato");

    // I monitor vendite **leggono, non scaricano**: ricevono l'indirizzo del lettore
    // interno, che serve il file da mostrare a schermo (Content-Disposition:
    // inline) e non da salvare. Non è una barriera crittografica — i byte
    // arrivano comunque al browser, altrimenti non si potrebbe disegnare la
    // pagina — ma toglie il salvataggio dai comandi offerti.
    const kind = viewableKind(attachment.mimeType, attachment.name);
    if (soloLettura || (wantsViewer && kind)) {
      if (!kind) throw forbidden("Questo documento non si può leggere qui");
      return {
        mode: "viewer",
        url: `/api/attachments/view/${signDownloadToken(id)}`,
        name: attachment.name,
        mimeType: attachment.mimeType,
      } satisfies AttachmentTarget;
    }
    return {
      mode: "download",
      url: `/api/attachments/download/${signDownloadToken(id)}`,
      name: attachment.name,
      mimeType: attachment.mimeType,
    } satisfies AttachmentTarget;
  });

  /**
   * Lettura a schermo: stessi token firmati del download, ma il file arriva
   * **inline** e con il tipo dichiarato dal server. `nosniff` impedisce al
   * browser di reinterpretare il contenuto, e i formati sono quelli che il
   * lettore sa disegnare — così non si trasforma in un canale per servire
   * qualunque cosa.
   */
  app.get("/api/attachments/view/:token", { config: { public: true } }, async (request, reply) => {
    const { token } = request.params as { token: string };
    const attachmentId = verifyDownloadToken(token);
    if (!attachmentId) throw notFound("Link non valido o scaduto");
    const attachment = await prisma.attachment.findUnique({ where: { id: attachmentId } });
    if (!attachment || attachment.type !== AttachmentType.FILE || !attachment.path) {
      throw notFound("Allegato non trovato");
    }
    const kind = viewableKind(attachment.mimeType, attachment.name);
    if (!kind) throw forbidden("Formato non leggibile a schermo");
    const store = attachmentStore();
    // Il magazzino può essere irraggiungibile: dirlo per quello che è, invece di
    // dichiarare perduto un file che sta al suo posto (04/09/2026).
    const size = await store.size(attachment.path).catch((errore: unknown) => {
      request.log.error(
        { err: errore, attachmentId, path: attachment.path },
        "magazzino allegati non raggiungibile",
      );
      throw magazzinoNonRaggiungibile();
    });
    if (size === null) throw notFound("File non presente nel magazzino allegati");

    reply.header("Content-Disposition", "inline");
    /**
     * I formati **testuali** partono sempre come `text/plain`, qualunque cosa
     * dichiari il file: da quando codice e markdown si leggono a schermo
     * (18/08/2026), un `pagina.html` o un `icona.svg` serviti inline col loro
     * tipo verrebbero **eseguiti dal browser come pagina di questo dominio** —
     * XSS memorizzata con dentro i cookie di sessione. Il lettore interno il
     * testo lo scarica con `fetch` e lo disegna da sé: del Content-Type non
     * fa niente, quindi qui non si perde nulla.
     */
    const textual = kind === "code" || kind === "markdown" || kind === "text";
    reply.header(
      "Content-Type",
      textual ? "text/plain; charset=utf-8" : (attachment.mimeType ?? "application/octet-stream"),
    );
    reply.header("X-Content-Type-Options", "nosniff");

    /**
     * **Richieste parziali** (`Range`), che per un video non sono un lusso:
     * senza, trascinare la barra riscarica il filmato dall'inizio e Safari si
     * rifiuta proprio di riprodurre. Si annuncia sempre di saperle fare
     * (`Accept-Ranges`), così il lettore le usa (18/08/2026).
     */
    reply.header("Accept-Ranges", "bytes");
    const range = parseRange(request.headers.range, size);
    if (range === "non-valido") {
      reply.header("Content-Range", `bytes */${size}`);
      return reply.status(416).send();
    }
    if (range) {
      reply.status(206);
      reply.header("Content-Range", `bytes ${range.start}-${range.end}/${size}`);
      reply.header("Content-Length", range.end - range.start + 1);
      return reply.send(await store.stream(attachment.path, range));
    }
    reply.header("Content-Length", size);
    return reply.send(await store.stream(attachment.path));
  });

  // Passo 1: verifica i permessi ed emette un token di download a vita breve.
  app.get("/api/attachments/:id/download-token", async (request) => {
    const user = requireUser(request);
    const { id } = request.params as { id: string };
    const attachment = await prisma.attachment.findUnique({ where: { id } });
    if (!attachment || attachment.type !== AttachmentType.FILE || !attachment.path) {
      throw notFound("Allegato non trovato");
    }
    await assertAttachmentDownloadAccess(user, id);
    const token = signDownloadToken(id);
    return { token, url: `/api/attachments/download/${token}` };
  });

  // Passo 2: streaming del file. Pubblica: l'autorizzazione è il token firmato
  // emesso al passo 1, quindi non serve la sessione (funziona come link diretto
  // per il browser) ma non si può scaricare per solo id.
  app.get(
    "/api/attachments/download/:token",
    { config: { public: true } },
    async (request, reply) => {
      const { token } = request.params as { token: string };
      const attachmentId = verifyDownloadToken(token);
      if (!attachmentId) throw notFound("Link di download non valido o scaduto");
      const attachment = await prisma.attachment.findUnique({ where: { id: attachmentId } });
      if (!attachment || attachment.type !== AttachmentType.FILE || !attachment.path) {
        throw notFound("Allegato non trovato");
      }
      const store = attachmentStore();
      const size = await store.size(attachment.path);
      if (size === null) throw notFound("File non presente nel magazzino allegati");

      reply.header(
        "Content-Disposition",
        `attachment; filename*=UTF-8''${encodeURIComponent(attachment.name)}`,
      );
      reply.header("Content-Type", attachment.mimeType ?? "application/octet-stream");
      reply.header("Content-Length", size);
      return reply.send(await store.stream(attachment.path));
    },
  );

  app.delete("/api/tasks/:id/attachments/:attachmentId", async (request, reply) => {
    const user = requireUser(request);
    const { id, attachmentId } = request.params as { id: string; attachmentId: string };
    // Togliere un allegato è modificare il task: qui non vale l'apertura fatta
    // al portale sull'aggiunta — il cliente allega alla sua richiesta, non fa
    // pulizia nella pratica.
    const task = await prisma.task.findUnique({ where: { id } });
    if (!task) throw notFound("Task non trovato");
    await assertTaskEditAccess(user, task);
    const link = await prisma.taskAttachment.findUnique({
      where: { taskId_attachmentId: { taskId: id, attachmentId } },
      include: { attachment: true },
    });
    if (!link) throw notFound("Allegato non trovato");

    /**
     * **Un allegato arrivato con un messaggio se ne va con il messaggio.**
     *
     * Toglierlo da qui lascerebbe in chat una frase che parla di un documento
     * che non c'è più — e lo potrebbe fare chiunque possa modificare il task,
     * mentre il messaggio lo cancella solo chi l'ha scritto (o un
     * amministratore). Le due regole devono essere la stessa, quindi qui si
     * dice di no e si dice dove andare (04/09/2026).
     */
    const dalMessaggio = await prisma.commentAttachment.findFirst({ where: { attachmentId } });
    if (dalMessaggio) {
      throw conflict(
        "Questo allegato è arrivato con un messaggio: si toglie eliminando quel messaggio",
        "ATTACHMENT_FROM_COMMENT",
      );
    }

    // Solo scollegamento: il file su disco NON viene toccato qui. Viene rimosso
    // solo alla cancellazione definitiva (svuotamento cestino / purge), dove uno
    // sweep elimina gli allegati rimasti senza alcun collegamento.
    await prisma.$transaction(async (tx) => {
      await tx.taskAttachment.delete({
        where: { taskId_attachmentId: { taskId: id, attachmentId } },
      });
      await logActivity(tx, id, user.id, "attachment_removed", { name: link.attachment.name });
    });
    return reply.status(204).send();
  });
}
