import type { FastifyInstance } from "fastify";
import {
  EXTERNAL_ROLES,
  isExternalRole,
  ActivityCategory,
  AttachmentType,
  ImportType,
  TaskKind,
  VisibilityAccess,
  VisibilityScope,
  type ImportReport,
  type UserRef,
} from "@kancrm/shared";
import { z } from "zod";
import { prisma } from "../../db";
import { badRequest, forbidden } from "../../lib/http-errors";
import { requireUser } from "../../plugins/auth";
import type { User } from "../../generated/prisma/client";
import { accessForScope, assertCanSeeContacts, canSeeScope } from "../visibility/service";
import { requireInitialStatusId, statusCategoryOfTask } from "../task-statuses/service";
import { materializeTemplate } from "../recurrence/service";
import { buildTemplate, parseWorkbook, type ParsedRow } from "./excel";
import { parseIcs } from "./ical";
import { rigaTaskAdattata, ruoloRigaTask, significatoStato } from "./dialects-core";
import type { StatusMeaning } from "./dialects";
import { aziendaConLoStessoNome, trovaOCreaAzienda } from "../crm/company-by-name";

/** Utente per nome completo o email. Prima prova email, poi nome completo. */
async function userIdByNameOrEmail(value: string): Promise<string | null> {
  const v = value.trim();
  if (!v) return null;
  if (v.includes("@")) return userIdByEmail(v);
  const [firstName, ...rest] = v.split(/\s+/);
  const lastName = rest.join(" ");
  const user = await prisma.user.findFirst({
    where: { isActive: true, name: { equals: lastName ? `${firstName} ${lastName}` : v } },
  });
  return user?.id ?? null;
}

/** Tipo attività per nome (case-insensitive); se manca lo crea come Amministrativo. */
async function activityTypeIdByName(name: string): Promise<string | null> {
  const n = name.trim();
  if (!n) return null;
  const existing = await prisma.activityType.findFirst({
    where: { name: { equals: n } },
  });
  if (existing) return existing.id;
  const last = await prisma.activityType.findFirst({ orderBy: { order: "desc" } });
  const created = await prisma.activityType
    .create({
      data: {
        name: n,
        category: ActivityCategory.ADMIN,
        color: "#f59e0b",
        order: (last?.order ?? -1) + 1,
      },
    })
    .catch(() => null);
  return created?.id ?? null;
}

/** "Titolo - URL" o URL semplice → { name, url } o null. */
function parseLinkValue(value: string): { name: string; url: string } | null {
  const v = value.trim();
  if (!v) return null;
  const urlMatch = /(https?:\/\/\S+)/i.exec(v);
  if (!urlMatch) return null;
  const url = urlMatch[1]!;
  const label = v
    .slice(0, urlMatch.index)
    .replace(/[-–:\s]+$/, "")
    .trim();
  return { name: label || "Link", url };
}

const WEEKDAYS = ["SU", "MO", "TU", "WE", "TH", "FR", "SA"];

/** Frequenza (italiano) + data di inizio → stringa RRULE, o null se sconosciuta. */
function frequencyToRRule(freq: string, start: Date): string | null {
  const f = freq.trim().toLowerCase();
  const byday = WEEKDAYS[start.getUTCDay()];
  const day = start.getUTCDate();
  const month = start.getUTCMonth() + 1;
  switch (f) {
    case "settimanale":
      return `FREQ=WEEKLY;BYDAY=${byday}`;
    case "quindicinale":
    case "bisettimanale":
      return `FREQ=WEEKLY;INTERVAL=2;BYDAY=${byday}`;
    case "mensile":
      return `FREQ=MONTHLY;BYMONTHDAY=${day}`;
    case "bimestrale":
      return `FREQ=MONTHLY;INTERVAL=2;BYMONTHDAY=${day}`;
    case "trimestrale":
      return `FREQ=MONTHLY;INTERVAL=3;BYMONTHDAY=${day}`;
    case "semestrale":
      return `FREQ=MONTHLY;INTERVAL=6;BYMONTHDAY=${day}`;
    case "annuale":
      return `FREQ=YEARLY;BYMONTH=${month};BYMONTHDAY=${day}`;
    default:
      return null;
  }
}

