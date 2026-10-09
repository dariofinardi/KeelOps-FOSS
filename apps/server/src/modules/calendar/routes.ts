import type { FastifyInstance, FastifyReply } from "fastify";
import { TaskKind, escapeHtml } from "@kancrm/shared";
import { prisma } from "../../db";
import { badRequest, notFound } from "../../lib/http-errors";
import { requireUser } from "../../plugins/auth";
import { readMailSettings } from "../mail/settings";
import { taskRecordUrl } from "../mail/notification-mail";
import { statusCategoryOfTask } from "../task-statuses/service";
import { applyTaskUpdate } from "../tasks/update-service";
import { buildIcs, type CalendarEntry } from "./ics";
import { signDoneLink, verifyDoneLink } from "./done-link";
import { ensureFeed, feedByToken, feedQuery, FEED_SCOPES, type FeedScope } from "./feeds";
import { calendarFeedsEnabled } from "./settings";
import { pendingCalendarRequest, requestCalendarAccess } from "./access-request";

/** Indirizzo pubblico configurato (pagina Email): unica verità, niente doppioni. */
async function publicBaseUrl(): Promise<string> {
  return (await readMailSettings()).baseUrl.replace(/\/+$/, "");
}

/** Dove si apre un record: la mappa vive in notification-mail (una verità sola). */
function recordUrl(base: string, task: { id: string; kind: string }): string | null {
  return base ? taskRecordUrl(base, task.id, task.kind) : null;
}

/**
 * "Aprilo nell'applicazione": la via d'uscita quando da qui non si può fare
 * niente. Senza, la pagina è un vicolo cieco — chi ci arriva voleva chiudere un
 * task e non gli si offre nessun altro modo.
 *
 * Il tipo del task resta `null` di proposito: se la firma non ha retto il task
 * non lo si è nemmeno letto, e l'indirizzo generico (`/bacheche?task=…`) è
 * quello che apre sia gli amministrativi sia i task di progetto su cui si
 * lavora. Il link è sicuro comunque: là i permessi si ricontrollano, e chi quel
 * task non lo deve vedere non lo vede.
 *
 * Senza indirizzo pubblico configurato non si scrive un link rotto: meglio
 * niente.
 */
async function openInAppLink(taskId: string): Promise<string> {
  const base = await publicBaseUrl();
  if (!base) return "";
  const href = escapeHtml(taskRecordUrl(base, taskId, null));
  return `<p><a href="${href}">Aprilo nell'applicazione</a></p>`;
}

/** Paginetta di risposta: il calendario porta qui, non dentro l'applicazione. */
function page(reply: FastifyReply, title: string, body: string) {
  return reply.type("text/html; charset=utf-8").send(`<!doctype html>
<html lang="it"><head><meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<meta name="robots" content="noindex" />
<title>${escapeHtml(title)}</title>
<style>
  body { margin:0; min-height:100vh; display:flex; align-items:center; justify-content:center;
         background:#f3f4f6; font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif; padding:24px }
  .card { background:#fff; border:1px solid #e5e7eb; border-radius:12px; padding:24px; max-width:28rem; width:100% }
  h1 { font-size:18px; margin:0 0 12px }
  p { color:#4b5563; font-size:14px; line-height:1.5; margin:0 0 16px }
  button { background:#7c3aed; color:#fff; border:0; border-radius:8px; padding:12px 20px;
           font-size:15px; font-weight:600; cursor:pointer }
  a { color:#7c3aed }
</style></head>
<body><div class="card"><h1>${escapeHtml(title)}</h1>${body}</div></body></html>`);
}

