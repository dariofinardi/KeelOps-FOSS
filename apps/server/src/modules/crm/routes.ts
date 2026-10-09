import type { FastifyInstance } from "fastify";
import { isUniqueViolation } from "../../lib/prisma-errors";
import {
  VisibilityScope,
  createCrmNoteSchema,
  paginationSchema,
  upsertCompanySchema,
  upsertContactSchema,
  type CompanyDetail,
  type CompanyListItem,
  type ContactDetail,
  type ContactListItem,
  type CrmNote as CrmNoteDto,
  type LinkedDeal,
  resolveCompanySchema,
  type CompanyMatch,
  type ResolvedCompany,
} from "@kancrm/shared";
import { canManageCompanies } from "@kancrm/shared";
import { z } from "zod";
import { prisma } from "../../db";
import { badRequest, conflict, forbidden, notFound } from "../../lib/http-errors";
import { requireUser } from "../../plugins/auth";
import type { Prisma, User } from "../../generated/prisma/client";
import { assertCanSeeContacts, canSeeScope, hasDealsDaysLens } from "../visibility/service";
import { visibleProjectsWhere } from "../projects/access";
import { softDeleteCompany, softDeleteContact } from "../trash/service";
import { parseContactsCsv } from "./csv";
import {
  aziendaConLoStessoNome,
  assertNomeAziendaLibero,
  trovaOCreaAzienda,
} from "./company-by-name";


type NoteWithAuthor = Prisma.CrmNoteGetPayload<{ include: { author: true } }>;

function toNoteDto(note: NoteWithAuthor): CrmNoteDto {
  return {
    id: note.id,
    body: note.body,
    createdAt: note.createdAt.toISOString(),
    author: { id: note.author.id, name: note.author.name },
  };
}

type DealWithStage = Prisma.TaskGetPayload<{ include: { dealStage: true } }>;

function toLinkedDeal(deal: DealWithStage): LinkedDeal {
  return {
    id: deal.id,
    title: deal.title,
    stageName: deal.dealStage?.name ?? "—",
    stageColor: deal.dealStage?.color ?? "#6b7280",
    dealValue: deal.dealValue,
  };
}

/**
 * Cosa vede questo utente dell'anagrafica clienti. Calcolato in un punto solo:
 * elenco e dettaglio devono raccontare la stessa storia, e i quattro livelli si
 * confondono facilmente se ripetuti.
 *
 * - `worksCrm` — admin o scope Anagrafica/Offerte: le note del CRM, e il diritto
 *   di rinominare o eliminare un'azienda;
 * - `seesAllCompanies` — solo chi lavora il CRM (`worksCrm`): la lente
 *   "giornate" NON basta. Serve a stimare il carico, non ad aprire l'anagrafica
 *   clienti: chi ce l'ha vede solo i clienti dei propri progetti, e una scheda
 *   di un'azienda estranea torna 404 (com'era prima del 07/08/2026, quando la
 *   lente apriva per errore qualunque azienda, note commerciali comprese);
 * - `countsDeals` — il contatore delle offerte sulla scheda: c'è per chi può
 *   APRIRE l'elenco (anche solo in giornate), non per chi resta fuori;
 * - `canContacts` / `canDeals` — i dettagli veri e propri (persone, importi,
 *   fasi), che restano ai moduli pieni.
 */
async function companyAccess(user: User): Promise<{
  worksCrm: boolean;
  seesAllCompanies: boolean;
  countsDeals: boolean;
  canContacts: boolean;
  canDeals: boolean;
}> {
  const [canContacts, canDeals, daysLens] = await Promise.all([
    canSeeScope(user, VisibilityScope.CONTACTS),
    canSeeScope(user, VisibilityScope.DEALS),
    hasDealsDaysLens(user),
  ]);
  const worksCrm = canManageCompanies({
    role: user.role,
    canSeeContacts: canContacts,
    canSeeDeals: canDeals,
  });
  return {
    worksCrm,
    seesAllCompanies: worksCrm,
    countsDeals: canDeals || daysLens,
    canContacts,
    canDeals,
  };
}

/**
 * L'anagrafica di un cliente si modifica ed elimina solo da chi lavora il CRM.
 *
 * Prima PATCH e DELETE chiedevano il solo login: qualunque utente interno poteva
 * rinominare o cestinare l'azienda di un collega — anche una che non aveva il
 * permesso di vedere, perché quelle rotte non applicavano nemmeno il perimetro
 * di lettura. Creare resta aperto (serve a collegare un cliente a un progetto,
 * vedi la combo "Associa un'azienda cliente"): aggiungere un nome non tocca il
 * lavoro altrui, riscriverlo o farlo sparire sì.
 */
