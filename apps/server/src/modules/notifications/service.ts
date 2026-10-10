// Copyright (c) 2026 Jugaad s.r.l.
// SPDX-License-Identifier: AGPL-3.0-only

import { NotificationType, UserRole, type TaskKind } from "@kancrm/shared";
import { destinoEmail } from "./email-queue";
import { emailPuoPartire } from "./weekend";
import type { Notification } from "../../generated/prisma/client";
import { config } from "../../config";
import { prisma } from "../../db";
import { wipBreaches, wipMessage, wipRecipients, type WipBreach } from "../task-statuses/wip";
import { localeOfUser, serverT } from "../../i18n";
import { sendDigestEmail, sendNotificationEmail } from "../mail/service";
import { pushToUser } from "../push/service";
import { contributiAlRiepilogo } from "../../plugins/plugin-host";
import { dayInRome } from "../../lib/date";
import { senzaTipiAssenti } from "../../edition/notification-types";

/** Traduce nella lingua del DESTINATARIO: la lega `notify` prima di comporre. */
export type NotifyTranslate = (key: string, params?: Record<string, string | number>) => string;

/**
 * Contenuto di una notifica. Il testo si compone con `message`, una funzione che
 * riceve il traduttore **già legato alla lingua del destinatario**: così ogni
 * persona riceve l'avviso nella propria lingua, senza che il chiamante sappia
 * qual è. Il riferimento è **tutto o niente**: chi cita un task deve dirne anche
 * il tipo, perché è il tipo a decidere quale pannello si apre al click.
 */
export type NotificationPayload = { message: (t: NotifyTranslate, locale: string) => string } & (
  { taskId: string; taskKind: TaskKind } | { taskId?: undefined; taskKind?: undefined }
);

type SseListener = (data: string) => void;

// Connessioni SSE aperte, per utente (in-process: un solo server, vedi CLAUDE.md).
const listeners = new Map<string, Set<SseListener>>();

export function addSseListener(userId: string, listener: SseListener): () => void {
  const set = listeners.get(userId) ?? new Set<SseListener>();
  set.add(listener);
  listeners.set(userId, set);
  return () => {
    set.delete(listener);
    if (set.size === 0) listeners.delete(userId);
  };
}

/** Spinge un evento sulle connessioni aperte di un utente (niente coda: chi non
 *  è connesso non lo riceve, ed è voluto — è un avviso, non un messaggio). */
export function pushSse(userId: string, event: object): void {
  const set = listeners.get(userId);
  if (!set) return;
  const data = `data: ${JSON.stringify(event)}\n\n`;
  for (const listener of set) listener(data);
}

/** I due canali di un tipo di evento, per una persona. */
export interface CanaliAttivi {
  /** Campanella, tempo reale, notifica del browser. */
  inApp: boolean;
  /** Email. */
  email: boolean;
}

/**
 * **Chi vuole cosa.** Ogni tipo di evento ha due interruttori indipendenti, e
 * chi non ha mai toccato niente li ha entrambi accesi — è il comportamento di
 * sempre, e una preferenza mancante non deve mai voler dire silenzio.
 */
export async function canaliAttivi(userId: string, type: NotificationType): Promise<CanaliAttivi> {
  const preference = await prisma.notificationPreference.findUnique({
    where: { userId_type: { userId, type } },
  });
  return { inApp: preference?.enabled ?? true, email: preference?.email ?? true };
}

/**
 * Avvisa una persona sui canali che ha lasciato accesi per quel tipo di evento,
 * e mai sul proprio operato.
 *
 * La riga in tabella si scrive **anche quando la campanella è spenta** (purché
 * l'email sia accesa): non compare da nessuna parte, ma è il registro con cui i
 * riepiloghi giornalieri sanno di aver già scritto oggi. Senza, un riavvio del
 * server rispedirebbe il riepilogo delle scadenze a ogni deploy.
 *
 * Con una `dedupKey` l'avviso è **unico per costruzione**: se una riga con la
 * stessa chiave c'è già, il database la rifiuta e qui non parte niente — né
 * campanella, né push, né email. È il gancio dei riepiloghi giornalieri, che
 * prima controllavano e poi scrivevano, e in due giri sovrapposti scrivevano
 * entrambi. Ritorna `true` se l'avviso è stato creato.
 */