export function calendarRoutes(app: FastifyInstance): void {
  // --- I calendari dell'utente (pagina Profilo) ------------------------------

  app.get("/api/calendar/feeds", async (request) => {
    const user = requireUser(request);
    const base = await publicBaseUrl();
    const enabled = await calendarFeedsEnabled();
    const feeds = await prisma.calendarFeed.findMany({
      where: { userId: user.id },
      orderBy: { createdAt: "asc" },
    });
    return {
      // Spento dall'amministratore: i link esistenti restano scritti qui ma non
      // rispondono più. Dirlo è meglio che lasciare copiare un indirizzo morto.
      enabled,
      // Richiesta già inoltrata: il bottone lo dice, invece di far bussare due
      // volte alla stessa porta.
      requestPending: enabled ? false : await pendingCalendarRequest(user),
      feeds: feeds.map((feed) => ({
        id: feed.id,
        scope: feed.scope,
        targetId: feed.targetId,
        label: feed.label,
        lastReadAt: feed.lastReadAt?.toISOString() ?? null,
        url: base ? `${base}/api/calendar/${feed.token}.ics` : null,
      })),
    };
  });

  app.post("/api/calendar/feeds", async (request, reply) => {
    const user = requireUser(request);
    const { scope, targetId } = request.body as { scope?: string; targetId?: string | null };
    if (!(await calendarFeedsEnabled())) {
      throw badRequest("I calendari sottoscrivibili sono disattivati dall'amministratore");
    }
    if (!scope || !FEED_SCOPES.includes(scope as FeedScope)) throw badRequest("Calendario ignoto");
    // `ensureFeed` passa da `feedQuery`, che rifà i controlli di accesso: non si
    // crea un calendario su una bacheca che non si potrebbe aprire.
    const feed = await ensureFeed(user, scope as FeedScope, targetId ?? null);
    const base = await publicBaseUrl();
    return reply.status(201).send({
      id: feed.id,
      scope: feed.scope,
      targetId: feed.targetId,
      label: feed.label,
      lastReadAt: null,
      url: base ? `${base}/api/calendar/${feed.token}.ics` : null,
    });
  });

  /**
   * "Chiedi agli amministratori". Apre un task a testa, con scadenza a due
   * giorni e chi ha chiesto come referente.
   */
  app.post("/api/calendar/feeds/request", async (request) => {
    const user = requireUser(request);
    const avvisati = await requestCalendarAccess(user);
    return { notified: avvisati };
  });

  app.delete("/api/calendar/feeds/:id", async (request, reply) => {
    const user = requireUser(request);
    const { id } = request.params as { id: string };
    const feed = await prisma.calendarFeed.findUnique({ where: { id } });
    if (!feed || feed.userId !== user.id) throw notFound("Calendario non trovato");
    // Revocare spegne anche i link "fatto" che erano usciti da questo feed:
    // la loro firma contiene il token (vedi done-link.ts).
    await prisma.calendarFeed.delete({ where: { id } });
    return reply.status(204).send();
  });

  // --- Il feed, letto dal client di calendario -------------------------------

  /**
   * Pubblico per forza: Google, Outlook e i telefoni non mandano cookie. Il
   * token nell'indirizzo È l'autenticazione, e i permessi si rifanno qui a ogni
   * lettura — chi è uscito da un progetto smette di vederne le consegne.
   */
  app.get("/api/calendar/:token.ics", { config: { public: true } }, async (request, reply) => {
    const { token } = request.params as { token: string };
    // Spento: l'indirizzo non esiste più, come se il feed fosse stato revocato.
    if (!(await calendarFeedsEnabled())) throw notFound("Calendario non trovato");
    const feed = await feedByToken(token);

    let query;
    try {
      query = await feedQuery(feed.user, feed.scope, feed.targetId);
    } catch {
      // Accesso perso dopo la creazione: il calendario resta, vuoto, invece di
      // dare errore — un client che riceve 403 lo segnala all'utente per sempre.
      query = null;
    }

    const tasks = query
      ? await prisma.task.findMany({
          where: query.where,
          include: { status: true, project: true, company: true },
          orderBy: [{ dueDate: "asc" }],
          take: 1000,
        })
      : [];

    const base = await publicBaseUrl();
    const entries: CalendarEntry[] = tasks.map((task) => {
      // La data si sceglie come nel filtro (feedQuery): l'offerta usa la chiusura
      // prevista, ma se manca ripiega sulla scadenza — altrimenti date! sarebbe
      // null qui e buildIcs esploderebbe sul primo giorno intero.
      const date =
        (task.kind === TaskKind.DEAL ? task.expectedCloseDate : task.dueDate) ??
        task.dueDate ??
        task.expectedCloseDate;
      const url = recordUrl(base, task);
      return {
        id: task.id,
        title: task.title,
        date: date!,
        // L'orario appartiene alla scadenza del task: se la data viene dalla
        // chiusura prevista di un'offerta, non c'è un orario da mostrare.
        time: date === task.dueDate ? task.dueTime : null,
        context: [
          task.project ? `Progetto: ${task.project.name}` : null,
          task.company ? `Cliente: ${task.company.name}` : null,
          `Stato: ${task.status?.name ?? "—"}`,
        ].filter((line): line is string => line !== null),
        url,
        // Il link di chiusura solo a chi il task lo può davvero chiudere: sui
        // supervisionati si guarda e basta (la regola è in tasks/permissions).
        // Mai sui task di board: hanno statusId null e boardStatusId, e
        // applyTaskUpdate non li sa chiudere (esploderebbe su status.category).
        doneUrl:
          base && !task.boardId && !task.status?.isClosed && task.assigneeId === feed.userId
            ? `${base}/calendario/fatto/${task.id}?f=${feed.token}&c=${signDoneLink(feed.token, task.id)}`
            : null,
        categories: [task.project?.name, task.company?.name].filter((v): v is string => !!v),
        updatedAt: task.updatedAt,
        closed: task.status?.isClosed ?? false,
      };
    });

    // "Ultima lettura" la UI la mostra al giorno: registrarla a ogni GET vuol
    // dire una transazione di scrittura per ogni polling (Google, iOS, Outlook,
    // per feed, per dispositivo), e SQLite serializza le scritture. Si aggiorna
    // solo se l'ultima è di più di un'ora fa.
    const HOUR_MS = 60 * 60 * 1000;
    if (!feed.lastReadAt || Date.now() - feed.lastReadAt.getTime() > HOUR_MS) {
      await prisma.calendarFeed.update({
        where: { id: feed.id },
        data: { lastReadAt: new Date() },
      });
    }

    reply.header("Content-Type", "text/calendar; charset=utf-8");
    reply.header("Cache-Control", "private, max-age=300");
    reply.header("Content-Disposition", `inline; filename="keelops.ics"`);
    return buildIcs({ name: `KeelOps — ${query?.label ?? feed.label}`, entries });
  });

  // --- "Segna come fatto" dal calendario -------------------------------------

  /**
   * La conferma. Non chiude niente: i programmi di posta e i motori di
   * anteprima **visitano** i link che trovano, e un GET che chiude un task
   * verrebbe premuto da un programma invece che da una persona.
   */
  app.get("/calendario/fatto/:taskId", { config: { public: true } }, async (request, reply) => {
    const { taskId } = request.params as { taskId: string };
    const { f, c } = request.query as { f?: string; c?: string };
    const task = f && c ? await taskForDoneLink(f, c, taskId) : null;
    if (!task) {
      // Il vicolo cieco è il difetto peggiore di questa pagina: chi ci arriva
      // voleva chiudere un task e non gli si offre nessun altro modo di farlo.
      // Il collegamento all'applicazione è sicuro anche se la firma non
      // valeva: lì i permessi si controllano di nuovo, e chi non deve vedere
      // quel task non lo vede.
      return page(
        reply,
        "Collegamento non valido",
        `<p>Questo collegamento non funziona più: il calendario da cui arriva è stato revocato, oppure il task non esiste.</p>
         ${await openInAppLink(taskId)}`,
      );
    }
    if (task.status?.isClosed) {
      return page(
        reply,
        "Già completato",
        `<p>«${escapeHtml(task.title)}» risulta già chiuso.</p>${await openInAppLink(taskId)}`,
      );
    }
    return page(
      reply,
      "Segnare come fatto?",
      `<p>Stai per chiudere «${escapeHtml(task.title)}».</p>
         <form method="post"><button type="submit">Sì, è fatto</button></form>`,
    );
  });

  app.post("/calendario/fatto/:taskId", { config: { public: true } }, async (request, reply) => {
    const { taskId } = request.params as { taskId: string };
    const { f, c } = request.query as { f?: string; c?: string };
    const task = f && c ? await taskForDoneLink(f, c, taskId) : null;
    if (!task) {
      return page(
        reply,
        "Collegamento non valido",
        `<p>Questo collegamento non funziona più.</p>${await openInAppLink(taskId)}`,
      );
    }
    const feed = await feedByToken(f!);
    const category = await statusCategoryOfTask({
      kind: task.kind,
      activityTypeId: task.activityTypeId,
    });
    // Il primo stato chiuso della categoria: nei nostri elenchi è
    // "Completato", e viene prima di "Annullato" — che è un'altra cosa.
    const closing = await prisma.taskStatus.findFirst({
      where: { category, isClosed: true },
      orderBy: { order: "asc" },
    });
    if (!closing) {
      return page(reply, "Non si può chiudere da qui", `<p>Manca uno stato di chiusura.</p>`);
    }
    // Passa dall'aggiornamento di sempre: storico, notifiche e controlli sono
    // quelli, non una scorciatoia scritta per il calendario. Le conferme di
    // sequenza e subtask sono implicite: chi arriva qui ha premuto "Sì, è fatto"
    // sulla pagina di conferma. Se resta un motivo per cui non si può chiudere
    // (subtask ancora aperti, stato sparito), lo si racconta nella paginetta,
    // non con un 409 JSON in faccia a chi apre dal telefono.
    try {
      await applyTaskUpdate(feed.user, task.id, {
        statusId: closing.id,
        confirmSequence: true,
        confirmSubtasks: true,
      });
    } catch (error) {
      return page(
        reply,
        "Non si è potuto chiudere",
        `<p>«${escapeHtml(task.title)}» non è stato chiuso: ${escapeHtml(
          error instanceof Error ? error.message : "riprova dall'applicazione",
        )}</p>`,
      );
    }
    return page(
      reply,
      "Fatto",
      `<p>«${escapeHtml(task.title)}» è stato chiuso.</p>
         <p>Il calendario si aggiornerà alla prossima rilettura, che decide il tuo programma.</p>`,
    );
  });
}

/** Il task del link, se la firma corrisponde a quel feed e il task è suo. */
async function taskForDoneLink(feedToken: string, code: string, taskId: string) {
  if (!verifyDoneLink(feedToken, taskId, code)) return null;
  const feed = await prisma.calendarFeed.findUnique({ where: { token: feedToken } });
  if (!feed) return null;
  const task = await prisma.task.findUnique({ where: { id: taskId }, include: { status: true } });
  // Solo l'assegnatario chiude dal calendario: è la stessa regola con cui il
  // link è stato scritto nel feed.
  if (!task || task.deletedAt || task.assigneeId !== feed.userId) return null;
  return task;
}
