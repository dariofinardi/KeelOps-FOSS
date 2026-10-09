/**
 * The record-level tools (05/09/2026): everything an assistant may need to
 * READ about one thing — a task in full, its attachments (with the file
 * itself, lent by the core), the support requests, the chat, people,
 * companies and contacts, recurrences, tags, notifications and the personal
 * boards. All inside the authenticated user's perimeter, like the rest.
 *
 * `attachments` is the core's `ctx.attachments` (null when the plugin runs on
 * its own): the file store and the download rule live in the core, and the
 * plugin asks it rather than reaching for the disk.
 */
import { stripHtml } from "../../keelops-sdk/text.mjs";
import { taskPerimeter, projectPerimeter } from "../../keelops-sdk/perimeter.mjs";
import { ha, se } from "./edizione.mjs";

/**
 * A link is not a file: KeelOps keeps only the address (no Drive tokens on
 * the server, by design). The assistant reads it only through ITS OWN
 * connector to that service, authorized with an account that can open the
 * file — said outright, or "not found" looks like our fault (05/09/2026).
 */
export function linkNote(url) {
  return /https?:\/\/(drive|docs|sheets|slides)\.google\.com\//i.test(url ?? "")
    ? "Collegamento a Google Drive: KeelOps non ha il file, solo l'indirizzo. Si legge SOLO con il connettore Google Drive dell'assistente, autorizzato con un account Google che abbia il permesso su questo file; senza, il contenuto non è raggiungibile e va chiesto a chi lo ha condiviso."
    : "Collegamento esterno: KeelOps non ha il file, solo l'indirizzo. Si legge solo se l'assistente ha un connettore verso quel servizio, autorizzato per accedervi.";
}

const day = (v) => v?.slice(0, 10) ?? null;
const minute = (v) => v?.slice(0, 16) ?? null;
const parse = (raw) => { try { return JSON.parse(raw ?? "{}"); } catch { return {}; } };