export async function notify(
  userId: string,
  actorId: string | null,
  type: NotificationType,
  payload: NotificationPayload,
  opzioni: { dedupKey?: string; contesto?: ContestoDestinatari; now?: Date } = {},
): Promise<boolean> {
  if (userId === actorId) return false;
  const canali = opzioni.contesto?.canali.get(userId) ?? (await canaliAttivi(userId, type));
  if (!canali.inApp && !canali.email) return false;
  // Il testo si compone nella lingua del destinatario (fonte: la sua
  // preferenza; "auto"/assente → inglese). Reso una volta e usato per i tre
  // canali (in-app, push, email): tutti dicono la stessa cosa, nella sua lingua.
  const recipient =
    opzioni.contesto?.utenti.get(userId) ??
    (await prisma.user.findUnique({
      where: { id: userId },
      select: { locale: true, emailDigest: true, emailWeekend: true, role: true },
    }));
  const locale = localeOfUser(recipient);
  const text = payload.message((key, params) => serverT(locale, key, params), locale);
  const stored = { text, taskId: payload.taskId, taskKind: payload.taskKind };
  /**
   * **Nessuna email parte adesso.** La riga nasce «in attesa» e la portano via
   * i due giri della coda (`email-queue.ts`): dopo qualche minuto l'email
   * singola, se l'avviso non è stato letto nella campanella nel frattempo
   * (25/09/2026); al riepilogo, per chi ha chiesto le email aggregate —
   * quattordici avvisi in otto minuti sono quattordici email, e a quel punto
   * non si legge più niente (04/09/2026) — e per gli avvisi del weekend, che
   * aspettano il lunedì (vedi weekend.ts). La campanella resta immediata: è
   * lì che si guarda lavorando.
   *
   * **Il portale clienti resta com'era** (25/09/2026, scelta del committente):
   * per un cliente l'email parte subito, salvo riepilogo o weekend — l'attesa
   * è una novità dell'applicazione interna.
   */
  const inCoda =
    canali.email &&
    (recipient?.role !== UserRole.PORTAL ||
      (recipient?.emailDigest ?? false) ||
      !emailPuoPartire(recipient, opzioni.now));
  let notification: { id: string };
  try {
    notification = await prisma.notification.create({
      data: {
        userId,
        type,
        payload: JSON.stringify(stored),
        inApp: canali.inApp,
        emailPending: inCoda,
        // Il momento dell'avviso decide il destino dell'email (il weekend,
        // l'attesa): un `now` esplicito vale anche qui.
        ...(opzioni.now ? { createdAt: opzioni.now } : {}),
        dedupKey: opzioni.dedupKey ?? null,
      },
      select: { id: true },
    });
  } catch (err) {
    // P2002 = vincolo di unicità: l'avviso con questa chiave esiste già.
    if (opzioni.dedupKey && (err as { code?: string }).code === "P2002") return false;
    throw err;
  }
  if (canali.inApp) {
    pushSse(userId, { kind: "notification", id: notification.id, type, ...stored });
    // Web Push best-effort verso i dispositivi registrati (anche ad app chiusa):
    // è la campanella che arriva fuori dall'applicazione, quindi segue lo stesso
    // interruttore.
    void pushToUser(userId, "KeelOps", text).catch(() => undefined);
  }
  // Solo il portale arriva qui con l'email da mandare adesso, come prima.
  if (canali.email && !inCoda) {
    void sendNotificationEmail(userId, {
      type,
      text,
      taskId: payload.taskId,
      taskKind: payload.taskKind,
    }).catch(() => undefined);
  }
  return true;
}

/** La chiave di un avviso che si manda **una volta al giorno** per persona. */
export function chiaveGiornaliera(type: NotificationType, userId: string, giorno: Date): string {
  return `${type}:${userId}:${giorno.toISOString().slice(0, 10)}`;
}