async function assertCanManageCompanies(user: User): Promise<void> {
  if (!(await companyAccess(user)).worksCrm) {
    throw forbidden("L'anagrafica clienti si modifica dal CRM: non hai quel permesso");
  }
}

/**
 * Filtro visibilità aziende. Chi lavora il CRM (scope DEALS o CONTACTS, o admin)
 * vede tutte le aziende; gli altri (es. sviluppatori) vedono solo le aziende
 * collegate ai progetti di cui sono membri.
 */
function companyScopeWhere(
  user: { id: string; role: string },
  seesAll: boolean,
): Prisma.CompanyWhereInput {
  if (seesAll) return {};
  return { projects: { some: { deletedAt: null, members: { some: { userId: user.id } } } } };
}

export function crmRoutes(app: FastifyInstance): void {
  // ---- Aziende -------------------------------------------------------------
  // Le aziende sono visibili a chi lavora il CRM (scope DEALS/CONTACTS) e, per
  // il resto degli utenti interni, limitatamente a quelle dei propri progetti.
  // I PORTAL sono già esclusi dal guard globale.

  app.get("/api/companies", async (request) => {
    const user = requireUser(request);
    const { seesAllCompanies, countsDeals, canContacts } = await companyAccess(user);
    const query = paginationSchema.extend({ q: z.string().optional() }).parse(request.query);
    const where: Prisma.CompanyWhereInput = {
      ...(query.q ? { name: { contains: query.q } } : {}),
      ...companyScopeWhere(user, seesAllCompanies),
    };
    const projectsWhere = await visibleProjectsWhere(user);
    const [companies, total] = await Promise.all([
      prisma.company.findMany({
        where,
        include: {
          _count: {
            select: {
              contacts: { where: { deletedAt: null } },
              deals: { where: { deletedAt: null } },
              projects: { where: projectsWhere },
            },
          },
        },
        orderBy: { name: "asc" },
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
      prisma.company.count({ where }),
    ]);
    return {
      items: companies.map((company): CompanyListItem => ({
        id: company.id,
        name: company.name,
        vatNumber: company.vatNumber,
        city: company.city,
        contactCount: canContacts ? company._count.contacts : 0,
        dealCount: countsDeals ? company._count.deals : 0,
        projectCount: company._count.projects,
      })),
      total,
      page: query.page,
      pageSize: query.pageSize,
    };
  });

  app.get("/api/companies/:id", async (request) => {
    const user = requireUser(request);
    const { worksCrm, seesAllCompanies, countsDeals, canContacts, canDeals } =
      await companyAccess(user);
    const { id } = request.params as { id: string };
    const company = await prisma.company.findFirst({
      where: { id, ...companyScopeWhere(user, seesAllCompanies) },
      include: {
        contacts: { where: { deletedAt: null }, orderBy: { lastName: "asc" } },
        deals: {
          where: { deletedAt: null },
          include: { dealStage: true },
          orderBy: { createdAt: "desc" },
        },
        crmNotes: { include: { author: true }, orderBy: { createdAt: "desc" } },
        _count: {
          select: {
            contacts: { where: { deletedAt: null } },
            deals: { where: { deletedAt: null } },
            projects: { where: await visibleProjectsWhere(user) },
          },
        },
      },
    });
    if (!company) throw notFound("Azienda non trovata");
    const detail: CompanyDetail = {
      id: company.id,
      name: company.name,
      vatNumber: company.vatNumber,
      city: company.city,
      notes: company.notes,
      contactCount: canContacts ? company._count.contacts : 0,
      dealCount: countsDeals ? company._count.deals : 0,
      projectCount: company._count.projects,
      contacts: canContacts
        ? company.contacts.map((contact) => ({
            id: contact.id,
            name: `${contact.firstName} ${contact.lastName}`.trim(),
            email: contact.email,
          }))
        : [],
      deals: canDeals ? company.deals.map(toLinkedDeal) : [],
      // Come contatti e offerte: le note del CRM non si mostrano a chi vede
      // l'azienda solo perché è il cliente di un suo progetto.
      crmNotes: worksCrm ? company.crmNotes.map(toNoteDto) : [],
    };
    return detail;
  });

  // Creare un'azienda resta aperto a ogni utente interno: serve a collegare un
  // cliente a un progetto senza passare dal CRM (combo "Associa un'azienda").
  /**
   * L'azienda che ha già questo nome, scritta magari diversa («jugaad» per
   * «Jugaad S.r.l.»): la tendina la propone al posto di «Crea azienda», così
   * il doppione non nasce nemmeno come tentativo.
   */
  app.get("/api/companies/match", async (request): Promise<CompanyMatch> => {
    requireUser(request);
    const { name } = z.object({ name: z.string().max(200).default("") }).parse(request.query);
    return { company: name.trim() ? await aziendaConLoStessoNome(name) : null };
  });

  /**
   * **Trova o crea**: chi scrive il nome di un'azienda in un modulo e salva non
   * deve sapere se c'era già (16/09/2026). Creare resta aperto a tutti, come la
   * rotta qui sotto: serve a collegare un cliente a quello che si sta scrivendo.
   */
  app.post("/api/companies/resolve", async (request, reply): Promise<ResolvedCompany> => {
    requireUser(request);
    const input = resolveCompanySchema.parse(request.body);
    const azienda = await trovaOCreaAzienda(input.name, input);
    reply.status(azienda.creata ? 201 : 200);
    return { id: azienda.id, name: azienda.name, created: azienda.creata };
  });

  app.post("/api/companies", async (request, reply) => {
    requireUser(request);
    const input = upsertCompanySchema.parse(request.body);
    // «Jugaad srl» quando c'è già «Jugaad» è un doppione, anche se il vincolo
    // del database, che guarda il nome letterale, lo lascerebbe passare.
    await assertNomeAziendaLibero(input.name);
    try {
      const company = await prisma.company.create({
        data: {
          name: input.name,
          vatNumber: input.vatNumber ?? null,
          city: input.city ?? null,
          notes: input.notes ?? null,
        },
      });
      return reply.status(201).send({ id: company.id });
    } catch (error) {
      if (isUniqueViolation(error)) throw conflict("Esiste già un'azienda con questo nome");
      throw error;
    }
  });

  app.patch("/api/companies/:id", async (request) => {
    await assertCanManageCompanies(requireUser(request));
    const { id } = request.params as { id: string };
    const input = upsertCompanySchema.partial().parse(request.body);
    const existing = await prisma.company.findUnique({ where: { id } });
    if (!existing) throw notFound("Azienda non trovata");
    // Rinominare in un nome che è già di un'altra azienda crea il doppione.
    if (input.name !== undefined) await assertNomeAziendaLibero(input.name, id);
    try {
      await prisma.company.update({ where: { id }, data: input });
      return { id };
    } catch (error) {
      if (isUniqueViolation(error)) throw conflict("Esiste già un'azienda con questo nome");
      throw error;
    }
  });

  app.delete("/api/companies/:id", async (request, reply) => {
    await assertCanManageCompanies(requireUser(request));
    const { id } = request.params as { id: string };
    const existing = await prisma.company.findUnique({ where: { id } });
    if (!existing) throw notFound("Azienda non trovata");
    await softDeleteCompany(id); // le offerte mantengono il riferimento
    return reply.status(204).send();
  });

  app.post("/api/companies/:id/notes", async (request, reply) => {
    const user = requireUser(request);
    // Le note sono contenuto CRM, come contatti e offerte: chi non lavora il CRM
    // non le legge (vedi il dettaglio) e quindi non le scrive.
    await assertCanManageCompanies(user);
    const { id } = request.params as { id: string };
    const input = createCrmNoteSchema.parse(request.body);
    const existing = await prisma.company.findUnique({ where: { id } });
    if (!existing) throw notFound("Azienda non trovata");
    const note = await prisma.crmNote.create({
      data: { companyId: id, authorId: user.id, body: input.body },
      include: { author: true },
    });
    return reply.status(201).send(toNoteDto(note));
  });

  // ---- Contatti ------------------------------------------------------------

  app.get("/api/contacts", async (request) => {
    const user = requireUser(request);
    await assertCanSeeContacts(user);
    const query = paginationSchema.extend({ q: z.string().optional() }).parse(request.query);
    const where = query.q
      ? {
          OR: [
            { firstName: { contains: query.q } },
            { lastName: { contains: query.q } },
            { email: { contains: query.q } },
          ],
        }
      : undefined;
    const [contacts, total] = await Promise.all([
      prisma.contact.findMany({
        where,
        include: {
          company: true,
          _count: { select: { deals: { where: { deletedAt: null } } } },
        },
        orderBy: [{ lastName: "asc" }, { firstName: "asc" }],
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
      prisma.contact.count({ where }),
    ]);
    return {
      items: contacts.map((contact): ContactListItem => ({
        id: contact.id,
        firstName: contact.firstName,
        lastName: contact.lastName,
        email: contact.email,
        phone: contact.phone,
        roleTitle: contact.roleTitle,
        company: contact.company ? { id: contact.company.id, name: contact.company.name } : null,
        dealCount: contact._count.deals,
      })),
      total,
      page: query.page,
      pageSize: query.pageSize,
    };
  });

  app.get("/api/contacts/:id", async (request) => {
    const user = requireUser(request);
    await assertCanSeeContacts(user);
    const { id } = request.params as { id: string };
    const contact = await prisma.contact.findUnique({
      where: { id },
      include: {
        company: true,
        deals: {
          where: { deletedAt: null },
          include: { dealStage: true },
          orderBy: { createdAt: "desc" },
        },
        crmNotes: { include: { author: true }, orderBy: { createdAt: "desc" } },
        _count: { select: { deals: { where: { deletedAt: null } } } },
      },
    });
    if (!contact) throw notFound("Contatto non trovato");
    const detail: ContactDetail = {
      id: contact.id,
      firstName: contact.firstName,
      lastName: contact.lastName,
      email: contact.email,
      phone: contact.phone,
      roleTitle: contact.roleTitle,
      company: contact.company ? { id: contact.company.id, name: contact.company.name } : null,
      dealCount: contact._count.deals,
      deals: contact.deals.map(toLinkedDeal),
      crmNotes: contact.crmNotes.map(toNoteDto),
    };
    return detail;
  });

  app.post("/api/contacts", async (request, reply) => {
    const user = requireUser(request);
    await assertCanSeeContacts(user);
    const input = upsertContactSchema.parse(request.body);
    const contact = await prisma.contact.create({
      data: {
        firstName: input.firstName,
        lastName: input.lastName,
        email: input.email ?? null,
        phone: input.phone ?? null,
        roleTitle: input.roleTitle ?? null,
        companyId: input.companyId ?? null,
      },
    });
    return reply.status(201).send({ id: contact.id });
  });

  app.patch("/api/contacts/:id", async (request) => {
    const user = requireUser(request);
    await assertCanSeeContacts(user);
    const { id } = request.params as { id: string };
    const input = upsertContactSchema.partial().parse(request.body);
    const existing = await prisma.contact.findUnique({ where: { id } });
    if (!existing) throw notFound("Contatto non trovato");
    await prisma.contact.update({ where: { id }, data: input });
    return { id };
  });

  app.delete("/api/contacts/:id", async (request, reply) => {
    const user = requireUser(request);
    await assertCanSeeContacts(user);
    const { id } = request.params as { id: string };
    const existing = await prisma.contact.findUnique({ where: { id } });
    if (!existing) throw notFound("Contatto non trovato");
    await softDeleteContact(id);
    return reply.status(204).send();
  });

  app.post("/api/contacts/:id/notes", async (request, reply) => {
    const user = requireUser(request);
    await assertCanSeeContacts(user);
    const { id } = request.params as { id: string };
    const input = createCrmNoteSchema.parse(request.body);
    const existing = await prisma.contact.findUnique({ where: { id } });
    if (!existing) throw notFound("Contatto non trovato");
    const note = await prisma.crmNote.create({
      data: { contactId: id, authorId: user.id, body: input.body },
      include: { author: true },
    });
    return reply.status(201).send(toNoteDto(note));
  });

  // ---- Import CSV (export Google Contacts) ---------------------------------

  app.post("/api/contacts/import", async (request, reply) => {
    const user = requireUser(request);
    await assertCanSeeContacts(user);
    const file = await request.file();
    if (!file) throw badRequest("Nessun file CSV ricevuto");
    const text = (await file.toBuffer()).toString("utf8");
    const parsed = parseContactsCsv(text);
    if (parsed.length === 0) {
      throw badRequest("Nessun contatto riconosciuto nel CSV (intestazioni non supportate?)");
    }

    let imported = 0;
    let skipped = 0;
    let companiesCreated = 0;
    for (const entry of parsed) {
      // Dedup per email, se presente.
      if (entry.email) {
        const existing = await prisma.contact.findFirst({ where: { email: entry.email } });
        if (existing) {
          skipped += 1;
          continue;
        }
      }
      let companyId: string | null = null;
      if (entry.companyName) {
        // Stessa regola dei moduli: «ACME S.p.A.» nell'export di Google e
        // «Acme» in anagrafica sono la stessa azienda.
        const company = await trovaOCreaAzienda(entry.companyName);
        companyId = company.id;
        if (company.creata) companiesCreated += 1;
      }
      await prisma.contact.create({
        data: {
          firstName: entry.firstName || "—",
          lastName: entry.lastName,
          email: entry.email,
          phone: entry.phone,
          companyId,
        },
      });
      imported += 1;
    }
    return reply.status(201).send({ imported, skipped, companiesCreated });
  });
}
