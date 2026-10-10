// Copyright (c) 2026 Jugaad s.r.l.
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * The KeelOps MCP tools, all READ-only and all inside the authenticated
 * user's perimeter: the token belongs to a person, and the person sees only
 * what they would see in the app.
 *
 * `search` and `fetch` exist with the names and shapes ChatGPT demands from
 * connectors; the others have speaking names for conversational use.
 */
import { stripHtml } from "../../keelops-sdk/text.mjs";
import { taskPerimeter } from "../../keelops-sdk/perimeter.mjs";
import { buildAnalysisTools } from "./tools-analisi.mjs";
import { ha, se } from "./edizione.mjs";
import { buildRecordTools, linkNote } from "./tools-record.mjs";

const LIMIT = 25;

function taskUrl(keelopsUrl, id) {
  return keelopsUrl ? `${keelopsUrl}/bacheche?task=${encodeURIComponent(id)}` : `keelops://task/${id}`;
}

async function findTasks(db, user, { text, project, onlyOpen, tag, limit = LIMIT }) {
  const per = taskPerimeter(user);
  const conditions = [per.where];
  const params = [...per.params];
  if (text) { conditions.push("(t.title LIKE ? OR t.description LIKE ?)"); params.push(`%${text}%`, `%${text}%`); }
  if (project) { conditions.push("p.name LIKE ?"); params.push(`%${project}%`); }
  if (onlyOpen) conditions.push("t.closedAt IS NULL");
  if (tag) { conditions.push("t.id IN (SELECT tt.taskId FROM TaskTag tt JOIN Tag tg ON tg.id = tt.tagId WHERE tg.name LIKE ?)"); params.push(tag); }
  return await db.all(`
    SELECT t.id, t.title, t.kind, t.createdAt, t.closedAt, t.dueDate, t.createdViaTicket,
           t.assigneeId, t.supervisorId, t.creatorId,
           p.name AS project, ts.name AS status,
           (SELECT ROUND(SUM(e.hours), 1) FROM TimeEntry e WHERE e.taskId = t.id) AS hours,
           ${ROLE_COLUMNS}, ${DEAL_COLUMNS}
    FROM Task t
    LEFT JOIN Project p ON p.id = t.projectId
    LEFT JOIN TaskStatus ts ON ts.id = t.statusId
    ${ROLE_JOINS} ${DEAL_JOINS}
    WHERE ${conditions.join(" AND ")}
    ORDER BY t.updatedAt DESC LIMIT ?`, ...params, Math.min(limit, 50));
}

/**
 * The three people of a task, each under its own name. One "assegnatario"
 * column used to stand for everyone, and an assistant asked about "my tasks"
 * could not tell assigned-to-me from supervised-by-me from opened-by-me —
 * exactly the confusion the user warned about (26/08/2026). The nickname wins
 * where present, like everywhere in the product.
 */
const ROLE_COLUMNS = `
           COALESCE(ua.nickName, ua.name) AS assignee,
           COALESCE(us.nickName, us.name) AS supervisor,
           COALESCE(uc.nickName, uc.name) AS creator`;
const ROLE_JOINS = `
    LEFT JOIN User ua ON ua.id = t.assigneeId
    LEFT JOIN User us ON us.id = t.supervisorId
    LEFT JOIN User uc ON uc.id = t.creatorId`;

/**
 * What makes a deal a deal: stage (with its won/lost nature), money,
 * probability, expected close, the customer and — for the lost ones — WHY.
 * Joined into every list, emitted only for kind = DEAL, so an assistant asked
 * "why did we lose the Acme deal" finds the reason next to the deal and not in
 * a payload it has to dig for (31/08/2026).
 */
const DEAL_COLUMNS = `
           ds.name AS stage, ds.isWon AS stageWon, ds.isLost AS stageLost,
           t.lostReason, t.dealValue, t.probability, t.expectedCloseDate,
           co.name AS company`;