/**
 * C'è già una riga di oggi per questa persona e questo tipo? È il controllo
 * di prima della chiave — che da solo non basta (due giri sovrapposti lo
 * passano entrambi) ma serve ancora per le righe **senza chiave**: quelle
 * scritte prima di questa versione. Senza, il primo avvio dopo il deploy
 * rimanderebbe il riepilogo già partito alle sette.
 */
export async function giaAvvisatoOggi(
  userId: string,
  type: NotificationType,
  startOfToday: Date,
): Promise<boolean> {
  const riga = await prisma.notification.findFirst({
    where: { userId, type, createdAt: { gte: startOfToday } },
    select: { id: true },
  });
  return riga !== null;
}

/** Preferenze e lingua dei destinatari, lette una volta per tutti (vedi `notifyMany`). */
export interface ContestoDestinatari {
  canali: Map<string, CanaliAttivi>;
  utenti: Map<
    string,
    { locale: string | null; emailDigest: boolean; emailWeekend: boolean; role: string }
  >;
}

/**
 * Notifica più destinatari distinti (deduplicati, escluso l'autore).
 *
 * Le preferenze e le lingue si leggono **in due query per tutti**, non in
 * due per ciascuno: un commento a cinque persone faceva trenta query, quasi
 * tutte uguali (O2 di PLAN_OPTIMIZE). Le impostazioni della posta le tiene in
 * memoria il modulo mail. Gli avvisi partono insieme: sono indipendenti.
 */
export async function notifyMany(
  userIds: Array<string | null | undefined>,
  actorId: string | null,
  type: NotificationType,
  payload: NotificationPayload,
): Promise<void> {
  const unique = [...new Set(userIds.filter((id): id is string => Boolean(id) && id !== actorId))];
  if (unique.length === 0) return;
  const contesto = await contestoDestinatari(unique, type);
  await Promise.all(unique.map((userId) => notify(userId, actorId, type, payload, { contesto })));
}

export async function contestoDestinatari(
  userIds: string[],
  type: NotificationType,
): Promise<ContestoDestinatari> {
  const [preferenze, utenti] = await Promise.all([
    prisma.notificationPreference.findMany({ where: { userId: { in: userIds }, type } }),
    prisma.user.findMany({
      where: { id: { in: userIds } },
      select: { id: true, locale: true, emailDigest: true, emailWeekend: true, role: true },
    }),
  ]);
  const canali = new Map<string, CanaliAttivi>();
  for (const id of userIds) {
    const p = preferenze.find((x) => x.userId === id);
    canali.set(id, { inApp: p?.enabled ?? true, email: p?.email ?? true });
  }
  return {
    canali,
    utenti: new Map(
      utenti.map((u) => [
        u.id,
        {
          locale: u.locale,
          emailDigest: u.emailDigest,
          emailWeekend: u.emailWeekend,
          role: u.role,
        },
      ]),
    ),
  };
}

/**
 * Gli avvisi con l'email in coda, ciascuno col suo destino (`email-queue.ts`).
 * Quelli **letti** intanto si tolgono dalla coda qui, senza spedire niente: è
 * il punto della coda — chi ha già visto l'avviso lavorando non lo riceve in
 * posta.
 */
async function codaEmail(now: Date) {
  const inAttesa = await prisma.notification.findMany({
    // I tipi dei moduli assenti restano in coda, non partono (vedi notification-types).
    where: { emailPending: true, ...senzaTipiAssenti() },
    orderBy: { createdAt: "asc" },
  });
  if (inAttesa.length === 0) return [];
  const persone = new Map(
    (
      await prisma.user.findMany({
        where: { id: { in: [...new Set(inAttesa.map((riga) => riga.userId))] } },
        select: { id: true, emailDigest: true, emailWeekend: true, role: true },
      })
    ).map((u) => [u.id, u]),
  );
  const conDestino = inAttesa.map((riga) => ({
    riga,
    destino: destinoEmail(riga, persone.get(riga.userId), now, config.emailGraceMinutes),
  }));
  const lette = conDestino.filter((x) => x.destino === "scarta").map((x) => x.riga.id);
  if (lette.length > 0) {
    await prisma.notification.updateMany({
      where: { id: { in: lette } },
      data: { emailPending: false },
    });
  }
  return conDestino;
}

