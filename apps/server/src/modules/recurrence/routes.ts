import path from "node:path";
import type { FastifyInstance } from "fastify";
import {
  AttachmentType,
  createLinkAttachmentSchema,
  createRecurrenceTemplateSchema,
  previewRecurrenceSchema,
  updateRecurrenceTemplateSchema,
  type ActivityTypeRef,
  type RecurrenceTemplate as TemplateDto,
} from "@kancrm/shared";
import { UserRole, VisibilityScope } from "@kancrm/shared";
import { prisma } from "../../db";
import { badRequest, forbidden, notFound } from "../../lib/http-errors";
import { requireUser } from "../../plugins/auth";
import type { Prisma, User } from "../../generated/prisma/client";
import { removeOrphanAttachmentFiles, sanitizeFilename } from "../attachments/storage";
import { attachmentStore } from "../attachments/store";
import { toAttachmentDto } from "../tasks/serializers";
import { canSeeScope } from "../visibility/service";
import { buildRule, dateOnlyToUTC, describeRule, nextOccurrences, toDateOnly } from "./rrule";
import {
  findFutureUntouchedOccurrences,
  materializeTemplate,
  syncTemplateOccurrences,
} from "./service";

const templateInclude = {
  assignee: true,
  supervisor: true,
  activityType: true,
  relatedDeal: { select: { id: true, title: true } },
  initialStatus: { select: { id: true, name: true, color: true } },
  attachments: { include: { attachment: { include: { uploadedBy: true } } } },
} satisfies Prisma.RecurrenceTemplateInclude;

type TemplateWithRelations = Prisma.RecurrenceTemplateGetPayload<{
  include: typeof templateInclude;
}>;

/** DTO della ricorrenza; `canManage` dice alla UI se mostrare modifica ed eliminazione. */
function toTemplateDto(template: TemplateWithRelations, user: User): TemplateDto {
  return {
    id: template.id,
    title: template.title,
    description: template.description,
    rrule: template.rrule,
    ruleText: describeRule(template.rrule),
    dtstart: toDateOnly(template.dtstart),
    isActive: template.isActive,
    assignee: template.assignee ? { id: template.assignee.id, name: template.assignee.name } : null,
    supervisor: template.supervisor
      ? { id: template.supervisor.id, name: template.supervisor.name }
      : null,
    relatedDeal: template.relatedDeal
      ? { id: template.relatedDeal.id, name: template.relatedDeal.title }
      : null,
    initialStatus: template.initialStatus,
    activityType: template.activityType
      ? ({
          id: template.activityType.id,
          name: template.activityType.name,
          color: template.activityType.color,
          category: template.activityType.category,
        } as ActivityTypeRef)
      : null,
    canManage: user.role === UserRole.ADMIN || template.creatorId === user.id,
    nextOccurrences: nextOccurrences(template.rrule, template.dtstart, new Date(), 5).map(
      (giorno) => toDateOnly(giorno),
    ),
    attachments: template.attachments.map((ta) => toAttachmentDto(ta.attachment)),
  };
}

async function loadTemplate(id: string): Promise<TemplateWithRelations> {
  const template = await prisma.recurrenceTemplate.findUnique({
    where: { id },
    include: templateInclude,
  });
  if (!template) throw notFound("Ricorrenza non trovata");
  return template;
}

/** Modifica/eliminazione: solo chi ha creato la ricorrenza o un amministratore. */
function assertRecurrenceManage(user: User, creatorId: string): void {
  if (user.role !== UserRole.ADMIN && creatorId !== user.id) {
    throw forbidden("Solo chi ha creato la ricorrenza (o un amministratore) può modificarla");
  }
}

