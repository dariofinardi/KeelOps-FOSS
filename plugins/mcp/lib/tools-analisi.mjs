// Copyright (c) 2026 Jugaad s.r.l.
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * The ANALYSIS tools: aggregated, analysis-ready readings of every kind of
 * data KeelOps collects — tasks, projects, support requests, hours, customers —
 * so an assistant can compute statistics and judgements without pulling
 * thousands of records one by one. The user asked for exactly this
 * (31/08/2026): "the model must receive what it needs to analyse, count and
 * evaluate every kind of data".
 *
 * Same rules as the other tools: read-only, inside the authenticated user's
 * perimeter (tasks through `taskPerimeter`, hours through the timesheet
 * permission), SQL dialect only through `db.sql`.
 */
import { stripHtml } from "../../keelops-sdk/text.mjs";
import { taskPerimeter, projectPerimeter } from "../../keelops-sdk/perimeter.mjs";
import { ha, se } from "./edizione.mjs";

const DATE = /^\d{4}-\d{2}-\d{2}$/;

/** A plain-language map of the data, for the model that has to reason about it. */
const GUIDA = `
KeelOps raccoglie il lavoro di una piccola azienda in UN solo tipo di record, il task, vestito in cinque modi (campo "tipo"):
- ADMIN: scadenza amministrativa (fatture, adempimenti, telefonate); vive nello scadenzario e nelle bacheche.
- PROJECT: task di progetto (sviluppo, consegne); ha un progetto e spesso un genitore (subtask).
- DEAL: offerta commerciale (trattativa): fase della pipeline, valore, probabilità, azienda cliente, referente; quando la fase è "vinta" o "persa" l'offerta è chiusa e, se persa, può avere il motivo della perdita.
- TICKET / nata_da_ticket: richiesta di supporto aperta da un cliente del portale o da un interno; ha priorità (LOW/MEDIUM/HIGH) e un progetto di riferimento. Le richieste possono essere di tipo PROJECT con nata_da_ticket = true.
- PERSONAL: task privato di una bacheca personale.
Persone: ogni task ha tre ruoli distinti — assegnatario (chi esegue), supervisore (il referente) e creato_da (chi l'ha aperto). "miei_ruoli" dice quali di questi sei tu.
Stati: ogni task ha uno stato configurabile per categoria; "chiuso" = lo stato è di chiusura (closedAt valorizzato). "in_ritardo" = aperto con scadenza passata.
Ore: il timesheet registra ore per persona, task e giorno (passi di 0,25). Un utente normale vede solo le proprie; amministratori e chi ha il permesso vedono quelle di tutti.
Progetti: hanno membri con ruolo (MANAGER/EDITOR/VIEWER), un'azienda cliente opzionale, task e ore.
Aziende e contatti: l'anagrafica CRM; le offerte e i progetti si legano all'azienda, il referente dell'offerta a un contatto.
Cronologia: ogni cambio di stato, fase, assegnatario, valore o scadenza è registrato con chi e quando (storico_stati, dettaglio_offerta).
Perimetro: ogni strumento risponde SOLO con ciò che l'utente autenticato vedrebbe nell'applicazione; le offerte e le ore altrui restano fuori a chi non ne ha diritto.
Date: giorni in formato YYYY-MM-DD, mesi YYYY-MM; le durate sono in giorni (decimali).
Strumenti di analisi: statistiche_task, dettaglio_progetto, statistiche_richieste, statistiche_ore, aziende, stato_offerte, offerte, dettaglio_offerta; per i record singoli: cerca_task, fetch, scadenze, storico_stati, mio_timesheet.
`.trim();

/** The task kinds this core has: TICKET only with the `ticket` function. */
const tipiTask = (user) =>
  ["ADMIN", "PROJECT", "DEAL", "TICKET", "PERSONAL"].filter((k) => k !== "TICKET" || ha(user, "ticket"));

/**
 * The guide without what this core lacks (08/10/2026): the TICKET line and the
 * tools that are hidden. With everything, the text as it was.
 */