/** Primo stato della categoria che soddisfa il significato richiesto. */
async function statusByMeaning(
  meaning: StatusMeaning,
  category: ActivityCategory,
): Promise<string | null> {
  if (meaning === "initial") return requireInitialStatusId(category);
  const status = await prisma.taskStatus.findFirst({
    where: {
      category,
      isClosed: true,
      ...(meaning === "stopsRecurrence" ? { stopsRecurrence: true } : {}),
    },
    orderBy: { order: "asc" },
  });
  return status?.id ?? null;
}

/**
 * Risolve lo stato dentro la categoria del task importato (quella del suo tipo di
 * attività): match esatto sul nome, poi gli alias dei dialetti (dialects.ts), poi
 * primo stato della lista.
 */
async function resolveStatusId(statusName: string, category: ActivityCategory): Promise<string> {
  const name = statusName.trim();
  if (name) {
    const exact = await prisma.taskStatus.findFirst({ where: { category, name } });
    if (exact) return exact.id;
    const meaning = significatoStato(name);
    if (meaning) {
      const mapped = await statusByMeaning(meaning, category);
      if (mapped) return mapped;
    }
  }
  return requireInitialStatusId(category);
}

const importTypeSchema = z.nativeEnum(ImportType);

/**
 * L'utente è un proprietario valido per i dati importati di questo tipo, cioè è
 * abilitato al modulo corrispondente (niente sviluppatori sui task amministrativi):
 *  - TASKS → scope Scadenzario; DEALS → Offerte; CONTACTS → Persone;
 *  - COMPANIES → qualunque utente interno.
 */
async function isEligibleOwner(user: User, type: ImportType): Promise<boolean> {
  if (isExternalRole(user.role) || !user.isActive) return false;
  switch (type) {
    case ImportType.TASKS:
      return canSeeScope(user, VisibilityScope.ADMIN_TASKS);
    case ImportType.DEALS:
      return canSeeScope(user, VisibilityScope.DEALS);
    case ImportType.CONTACTS:
      return canSeeScope(user, VisibilityScope.CONTACTS);
    case ImportType.COMPANIES:
      return true;
    default:
      return false;
  }
}

/** Elenco utenti abilitati come proprietari per un tipo di import. */
async function eligibleOwners(type: ImportType): Promise<UserRef[]> {
  const users = await prisma.user.findMany({
    where: { isActive: true, role: { notIn: [...EXTERNAL_ROLES] } },
    orderBy: { name: "asc" },
  });
  const eligible: UserRef[] = [];
  for (const user of users) {
    if (await isEligibleOwner(user, type)) eligible.push({ id: user.id, name: user.name });
  }
  return eligible;
}

/**
 * Proprietario dei dati importati (creatore). Default: chi importa; se indicato un
 * ownerId dev'essere un utente abilitato al tipo.
 */
async function resolveImportOwner(
  importer: User,
  type: ImportType,
  ownerId: string | undefined,
): Promise<User> {
  if (!ownerId || ownerId === importer.id) return importer;
  const owner = await prisma.user.findUnique({ where: { id: ownerId } });
  if (!owner) throw badRequest("Proprietario non trovato");
  if (!(await isEligibleOwner(owner, type))) {
    throw badRequest("Il proprietario scelto non è abilitato a questo tipo di dati");
  }
  return owner;
}

async function assertImportAccess(user: User, type: ImportType): Promise<void> {
  if (type === ImportType.TASKS) {
    if (!(await canSeeScope(user, VisibilityScope.ADMIN_TASKS))) {
      throw forbidden("Non hai accesso ai task amministrativi");
    }
    return;
  }
  if (type === ImportType.CONTACTS) {
    await assertCanSeeContacts(user);
    return;
  }
  if (type === ImportType.COMPANIES) return; // aziende: tutti gli utenti interni
  // Import offerte = scrittura: serve accesso completo, non la sola lettura.
  if ((await accessForScope(user, VisibilityScope.DEALS)) !== VisibilityAccess.FULL) {
    throw forbidden("Non hai accesso completo alle offerte");
  }
}

/** Numeri in formato italiano: "12.500" → 12500, "12,5" → 12.5, "12.500,50" → 12500.5. */
function parseItalianNumber(raw: string): number | null {
  const text = raw.replace(/[^\d.,-]/g, "");
  if (!text) return null;
  let normalized = text;
  if (text.includes(".") && text.includes(",")) {
    normalized = text.replaceAll(".", "").replace(",", ".");
  } else if (text.includes(",")) {
    normalized = text.replace(",", ".");
  } else if (/\.\d{3}$/.test(text)) {
    normalized = text.replaceAll(".", ""); // punto come separatore migliaia
  }
  const value = Number(normalized);
  return Number.isNaN(value) ? null : value;
}