export function recurrenceRoutes(app: FastifyInstance): void {
  app.post("/api/recurrence-templates/preview", async (request) => {
    requireUser(request);
    const input = previewRecurrenceSchema.parse(request.body);
    const dtstart = dateOnlyToUTC(input.dtstart);
    buildRule(input.rrule, dtstart); // valida
    return {
      occurrences: nextOccurrences(input.rrule, dtstart, new Date(), input.count).map((giorno) => toDateOnly(giorno)),
      ruleText: describeRule(input.rrule),
    };
  });

  app.get("/api/recurrence-templates", async (request) => {
    const user = requireUser(request);
    // Le ricorrenze generano task dello scadenzario e ne seguono la visibilità:
    // con lo scope si vedono tutte, altrimenti solo quelle che riguardano
    // l'utente (create da lui, o dove è assegnatario o supervisore). Prima
    // bastava essere autenticati per leggere l'intero scadenzario ricorrente.
    const seesAll = await canSeeScope(user, VisibilityScope.ADMIN_TASKS);
    const templates = await prisma.recurrenceTemplate.findMany({
      where: seesAll
        ? {}
        : {
            OR: [{ creatorId: user.id }, { assigneeId: user.id }, { supervisorId: user.id }],
          },
      include: templateInclude,
    });

    // Ordinate per prossima scadenza, non per data di inserimento: chi guarda
    // l'elenco vuole sapere cosa scade prima. La prima occorrenza è calcolata
    // dalla RRULE nel DTO, quindi l'ordinamento avviene qui e non nella query.
    // Le ricorrenze esaurite o sospese (senza occorrenze future) vanno in fondo.
    return templates
      .map((t) => toTemplateDto(t, user))
      .sort((a, b) => {
        const first = (t: (typeof a)["nextOccurrences"]) => t[0] ?? "9999-12-31";
        return (
          first(a.nextOccurrences).localeCompare(first(b.nextOccurrences)) ||
          a.title.localeCompare(b.title, "it")
        );
      });
  });

  app.post("/api/recurrence-templates", async (request, reply) => {
    const user = requireUser(request);
    const input = createRecurrenceTemplateSchema.parse(request.body);
    const dtstart = dateOnlyToUTC(input.dtstart);
    buildRule(input.rrule, dtstart); // valida prima di salvare

    // Senza accesso allo scadenzario la ricorrenza è personale: si può crearne una
    // per sé, non intestare scadenze ad altri (come per i task, vedi personalAdmin).
    let assigneeId = input.assigneeId ?? null;
    if (!(await canSeeScope(user, VisibilityScope.ADMIN_TASKS)) && assigneeId !== user.id) {
      assigneeId = null;
    }

    const template = await prisma.recurrenceTemplate.create({
      data: {
        title: input.title,
        description: input.description ?? null,
        rrule: input.rrule,
        dtstart,
        creatorId: user.id,
        assigneeId,
        supervisorId: input.supervisorId ?? null,
        activityTypeId: input.activityTypeId ?? null,
        relatedDealId: input.relatedDealId ?? null,
        initialStatusId: input.initialStatusId ?? null,
      },
    });
    await materializeTemplate(template.id);
    return reply.status(201).send(toTemplateDto(await loadTemplate(template.id), user));
  });

  app.patch("/api/recurrence-templates/:id", async (request) => {
    const user = requireUser(request);
    const { id } = request.params as { id: string };
    const input = updateRecurrenceTemplateSchema.parse(request.body);
    const existing = await prisma.recurrenceTemplate.findUnique({ where: { id } });
    if (!existing) throw notFound("Ricorrenza non trovata");
    assertRecurrenceManage(user, existing.creatorId);

    const dtstart = input.dtstart !== undefined ? dateOnlyToUTC(input.dtstart) : undefined;
    const rrule = input.rrule ?? existing.rrule;
    buildRule(rrule, dtstart ?? existing.dtstart); // valida

    const scheduleChanged =
      (input.rrule !== undefined && input.rrule !== existing.rrule) ||
      (dtstart !== undefined && dtstart.getTime() !== existing.dtstart.getTime());

    await prisma.recurrenceTemplate.update({
      where: { id },
      data: {
        ...(input.title !== undefined ? { title: input.title } : {}),
        ...(input.description !== undefined ? { description: input.description } : {}),
        ...(input.rrule !== undefined ? { rrule: input.rrule } : {}),
        ...(dtstart !== undefined ? { dtstart } : {}),
        ...(input.assigneeId !== undefined ? { assigneeId: input.assigneeId } : {}),
        ...(input.supervisorId !== undefined ? { supervisorId: input.supervisorId } : {}),
        ...(input.activityTypeId !== undefined ? { activityTypeId: input.activityTypeId } : {}),
        ...(input.relatedDealId !== undefined ? { relatedDealId: input.relatedDealId } : {}),
        ...(input.initialStatusId !== undefined ? { initialStatusId: input.initialStatusId } : {}),
        ...(input.isActive !== undefined ? { isActive: input.isActive } : {}),
      },
    });
    await syncTemplateOccurrences(id, { scheduleChanged });
    // Chi ha in mano un'occorrenza deve sapere che non c'è più: la rigenerazione
    // le cambia l'id, e il pannello resterebbe aperto su un fantasma.
    return {
      ...toTemplateDto(await loadTemplate(id), user),
      occurrencesRegenerated: scheduleChanged,
    };
  });

  // ?deleteFuture=true elimina anche le occorrenze future non ancora lavorate.
  app.delete("/api/recurrence-templates/:id", async (request, reply) => {
    const user = requireUser(request);
    const { id } = request.params as { id: string };
    const { deleteFuture } = request.query as { deleteFuture?: string };
    const existing = await prisma.recurrenceTemplate.findUnique({
      where: { id },
      include: { attachments: true },
    });
    if (!existing) throw notFound("Ricorrenza non trovata");
    assertRecurrenceManage(user, existing.creatorId);

    if (deleteFuture === "true") {
      const untouched = await findFutureUntouchedOccurrences(id);
      await prisma.task.deleteMany({ where: { id: { in: untouched.map((t) => t.id) } } });
    }
    const attachmentIds = existing.attachments.map((ta) => ta.attachmentId);
    await prisma.recurrenceTemplate.delete({ where: { id } });
    await removeOrphanAttachmentFiles(attachmentIds);
    return reply.status(204).send();
  });

  // Allegati-modello: applicati anche alle occorrenze future non lavorate.
  app.post("/api/recurrence-templates/:id/attachments/link", async (request, reply) => {
    const user = requireUser(request);
    const { id } = request.params as { id: string };
    const input = createLinkAttachmentSchema.parse(request.body);
    assertRecurrenceManage(user, (await loadTemplate(id)).creatorId);

    const attachment = await prisma.attachment.create({
      data: {
        type: AttachmentType.LINK,
        name: input.name,
        url: input.url,
        uploadedById: user.id,
        templates: { create: { templateId: id } },
      },
    });
    await linkAttachmentToFutureOccurrences(id, attachment.id);
    return reply.status(201).send(toTemplateDto(await loadTemplate(id), user));
  });

  app.post("/api/recurrence-templates/:id/attachments/file", async (request, reply) => {
    const user = requireUser(request);
    const { id } = request.params as { id: string };
    assertRecurrenceManage(user, (await loadTemplate(id)).creatorId);

    const file = await request.file();
    if (!file) throw badRequest("Nessun file ricevuto");
    const buffer = await file.toBuffer();
    const filename = sanitizeFilename(file.filename);

    const attachment = await prisma.attachment.create({
      data: {
        type: AttachmentType.FILE,
        name: filename,
        mimeType: file.mimetype,
        size: buffer.length,
        uploadedById: user.id,
        templates: { create: { templateId: id } },
      },
    });
    const relativePath = path.join("_templates", id, `${attachment.id}-${filename}`);
    await attachmentStore().write(relativePath, buffer);
    await prisma.attachment.update({ where: { id: attachment.id }, data: { path: relativePath } });
    await linkAttachmentToFutureOccurrences(id, attachment.id);
    return reply.status(201).send(toTemplateDto(await loadTemplate(id), user));
  });

  app.delete("/api/recurrence-templates/:id/attachments/:attachmentId", async (request, reply) => {
    const user = requireUser(request);
    const { id, attachmentId } = request.params as { id: string; attachmentId: string };
    assertRecurrenceManage(user, (await loadTemplate(id)).creatorId);
    const link = await prisma.recurrenceTemplateAttachment.findUnique({
      where: { templateId_attachmentId: { templateId: id, attachmentId } },
    });
    if (!link) throw notFound("Allegato non trovato");

    await prisma.recurrenceTemplateAttachment.delete({
      where: { templateId_attachmentId: { templateId: id, attachmentId } },
    });
    // Scollega anche dalle occorrenze future non lavorate. Il file su disco non
    // viene toccato: sparisce solo alla cancellazione definitiva (sweep del cestino).
    const untouched = await findFutureUntouchedOccurrences(id);
    await prisma.taskAttachment.deleteMany({
      where: { attachmentId, taskId: { in: untouched.map((t) => t.id) } },
    });
    return reply.status(204).send();
  });
}

async function linkAttachmentToFutureOccurrences(
  templateId: string,
  attachmentId: string,
): Promise<void> {
  const untouched = await findFutureUntouchedOccurrences(templateId);
  for (const task of untouched) {
    await prisma.taskAttachment
      .create({ data: { taskId: task.id, attachmentId } })
      .catch(() => undefined); // già collegato
  }
}