const DEAL_JOINS = `
    LEFT JOIN DealStage ds ON ds.id = t.dealStageId
    LEFT JOIN Company co ON co.id = t.companyId`;

const dealOutcome = (r) => (r.stageWon ? "vinta" : r.stageLost ? "persa" : "aperta");

function dealFields(r) {
  return { fase: r.stage ?? null, esito: dealOutcome(r),
           valore: r.dealValue ?? null, probabilita: r.probability ?? null,
           chiusura_prevista: r.expectedCloseDate?.slice(0, 10) ?? null,
           azienda: r.company ?? null,
           // il motivo c'è solo dove qualcuno l'ha scritto: null è "non detto", non "nessuno"
           motivo_perdita: r.stageLost ? (r.lostReason ?? null) : null };
}

/** A support request in either of its two forms (see tickets/access on the core). */
const isTicketRecord = (r) => r.kind === "TICKET" || Boolean(r.createdViaTicket);

/**
 * Which of the three roles the AUTHENTICATED user holds on this task. Saying
 * it outright ("this one is mine as assignee") spares the assistant a name
 * comparison it can get wrong: the user asked for exactly this reading —
 * "for my tasks, show me executor and supervisor when they are not me"
 * (26/08/2026).
 */
function myRoles(r, user) {
  const roles = [];
  if (r.assigneeId === user.id) roles.push("assegnatario");
  if (r.supervisorId === user.id) roles.push("supervisore");
  if (r.creatorId === user.id) roles.push("creatore");
  return roles;
}

function rowToItem(keelopsUrl, r, user) {
  return { id: r.id, titolo: stripHtml(r.title), tipo: r.kind,
           progetto: r.project ?? null, stato: r.status ?? null,
           assegnatario: r.assignee ?? null,
           supervisore: r.supervisor ?? null,
           creato_da: r.creator ?? null,
           miei_ruoli: myRoles(r, user),
           // vero anche per i task di progetto NATI da un ticket, che per
           // tipo direbbero solo PROJECT
           ...se(ha(user, "ticket"), { nata_da_ticket: isTicketRecord(r) }),
           scadenza: r.dueDate?.slice(0, 10) ?? null, chiuso: Boolean(r.closedAt),
           // per chi fa i conti: quando è nato, quando è finito, quanto è costato
           aperto_il: r.createdAt?.slice(0, 10) ?? null, chiuso_il: r.closedAt?.slice(0, 10) ?? null,
           ore: r.hours ?? null,
           ...(r.kind === "DEAL" ? { offerta: dealFields(r) } : {}),
           url: taskUrl(keelopsUrl, r.id) };
}

/** The lists share one shape; a date is a day, a JSON payload is parsed or ignored. */
const day = (v) => v?.slice(0, 10) ?? null;
const minute = (v) => v?.slice(0, 16) ?? null;
function parsePayload(raw) {
  try { return JSON.parse(raw ?? "{}"); } catch { return {}; }
}