async function userIdByEmail(email: string): Promise<string | null> {
  if (!email) return null;
  const user = await prisma.user.findUnique({ where: { email: email.toLowerCase().trim() } });
  return user && user.isActive ? user.id : null;
}

async function companyIdByName(name: string): Promise<string | null> {
  if (!name) return null;
  // «Jugaad srl» nel foglio e «Jugaad» in anagrafica sono la stessa azienda.
  const azienda = await trovaOCreaAzienda(name).catch(() => null);
  return azienda?.id ?? null; // null se il nome è occupato da un'azienda nel cestino
}

async function contactIdByName(fullName: string, companyId: string | null): Promise<string | null> {
  if (!fullName) return null;
  const parts = fullName.trim().split(/\s+/);
  const firstName = parts[0] ?? "";
  const lastName = parts.slice(1).join(" ") || "—";
  const existing = await prisma.contact.findFirst({
    where: { firstName, lastName },
  });
  if (existing) return existing.id;
  const created = await prisma.contact.create({
    data: { firstName, lastName, companyId },
  });
  return created.id;
}

type RowHandler = (row: ParsedRow, user: User) => Promise<"imported" | "skipped">;

interface ImportTaskResult {
  outcome: "imported" | "skipped";
  /** Id del task creato/esistente (per agganciare i subtask); null per le ricorrenze. */
  taskId: string | null;
}

/**
 * Importa un task ADMIN da una riga. `opts.title` forza il titolo (subitem, il cui
 * nome è nella colonna "Sotto elementi"); `opts.parentTaskId` lo rende un subtask
 * (i subtask non ricorrono). Deduplica su titolo + campi descrittivi + padre.
 */
async function importAdminTask(
  row: ParsedRow,
  user: User,
  opts: { title?: string; parentTaskId?: string } = {},
): Promise<ImportTaskResult> {
  const title = (opts.title ?? row.values["titolo"] ?? "").trim();
  if (!title) throw new Error("Titolo mancante");
  const description = row.values["descrizione"] || null;
  const dueDate = row.dateValues["scadenza"] ?? null;
  const assigneeId = await userIdByNameOrEmail(
    row.values["assegnatario (nome o email)"] ?? row.values["assegnatario (email)"] ?? "",
  );
  const supervisorId = await userIdByNameOrEmail(
    row.values["supervisore (nome o email)"] ?? row.values["supervisore (email)"] ?? "",
  );
  const activityTypeId = await activityTypeIdByName(
    row.values["tipo attività"] || "",
  );
  const link = parseLinkValue(row.values["link"] ?? "");
  // I subtask non diventano ricorrenze.
  const frequency = opts.parentTaskId
    ? ""
    : row.values["frequenza"] || "";

  const dtstart = dueDate ?? new Date(new Date().setUTCHours(0, 0, 0, 0));
  const rrule = frequency.trim() ? frequencyToRRule(frequency, dtstart) : null;
  if (rrule) {
    const dup = await prisma.recurrenceTemplate.findFirst({
      where: { title, rrule, dtstart, activityTypeId },
    });
    if (dup) return { outcome: "skipped", taskId: null };
    const template = await prisma.recurrenceTemplate.create({
      data: {
        title,
        description,
        rrule,
        dtstart,
        creatorId: user.id,
        assigneeId,
        supervisorId,
        activityTypeId,
        ...(link
          ? {
              attachments: {
                create: {
                  attachment: {
                    create: {
                      type: AttachmentType.LINK,
                      name: link.name,
                      url: link.url,
                      uploadedById: user.id,
                    },
                  },
                },
              },
            }
          : {}),
      },
    });
    await materializeTemplate(template.id);
    return { outcome: "imported", taskId: null };
  }

  // Task singolo o subtask. Deduplica su campi descrittivi + padre.
  const dup = await prisma.task.findFirst({
    where: {
      kind: TaskKind.ADMIN,
      title,
      description,
      dueDate,
      assigneeId,
      supervisorId,
      activityTypeId,
      parentTaskId: opts.parentTaskId ?? null,
    },
  });
  if (dup) return { outcome: "skipped", taskId: dup.id };
  const task = await prisma.task.create({
    data: {
      kind: TaskKind.ADMIN,
      title,
      description,
      statusId: await resolveStatusId(
        row.values["stato"] ?? "",
        await statusCategoryOfTask({ activityTypeId, kind: TaskKind.ADMIN }),
      ),
      creatorId: user.id,
      assigneeId,
      supervisorId,
      activityTypeId,
      dueDate,
      parentTaskId: opts.parentTaskId ?? null,
      activities: { create: { userId: user.id, action: "created" } },
    },
  });
  if (link) {
    await prisma.attachment.create({
      data: {
        type: AttachmentType.LINK,
        name: link.name,
        url: link.url,
        uploadedById: user.id,
        tasks: { create: { taskId: task.id } },
      },
    });
  }
  return { outcome: "imported", taskId: task.id };
}