/**
 * **Le email una per una**, dopo l'attesa (25/09/2026). Gira ogni minuto: per
 * chi riceve le email singole, un avviso non letto parte fra
 * `EMAIL_GRACE_MINUTES` e un minuto dopo. L'invio resta best-effort come
 * sempre: la campanella è il canale su cui l'applicazione fa affidamento, e
 * l'avviso si toglie dalla coda prima di spedire — meglio un'email persa in un
 * guasto SMTP che la stessa email a ogni giro.
 *
 * Restituisce quante email sono partite.
 */
export async function sendDeferredEmails(now = new Date()): Promise<number> {
  const singole = (await codaEmail(now)).filter((x) => x.destino === "singola").map((x) => x.riga);
  let inviate = 0;
  for (const riga of singole) {
    // Tolta dalla coda **solo se era ancora in coda**: due giri sovrapposti non
    // mandano la stessa email due volte.
    const { count } = await prisma.notification.updateMany({
      where: { id: riga.id, emailPending: true },
      data: { emailPending: false },
    });
    if (count === 0) continue;
    const payload = JSON.parse(riga.payload) as {
      text?: string;
      taskId?: string;
      taskKind?: string;
    };
    await sendNotificationEmail(riga.userId, {
      type: riga.type,
      text: payload.text ?? "",
      taskId: payload.taskId ?? null,
      taskKind: payload.taskKind ?? null,
    }).catch(() => undefined);
    inviate += 1;
  }
  return inviate;
}

/**
 * **Il riepilogo delle email, per chi ha chiesto di aggregarle** — e per gli
 * avvisi trattenuti nel weekend.
 *
 * Gira ogni pochi minuti e manda a ciascuno un'email sola con quello che si è
 * accumulato. Gli avvisi si tolgono dalla coda **solo se l'email è partita**:
 * cancellarli su un invio fallito vorrebbe dire perderli, e nessuno se ne
 * accorgerebbe. Quelli letti nel frattempo non ci entrano (vedi `codaEmail`).
 *
 * Restituisce quante email sono partite.
 */
export async function sendEmailDigests(now = new Date()): Promise<number> {
  const perUtente = new Map<string, Notification[]>();
  for (const { riga, destino } of await codaEmail(now)) {
    if (destino !== "riepilogo") continue;
    perUtente.set(riga.userId, [...(perUtente.get(riga.userId) ?? []), riga]);
  }

  let inviate = 0;
  for (const [userId, righe] of perUtente) {
    // I riepiloghi giornalieri accumulati (scadenze, timesheet) valgono solo
    // per l'ultimo: dopo un weekend il lunedì si legge la situazione di oggi,
    // non tre volte quella dei giorni prima. Le righe vecchie si segnano
    // comunque come spedite.
    const ultimoPerTipo = new Map<string, string>();
    for (const riga of righe) {
      if (
        riga.type === NotificationType.DUE_DIGEST ||
        riga.type === NotificationType.TIMESHEET_REMINDER
      ) {
        ultimoPerTipo.set(riga.type, riga.id);
      }
    }
    const daLeggere = righe.filter(
      (riga) => !ultimoPerTipo.has(riga.type) || ultimoPerTipo.get(riga.type) === riga.id,
    );
    const voci = daLeggere.map((riga) => {
      const payload = JSON.parse(riga.payload) as {
        text?: string;
        taskId?: string;
        taskKind?: string;
      };
      return {
        type: riga.type,
        text: payload.text ?? "",
        taskId: payload.taskId ?? null,
        taskKind: payload.taskKind ?? null,
        createdAt: riga.createdAt,
      };
    });
    const partita = await sendDigestEmail(userId, voci);
    if (!partita) continue;
    await prisma.notification.updateMany({
      where: { id: { in: righe.map((riga) => riga.id) } },
      data: { emailPending: false },
    });
    inviate += 1;
  }
  return inviate;
}

