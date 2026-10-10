// Copyright (c) 2026 Jugaad s.r.l.
// SPDX-License-Identifier: AGPL-3.0-only

import { schedePlugin } from "../../plugins/plugin-host";
import { impostaPluginAttivo } from "../../plugins/plugin-stato";
import { TICKET_ATTACHMENT_EXTENSIONS } from "@kancrm/shared";
import { extraAttachmentExtensions, setExtraAttachmentExtensions } from "../attachments/extensions";
import { createReadStream } from "node:fs";
import { mkdtemp, rm, stat } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import path from "node:path";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import {
  CompanyTheme,
  NotificationType,
  TaskKind,
  updateBrandingSchema,
  updateCalendarSettingsSchema,
  updateMailSettingsSchema,
  type MailConfig,
  setPluginAttivoSchema,
} from "@kancrm/shared";
import { config } from "../../config";
import { prisma } from "../../db";
import { badRequest, conflict, notFound } from "../../lib/http-errors";
import { serverT, localeFromRequest } from "../../i18n";
import { requireAdmin, requireUser } from "../../plugins/auth";
import { sanitizeFilename } from "../attachments/storage";
import { attachmentStore, localStore, setAttachmentStore } from "../attachments/store";
import { readAttachmentSettings, storeFor, writeAttachmentLocalDir } from "../attachments/settings";
import { moveAttachments } from "../attachments/move";
import { writeBackupZip } from "./backup";
import { backupStatus, cachedStorageUsage, isStale, refreshStorageUsage } from "./storage-usage";
import { infoDatabase } from "./db-info";
import { serverVersions } from "./versions";
import { composeNotificationEmail, mailTransportName, sendNow } from "../mail/service";
import { readMailSettings, writeMailSettings } from "../mail/settings";
import { calendarFeedsEnabled, setCalendarFeedsEnabled } from "../calendar/settings";
import { BRANDING_DIR, LOGO_EXTS, LOGO_KEY, readBrandingLogo } from "../branding/logo";

const COMPANY_THEME_KEY = "branding.companyTheme";
const TITLE_KEY = "branding.title";

async function getSetting(key: string): Promise<string | null> {
  return (await prisma.appSetting.findUnique({ where: { key } }))?.value ?? null;
}
async function setSetting(key: string, value: string): Promise<void> {
  await prisma.appSetting.upsert({ where: { key }, update: { value }, create: { key, value } });
}