export function buildTools(db, user, keelopsUrl, attachments = null) {
  const per = taskPerimeter(user);
  return [
    ...buildAnalysisTools(db, user, keelopsUrl, { taskUrl }),
    ...buildRecordTools(db, user, keelopsUrl, attachments, { taskUrl }),
    {
      name: "search",
      description: "Search KeelOps work items (tasks, deals, tickets) visible to the authenticated user. Returns a result list with id, title and url.",
      inputSchema: { type: "object", properties: { query: { type: "string" } }, required: ["query"] },
      run: async ({ query }) => ({
        results: (await findTasks(db, user, { text: query })).map((r) => ({
          id: r.id, title: stripHtml(r.title), url: taskUrl(keelopsUrl, r.id) })),
      }),
    },
    {
      name: "fetch",
      description: "Fetch the full content of one KeelOps work item by id (as returned by search).",
      inputSchema: { type: "object", properties: { id: { type: "string" } }, required: ["id"] },
      run: async ({ id }) => {
        const r = await db.get(`
          SELECT t.id, t.title, t.description, t.kind, t.createdAt, t.closedAt, t.dueDate,
                 t.createdViaTicket, t.assigneeId, t.supervisorId, t.creatorId,
                 p.name AS project, ts.name AS status,
                 ${ROLE_COLUMNS}, ${DEAL_COLUMNS}
          FROM Task t LEFT JOIN Project p ON p.id = t.projectId
          LEFT JOIN TaskStatus ts ON ts.id = t.statusId
          ${ROLE_JOINS} ${DEAL_JOINS}
          WHERE t.id = ? AND ${per.where}`, id, ...per.params);
        if (!r) throw new Error("record non trovato o non visibile a questo utente");
        const allegati = await db.all(`
          SELECT a.id, a.name, a.type, a.url FROM TaskAttachment ta JOIN Attachment a ON a.id = ta.attachmentId
          WHERE ta.taskId = ? ORDER BY a.createdAt`, id);
        const tags = await db.all(`SELECT tg.name FROM TaskTag tt JOIN Tag tg ON tg.id = tt.tagId WHERE tt.taskId = ?`, id);
        return { id: r.id, title: stripHtml(r.title),
                 text: stripHtml(r.description) || "(senza descrizione)",
                 url: taskUrl(keelopsUrl, r.id),
                 metadata: { tipo: r.kind, progetto: r.project, stato: r.status,
                             tag: tags.map((t) => t.name),
                             allegati: allegati.map((a) => ({ id: a.id, nome: a.name, tipo: a.type === "LINK" ? "collegamento" : "file",
                                                              ...(a.type === "LINK" ? { url: a.url, nota: linkNote(a.url) } : { leggibile_con: "leggi_allegato" }) })),
                             tutto: "dettaglio_task",
                             assegnatario: r.assignee ?? null,
                             supervisore: r.supervisor ?? null,
                             creato_da: r.creator ?? null,
                             miei_ruoli: myRoles(r, user),
                             ...se(ha(user, "ticket"), { nata_da_ticket: isTicketRecord(r) }),
                             aperto: r.createdAt?.slice(0, 10), chiuso: r.closedAt?.slice(0, 10) ?? null,
                             scadenza: r.dueDate?.slice(0, 10) ?? null,
                             ...(r.kind === "DEAL" ? { offerta: dealFields(r) } : {}) } };
      },
    },
    {
      name: "cerca_task",
      description: "Cerca i task visibili all'utente per testo, progetto o solo aperti. Più ricco di `search`: riporta stato, scadenza e i TRE ruoli distinti — assegnatario (chi esegue), supervisore (il referente) e creato_da (chi ha aperto, decisivo per le richieste di supporto).",
      inputSchema: { type: "object", properties: {
        testo: { type: "string", description: "parole nel titolo o nella descrizione" },
        progetto: { type: "string", description: "nome (anche parziale) del progetto" },
        tag: { type: "string", description: "nome esatto di un tag (vedi lo strumento tag)" },
        solo_aperti: { type: "boolean" } } },
      run: async ({ testo, progetto, tag, solo_aperti }) => ({
        task: (await findTasks(db, user, { text: testo, project: progetto, tag, onlyOpen: solo_aperti }))
          .map((r) => rowToItem(keelopsUrl, r, user)) }),
    },
    {
      name: "progetti",
      description: ha(user, "timesheet")
        ? "I progetti visibili all'utente, con task aperti e ore registrate."
        : "I progetti visibili all'utente, con i task aperti.",
      inputSchema: { type: "object", properties: {} },
      run: async () => ({
        progetti: (await db.all(`
          SELECT p.name AS nome, COUNT(t.id) AS task,
                 SUM(t.closedAt IS NULL) AS aperti,
                 ROUND(SUM((SELECT SUM(e.hours) FROM TimeEntry e WHERE e.taskId = t.id)), 1) AS ore
          FROM Project p JOIN Task t ON t.projectId = p.id
          WHERE p.deletedAt IS NULL AND ${per.where}
          GROUP BY p.id ORDER BY aperti DESC, p.name`, ...per.params))
          .map(({ ore, ...riga }) => ({ ...riga, ...se(ha(user, "timesheet"), { ore }) })) }),
    },
    {
      name: "scadenze",
      description: "I task visibili con scadenza nei prossimi N giorni (default 14), più gli scaduti aperti.",
      inputSchema: { type: "object", properties: { giorni: { type: "integer", minimum: 1, maximum: 90 } } },
      run: async ({ giorni = 14 }) => ({
        scadenze: (await db.all(`
          SELECT t.id, t.title, t.kind, t.closedAt, t.dueDate, t.createdViaTicket,
                 p.name AS project, ts.name AS status,
                 ${ROLE_COLUMNS}
          FROM Task t LEFT JOIN Project p ON p.id = t.projectId
          LEFT JOIN TaskStatus ts ON ts.id = t.statusId
          ${ROLE_JOINS}
          WHERE ${per.where} AND t.closedAt IS NULL AND t.dueDate IS NOT NULL
            AND date(t.dueDate) <= ${db.sql.todayPlusDays(giorni)}
          ORDER BY t.dueDate LIMIT 50`, ...per.params))
          .map((r) => rowToItem(keelopsUrl, r, user)) }),
    },
    {
      name: "storico_stati",
      description: "I cambi di stato registrati sui task visibili all'utente: chi ha spostato cosa, da quale stato a quale, quando. Con `id` la storia di UN task; senza, gli ultimi cambi sui task in cui l'utente ha un ruolo (assegnatario, supervisore o creatore).",
      inputSchema: { type: "object", properties: {
        id: { type: "string", description: "id del task (da search/cerca_task)" },
        giorni: { type: "integer", minimum: 1, maximum: 365, description: "finestra all'indietro, default 30" } } },
      run: async ({ id, giorni = 30 }) => {
        const conditions = [per.where, "a.action = 'status_changed'"];
        const params = [...per.params];
        if (id) { conditions.push("t.id = ?"); params.push(id); }
        else {
          // senza id: i MIEI task, nel senso largo dei tre ruoli
          conditions.push("(t.assigneeId = ? OR t.supervisorId = ? OR t.creatorId = ?)");
          params.push(user.id, user.id, user.id);
          conditions.push(`date(a.createdAt) >= ${db.sql.todayPlusDays(-giorni)}`);
        }
        const rows = await db.all(`
          SELECT t.id, t.title, a.payload, a.createdAt,
                 COALESCE(u.nickName, u.name) AS author
          FROM ActivityLog a
          JOIN Task t ON t.id = a.taskId
          LEFT JOIN User u ON u.id = a.userId
          WHERE ${conditions.join(" AND ")}
          ORDER BY a.createdAt DESC LIMIT 100`, ...params);
        return { cambi: rows.map((r) => {
          let payload = {};
          try { payload = JSON.parse(r.payload ?? "{}"); } catch { /* storico vecchio */ }
          return { task: r.id, titolo: stripHtml(r.title),
                   da: payload.from ?? null, a: payload.to ?? null,
                   di: r.author ?? null, quando: r.createdAt?.slice(0, 16) ?? null };
        }) };
      },
    },
    {
      name: "mio_timesheet",
      description: "Le ore che L'UTENTE ha registrato nel timesheet, giorno per giorno e task per task, in un intervallo (date YYYY-MM-DD). Sempre e solo le proprie: per gli aggregati di tutti c'è ore_per_progetto.",
      inputSchema: { type: "object", properties: {
        da: { type: "string", description: "YYYY-MM-DD" },
        a: { type: "string", description: "YYYY-MM-DD" } }, required: ["da", "a"] },
      run: async ({ da, a }) => {
        if (!/^\d{4}-\d{2}-\d{2}$/.test(da) || !/^\d{4}-\d{2}-\d{2}$/.test(a))
          throw new Error("date nel formato YYYY-MM-DD");
        const righe = await db.all(`
          SELECT ${db.sql.dayOf("e.date")} AS giorno, e.hours,
                 t.id AS taskId, t.title, p.name AS project
          FROM TimeEntry e
          JOIN Task t ON t.id = e.taskId
          LEFT JOIN Project p ON p.id = t.projectId
          WHERE e.userId = ? AND date(e.date) BETWEEN date(?) AND date(?)
          ORDER BY e.date, t.title`, user.id, da, a);
        const totale = Math.round(righe.reduce((somma, r) => somma + r.hours, 0) * 10) / 10;
        return { totale_ore: totale,
                 giornate: new Set(righe.map((r) => r.giorno)).size,
                 registrazioni: righe.map((r) => ({
                   giorno: r.giorno, ore: r.hours, task: r.taskId,
                   titolo: stripHtml(r.title), progetto: r.project ?? null })) };
      },
    },
    {
      name: "ore_per_progetto",
      richiede: "timesheet",
      description: "Ore di timesheet aggregate per progetto in un intervallo (date YYYY-MM-DD). Un utente normale vede solo le proprie ore; chi ha il permesso sui timesheet o è amministratore vede quelle di tutti.",
      inputSchema: { type: "object", properties: {
        da: { type: "string", description: "YYYY-MM-DD" },
        a: { type: "string", description: "YYYY-MM-DD" } }, required: ["da", "a"] },
      run: async ({ da, a }) => {
        if (!/^\d{4}-\d{2}-\d{2}$/.test(da) || !/^\d{4}-\d{2}-\d{2}$/.test(a))
          throw new Error("date nel formato YYYY-MM-DD");
        const everyone = user.role === "ADMIN" || user.canViewAllTimesheets;
        const params = everyone ? [da, a] : [da, a, user.id];
        return { di_chi: everyone ? "tutti" : "solo le mie",
          ore: await db.all(`
            SELECT COALESCE(p.name, '(senza progetto)') AS progetto,
                   ROUND(SUM(e.hours), 1) AS ore, COUNT(DISTINCT e.userId) AS persone
            FROM TimeEntry e
            JOIN Task t ON t.id = e.taskId
            LEFT JOIN Project p ON p.id = t.projectId
            WHERE date(e.date) BETWEEN date(?) AND date(?) ${everyone ? "" : "AND e.userId = ?"}
            GROUP BY p.id ORDER BY ore DESC`, ...params) };
      },
    },
    {
      name: "stato_offerte",
      description: "La pipeline commerciale visibile all'utente: offerte per fase con valori totali, più il bilancio delle chiuse — vinte, perse e i MOTIVI delle perdite raggruppati con conteggio e valore. Un utente normale vede solo le offerte sue.",
      inputSchema: { type: "object", properties: {} },
      run: async () => {
        const fasi = (await db.all(`
          SELECT ds.name AS fase, ds.isWon AS stageWon, ds.isLost AS stageLost,
                 COUNT(t.id) AS offerte,
                 ROUND(SUM(COALESCE(t.dealValue, 0)), 0) AS valore
          FROM Task t JOIN DealStage ds ON ds.id = t.dealStageId
          WHERE t.kind = 'DEAL' AND ${per.where}
          GROUP BY ds.id ORDER BY ds.${db.sql.ident("order")}`, ...per.params))
          .map((r) => ({ fase: r.fase, esito: dealOutcome(r), offerte: r.offerte, valore: r.valore }));
        const motivi = await db.all(`
          SELECT COALESCE(NULLIF(TRIM(t.lostReason), ''), '(motivo non indicato)') AS motivo,
                 COUNT(t.id) AS offerte, ROUND(SUM(COALESCE(t.dealValue, 0)), 0) AS valore
          FROM Task t JOIN DealStage ds ON ds.id = t.dealStageId
          WHERE t.kind = 'DEAL' AND ds.isLost = 1 AND ${per.where}
          GROUP BY motivo ORDER BY offerte DESC, valore DESC`, ...per.params);
        const somma = (esito, campo) => fasi.filter((f) => f.esito === esito)
          .reduce((s, f) => s + (f[campo] ?? 0), 0);
        const vinte = somma("vinta", "offerte"), perse = somma("persa", "offerte");
        // Andamento delle chiusure, mese per mese negli ultimi dodici: vinte e
        // perse con i valori, per vedere se il tasso migliora o peggiora.
        const perMese = await db.all(`
          SELECT ${db.sql.monthOf("t.closedAt")} AS mese,
                 SUM(ds.isWon) AS vinte, ROUND(SUM(CASE WHEN ds.isWon THEN COALESCE(t.dealValue, 0) ELSE 0 END), 0) AS valore_vinto,
                 SUM(ds.isLost) AS perse, ROUND(SUM(CASE WHEN ds.isLost THEN COALESCE(t.dealValue, 0) ELSE 0 END), 0) AS valore_perso
          FROM Task t JOIN DealStage ds ON ds.id = t.dealStageId
          WHERE t.kind = 'DEAL' AND t.closedAt IS NOT NULL AND (ds.isWon = 1 OR ds.isLost = 1)
            AND ${db.sql.dayOf("t.closedAt")} >= ${db.sql.todayPlusDays(-365)} AND ${per.where}
          GROUP BY mese ORDER BY mese`, ...per.params);
        const perAzienda = await db.all(`
          SELECT COALESCE(co.name, '(senza azienda)') AS azienda,
                 SUM(COALESCE(ds.isWon, 0) = 0 AND COALESCE(ds.isLost, 0) = 0) AS aperte,
                 SUM(COALESCE(ds.isWon, 0)) AS vinte, SUM(COALESCE(ds.isLost, 0)) AS perse,
                 ROUND(SUM(COALESCE(t.dealValue, 0)), 0) AS valore
          FROM Task t LEFT JOIN DealStage ds ON ds.id = t.dealStageId LEFT JOIN Company co ON co.id = t.companyId
          WHERE t.kind = 'DEAL' AND ${per.where}
          GROUP BY t.companyId ORDER BY valore DESC LIMIT 15`, ...per.params);
        const aperte = await db.get(`
          SELECT COUNT(*) AS offerte, ROUND(SUM(COALESCE(t.dealValue, 0)), 0) AS valore,
                 ROUND(SUM(COALESCE(t.dealValue, 0) * COALESCE(t.probability, 0) / 100.0), 0) AS valore_pesato,
                 ROUND(AVG(${db.sql.daysBetween("t.createdAt", db.sql.now())}), 0) AS eta_media_giorni
          FROM Task t LEFT JOIN DealStage ds ON ds.id = t.dealStageId
          WHERE t.kind = 'DEAL' AND COALESCE(ds.isWon, 0) = 0 AND COALESCE(ds.isLost, 0) = 0 AND ${per.where}`, ...per.params);
        return { fasi,
                 aperte: { ...aperte, valore_pesato_nota: "valore × probabilità" },
                 vinte: { offerte: vinte, valore: somma("vinta", "valore") },
                 perse: { offerte: perse, valore: somma("persa", "valore"), motivi },
                 tasso_vittoria: vinte + perse > 0 ? Math.round((vinte / (vinte + perse)) * 100) : null,
                 per_mese: perMese, per_azienda: perAzienda };
      },
    },
    {
      name: "offerte",
      description: "Le offerte (trattative commerciali) visibili all'utente, con fase, esito (aperta/vinta/persa), valore, probabilità, azienda e — per le perse — il motivo della perdita. Filtri: esito, fase, azienda, testo, giorni (le chiuse negli ultimi N giorni). Per la storia completa di una: dettaglio_offerta.",
      inputSchema: { type: "object", properties: {
        esito: { type: "string", enum: ["aperte", "vinte", "perse", "tutte"], description: "default aperte" },
        fase: { type: "string", description: "nome (anche parziale) della fase" },
        azienda: { type: "string", description: "nome (anche parziale) dell'azienda cliente" },
        testo: { type: "string", description: "parole nel titolo o nella descrizione" },
        giorni: { type: "integer", minimum: 1, maximum: 730, description: "solo le offerte chiuse negli ultimi N giorni (vinte/perse)" } } },
      run: async ({ esito = "aperte", fase, azienda, testo, giorni }) => {
        const conditions = ["t.kind = 'DEAL'", per.where];
        const params = [...per.params];
        if (esito === "aperte") conditions.push("COALESCE(ds.isWon, 0) = 0 AND COALESCE(ds.isLost, 0) = 0");
        if (esito === "vinte") conditions.push("ds.isWon = 1");
        if (esito === "perse") conditions.push("ds.isLost = 1");
        if (fase) { conditions.push("ds.name LIKE ?"); params.push(`%${fase}%`); }
        if (azienda) { conditions.push("co.name LIKE ?"); params.push(`%${azienda}%`); }
        if (testo) { conditions.push("(t.title LIKE ? OR t.description LIKE ?)"); params.push(`%${testo}%`, `%${testo}%`); }
        if (giorni) conditions.push(`t.closedAt IS NOT NULL AND date(t.closedAt) >= ${db.sql.todayPlusDays(-giorni)}`);
        const rows = await db.all(`
          SELECT t.id, t.title, t.kind, t.closedAt, t.dueDate, t.createdViaTicket, t.updatedAt,
                 t.assigneeId, t.supervisorId, t.creatorId,
                 ts.name AS status, NULL AS project,
                 ${ROLE_COLUMNS}, ${DEAL_COLUMNS}
          FROM Task t
          LEFT JOIN TaskStatus ts ON ts.id = t.statusId
          ${ROLE_JOINS} ${DEAL_JOINS}
          WHERE ${conditions.join(" AND ")}
          ORDER BY COALESCE(t.closedAt, t.updatedAt) DESC LIMIT 50`, ...params);
        return { offerte: rows.map((r) => ({
          id: r.id, titolo: stripHtml(r.title), ...dealFields(r),
          assegnatario: r.assignee ?? null, chiusa_il: day(r.closedAt),
          aggiornata: day(r.updatedAt), url: taskUrl(keelopsUrl, r.id) })) };
      },
    },
    {
      name: "dettaglio_offerta",
      description: "Tutto di UNA offerta: dati commerciali, referente, motivo della perdita, la storia dei passaggi di fase (chi, quando, da quale a quale, con il motivo scritto al momento), i cambi di valore, gli ultimi messaggi della chat, i task collegati, la lettura degli allegati se fatta.",
      inputSchema: { type: "object", properties: { id: { type: "string", description: "id dell'offerta (da offerte/search)" } }, required: ["id"] },
      run: async ({ id }) => {
        const r = await db.get(`
          SELECT t.id, t.title, t.description, t.kind, t.createdAt, t.closedAt, t.updatedAt,
                 t.dueDate, t.createdViaTicket, t.assigneeId, t.supervisorId, t.creatorId,
                 t.visibleToSalesMonitors,
                 ${ROLE_COLUMNS}, ${DEAL_COLUMNS},
                 TRIM(${db.sql.concat("COALESCE(ct.firstName, '')", "' '", "COALESCE(ct.lastName, '')")}) AS contact,
                 ct.roleTitle AS contactRole, ct.email AS contactEmail, ct.phone AS contactPhone
          FROM Task t
          ${ROLE_JOINS} ${DEAL_JOINS}
          LEFT JOIN Contact ct ON ct.id = t.contactId
          WHERE t.id = ? AND t.kind = 'DEAL' AND ${per.where}`, id, ...per.params);
        if (!r) throw new Error("offerta non trovata o non visibile a questo utente");
        const eventi = await db.all(`
          SELECT a.action, a.payload, a.createdAt, COALESCE(u.nickName, u.name) AS author
          FROM ActivityLog a LEFT JOIN User u ON u.id = a.userId
          WHERE a.taskId = ? AND a.action IN ('stage_changed', 'value_changed', 'created')
          ORDER BY a.createdAt`, id);
        const storiaFasi = eventi.filter((e) => e.action === "stage_changed").map((e) => {
          const p = parsePayload(e.payload);
          return { da: p.from ?? null, a: p.to ?? null, motivo: p.reason ?? null,
                   di: e.author ?? null, quando: minute(e.createdAt) };
        });
        const cambiValore = eventi.filter((e) => e.action === "value_changed").map((e) => {
          const p = parsePayload(e.payload);
          return { da: p.from ?? null, a: p.to ?? null, di: e.author ?? null, quando: minute(e.createdAt) };
        });
        const messaggi = (await db.all(`
          SELECT c.body, c.createdAt, COALESCE(u.nickName, u.name) AS author
          FROM Comment c LEFT JOIN User u ON u.id = c.authorId
          WHERE c.taskId = ? AND c.secret = 0
          ORDER BY c.createdAt DESC LIMIT 20`, id))
          .map((c) => ({ di: c.author ?? null, quando: minute(c.createdAt), testo: stripHtml(c.body) }))
          .reverse();
        const collegati = (await db.all(`
          SELECT t.id, t.title, t.kind, t.closedAt, ts.name AS status,
                 CASE WHEN t.sourceDealId = ? THEN 'fatturazione' ELSE 'collegato' END AS legame
          FROM Task t LEFT JOIN TaskStatus ts ON ts.id = t.statusId
          WHERE (t.relatedDealId = ? OR t.sourceDealId = ?) AND t.deletedAt IS NULL
          ORDER BY t.createdAt`, id, id, id))
          .map((t) => ({ id: t.id, titolo: stripHtml(t.title), tipo: t.kind, legame: t.legame,
                         stato: t.status ?? null, chiuso: Boolean(t.closedAt), url: taskUrl(keelopsUrl, t.id) }));
        const analisi = await db.get(`
          SELECT state, projectName, completedAt, appliedAt FROM DealAnalysis WHERE dealId = ?`, id);
        const allegati = await db.all(`
          SELECT a.name, a.type FROM TaskAttachment ta JOIN Attachment a ON a.id = ta.attachmentId
          WHERE ta.taskId = ? ORDER BY a.createdAt`, id);
        return {
          id: r.id, titolo: stripHtml(r.title), ...dealFields(r),
          descrizione: stripHtml(r.description) || null,
          referente: r.contact ? { nome: r.contact, ruolo: r.contactRole ?? null,
                                   email: r.contactEmail ?? null, telefono: r.contactPhone ?? null } : null,
          assegnatario: r.assignee ?? null, supervisore: r.supervisor ?? null, creato_da: r.creator ?? null,
          miei_ruoli: myRoles(r, user),
          aperta_il: day(r.createdAt), chiusa_il: day(r.closedAt), aggiornata: day(r.updatedAt),
          visibile_ai_finanziatori: Boolean(r.visibleToSalesMonitors),
          storia_fasi: storiaFasi, cambi_valore: cambiValore,
          messaggi, task_collegati: collegati,
          ...se(ha(user, "analisi-offerte"), {
            lettura_allegati: analisi ? { stato: analisi.state, progetto_proposto: analisi.projectName ?? null,
                                          completata: day(analisi.completedAt), applicata: day(analisi.appliedAt) } : null }),
          allegati: allegati.map((a) => ({ nome: a.name, tipo: a.type })),
          url: taskUrl(keelopsUrl, r.id) };
      },
    },
  ];
}