/** Menzioni: "@nome" o "@nome cognome" (case-insensitive) nel corpo del commento. */
export async function findMentionedUserIds(body: string): Promise<string[]> {
  const candidati = mentionCandidates(body);
  if (candidati.length === 0) return [];
  // Solo gli utenti il cui nome comincia con una parola menzionata (LIKE
  // 'x%', senza distinzione di maiuscole su entrambi i motori), poi la regola
  // di sempre sul testo: «@nome» o «@nome cognome» per intero. Prima si
  // caricava l'intera tabella a ogni messaggio con una chiocciola dentro —
  // anche solo un indirizzo email citato (O1 di PLAN_OPTIMIZE).
  const users = await prisma.user.findMany({
    where: { isActive: true, OR: candidati.map((parola) => ({ name: { startsWith: parola } })) },
    select: { id: true, name: true },
  });
  return resolveMentions(body, users);
}

/**
 * **Il nome intero vince sul nome proprio** (18/09/2026). «@Dario Ferri»
 * chiamava anche «Dario DF», un cliente del portale, perché «@dario» — la
 * prima parola — c'è nel testo: una menzione sola arrivava a tutti i Dario.
 * Le menzioni per nome intero si tolgono dal testo (le più lunghe prima), e il
 * solo nome proprio si cerca in ciò che resta. Due omonimi per intero restano
 * chiamati entrambi: il testo non sa distinguerli.
 */
export function resolveMentions(
  body: string,
  users: ReadonlyArray<{ id: string; name: string }>,
): string[] {
  const nomi = users.map((user) => {
    const full = user.name.toLowerCase();
    return { id: user.id, full, first: full.split(/\s+/)[0] ?? full };
  });
  const lower = body.toLowerCase();
  const perNomeIntero = new Set(
    nomi.filter((nome) => lower.includes(`@${nome.full}`)).map((nome) => nome.id),
  );
  let resto = lower;
  for (const nome of [...nomi].sort((a, b) => b.full.length - a.full.length)) {
    if (perNomeIntero.has(nome.id)) resto = resto.split(`@${nome.full}`).join(" ");
  }
  return nomi
    .filter((nome) => perNomeIntero.has(nome.id) || resto.includes(`@${nome.first}`))
    .map((nome) => nome.id);
}

/**
 * Le parole che seguono una chiocciola nel testo: la prima parola di ogni
 * menzione, che è anche la prima parola del nome di chi è menzionato. Un
 * indirizzo email («nome@dominio») non conta: la chiocciola non è in testa a
 * una parola. Al massimo venti, distinte: è il tetto della OR in query.
 */