function guidaPer(user) {
  const senzaOre = !ha(user, "timesheet");
  const senzaTicket = !ha(user, "ticket");
  if (!senzaOre && !senzaTicket) return GUIDA;
  // The grid is core (08/10/2026): own hours are always there, the statistics are commercial.
  const nascosti = [...(senzaOre ? ["statistiche_ore"] : []), ...(senzaTicket ? ["statistiche_richieste"] : [])];
  return GUIDA.split("\n")
    .filter((riga) => !(senzaTicket && riga.startsWith("- TICKET")))
    .map((riga) => (riga.startsWith("Strumenti di analisi:")
      ? riga.replace(new RegExp(`(?:, )?\\b(?:${nascosti.join("|")})\\b`, "g"), "")
      : riga))
    .join("\n");
}

/** A ticket is a TICKET record or a project task born from the ticket area. */
const IS_REQUEST = "(t.kind = 'TICKET' OR t.createdViaTicket = 1)";

export function buildAnalysisTools(db, user, keelopsUrl, { taskUrl }) {
  const per = taskPerimeter(user);
  const perProj = projectPerimeter(user);
  const everyoneHours = user.role === "ADMIN" || Boolean(user.canViewAllTimesheets);
  const overdue = `(t.closedAt IS NULL AND t.dueDate IS NOT NULL AND ${db.sql.dayOf("t.dueDate")} < ${db.sql.today()})`;
  const round1 = (v) => (v == null ? null : Math.round(v * 10) / 10);

  /** The recurring block: counts, distributions and monthly trend over a task filter. */
  async function taskStatistics(conditions, params, giorni) {
    const where = conditions.join(" AND ");
    const totals = await db.get(`
      SELECT COUNT(*) AS totale, SUM(t.closedAt IS NULL) AS aperti, SUM(t.closedAt IS NOT NULL) AS chiusi,
             SUM(${overdue}) AS in_ritardo,
             ROUND(AVG(CASE WHEN t.closedAt IS NOT NULL AND ${db.sql.dayOf("t.closedAt")} >= ${db.sql.todayPlusDays(-giorni)}
                       THEN ${db.sql.daysBetween("t.createdAt", "t.closedAt")} END), 1) AS tempo_medio_chiusura_giorni,
             ROUND(AVG(CASE WHEN t.closedAt IS NULL THEN ${db.sql.daysBetween("t.createdAt", db.sql.now())} END), 1) AS eta_media_aperti_giorni
      FROM Task t WHERE ${where}`, ...params);
    const perTipo = await db.all(`
      SELECT t.kind AS tipo, SUM(t.closedAt IS NULL) AS aperti, SUM(t.closedAt IS NOT NULL) AS chiusi,
             SUM(${overdue}) AS in_ritardo
      FROM Task t WHERE ${where} GROUP BY t.kind ORDER BY aperti DESC`, ...params);
    const perStato = await db.all(`
      SELECT COALESCE(ts.name, bs.name, '(senza stato)') AS stato, COUNT(*) AS task
      FROM Task t LEFT JOIN TaskStatus ts ON ts.id = t.statusId LEFT JOIN BoardStatus bs ON bs.id = t.boardStatusId
      WHERE ${where} AND t.closedAt IS NULL GROUP BY stato ORDER BY task DESC`, ...params);
    const perAssegnatario = await db.all(`
      SELECT COALESCE(ua.nickName, ua.name, '(non assegnato)') AS assegnatario,
             SUM(t.closedAt IS NULL) AS aperti, SUM(${overdue}) AS in_ritardo,
             SUM(t.closedAt IS NOT NULL AND ${db.sql.dayOf("t.closedAt")} >= ${db.sql.todayPlusDays(-giorni)}) AS chiusi_nel_periodo
      FROM Task t LEFT JOIN User ua ON ua.id = t.assigneeId
      WHERE ${where} GROUP BY t.assigneeId ORDER BY aperti DESC LIMIT 30`, ...params);
    // The derived table needs an alias: SQLite lets one go without, MySQL
    // (and the standard) do not.
    const perMese = await db.all(`
      SELECT mese, SUM(creati) AS creati, SUM(chiusi) AS chiusi FROM (
        SELECT ${db.sql.monthOf("t.createdAt")} AS mese, 1 AS creati, 0 AS chiusi FROM Task t
        WHERE ${where} AND ${db.sql.dayOf("t.createdAt")} >= ${db.sql.todayPlusDays(-giorni)}
        UNION ALL
        SELECT ${db.sql.monthOf("t.closedAt")} AS mese, 0, 1 FROM Task t
        WHERE ${where} AND t.closedAt IS NOT NULL AND ${db.sql.dayOf("t.closedAt")} >= ${db.sql.todayPlusDays(-giorni)}
      ) AS per_mese GROUP BY mese ORDER BY mese`, ...params, ...params);
    const piuVecchi = (await db.all(`
      SELECT t.id, t.title, t.kind, t.createdAt, t.dueDate, COALESCE(ua.nickName, ua.name) AS assignee
      FROM Task t LEFT JOIN User ua ON ua.id = t.assigneeId
      WHERE ${where} AND t.closedAt IS NULL ORDER BY t.createdAt LIMIT 5`, ...params))
      .map((r) => ({ id: r.id, titolo: stripHtml(r.title), tipo: r.kind, aperto_il: r.createdAt?.slice(0, 10) ?? null,
                     scadenza: r.dueDate?.slice(0, 10) ?? null, assegnatario: r.assignee ?? null, url: taskUrl(keelopsUrl, r.id) }));
    return { periodo_giorni: giorni, ...totals, per_tipo: perTipo, per_stato: perStato,
             per_assegnatario: perAssegnatario, per_mese: perMese, piu_vecchi_aperti: piuVecchi };
  }

  return [
    {
      name: "guida_dati",
      description: "Come sono fatti i dati di KeelOps (tipi di task, ruoli, stati, ore, offerte, richieste, perimetro) e quale strumento usare per cosa. Da leggere prima di fare analisi o statistiche.",
      inputSchema: { type: "object", properties: {} },
      run: async () => ({ guida: guidaPer(user) }),
    },
    {
      name: "statistiche_task",
      description: `Statistiche sui task visibili all'utente: totali (aperti, chiusi, in ritardo), distribuzione per tipo, per stato e per assegnatario, andamento mensile creati/chiusi, tempo medio di chiusura ed età media degli aperti, i cinque aperti più vecchi. Filtri: tipo (${tipiTask(user).join(", ")}), progetto, giorni (finestra per andamento e tempi, default 90).`,
      inputSchema: { type: "object", properties: {
        tipo: { type: "string", enum: tipiTask(user) },
        progetto: { type: "string", description: "nome (anche parziale) del progetto" },
        giorni: { type: "integer", minimum: 7, maximum: 730 } } },
      run: async ({ tipo, progetto, giorni = 90 }) => {
        const conditions = [per.where];
        const params = [...per.params];
        if (tipo) { conditions.push("t.kind = ?"); params.push(tipo); }
        if (progetto) { conditions.push("t.projectId IN (SELECT p.id FROM Project p WHERE p.name LIKE ?)"); params.push(`%${progetto}%`); }
        return await taskStatistics(conditions, params, giorni);
      },
    },
    {
      name: "dettaglio_progetto",
      description: "Tutto di UN progetto (per nome, anche parziale, o id): azienda, membri e ruoli, task per stato e per assegnatario, ritardi, ore totali e per persona, andamento mensile, richieste di supporto collegate, tempo medio di chiusura, i task aperti più vecchi.",
      inputSchema: { type: "object", properties: {
        progetto: { type: "string", description: "nome (anche parziale) o id del progetto" },
        giorni: { type: "integer", minimum: 7, maximum: 730, description: "finestra per andamento e tempi, default 180" } }, required: ["progetto"] },
      run: async ({ progetto, giorni = 180 }) => {
        const p = await db.get(`
          SELECT p.id, p.name, p.description, p.isArchived, p.createdAt, co.name AS company
          FROM Project p LEFT JOIN Company co ON co.id = p.companyId
          WHERE ${perProj.where} AND (p.id = ? OR p.name LIKE ?)
          ORDER BY p.isArchived, length(p.name) LIMIT 1`, ...perProj.params, progetto, `%${progetto}%`);
        if (!p) throw new Error("progetto non trovato o non visibile a questo utente");
        const membri = await db.all(`
          SELECT COALESCE(u.nickName, u.name) AS nome, pm.role AS ruolo
          FROM ProjectMember pm JOIN User u ON u.id = pm.userId WHERE pm.projectId = ? ORDER BY pm.role, nome`, p.id);
        const stats = await taskStatistics([per.where, "t.projectId = ?"], [...per.params, p.id], giorni);
        const hoursWhere = everyoneHours ? "" : "AND e.userId = ?";
        const hoursParams = everyoneHours ? [p.id] : [p.id, user.id];
        const ore = await db.get(`
          SELECT ROUND(COALESCE(SUM(e.hours), 0), 1) AS ore, COUNT(DISTINCT e.userId) AS persone,
                 COUNT(DISTINCT ${db.sql.dayOf("e.date")}) AS giornate
          FROM TimeEntry e JOIN Task t ON t.id = e.taskId WHERE t.projectId = ? ${hoursWhere}`, ...hoursParams);
        const orePerPersona = await db.all(`
          SELECT COALESCE(u.nickName, u.name) AS persona, ROUND(SUM(e.hours), 1) AS ore
          FROM TimeEntry e JOIN Task t ON t.id = e.taskId JOIN User u ON u.id = e.userId
          WHERE t.projectId = ? ${hoursWhere} GROUP BY e.userId ORDER BY ore DESC`, ...hoursParams);
        const orePerMese = await db.all(`
          SELECT ${db.sql.monthOf("e.date")} AS mese, ROUND(SUM(e.hours), 1) AS ore
          FROM TimeEntry e JOIN Task t ON t.id = e.taskId
          WHERE t.projectId = ? ${hoursWhere} AND ${db.sql.dayOf("e.date")} >= ${db.sql.todayPlusDays(-giorni)}
          GROUP BY mese ORDER BY mese`, ...hoursParams);
        const richieste = await db.get(`
          SELECT COUNT(*) AS totale, SUM(t.closedAt IS NULL) AS aperte
          FROM Task t WHERE ${per.where} AND ${IS_REQUEST} AND (t.projectId = ? OR t.relatedProjectId = ?)`,
          ...per.params, p.id, p.id);
        return { id: p.id, nome: p.name, descrizione: stripHtml(p.description) || null,
                 azienda: p.company ?? null, archiviato: Boolean(p.isArchived),
                 creato_il: p.createdAt?.slice(0, 10) ?? null, membri,
                 task: stats,
                 ...se(ha(user, "timesheet"), { ore: { ...ore, di_chi: everyoneHours ? "tutti" : "solo le mie", per_persona: orePerPersona, per_mese: orePerMese } }),
                 ...se(ha(user, "ticket"), { richieste_supporto: richieste }),
                 url: keelopsUrl ? `${keelopsUrl}/progetti/${encodeURIComponent(p.id)}` : null };
      },
    },
    {
      name: "statistiche_richieste",
      richiede: "ticket",
      description: "Statistiche sulle richieste di supporto (ticket) visibili: totali, per priorità, per progetto, per richiedente e per azienda, andamento mensile aperte/chiuse, tempo medio di risoluzione, le più vecchie ancora aperte. Filtri: progetto, giorni (default 90).",
      inputSchema: { type: "object", properties: {
        progetto: { type: "string" }, giorni: { type: "integer", minimum: 7, maximum: 730 } } },
      run: async ({ progetto, giorni = 90 }) => {
        const conditions = [per.where, IS_REQUEST];
        const params = [...per.params];
        if (progetto) {
          conditions.push("(t.projectId IN (SELECT p.id FROM Project p WHERE p.name LIKE ?) OR t.relatedProjectId IN (SELECT p.id FROM Project p WHERE p.name LIKE ?))");
          params.push(`%${progetto}%`, `%${progetto}%`);
        }
        const where = conditions.join(" AND ");
        const base = await taskStatistics(conditions, params, giorni);
        const perPriorita = await db.all(`
          SELECT COALESCE(t.ticketPriority, '(senza)') AS priorita, SUM(t.closedAt IS NULL) AS aperte, SUM(t.closedAt IS NOT NULL) AS chiuse,
                 ROUND(AVG(CASE WHEN t.closedAt IS NOT NULL THEN ${db.sql.daysBetween("t.createdAt", "t.closedAt")} END), 1) AS giorni_medi_chiusura
          FROM Task t WHERE ${where} GROUP BY priorita ORDER BY aperte DESC`, ...params);
        const perProgetto = await db.all(`
          SELECT COALESCE(p.name, p2.name, '(senza progetto)') AS progetto, SUM(t.closedAt IS NULL) AS aperte, COUNT(*) AS totale
          FROM Task t LEFT JOIN Project p ON p.id = t.projectId LEFT JOIN Project p2 ON p2.id = t.relatedProjectId
          WHERE ${where} GROUP BY progetto ORDER BY aperte DESC, totale DESC LIMIT 30`, ...params);
        const perRichiedente = await db.all(`
          SELECT COALESCE(uc.nickName, uc.name) AS richiedente, co.name AS azienda,
                 COUNT(*) AS totale, SUM(t.closedAt IS NULL) AS aperte
          FROM Task t LEFT JOIN User uc ON uc.id = t.creatorId LEFT JOIN Company co ON co.id = uc.companyId
          WHERE ${where} GROUP BY t.creatorId ORDER BY totale DESC LIMIT 30`, ...params);
        return { ...base, per_priorita: perPriorita, per_progetto: perProgetto, per_richiedente: perRichiedente,
                 // nel blocco base "per_tipo" distingue solo TICKET/PROJECT: qui non serve
                 per_tipo: undefined };
      },
    },
    {
      name: "statistiche_ore",
      richiede: "timesheet",
      description: "Ore di timesheet aggregate in un intervallo (date YYYY-MM-DD), raggruppate per progetto, persona, mese, tipo di attività o azienda cliente: ore, giornate lavorate, persone, media ore/giornata. Un utente normale vede solo le proprie ore; amministratori e chi ha il permesso vedono quelle di tutti.",
      inputSchema: { type: "object", properties: {
        da: { type: "string", description: "YYYY-MM-DD" }, a: { type: "string", description: "YYYY-MM-DD" },
        raggruppa: { type: "string", enum: ["progetto", "persona", "mese", "tipo_attivita", "azienda", "tipo_task"], description: "default progetto" } },
        required: ["da", "a"] },
      run: async ({ da, a, raggruppa = "progetto" }) => {
        if (!DATE.test(da) || !DATE.test(a)) throw new Error("date nel formato YYYY-MM-DD");
        const chiave = {
          progetto: "COALESCE(p.name, '(senza progetto)')",
          persona: "COALESCE(u.nickName, u.name)",
          mese: db.sql.monthOf("e.date"),
          tipo_attivita: "COALESCE(at.name, '(senza tipo)')",
          azienda: "COALESCE(co.name, pco.name, '(senza azienda)')",
          tipo_task: "t.kind",
        }[raggruppa];
        if (!chiave) throw new Error("raggruppa: progetto | persona | mese | tipo_attivita | azienda | tipo_task");
        const params = everyoneHours ? [da, a] : [da, a, user.id];
        const righe = await db.all(`
          SELECT ${chiave} AS chiave, ROUND(SUM(e.hours), 1) AS ore,
                 COUNT(DISTINCT ${db.sql.concat("e.userId", "'/'", db.sql.dayOf("e.date"))}) AS giornate,
                 COUNT(DISTINCT e.userId) AS persone
          FROM TimeEntry e
          JOIN Task t ON t.id = e.taskId
          JOIN User u ON u.id = e.userId
          LEFT JOIN Project p ON p.id = t.projectId
          LEFT JOIN ActivityType at ON at.id = t.activityTypeId
          LEFT JOIN Company co ON co.id = t.companyId
          LEFT JOIN Company pco ON pco.id = p.companyId
          WHERE ${db.sql.dayOf("e.date")} BETWEEN ? AND ? ${everyoneHours ? "" : "AND e.userId = ?"}
          GROUP BY chiave ORDER BY ${raggruppa === "mese" ? "chiave" : "ore DESC"}`, ...params);
        const totale = round1(righe.reduce((s, r) => s + (r.ore ?? 0), 0));
        return { da, a, di_chi: everyoneHours ? "tutti" : "solo le mie", raggruppato_per: raggruppa, totale_ore: totale,
                 righe: righe.map((r) => ({ ...r, media_ore_giornata: r.giornate ? round1(r.ore / r.giornate) : null })) };
      },
    },
    {
      name: "aziende",
      description: "Le aziende clienti con il loro peso: contatti, offerte aperte/vinte/perse con i valori, progetti, ultima offerta e ultimo contatto. Solo ciò che l'utente vede (le offerte altrui non contano). Filtro: testo nel nome.",
      inputSchema: { type: "object", properties: { testo: { type: "string" }, limite: { type: "integer", minimum: 1, maximum: 200 } } },
      run: async ({ testo, limite = 50 }) => {
        const params = [...per.params, ...perProj.params];
        const conditions = ["co.deletedAt IS NULL"];
        if (testo) { conditions.push("co.name LIKE ?"); params.push(`%${testo}%`); }
        const righe = await db.all(`
          SELECT co.id, co.name, co.city,
                 (SELECT COUNT(*) FROM Contact c WHERE c.companyId = co.id AND c.deletedAt IS NULL) AS contatti,
                 d.aperte, d.vinte, d.perse, d.valore_aperto, d.valore_vinto, d.valore_perso, d.ultima,
                 (SELECT COUNT(*) FROM Project p WHERE p.companyId = co.id AND ${perProj.where}) AS progetti
          FROM Company co
          LEFT JOIN (
            SELECT t.companyId,
                   SUM(COALESCE(ds.isWon, 0) = 0 AND COALESCE(ds.isLost, 0) = 0) AS aperte,
                   SUM(COALESCE(ds.isWon, 0)) AS vinte, SUM(COALESCE(ds.isLost, 0)) AS perse,
                   ROUND(SUM(CASE WHEN COALESCE(ds.isWon, 0) = 0 AND COALESCE(ds.isLost, 0) = 0 THEN COALESCE(t.dealValue, 0) ELSE 0 END), 0) AS valore_aperto,
                   ROUND(SUM(CASE WHEN ds.isWon THEN COALESCE(t.dealValue, 0) ELSE 0 END), 0) AS valore_vinto,
                   ROUND(SUM(CASE WHEN ds.isLost THEN COALESCE(t.dealValue, 0) ELSE 0 END), 0) AS valore_perso,
                   MAX(t.updatedAt) AS ultima
            FROM Task t LEFT JOIN DealStage ds ON ds.id = t.dealStageId
            WHERE t.kind = 'DEAL' AND ${per.where} GROUP BY t.companyId
          ) d ON d.companyId = co.id
          WHERE ${conditions.join(" AND ")}
          ORDER BY COALESCE(d.valore_vinto, 0) + COALESCE(d.valore_aperto, 0) DESC, co.name
          LIMIT ?`, ...params, limite);
        return { aziende: righe.map((r) => ({
          id: r.id, nome: r.name, citta: r.city ?? null, contatti: r.contatti, progetti: r.progetti,
          offerte: { aperte: r.aperte ?? 0, vinte: r.vinte ?? 0, perse: r.perse ?? 0,
                     valore_aperto: r.valore_aperto ?? 0, valore_vinto: r.valore_vinto ?? 0, valore_perso: r.valore_perso ?? 0 },
          ultima_offerta: r.ultima?.slice(0, 10) ?? null })) };
      },
    },
  ];
}