/**
 * Import task da xlsx, con stato: una riga è un'attività, un sotto-elemento
 * dell'attività precedente (che diventa un subtask) o niente. Chi decide sono i
 * dialetti (dialects.ts, la gerarchia degli export Monday nella commerciale);
 * senza, una riga con il titolo è un'attività. Le righe passano prima
 * dall'adattamento dei dialetti, che ne riscrive le colonne nei nomi KeelOps.
 */
async function runTasksImport(rows: ParsedRow[], user: User, report: ImportReport): Promise<void> {
  let parentTaskId: string | null = null;
  for (const originale of rows) {
    const row = rigaTaskAdattata(originale);
    const ruolo = ruoloRigaTask(row);
    try {
      if (ruolo.tipo === "attivita") {
        const result = await importAdminTask(row, user);
        report[result.outcome] += 1;
        // Il task appena importato (o quello esistente) diventa il padre corrente.
        parentTaskId = result.taskId;
      } else if (ruolo.tipo === "sotto") {
        if (!parentTaskId) {
          report.errors.push({
            row: row.rowNumber,
            message: "Sotto-elemento senza attività padre",
          });
          continue;
        }
        const result = await importAdminTask(row, user, { title: ruolo.titolo, parentTaskId });
        report[result.outcome] += 1;
      }
    } catch (error) {
      report.errors.push({
        row: row.rowNumber,
        message: error instanceof Error ? error.message : "Errore sconosciuto",
      });
    }
  }
}

const handlers: Record<ImportType, RowHandler> = {
  async companies(row) {
    const name = row.values["ragione sociale"] ?? "";
    if (!name) throw new Error("Ragione sociale mancante");
    // Già in anagrafica, magari scritta diversa: si salta, come per il nome identico.
    if (await aziendaConLoStessoNome(name)) return "skipped";
    await prisma.company.create({
      data: {
        name,
        vatNumber: row.values["partita iva"] || null,
        city: row.values["città"] || null,
        notes: row.values["note"] || null,
      },
    });
    return "imported";
  },

  async contacts(row) {
    const firstName = row.values["nome"] ?? "";
    const lastName = row.values["cognome"] ?? "";
    if (!firstName || !lastName) throw new Error("Nome e cognome sono obbligatori");
    const email = row.values["email"] || null;
    if (email) {
      const existing = await prisma.contact.findFirst({ where: { email } });
      if (existing) return "skipped";
    }
    await prisma.contact.create({
      data: {
        firstName,
        lastName,
        email,
        phone: row.values["telefono"] || null,
        roleTitle: row.values["ruolo"] || null,
        companyId: await companyIdByName(row.values["azienda"] ?? ""),
      },
    });
    return "imported";
  },

  async tasks(row, user) {
    // Import singola riga (l'endpoint usa runTasksImport con gerarchia subtask).
    return (await importAdminTask(row, user)).outcome;
  },

  async deals(row, user) {
    const title = row.values["titolo"] ?? "";
    if (!title) throw new Error("Titolo mancante");
    const stageName = row.values["fase"] ?? "";
    const stage = stageName
      ? await prisma.dealStage.findFirst({ where: { name: stageName } })
      : null;
    const defaultStage = await prisma.dealStage.findFirst({ orderBy: { order: "asc" } });
    if (!stage && !defaultStage) throw new Error("Nessuna fase pipeline configurata");
    const companyId = await companyIdByName(row.values["azienda"] ?? "");
    const value = parseItalianNumber(row.values["valore"] ?? "");
    const probability = row.values["probabilità"]?.replace(/[^\d]/g, "") ?? "";
    await prisma.task.create({
      data: {
        kind: TaskKind.DEAL,
        title,
        description: row.values["descrizione"] || null,
        // Offerta importata: stati del modulo commerciale.
        statusId: await requireInitialStatusId(await statusCategoryOfTask({ kind: TaskKind.DEAL })),
        creatorId: user.id,
        assigneeId: await userIdByEmail(row.values["commerciale (email)"] ?? ""),
        dealStageId: stage?.id ?? defaultStage!.id,
        companyId,
        contactId: await contactIdByName(row.values["contatto"] ?? "", companyId),
        dealValue: value,
        probability: probability ? Math.min(100, Number(probability)) : null,
        expectedCloseDate: row.dateValues["chiusura prevista"] ?? null,
        activities: { create: { userId: user.id, action: "created" } },
      },
    });
    return "imported";
  },
};