export function adminRoutes(app: FastifyInstance): void {
  /**
   * Configurazione delle email di notifica: cosa dicono e come si presentano.
   * Le credenziali del provider restano nel `.env` — qui non passano mai, e
   * infatti lo stato riporta host e mittente ma nessuna password.
   */
  app.get("/api/admin/mail", async (request) => {
    requireAdmin(request);
    const settings = await readMailSettings();
    // L'anteprima esce nella lingua di chi guarda la pagina.
    const locale = localeFromRequest(request);
    const preview = await composeNotificationEmail(
      "anteprima@esempio.it",
      serverT(locale, "Nome"),
      {
        type: NotificationType.TASK_ASSIGNED,
        text: serverT(locale, '{{actor}} ti ha assegnato il task "{{title}}"', {
          actor: "Giacomo Verdi",
          title: serverT(locale, "Consegna beta"),
        }),
        taskId: "anteprima",
        taskKind: TaskKind.PROJECT,
      },
      // L'anteprima gira in un iframe: un `cid:` lì non vuol dire niente.
      "data",
      locale,
    );
    return {
      settings,
      status: {
        enabled: config.mail.enabled,
        transport: config.mail.transport,
        host: config.mail.smtp.host,
        from: config.mail.from,
      },
      previewHtml: preview.html ?? "",
      calendar: { feedsEnabled: await calendarFeedsEnabled() },
    } satisfies MailConfig;
  });

  /** L'interruttore dei calendari sottoscrivibili: stessa pagina, altra sezione. */
  app.put("/api/admin/calendar", async (request) => {
    requireAdmin(request);
    const { feedsEnabled } = updateCalendarSettingsSchema.parse(request.body);
    await setCalendarFeedsEnabled(feedsEnabled);
    return { feedsEnabled };
  });

  app.put("/api/admin/mail", async (request) => {
    requireAdmin(request);
    const input = updateMailSettingsSchema.parse(request.body);
    await writeMailSettings(input);
    return readMailSettings();
  });

  /**
   * Invio di prova all'indirizzo di chi lo chiede: è l'unico modo onesto di
   * sapere se la configurazione funziona davvero — host, credenziali, mittente
   * verificato dal provider. Il messaggio è una notifica finta ma completa, così
   * si vede il template come lo vedranno i colleghi.
   */
  app.post("/api/admin/mail/test", async (request) => {
    const user = requireAdmin(request);
    if (!config.mail.enabled) {
      throw badRequest("Posta non configurata: manca MAILER_HOST nel file di ambiente del server.");
    }
    if (!user.email.includes("@")) throw badRequest("Il tuo utente non ha un indirizzo email");
    const locale = localeFromRequest(request);
    const message = await composeNotificationEmail(
      user.email,
      user.name,
      {
        type: NotificationType.TASK_ASSIGNED,
        text: serverT(
          locale,
          "Messaggio di prova: se lo leggi, le notifiche via email funzionano. Il pulsante qui sotto apre KeelOps.",
        ),
        taskId: null,
        taskKind: null,
      },
      "cid",
      locale,
    );
    try {
      await sendNow(message);
    } catch (error) {
      // L'errore del provider è l'informazione utile (mittente non verificato,
      // credenziali sbagliate, porta chiusa): si riporta, non si nasconde.
      throw badRequest("Invio non riuscito: {{error}}", {
        error: error instanceof Error ? error.message : String(error),
      });
    }
    return { sentTo: user.email };
  });

  // Info di sistema per la pagina admin.
  /**
   * Dove vivono gli allegati, e come spostarli.
   *
   * Si legge dove sono, quanti sono e quanto pesano; si cambia la **cartella**
   * (il bucket no: sta nel `.env`, come le credenziali della posta); si
   * **sposta** da un magazzino all'altro con un resoconto. Cambiare la cartella
   * e spostare i file restano due gesti distinti: il primo dice dove andranno i
   * prossimi, il secondo muove quelli che ci sono già — unirli vorrebbe dire
   * che una modifica in un campo di testo mette in moto mille file senza che
   * nessuno l'abbia chiesto.
   */
  app.get("/api/admin/attachments", async (request) => {
    requireAdmin(request);
    const settings = await readAttachmentSettings();
    const attivo = attachmentStore();
    // **Dalla cache, non dal magazzino.** Elencare un bucket costa una chiamata
    // di rete per pagina di risultati, e farlo a ogni apertura della pagina
    // Sistema è un conto che cresce con l'archivio. Il numero arriva col giorno
    // in cui è stato preso, e chi guarda decide se gli basta.
    const usage = await cachedStorageUsage();

    // Cosa c'è nell'ALTRO magazzino: è il numero che dice se resta roba
    // indietro dopo un cambio di configurazione.
    const altro = settings.backend === "GCP" ? localStore(settings.localDir) : null;
    const altroContenuto = altro
      ? await altro
          .list()
          .then((files) => files.length)
          .catch(() => 0)
      : 0;

    return {
      backend: settings.backend,
      dove: attivo.describe(),
      localDir: settings.localDir,
      localDirSource: settings.localDirSource,
      uri: settings.uri,
      gcpProject: settings.gcpProject,
      count: usage?.files ?? 0,
      bytes: usage?.bytes ?? 0,
      backupCount: usage?.backupFiles ?? 0,
      backupBytes: usage?.backupBytes ?? 0,
      /** Quando è stato preso il conteggio. `null` = mai fatto finora. */
      countedAt: usage?.countedAt ?? null,
      countStale: isStale(usage),
      error: usage?.error ?? null,
      /** File rimasti sul disco mentre il magazzino attivo è il bucket. */
      rimastiSulDisco: altroContenuto,
      /** Estensioni ammesse in più ai clienti del portale, come sono configurate. */
      estensioniInPiu: (await extraAttachmentExtensions()).join(" "),
      /** Quelle che valgono comunque, per dirlo accanto al campo. */
      estensioniDiCasa: [...TICKET_ATTACHMENT_EXTENSIONS],
    };
  });

  /**
   * Le estensioni ammesse **in più** ai clienti del portale. Si scrivono come
   * vengono («dwg, .STEP») e vengono normalizzate: chi le configura non
   * deve ricordarsi il punto né la minuscola.
   */
  app.put("/api/admin/attachment-extensions", async (request) => {
    requireAdmin(request);
    const { extensions } = z.object({ extensions: z.string().max(500) }).parse(request.body);
    return { extensions: await setExtraAttachmentExtensions(extensions) };
  });

  app.put("/api/admin/attachments", async (request) => {
    requireAdmin(request);
    const { localDir } = z.object({ localDir: z.string() }).parse(request.body);
    await writeAttachmentLocalDir(localDir);
    const settings = await readAttachmentSettings();
    // Il magazzino attivo segue subito la configurazione: i prossimi allegati
    // vanno dove si è appena scritto, senza aspettare un riavvio.
    if (settings.backend === "LOCAL") setAttachmentStore(storeFor(settings));
    return { localDir: settings.localDir, dove: attachmentStore().describe() };
  });

  /**
   * Riconta adesso. Il giro automatico è quotidiano: questo serve quando si è
   * appena spostato l\'archivio, o quando il numero sullo schermo ha una data
   * che non convince.
   */
  app.post("/api/admin/attachments/recount", async (request) => {
    requireAdmin(request);
    return refreshStorageUsage();
  });

  app.post("/api/admin/attachments/move", async (request) => {
    requireAdmin(request);
    const { from, dryRun } = z
      .object({ from: z.enum(["local", "gcs"]), dryRun: z.boolean().default(false) })
      .parse(request.body);
    const settings = await readAttachmentSettings();
    // Sorgente e destinazione **senza rete di sicurezza**: quella dice "esiste"
    // anche per un file che sta solo nell'origine, e lo spostamento si
    // salterebbe da solo dichiarando di aver finito.
    const sorgente =
      from === "local"
        ? localStore(settings.localDir)
        : storeFor({ ...settings, backend: "GCP" }, { transitionFallback: false });
    const destinazione = storeFor(settings, { transitionFallback: false });
    const report = await moveAttachments(sorgente, destinazione, { dryRun });
    request.log.info({ report, from, dryRun }, "Spostamento allegati");
    // Spostare l'archivio cambia il conteggio: rifarlo subito evita che la
    // pagina, appena dopo l'operazione, mostri i numeri di prima con la data
    // di ieri — che sembrerebbe uno spostamento non riuscito.
    if (!dryRun) await refreshStorageUsage();
    return report;
  });

  app.get("/api/admin/system", async (request) => {
    requireAdmin(request);
    const [users, tasks, deals, projects, companies, contacts, timeEntries] = await Promise.all([
      prisma.user.count(),
      prisma.task.count({ where: { kind: "ADMIN" } }),
      prisma.task.count({ where: { kind: "DEAL" } }),
      prisma.project.count(),
      prisma.company.count(),
      prisma.contact.count(),
      prisma.timeEntry.count(),
    ]);
    // Su quale motore gira questa installazione: da qui viene anche la
    // dimensione, che su MariaDB non è la dimensione di un file.
    const database = await infoDatabase();

    return {
      database,
      maxUploadMb: config.maxUploadMb,
      counts: { users, tasks, deals, projects, companies, contacts, timeEntries },
      /**
       * Lo stato dei due backup: l'istantanea di mezzanotte nel magazzino e lo
       * zip delle 02:30 sul disco. Ce n'erano due elenchi — questo e quello
       * della retention — che leggevano la stessa cartella con la stessa regola.
       */
      backup: await backupStatus(),
      /** Cosa sta girando davvero sul server: Node, il motore, librerie. */
      versions: serverVersions(database),
      /**
       * Com'è configurata la posta in uscita: "spento", "log" (racconta senza
       * spedire) o "smtp". È la prima domanda quando un'email non arriva, e la
       * risposta non deve richiedere di leggere l'ambiente a mano.
       */
      mailTransport: mailTransportName(),
      /**
       * I plugin montati, con la versione del codice e quella della struttura
       * delle loro tabelle: è ciò che il contratto chiede a ogni plugin di
       * dichiarare (`plugin_<nick>_config`), e la prima cosa da guardare
       * quando uno «non si vede».
       */
      plugins: schedePlugin(),
    };
  });

  /**
   * **Accende o spegne un plugin installato** (22/09/2026), subito e senza
   * riavvio: il porta-plugin smette di servirlo, o ricomincia. Solo il super
   * admin — `requireAdmin` guarda il ruolo efficace, e un amministratore che
   * non si è elevato è un membro. Un plugin non installato non si accende da
   * qui: si installa con il suo `installa.sh` e un riavvio.
   */
  app.put("/api/admin/plugins/:nome", async (request) => {
    requireAdmin(request);
    const { nome } = request.params as { nome: string };
    const { attivo } = setPluginAttivoSchema.parse(request.body);
    const scheda = schedePlugin().find((p) => p.nome === nome);
    if (!scheda) throw notFound("Plugin non trovato");
    if (!scheda.installato) {
      throw conflict(
        "Questo plugin non è installato: si installa con il suo installa.sh e un riavvio.",
      );
    }
    await impostaPluginAttivo(nome, attivo);
    request.log.info({ plugin: nome, attivo }, "plugin acceso o spento da Sistema");
    return { plugins: schedePlugin() };
  });

  // Backup manuale: genera lo zip e lo scarica.
  app.get("/api/admin/backup", async (request, reply) => {
    requireAdmin(request);
    const tempDir = await mkdtemp(path.join(tmpdir(), "kancrm-download-"));
    const zipPath = path.join(tempDir, "backup.zip");
    await writeBackupZip(zipPath);
    const info = await stat(zipPath);

    const stamp = new Date().toISOString().slice(0, 10);
    reply.header("Content-Type", "application/zip");
    reply.header("Content-Disposition", `attachment; filename="kancrm-backup-${stamp}.zip"`);
    reply.header("Content-Length", info.size);

    const stream = createReadStream(zipPath);
    stream.on("close", () => {
      void rm(tempDir, { recursive: true, force: true });
    });
    return reply.send(stream);
  });

  // --- Branding aziendale (logo + palette): lettura per tutti, modifica solo admin ---

  // DTO branding completo (logo + titolo + palette) letto dall'header e dal profilo.
  async function brandingDto() {
    const logo = await getSetting(LOGO_KEY);
    return {
      logoUrl: logo ? `/api/branding/logo?v=${logo}` : null,
      title: (await getSetting(TITLE_KEY)) || null,
      companyTheme: (await getSetting(COMPANY_THEME_KEY)) ?? CompanyTheme.JUGAAD,
    };
  }

  // Logo + titolo + tema aziendale attivo, per rendere l'header e applicare il tema "Aziendale".
  app.get("/api/branding", async (request) => {
    requireUser(request);
    return brandingDto();
  });

  /**
   * Il file del logo, **senza sessione**.
   *
   * Deve esserlo perché l'anteprima della pagina Email gira in un iframe
   * isolato, che credenziali non ne ha. Nelle email il logo NON passa più di
   * qui: viaggia dentro il messaggio (vedi `mail/service.ts`), perché
   * un'immagine remota richiede che il destinatario raggiunga il server, con un
   * certificato che il suo client accetti — e da fuori ufficio, o dietro il
   * proxy immagini di Gmail, quasi mai è così.
   */
  app.get("/api/branding/logo", { config: { public: true } }, async (request, reply) => {
    const logo = await readBrandingLogo();
    if (!logo) throw notFound("Logo non trovato");
    return reply
      .type(logo.contentType)
      .header("Cache-Control", "public, max-age=3600")
      .send(logo.content);
  });

  app.put("/api/branding", async (request) => {
    requireAdmin(request);
    const { companyTheme, title } = updateBrandingSchema.parse(request.body);
    if (companyTheme !== undefined) await setSetting(COMPANY_THEME_KEY, companyTheme);
    if (title !== undefined) {
      // Stringa vuota = azzera (torna a "KeelOps"): rimuove la chiave invece di salvarla vuota.
      if (title === "")
        await prisma.appSetting.delete({ where: { key: TITLE_KEY } }).catch(() => undefined);
      else await setSetting(TITLE_KEY, title);
    }
    return brandingDto();
  });

  app.post("/api/branding/logo", async (request) => {
    requireAdmin(request);
    const file = await request.file();
    if (!file) throw badRequest("Nessun file ricevuto");
    const ext = path.extname(sanitizeFilename(file.filename)).toLowerCase();
    if (!file.mimetype.startsWith("image/") || !(ext in LOGO_EXTS)) {
      throw badRequest("Serve un'immagine (PNG, JPG, WEBP o SVG)");
    }
    const buffer = await file.toBuffer();
    const filename = `logo-${randomUUID()}${ext}`;
    await attachmentStore().write(`${BRANDING_DIR}/${filename}`, buffer);

    const previous = await getSetting(LOGO_KEY);
    await setSetting(LOGO_KEY, filename);
    if (previous) {
      await attachmentStore().remove(`${BRANDING_DIR}/${previous}`);
    }
    return { logoUrl: `/api/branding/logo?v=${filename}` };
  });

  app.delete("/api/branding/logo", async (request) => {
    requireAdmin(request);
    const previous = await getSetting(LOGO_KEY);
    if (previous) {
      await prisma.appSetting.delete({ where: { key: LOGO_KEY } }).catch(() => undefined);
      await attachmentStore().remove(`${BRANDING_DIR}/${previous}`);
    }
    return { logoUrl: null };
  });
}