export function buildRecordTools(db, user, keelopsUrl, attachments, { taskUrl }) {
  const per = taskPerimeter(user);
  const perP = projectPerimeter(user);
  const isAdmin = user.role === "ADMIN";

  /** A task the user may see, or an error that says so. */
  async function visibleTask(id) {
    const t = await db.get(`SELECT t.id FROM Task t WHERE t.id = ? AND ${per.where}`, id, ...per.params);
    if (!t) throw new Error("task non trovato o non visibile a questo utente");
    return t.id;
  }

  /** Attachments of a task: the task's own and those that arrived with a message. */
  async function attachmentsOf(taskId) {
    const rows = await db.all(`
      SELECT a.id, a.name, a.type, a.mimeType, a.size, a.url, a.createdAt,
             COALESCE(uu.nickName, uu.name) AS uploader, ca.commentId
      FROM TaskAttachment ta
      JOIN Attachment a ON a.id = ta.attachmentId
      LEFT JOIN User uu ON uu.id = a.uploadedById
      LEFT JOIN CommentAttachment ca ON ca.attachmentId = a.id
      WHERE ta.taskId = ? ORDER BY a.createdAt`, taskId);
    return rows.map((a) => ({
      id: a.id, nome: a.name, tipo: a.type === "LINK" ? "collegamento" : "file",
      mime: a.mimeType ?? null, byte: a.size ?? null, url: a.type === "LINK" ? a.url : null,
      caricato_da: a.uploader ?? null, quando: day(a.createdAt),
      arrivato_con_messaggio: Boolean(a.commentId),
      ...(a.type === "LINK" ? { nota: linkNote(a.url) } : { leggibile_con: "leggi_allegato" }) }));
  }

  /** The MCP content for one attachment: text always, the file itself when asked and possible. */
  async function attachmentContent(id, formato) {
    if (!attachments) throw new Error("lettura degli allegati non disponibile: il plugin gira fuori dal core");
    const a = await attachments.read(user.id, id, { bytes: formato === "file" });
    const meta = { id: a.id, nome: a.name, tipo: a.type === "LINK" ? "collegamento" : "file",
                   mime: a.mimeType, byte: a.size, url: a.url ?? undefined,
                   testo_estratto: a.text ? "sì" : "no", nota: a.saltato ?? undefined };
    const content = [{ type: "text", text: JSON.stringify(meta, null, 1) }];
    if (a.text) content.push({ type: "text", text: a.text });
    if (a.bytes) {
      const blob = a.bytes.toString("base64");
      const mime = a.mimeType ?? "application/octet-stream";
      content.push(mime.startsWith("image/")
        ? { type: "image", data: blob, mimeType: mime }
        : { type: "resource", resource: { uri: `keelops://allegato/${a.id}`, mimeType: mime, blob } });
    }
    return content;
  }

  return [
    {
      name: "dettaglio_task",
      description: "Tutto di UN task (di qualunque tipo: scadenzario, progetto, richiesta di supporto, offerta): campi, i tre ruoli, stato e scadenza, tag, azienda e referente, progetto, task padre e sottotask, sequenza (propedeutico e conseguenti), ore per persona, ricorrenza, dati della richiesta (priorità, riferimento, richiedente), la chat (messaggi non riservati con i loro allegati), gli allegati con gli id per leggi_allegato, e lo storico completo.",
      inputSchema: { type: "object", properties: { id: { type: "string", description: "id del task (da search/cerca_task/scadenze)" } }, required: ["id"] },
      run: async ({ id }) => {
        const r = await db.get(`
          SELECT t.*, p.name AS project, p.id AS projectId2, ts.name AS status, ts.isClosed AS statusClosed,
                 at.name AS activityType, co.name AS company, ds.name AS stage,
                 TRIM(${db.sql.concat("COALESCE(ct.firstName, '')", "' '", "COALESCE(ct.lastName, '')")}) AS contact,
                 ct.roleTitle AS contactRole, ct.email AS contactEmail, ct.phone AS contactPhone,
                 COALESCE(ua.nickName, ua.name) AS assignee, COALESCE(us.nickName, us.name) AS supervisor,
                 COALESCE(uc.nickName, uc.name) AS creator, uc.email AS creatorEmail, cco.name AS creatorCompany,
                 pt.title AS parentTitle, pre.title AS predecessorTitle,
                 rd.title AS relatedDeal, rp.name AS relatedProject
          FROM Task t
          LEFT JOIN Project p ON p.id = t.projectId
          LEFT JOIN TaskStatus ts ON ts.id = t.statusId
          LEFT JOIN ActivityType at ON at.id = t.activityTypeId
          LEFT JOIN Company co ON co.id = t.companyId
          LEFT JOIN DealStage ds ON ds.id = t.dealStageId
          LEFT JOIN Contact ct ON ct.id = t.contactId
          LEFT JOIN User ua ON ua.id = t.assigneeId
          LEFT JOIN User us ON us.id = t.supervisorId
          LEFT JOIN User uc ON uc.id = t.creatorId
          LEFT JOIN Company cco ON cco.id = uc.companyId
          LEFT JOIN Task pt ON pt.id = t.parentTaskId
          LEFT JOIN Task pre ON pre.id = t.predecessorId
          LEFT JOIN Task rd ON rd.id = t.relatedDealId
          LEFT JOIN Project rp ON rp.id = t.relatedProjectId
          WHERE t.id = ? AND ${per.where}`, id, ...per.params);
        if (!r) throw new Error("task non trovato o non visibile a questo utente");
        const [tags, subtasks, successors, hours, comments, allegati, history, recurrence] = await Promise.all([
          db.all(`SELECT tg.name FROM TaskTag tt JOIN Tag tg ON tg.id = tt.tagId WHERE tt.taskId = ? ORDER BY tg.name`, id),
          db.all(`SELECT t.id, t.title, t.closedAt, ts.name AS status FROM Task t LEFT JOIN TaskStatus ts ON ts.id = t.statusId
                  WHERE t.parentTaskId = ? AND t.deletedAt IS NULL ORDER BY t.createdAt`, id),
          db.all(`SELECT t.id, t.title, t.closedAt FROM Task t WHERE t.predecessorId = ? AND t.deletedAt IS NULL ORDER BY t.createdAt`, id),
          db.all(`SELECT COALESCE(u.nickName, u.name) AS persona, ROUND(SUM(e.hours), 1) AS ore, COUNT(*) AS registrazioni,
                         MIN(${db.sql.dayOf("e.date")}) AS dal, MAX(${db.sql.dayOf("e.date")}) AS al
                  FROM TimeEntry e LEFT JOIN User u ON u.id = e.userId WHERE e.taskId = ? GROUP BY e.userId ORDER BY ore DESC`, id),
          db.all(`SELECT c.id, c.body, c.createdAt, c.sentToClient, COALESCE(u.nickName, u.name) AS author
                  FROM Comment c LEFT JOIN User u ON u.id = c.authorId
                  WHERE c.taskId = ? AND c.secret = 0 ORDER BY c.createdAt DESC LIMIT 50`, id),
          attachmentsOf(id),
          db.all(`SELECT a.action, a.payload, a.createdAt, COALESCE(u.nickName, u.name) AS author
                  FROM ActivityLog a LEFT JOIN User u ON u.id = a.userId WHERE a.taskId = ? ORDER BY a.createdAt DESC LIMIT 60`, id),
          r.recurrenceTemplateId
            ? db.get(`SELECT rt.title, rt.rrule, rt.isActive FROM RecurrenceTemplate rt WHERE rt.id = ?`, r.recurrenceTemplateId)
            : Promise.resolve(null),
        ]);
        const byComment = new Map();
        for (const a of allegati) if (a.arrivato_con_messaggio) byComment.set(a.id, a);
        const attachmentsByComment = await db.all(
          `SELECT ca.commentId, ca.attachmentId FROM CommentAttachment ca JOIN Comment c ON c.id = ca.commentId WHERE c.taskId = ?`, id);
        const isTicket = r.kind === "TICKET" || Boolean(r.createdViaTicket);
        return {
          id: r.id, titolo: stripHtml(r.title), tipo: r.kind, ...se(ha(user, "ticket"), { nata_da_ticket: isTicket }),
          descrizione: stripHtml(r.description) || null,
          stato: r.status ?? null, chiuso: Boolean(r.closedAt), tipo_attivita: r.activityType ?? null,
          scadenza: day(r.dueDate), ora: r.dueTime ?? null,
          aperto_il: day(r.createdAt), chiuso_il: day(r.closedAt), aggiornato: day(r.updatedAt),
          assegnatario: r.assignee ?? null, supervisore: r.supervisor ?? null, creato_da: r.creator ?? null,
          miei_ruoli: [r.assigneeId === user.id && "assegnatario", r.supervisorId === user.id && "supervisore", r.creatorId === user.id && "creatore"].filter(Boolean),
          tag: tags.map((t) => t.name),
          progetto: r.project ? { id: r.projectId, nome: r.project } : null,
          azienda: r.company ?? null,
          referente: r.contact ? { nome: r.contact, ruolo: r.contactRole ?? null, email: r.contactEmail ?? null, telefono: r.contactPhone ?? null } : null,
          ...(isTicket && ha(user, "ticket") ? { richiesta: { priorita: r.ticketPriority ?? null, riferimento: r.ticketRef ?? null,
                                        richiedente: r.creator ?? null, email_richiedente: r.creatorEmail ?? null,
                                        azienda_richiedente: r.creatorCompany ?? null } } : {}),
          ...(r.kind === "DEAL" ? { offerta: { fase: r.stage ?? null, valore: r.dealValue ?? null, probabilita: r.probability ?? null,
                                                chiusura_prevista: day(r.expectedCloseDate), motivo_perdita: r.lostReason ?? null,
                                                dettagli: "dettaglio_offerta" } } : {}),
          padre: r.parentTaskId ? { id: r.parentTaskId, titolo: stripHtml(r.parentTitle), url: taskUrl(keelopsUrl, r.parentTaskId) } : null,
          sottotask: subtasks.map((s) => ({ id: s.id, titolo: stripHtml(s.title), stato: s.status ?? null, chiuso: Boolean(s.closedAt) })),
          propedeutico: r.predecessorId ? { id: r.predecessorId, titolo: stripHtml(r.predecessorTitle) } : null,
          conseguenti: successors.map((s) => ({ id: s.id, titolo: stripHtml(s.title), chiuso: Boolean(s.closedAt) })),
          offerta_collegata: r.relatedDealId ? { id: r.relatedDealId, titolo: stripHtml(r.relatedDeal) } : null,
          progetto_collegato: r.relatedProject ?? null,
          ricorrenza: recurrence ? { titolo: recurrence.title, regola: recurrence.rrule, attiva: Boolean(recurrence.isActive), occorrenza_del: day(r.occurrenceDate) } : null,
          ore: { totale: Math.round(hours.reduce((s, h) => s + (h.ore ?? 0), 0) * 10) / 10, per_persona: hours },
          messaggi: comments.map((c) => ({
            id: c.id, di: c.author ?? null, quando: minute(c.createdAt), testo: stripHtml(c.body),
            inviato_al_cliente: Boolean(c.sentToClient),
            allegati: attachmentsByComment.filter((x) => x.commentId === c.id).map((x) => byComment.get(x.attachmentId)?.nome ?? x.attachmentId) })).reverse(),
          allegati,
          storico: history.map((h) => ({ azione: h.action, di: h.author ?? null, quando: minute(h.createdAt), dettagli: parse(h.payload) })).reverse(),
          url: taskUrl(keelopsUrl, r.id) };
      },
    },
    {
      name: "allegati_task",
      description: "Gli allegati di un task (file e collegamenti, anche quelli arrivati con un messaggio) con gli id da passare a leggi_allegato.",
      inputSchema: { type: "object", properties: { id: { type: "string" } }, required: ["id"] },
      run: async ({ id }) => ({ allegati: await attachmentsOf(await visibleTask(id)) }),
    },
    {
      name: "leggi_allegato",
      description: "Legge UN allegato (id da allegati_task, dettaglio_task o dettaglio_offerta). Restituisce il testo estratto (PDF, Word, file di testo) e, con formato=file, anche il documento stesso (immagini come immagine, il resto come risorsa) fino a 8 MB. Solo dentro il perimetro dell'utente. Per un COLLEGAMENTO (Google Drive o altro) KeelOps ha solo l'indirizzo: il contenuto si legge con il connettore dell'assistente verso quel servizio, autorizzato con un account che abbia il permesso sul file.",
      inputSchema: { type: "object", properties: {
        id: { type: "string" },
        formato: { type: "string", enum: ["testo", "file"], description: "default testo" } }, required: ["id"] },
      run: async ({ id, formato = "testo" }) => ({ mcpContent: await attachmentContent(id, formato) }),
    },
    {
      name: "richieste",
      richiede: "ticket",
      description: "Le richieste di supporto (ticket) visibili all'utente: priorità, riferimento, richiedente e la sua azienda, progetto, stato, date, ultimo messaggio. Filtri: stato (aperte/chiuse/tutte), progetto, priorita, testo, giorni.",
      inputSchema: { type: "object", properties: {
        stato: { type: "string", enum: ["aperte", "chiuse", "tutte"], description: "default aperte" },
        progetto: { type: "string" }, priorita: { type: "string" }, testo: { type: "string" },
        giorni: { type: "integer", minimum: 1, maximum: 730, description: "aperte negli ultimi N giorni" } } },
      run: async ({ stato = "aperte", progetto, priorita, testo, giorni }) => {
        const conditions = ["(t.kind = 'TICKET' OR t.createdViaTicket = 1)", per.where];
        const params = [...per.params];
        if (stato === "aperte") conditions.push("t.closedAt IS NULL");
        if (stato === "chiuse") conditions.push("t.closedAt IS NOT NULL");
        if (progetto) { conditions.push("p.name LIKE ?"); params.push(`%${progetto}%`); }
        if (priorita) { conditions.push("t.ticketPriority LIKE ?"); params.push(`%${priorita}%`); }
        if (testo) { conditions.push("(t.title LIKE ? OR t.description LIKE ? OR t.ticketRef LIKE ?)"); params.push(`%${testo}%`, `%${testo}%`, `%${testo}%`); }
        if (giorni) conditions.push(`${db.sql.dayOf("t.createdAt")} >= ${db.sql.todayPlusDays(-giorni)}`);
        const rows = await db.all(`
          SELECT t.id, t.title, t.kind, t.ticketPriority, t.ticketRef, t.createdAt, t.closedAt, t.dueDate, t.updatedAt,
                 p.name AS project, ts.name AS status,
                 COALESCE(uc.nickName, uc.name) AS requester, cco.name AS requesterCompany,
                 COALESCE(ua.nickName, ua.name) AS assignee,
                 (SELECT MAX(c.createdAt) FROM Comment c WHERE c.taskId = t.id AND c.secret = 0) AS lastMessage,
                 (SELECT COUNT(*) FROM Comment c WHERE c.taskId = t.id AND c.secret = 0) AS messages
          FROM Task t
          LEFT JOIN Project p ON p.id = t.projectId
          LEFT JOIN TaskStatus ts ON ts.id = t.statusId
          LEFT JOIN User uc ON uc.id = t.creatorId
          LEFT JOIN Company cco ON cco.id = uc.companyId
          LEFT JOIN User ua ON ua.id = t.assigneeId
          WHERE ${conditions.join(" AND ")}
          ORDER BY t.closedAt IS NOT NULL, t.updatedAt DESC LIMIT 50`, ...params);
        return { richieste: rows.map((r) => ({
          id: r.id, titolo: stripHtml(r.title), priorita: r.ticketPriority ?? null, riferimento: r.ticketRef ?? null,
          richiedente: r.requester ?? null, azienda: r.requesterCompany ?? null, progetto: r.project ?? null,
          stato: r.status ?? null, chiusa: Boolean(r.closedAt), assegnatario: r.assignee ?? null,
          aperta_il: day(r.createdAt), scadenza: day(r.dueDate), chiusa_il: day(r.closedAt),
          messaggi: r.messages ?? 0, ultimo_messaggio: minute(r.lastMessage), url: taskUrl(keelopsUrl, r.id) })) };
      },
    },
    {
      name: "messaggi",
      description: "I messaggi della chat dei task visibili all'utente (mai quelli riservati): di UN task con `id`, oppure gli ultimi N giorni sui task in cui l'utente ha un ruolo, con ricerca nel testo. Ogni messaggio dice chi, quando, su quale task, se è stato inviato al cliente e quali allegati portava.",
      inputSchema: { type: "object", properties: {
        id: { type: "string", description: "id del task" }, testo: { type: "string" },
        giorni: { type: "integer", minimum: 1, maximum: 365, description: "default 14" },
        di: { type: "string", description: "nome (anche parziale) dell'autore" } } },
      run: async ({ id, testo, giorni = 14, di }) => {
        const conditions = [per.where, "c.secret = 0"];
        const params = [...per.params];
        if (id) { conditions.push("t.id = ?"); params.push(id); }
        else {
          conditions.push("(t.assigneeId = ? OR t.supervisorId = ? OR t.creatorId = ? OR (t.kind = 'PROJECT' AND t.projectId IN (SELECT pm.projectId FROM ProjectMember pm WHERE pm.userId = ?)))");
          params.push(user.id, user.id, user.id, user.id);
          conditions.push(`${db.sql.dayOf("c.createdAt")} >= ${db.sql.todayPlusDays(-giorni)}`);
        }
        if (testo) { conditions.push("c.body LIKE ?"); params.push(`%${testo}%`); }
        if (di) { conditions.push("(u.name LIKE ? OR u.nickName LIKE ?)"); params.push(`%${di}%`, `%${di}%`); }
        const rows = await db.all(`
          SELECT c.id, c.body, c.createdAt, c.sentToClient, t.id AS taskId, t.title, t.kind,
                 COALESCE(u.nickName, u.name) AS author,
                 (SELECT GROUP_CONCAT(a.name) FROM CommentAttachment ca JOIN Attachment a ON a.id = ca.attachmentId WHERE ca.commentId = c.id) AS files
          FROM Comment c JOIN Task t ON t.id = c.taskId LEFT JOIN User u ON u.id = c.authorId
          WHERE ${conditions.join(" AND ")}
          ORDER BY c.createdAt DESC LIMIT 100`, ...params);
        return { messaggi: rows.map((c) => ({
          id: c.id, task: c.taskId, titolo_task: stripHtml(c.title), tipo_task: c.kind,
          di: c.author ?? null, quando: minute(c.createdAt), testo: stripHtml(c.body),
          inviato_al_cliente: Boolean(c.sentToClient),
          allegati: c.files ? String(c.files).split(",") : [], url: taskUrl(keelopsUrl, c.taskId) })) };
      },
    },
    {
      name: "cerca_contatti",
      description: "La rubrica: contatti (referenti) e aziende clienti, cercati per nome, azienda o email. Ogni contatto porta ruolo, email, telefono e le offerte visibili in cui è referente.",
      inputSchema: { type: "object", properties: { testo: { type: "string" }, azienda: { type: "string" } } },
      run: async ({ testo, azienda }) => {
        const conditions = ["ct.deletedAt IS NULL"];
        const params = [];
        if (testo) { conditions.push(`(${db.sql.concat("ct.firstName", "' '", "ct.lastName")} LIKE ? OR ct.email LIKE ? OR co.name LIKE ?)`); params.push(`%${testo}%`, `%${testo}%`, `%${testo}%`); }
        if (azienda) { conditions.push("co.name LIKE ?"); params.push(`%${azienda}%`); }
        const contatti = await db.all(`
          SELECT ct.id, ct.firstName, ct.lastName, ct.email, ct.phone, ct.roleTitle, co.id AS companyId, co.name AS company,
                 (SELECT COUNT(*) FROM Task t WHERE t.contactId = ct.id AND t.kind = 'DEAL' AND ${per.where}) AS offerte
          FROM Contact ct LEFT JOIN Company co ON co.id = ct.companyId
          WHERE ${conditions.join(" AND ")} ORDER BY co.name, ct.lastName, ct.firstName LIMIT 50`, ...per.params, ...params);
        const aziende = await db.all(`
          SELECT co.id, co.name, co.city, co.vatNumber, (SELECT COUNT(*) FROM Contact c2 WHERE c2.companyId = co.id AND c2.deletedAt IS NULL) AS contatti
          FROM Company co WHERE co.deletedAt IS NULL ${testo || azienda ? "AND co.name LIKE ?" : ""}
          ORDER BY co.name LIMIT 50`, ...(testo || azienda ? [`%${azienda ?? testo}%`] : []));
        return {
          contatti: contatti.map((c) => ({ id: c.id, nome: `${c.firstName} ${c.lastName}`.trim(), ruolo: c.roleTitle ?? null,
            email: c.email ?? null, telefono: c.phone ?? null, azienda: c.company ?? null, azienda_id: c.companyId ?? null, offerte_visibili: c.offerte ?? 0 })),
          aziende: aziende.map((a) => ({ id: a.id, nome: a.name, citta: a.city ?? null, partita_iva: a.vatNumber ?? null, contatti: a.contatti ?? 0, dettagli: "dettaglio_azienda" })) };
      },
    },
    {
      name: "dettaglio_azienda",
      description: "Tutto di UN'azienda cliente: dati, contatti, le offerte visibili (aperte/vinte/perse con valori), i progetti, i task aperti che la riguardano, le note CRM e gli utenti del portale.",
      inputSchema: { type: "object", properties: { id: { type: "string" }, nome: { type: "string", description: "in alternativa all'id: nome anche parziale" } } },
      run: async ({ id, nome }) => {
        if (!id && !nome) throw new Error("serve id o nome");
        const co = id
          ? await db.get(`SELECT * FROM Company co WHERE co.id = ? AND co.deletedAt IS NULL`, id)
          : await db.get(`SELECT * FROM Company co WHERE co.name LIKE ? AND co.deletedAt IS NULL ORDER BY co.name LIMIT 1`, `%${nome}%`);
        if (!co) throw new Error("azienda non trovata");
        const [contatti, offerte, progetti, taskAperti, note, portale] = await Promise.all([
          db.all(`SELECT ct.id, ct.firstName, ct.lastName, ct.email, ct.phone, ct.roleTitle FROM Contact ct WHERE ct.companyId = ? AND ct.deletedAt IS NULL ORDER BY ct.lastName`, co.id),
          db.all(`SELECT t.id, t.title, t.dealValue, t.closedAt, t.expectedCloseDate, ds.name AS stage, ds.isWon, ds.isLost, t.lostReason
                  FROM Task t LEFT JOIN DealStage ds ON ds.id = t.dealStageId WHERE t.kind = 'DEAL' AND t.companyId = ? AND ${per.where} ORDER BY t.updatedAt DESC LIMIT 50`, co.id, ...per.params),
          db.all(`SELECT p.id, p.name, (SELECT COUNT(*) FROM Task t WHERE t.projectId = p.id AND t.deletedAt IS NULL AND t.closedAt IS NULL) AS aperti
                  FROM Project p WHERE p.companyId = ? AND ${perP.where} ORDER BY p.name`, co.id, ...perP.params),
          db.all(`SELECT t.id, t.title, t.kind, t.dueDate, ts.name AS status FROM Task t LEFT JOIN TaskStatus ts ON ts.id = t.statusId
                  WHERE t.companyId = ? AND t.kind <> 'DEAL' AND t.closedAt IS NULL AND ${per.where} ORDER BY t.dueDate LIMIT 30`, co.id, ...per.params),
          db.all(`SELECT n.body, n.createdAt, COALESCE(u.nickName, u.name) AS author, TRIM(${db.sql.concat("COALESCE(ct.firstName, '')", "' '", "COALESCE(ct.lastName, '')")}) AS contact
                  FROM CrmNote n LEFT JOIN User u ON u.id = n.authorId LEFT JOIN Contact ct ON ct.id = n.contactId
                  WHERE n.companyId = ? OR n.contactId IN (SELECT c2.id FROM Contact c2 WHERE c2.companyId = ?) ORDER BY n.createdAt DESC LIMIT 20`, co.id, co.id),
          db.all(`SELECT u.name, u.email, u.isActive FROM User u WHERE u.companyId = ? AND u.role = 'PORTAL' ORDER BY u.name`, co.id),
        ]);
        const esito = (o) => (o.isWon ? "vinta" : o.isLost ? "persa" : "aperta");
        return {
          id: co.id, nome: co.name, citta: co.city ?? null, partita_iva: co.vatNumber ?? null, note: stripHtml(co.notes) || null,
          contatti: contatti.map((c) => ({ id: c.id, nome: `${c.firstName} ${c.lastName}`.trim(), ruolo: c.roleTitle ?? null, email: c.email ?? null, telefono: c.phone ?? null })),
          offerte: offerte.map((o) => ({ id: o.id, titolo: stripHtml(o.title), fase: o.stage ?? null, esito: esito(o), valore: o.dealValue ?? null,
            chiusura_prevista: day(o.expectedCloseDate), chiusa_il: day(o.closedAt), motivo_perdita: o.isLost ? (o.lostReason ?? null) : null, url: taskUrl(keelopsUrl, o.id) })),
          riepilogo_offerte: { aperte: offerte.filter((o) => esito(o) === "aperta").length, vinte: offerte.filter((o) => o.isWon).length, perse: offerte.filter((o) => o.isLost).length,
            valore_vinto: offerte.filter((o) => o.isWon).reduce((s, o) => s + (o.dealValue ?? 0), 0) },
          progetti: progetti.map((p) => ({ id: p.id, nome: p.name, task_aperti: p.aperti ?? 0 })),
          task_aperti: taskAperti.map((t) => ({ id: t.id, titolo: stripHtml(t.title), tipo: t.kind, stato: t.status ?? null, scadenza: day(t.dueDate), url: taskUrl(keelopsUrl, t.id) })),
          note_crm: note.map((n) => ({ di: n.author ?? null, quando: minute(n.createdAt), contatto: n.contact || null, testo: stripHtml(n.body) })),
          ...se(ha(user, "ticket"), { utenti_portale: portale.map((u) => ({ nome: u.name, email: u.email, attivo: Boolean(u.isActive) })) }) };
      },
    },
    {
      name: "persone",
      description: "Le persone interne di KeelOps (chi lavora qui): nome, soprannome, ruolo, email, gruppi (e se ne guidano uno), progetti di cui sono membri, task aperti assegnati. Per sapere chi è chi quando un altro strumento dice solo un nome.",
      inputSchema: { type: "object", properties: { testo: { type: "string", description: "nome anche parziale" } } },
      run: async ({ testo }) => {
        const params = [];
        let extra = "";
        if (testo) { extra = "AND (u.name LIKE ? OR u.nickName LIKE ? OR u.email LIKE ?)"; params.push(`%${testo}%`, `%${testo}%`, `%${testo}%`); }
        const rows = await db.all(`
          SELECT u.id, u.name, u.nickName, u.role, u.email, u.lastSeenAt,
                 (SELECT COUNT(*) FROM Task t WHERE t.assigneeId = u.id AND t.closedAt IS NULL AND t.deletedAt IS NULL) AS aperti,
                 (SELECT GROUP_CONCAT(g.name) FROM GroupMember gm JOIN ${db.sql.ident("Group")} g ON g.id = gm.groupId WHERE gm.userId = u.id) AS groups,
                 (SELECT GROUP_CONCAT(g.name) FROM GroupMember gm JOIN ${db.sql.ident("Group")} g ON g.id = gm.groupId WHERE gm.userId = u.id AND gm.isManager = 1) AS manages,
                 (SELECT GROUP_CONCAT(p.name) FROM ProjectMember pm JOIN Project p ON p.id = pm.projectId WHERE pm.userId = u.id AND p.deletedAt IS NULL) AS projects
          FROM User u
          WHERE u.isActive = 1 AND u.isSystem = 0 AND u.role IN ('ADMIN', 'MEMBER') ${extra}
          ORDER BY u.name LIMIT 100`, ...params);
        return { persone: rows.map((u) => ({ id: u.id, nome: u.name, soprannome: u.nickName ?? null, ruolo: u.role,
          email: u.email, sono_io: u.id === user.id, task_aperti_assegnati: u.aperti ?? 0,
          gruppi: u.groups ? String(u.groups).split(",") : [], guida: u.manages ? String(u.manages).split(",") : [],
          progetti: u.projects ? String(u.projects).split(",") : [], ultima_attivita: day(u.lastSeenAt) })) };
      },
    },
    {
      name: "mie_notifiche",
      description: "Le notifiche DELL'UTENTE (campanella): non lette per default, oppure tutte negli ultimi N giorni. Ognuna dice il tipo, il testo e il task a cui porta.",
      inputSchema: { type: "object", properties: {
        solo_non_lette: { type: "boolean", description: "default true" },
        giorni: { type: "integer", minimum: 1, maximum: 90, description: "default 7" } } },
      run: async ({ solo_non_lette = true, giorni = 7 }) => {
        const rows = await db.all(`
          SELECT n.id, n.type, n.payload, n.readAt, n.createdAt FROM Notification n
          WHERE n.userId = ? AND n.inApp = 1 ${solo_non_lette ? "AND n.readAt IS NULL" : ""}
            AND ${db.sql.dayOf("n.createdAt")} >= ${db.sql.todayPlusDays(-giorni)}
          ORDER BY n.createdAt DESC LIMIT 100`, user.id);
        return { non_lette: rows.filter((n) => !n.readAt).length, notifiche: rows.map((n) => {
          const p = parse(n.payload);
          return { id: n.id, tipo: n.type, testo: p.text ?? null, quando: minute(n.createdAt), letta: Boolean(n.readAt),
                   task: p.taskId ?? null, url: p.taskId ? taskUrl(keelopsUrl, p.taskId) : null }; }) };
      },
    },
    {
      name: "ricorrenze",
      description: "I modelli di task ricorrenti visibili all'utente (scadenze che si ripetono): titolo, regola (RRULE), da quando, assegnatario, progetto, attivo o no, e l'occorrenza aperta con la sua scadenza.",
      inputSchema: { type: "object", properties: { solo_attive: { type: "boolean", description: "default true" } } },
      run: async ({ solo_attive = true }) => {
        const rows = await db.all(`
          SELECT rt.id, rt.title, rt.rrule, rt.dtstart, rt.isActive, p.name AS project,
                 COALESCE(ua.nickName, ua.name) AS assignee, COALESCE(us.nickName, us.name) AS supervisor,
                 (SELECT MIN(t.dueDate) FROM Task t WHERE t.recurrenceTemplateId = rt.id AND t.closedAt IS NULL AND t.deletedAt IS NULL) AS nextDue,
                 (SELECT COUNT(*) FROM Task t WHERE t.recurrenceTemplateId = rt.id AND t.deletedAt IS NULL) AS occorrenze
          FROM RecurrenceTemplate rt
          LEFT JOIN Project p ON p.id = rt.projectId
          LEFT JOIN User ua ON ua.id = rt.assigneeId LEFT JOIN User us ON us.id = rt.supervisorId
          WHERE ${solo_attive ? "rt.isActive = 1" : "1 = 1"}
            ${isAdmin ? "" : "AND (rt.creatorId = ? OR rt.assigneeId = ? OR rt.supervisorId = ? OR rt.projectId IN (SELECT pm.projectId FROM ProjectMember pm WHERE pm.userId = ?))"}
          ORDER BY rt.title`, ...(isAdmin ? [] : [user.id, user.id, user.id, user.id]));
        return { ricorrenze: rows.map((r) => ({ id: r.id, titolo: stripHtml(r.title), regola: r.rrule, da: day(r.dtstart), attiva: Boolean(r.isActive),
          progetto: r.project ?? null, assegnatario: r.assignee ?? null, supervisore: r.supervisor ?? null,
          occorrenze_generate: r.occorrenze ?? 0, prossima_scadenza_aperta: day(r.nextDue) })) };
      },
    },
    {
      name: "tag",
      description: "I tag in uso, con quanti task aperti visibili all'utente portano ciascuno. Il nome si passa a cerca_task come filtro `tag`.",
      inputSchema: { type: "object", properties: {} },
      run: async () => ({ tag: await db.all(`
        SELECT tg.name AS nome, tg.color AS colore,
               (SELECT COUNT(*) FROM TaskTag tt JOIN Task t ON t.id = tt.taskId WHERE tt.tagId = tg.id AND t.closedAt IS NULL AND ${per.where}) AS task_aperti
        FROM Tag tg ORDER BY task_aperti DESC, tg.name`, ...per.params) }),
    },
    {
      name: "mie_bacheche",
      description: "Le bacheche personali DELL'UTENTE (estensione «Personale»): ogni bacheca con le sue colonne e le card aperte — titolo, colonna, scadenza e ora. Solo le proprie.",
      inputSchema: { type: "object", properties: { anche_chiuse: { type: "boolean", description: "default false" } } },
      run: async ({ anche_chiuse = false }) => {
        let boards;
        try {
          boards = await db.all(`SELECT b.id, b.name FROM plugin_personale_board b WHERE b.ownerId = ? ORDER BY b.position, b.name`, user.id);
        } catch {
          return { disponibile: false, nota: "l'estensione «Personale» non è attiva su questa installazione" };
        }
        const out = [];
        for (const b of boards) {
          const cards = await db.all(`
            SELECT c.id, c.title, c.dueDate, c.dueTime, c.closedAt, s.name AS column_name, s.isClosed
            FROM plugin_personale_task c JOIN plugin_personale_status s ON s.id = c.statusId
            WHERE c.boardId = ? AND c.archivedAt IS NULL ${anche_chiuse ? "" : "AND c.closedAt IS NULL"}
            ORDER BY s.position, c.position`, b.id);
          out.push({ id: b.id, nome: b.name, card: cards.map((c) => ({ id: c.id, titolo: c.title, colonna: c.column_name,
            scadenza: day(c.dueDate), ora: c.dueTime ?? null, chiusa: Boolean(c.closedAt) })) });
        }
        return { disponibile: true, bacheche: out };
      },
    },
  ];
}