export function importRoutes(app: FastifyInstance): void {
  // Template .xlsx scaricabile per ogni tracciato.
  app.get("/api/imports/template/:type", async (request, reply) => {
    const user = requireUser(request);
    const type = importTypeSchema.parse((request.params as { type: string }).type);
    await assertImportAccess(user, type);
    const buffer = await buildTemplate(type);
    reply.header(
      "Content-Type",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    );
    reply.header("Content-Disposition", `attachment; filename="template-${type}.xlsx"`);
    return reply.send(buffer);
  });

  // Utenti abilitati come proprietari dei dati importati, per tipo.
  app.get("/api/imports/owners/:type", async (request) => {
    const user = requireUser(request);
    const type = importTypeSchema.parse((request.params as { type: string }).type);
    await assertImportAccess(user, type);
    return eligibleOwners(type);
  });

  // Import da file .xlsx compilato sul template. ?ownerId assegna la proprietà.
  app.post("/api/imports/:type", async (request) => {
    const user = requireUser(request);
    const type = importTypeSchema.parse((request.params as { type: string }).type);
    await assertImportAccess(user, type);
    const { ownerId } = request.query as { ownerId?: string };
    const owner = await resolveImportOwner(user, type, ownerId);

    const file = await request.file();
    if (!file) throw badRequest("Nessun file ricevuto");
    const rows = await parseWorkbook(await file.toBuffer());
    if (rows.length === 0) {
      throw badRequest("Nessuna riga da importare (hai eliminato la riga di esempio?)");
    }

    const report: ImportReport = { imported: 0, skipped: 0, errors: [] };
    if (type === ImportType.TASKS) {
      // I task usano un import con stato (padre corrente) per ricostruire i subtask.
      await runTasksImport(rows, owner, report);
    } else {
      for (const row of rows) {
        try {
          const outcome = await handlers[type](row, owner);
          report[outcome] += 1;
        } catch (error) {
          report.errors.push({
            row: row.rowNumber,
            message: error instanceof Error ? error.message : "Errore sconosciuto",
          });
        }
      }
    }
    return report;
  });

  // Import iCalendar (.ics): VEVENT/VTODO → task del proprietario scelto.
  app.post("/api/imports/ical", async (request) => {
    const user = requireUser(request);
    await assertImportAccess(user, ImportType.TASKS);
    const { ownerId } = request.query as { ownerId?: string };
    const owner = await resolveImportOwner(user, ImportType.TASKS, ownerId);

    const file = await request.file();
    if (!file) throw badRequest("Nessun file ricevuto");
    const items = parseIcs((await file.toBuffer()).toString("utf8"));
    if (items.length === 0) {
      throw badRequest("Nessun evento o attività trovato nel file iCal");
    }

    // Gli eventi iCal arrivano senza tipo di attività: stati generali.
    const statusId = await requireInitialStatusId(ActivityCategory.GENERAL);
    const report: ImportReport = { imported: 0, skipped: 0, errors: [] };
    for (const item of items) {
      // Dedup semplice: stesso titolo e stessa scadenza già presenti.
      const existing = await prisma.task.findFirst({
        where: { kind: TaskKind.ADMIN, title: item.title, dueDate: item.date },
      });
      if (existing) {
        report.skipped += 1;
        continue;
      }
      await prisma.task.create({
        data: {
          kind: TaskKind.ADMIN,
          title: item.title,
          description: item.description,
          statusId,
          creatorId: owner.id,
          assigneeId: owner.id,
          dueDate: item.date,
          activities: { create: { userId: owner.id, action: "created" } },
        },
      });
      report.imported += 1;
    }
    return report;
  });
}