export function mentionCandidates(body: string): string[] {
  const parole = new Set<string>();
  for (const m of body.matchAll(/(?:^|[^\p{L}\p{N}_.-])@([\p{L}\p{N}'’-]+)/gu)) {
    const parola = m[1]!.toLowerCase();
    if (parola.length > 0) parole.add(parola);
    if (parole.size >= 20) break;
  }
  return [...parole];
}

/**
 * Digest scadenze giornaliero: una notifica riepilogativa al giorno per persona,
 * con i task aperti in ritardo, in scadenza oggi o domani.
 *
 * **Perché un riepilogo e non un messaggio per task**: le scadenze si ripetono
 * ogni giorno finché non si chiudono, e una email per ciascuna renderebbe la
 * casella inutilizzabile in una settimana — chi ha venti arretrati ne riceverebbe
 * venti al giorno. Un riepilogo quotidiano dice le stesse cose una volta sola, e
 * resta leggibile: è la regola di equilibrio del canale email (vedi modules/mail).
 * Gli avvisi immediati restano per i fatti che accadono una volta: assegnazione,
 * nomina a supervisore, ingresso in un progetto.
 *
 * Lo riceve **chi deve fare** il task e **chi lo segue**: assegnatario e
 * supervisore. Il supervisore prima restava fuori e scopriva i ritardi solo
 * aprendo l'applicazione.
 */
export async function sendDueDigests(now = new Date()): Promise<number> {
  const startOfToday = new Date(now);
  startOfToday.setUTCHours(0, 0, 0, 0);
  const endOfTomorrow = new Date(startOfToday);
  endOfTomorrow.setUTCDate(endOfTomorrow.getUTCDate() + 2);

  const tasks = await prisma.task.findMany({
    where: {
      OR: [{ assigneeId: { not: null } }, { supervisorId: { not: null } }],
      dueDate: { lt: endOfTomorrow },
      status: { isClosed: false },
      deletedAt: null,
    },
  });

  const byUser = new Map<string, { overdue: number; today: number; tomorrow: number }>();
  const startOfTomorrow = new Date(startOfToday);
  startOfTomorrow.setUTCDate(startOfTomorrow.getUTCDate() + 1);
  for (const task of tasks) {
    // Un task che si assegna e si supervisiona da solo conta una volta per
    // persona: i due ruoli spesso coincidono (ogni task nasce così).
    for (const userId of new Set([task.assigneeId, task.supervisorId].filter(Boolean))) {
      const bucket = byUser.get(userId!) ?? { overdue: 0, today: 0, tomorrow: 0 };
      if (task.dueDate! < startOfToday) bucket.overdue += 1;
      else if (task.dueDate! < startOfTomorrow) bucket.today += 1;
      else bucket.tomorrow += 1;
      byUser.set(userId!, bucket);
    }
  }

  /**
   * Al riepilogo si aggiungono i **limiti WIP superati**: quelli propri e
   * quelli dei progetti che la persona guida. La mattina è il momento in cui si
   * decide cosa prendere in mano, ed è lì che "ne hai già troppi aperti" serve.
   *
   * Un limite superato **basta da solo** a far partire il riepilogo: legarlo
   * alle scadenze vorrebbe dire che in una giornata senza scadenze l'avviso non
   * arriva, che è proprio la giornata in cui si comincia qualcosa di nuovo.
   */
  const breaches = await wipBreaches();
  const wipByUser = new Map<string, WipBreach[]>();
  for (const breach of breaches) {
    for (const userId of await wipRecipients(breach)) {
      wipByUser.set(userId, [...(wipByUser.get(userId) ?? []), breach]);
    }
  }
  /**
   * E le righe dei **plugin** (06/09/2026): «Bacheche personali: 3 in
   * ritardo» viene da Personale, che sa le sue card; il core chiede una volta
   * per tutti e le accoda al messaggio di ciascuno. Anche qui una riga basta da
   * sola a far partire il riepilogo: una card personale in ritardo è una
   * scadenza come le altre.
   */
  const daiPlugin = await contributiAlRiepilogo(dayInRome(now));
  const everyone = new Set([...byUser.keys(), ...wipByUser.keys(), ...daiPlugin.keys()]);

  let sent = 0;
  for (const userId of everyone) {
    const counts = byUser.get(userId) ?? { overdue: 0, today: 0, tomorrow: 0 };
    // Una sola notifica digest al giorno per utente: lo garantisce la chiave
    // (e, per le righe di prima della chiave, il controllo sulla data).
    if (await giaAvvisatoOggi(userId, NotificationType.DUE_DIGEST, startOfToday)) continue;
    const creata = await notify(
      userId,
      null,
      NotificationType.DUE_DIGEST,
      {
        message: (t, locale) => {
          const parts: string[] = [];
          if (counts.overdue > 0) parts.push(t("{{count}} in ritardo", { count: counts.overdue }));
          if (counts.today > 0)
            parts.push(t("{{count}} in scadenza oggi", { count: counts.today }));
          if (counts.tomorrow > 0)
            parts.push(t("{{count}} in scadenza domani", { count: counts.tomorrow }));
          const scadenze =
            parts.length > 0 ? t("Scadenze: {{summary}}.", { summary: parts.join(", ") }) : "";
          // Gli avvisi WIP in coda alle scadenze, uno per riga: sono frasi
          // intere, e infilate in un elenco separato da virgole non si leggono.
          const avvisi = (wipByUser.get(userId) ?? []).map((breach) => wipMessage(t, breach));
          const plugin = (daiPlugin.get(userId) ?? []).flatMap((righe) => righe(locale));
          return [scadenze, ...avvisi, ...plugin].filter(Boolean).join("\n");
        },
      },
      { dedupKey: chiaveGiornaliera(NotificationType.DUE_DIGEST, userId, startOfToday) },
    );
    if (creata) sent += 1;
  }
  return sent;
}
