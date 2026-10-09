import type { FastifyInstance } from "fastify";
import { toDateOnly } from "../../lib/date";
import {
  dealValueToDays,
  isExternalRole,
  NotificationType,
  TaskKind,
  UserRole,
  createDealSchema,
  createDealFromTaskSchema,
  AttachmentType,
  dealFiltersSchema,
  updateDealSchema,
  type DealDetail,
  type DealListItem,
  confrontaPerPasso,
  dealForecastDate,
  parseDealMonths,
} from "@kancrm/shared";
import { dealMonthFacet, dealMonthsWhere } from "./months";
import { VisibilityAccess, VisibilityScope } from "@kancrm/shared";
import { ensureWonDealTask } from "./won-task";
import { creaOfferta } from "./create";
import { puoCreareOffertaDaTask } from "./from-task";
import { readMailSettings } from "../mail/settings";
import { taskLinkUrl } from "../tasks/task-link";
import { assertTaskViewAccess } from "../tasks/access";
import { companyIdOf, companyIdSelect } from "../tasks/company";
import { withoutInlineImagesOf } from "../rich-text/inline-images";
import { dealOwnerWhere, ownerIdOf } from "./owner";
import {
  oggiAMezzanotte,
  offerteFermeWhere,
  passiInclude,
  prossimoPassoDi,
  taskApertoWhere,
} from "./next-step";
import { prisma } from "../../db";
import { csvCell } from "../../lib/csv";
import { badRequest, forbidden, notFound } from "../../lib/http-errors";
import { requireAdmin, requireUser } from "../../plugins/auth";
import type { Prisma, User } from "../../generated/prisma/client";
import { logActivity } from "../tasks/activity";
import { isElevated } from "../auth/elevation";
import { taskDetailInclude, toTaskDetail } from "../tasks/serializers";
import { taskAccessContext, type TaskAccessContext } from "../tasks/permissions";
import { toStageDto } from "../deal-stages/routes";
import { accessForScope, assertCanSeeDeals, hasDealsDaysLens } from "../visibility/service";
import { notifyMany } from "../notifications/service";
import { softDeleteTask } from "../trash/service";
import { moduliAttivi, type EsitoOffertaVinta } from "../../edition/registry";

const dealListInclude = {
  dealStage: true,
  company: true,
  contact: true,
  assignee: true,
  billingTasks: { select: { id: true } },
  // I task aperti collegati: il primo per scadenza è il prossimo passo.
  dealTasks: passiInclude,
  _count: {
    select: {
      attachments: true,
      comments: true,
      // Task collegati aperti (non chiusi, non nel cestino): la stessa regola del passo.
      dealTasks: { where: taskApertoWhere },
    },
  },
} satisfies Prisma.TaskInclude;

const dealDetailInclude = {
  ...taskDetailInclude,
  dealStage: true,
  company: true,
  contact: true,
  billingTasks: { select: { id: true } },
  dealTasks: {
    where: { deletedAt: null },
    include: { status: true },
    orderBy: [{ dueDate: { sort: "asc", nulls: "last" } }, { createdAt: "desc" }],
  },
} satisfies Prisma.TaskInclude;

type DealForList = Prisma.TaskGetPayload<{ include: typeof dealListInclude }>;
type DealForDetail = Prisma.TaskGetPayload<{ include: typeof dealDetailInclude }>;

// Anagrafica nel cestino: il riferimento resta, col marcatore "(eliminata/o)".
function companyRef(company: { id: string; name: string; deletedAt: Date | null } | null) {
  if (!company) return null;
  return {
    id: company.id,
    name: company.deletedAt ? `${company.name} (eliminata)` : company.name,
  };
}

function contactRef(
  contact: { id: string; firstName: string; lastName: string; deletedAt: Date | null } | null,
) {
  if (!contact) return null;
  const name = `${contact.firstName} ${contact.lastName}`;
  return { id: contact.id, name: contact.deletedAt ? `${name} (eliminato)` : name };
}

/**
 * Proprietario dell'offerta = l'assegnatario (il commerciale responsabile); se
 * non assegnata, il creatore. Chi non è owner può vedere ma non modificare.
 */

/**
 * Riga per chi guarda in giornate (interni senza privilegio commerciale): la
 * stessa dell'elenco, spogliata dei dati CRM. Il contatto è rubrica
 * commerciale, i conteggi pubblicizzano allegati e chat che non si possono
 * aprire, esito e fatturazione sono affari di chi vende. Il valore resta in
 * euro nel DTO: la conversione in giornate è una presentazione (tariffa
 * condivisa `DEV_DAY_RATE`), non un segreto.
 */
function toDaysViewItem(item: DealListItem): DealListItem {
  return {
    ...item,
    // Giornate al posto degli euro: l'importo non esce proprio dal server.
    dealValue: dealValueToDays(item.dealValue),
    contact: null,
    lostReason: null,
    billingTaskId: null,
    projectId: null,
    visibleToSalesMonitors: false,
    attachmentCount: 0,
    commentCount: 0,
    canEdit: false,
  };
}

/**
 * L'utente può modificare l'offerta: l'ADMIN sempre; gli altri solo con accesso
 * FULL al modulo Offerte E se sono il proprietario dell'offerta.
 *
 * **Un'offerta senza commerciale la può riprendere chiunque lavori le offerte.**
 * Il ripiego sul creatore valeva come proprietà, ma creava l'offerta orfana:
 * commerciale mai impostato e creatore che non c'è più (o che non c'entra), e
 * nessuno — nemmeno per assegnarla — poteva più toccarla, se non un admin
 * elevato che di solito non è chi vende (22/08/2026). Da assegnata, torna a
 * valere la regola stretta: solo il suo commerciale.
 */
export function canEditDeal(
  user: User,
  deal: { assigneeId: string | null; creatorId: string },
  access: VisibilityAccess | null,
): boolean {
  if (user.role === UserRole.ADMIN) return true;
  if (access !== VisibilityAccess.FULL) return false;
  if (deal.assigneeId === null) return true;
  return ownerIdOf(deal) === user.id;
}

/**
 * Il commerciale di un'offerta dev'essere un utente interno con accesso completo
 * alle Offerte: un cliente del portale o chi le vede in sola lettura non potrebbe
 * lavorare l'offerta che gli viene intestata.
 */
async function assertValidDealOwner(assigneeId: string | null | undefined): Promise<void> {
  if (!assigneeId) return;
  const user = await prisma.user.findUnique({ where: { id: assigneeId } });
  if (!user || !user.isActive || user.isSystem || isExternalRole(user.role)) {
    throw badRequest("Commerciale non valido");
  }
  if ((await accessForScope(user, VisibilityScope.DEALS)) !== VisibilityAccess.FULL) {
    throw badRequest("{{user}} non ha accesso completo alle Offerte", { user: user.name });
  }
}

function toDealListItem(deal: DealForList, canEdit: boolean): DealListItem {
  return {
    id: deal.id,
    title: deal.title,
    stage: toStageDto(deal.dealStage!),
    company: companyRef(deal.company),
    contact: contactRef(deal.contact),
    assignee: deal.assignee ? { id: deal.assignee.id, name: deal.assignee.name } : null,
    dealValue: deal.dealValue,
    probability: deal.probability,
    expectedCloseDate: toDateOnly(deal.expectedCloseDate),
    closedAt: toDateOnly(deal.closedAt),
    attachmentCount: deal._count.attachments,
    commentCount: deal._count.comments,
    openTaskCount: deal._count.dealTasks,
    nextStep: prossimoPassoDi(deal.dealTasks),
    createdAt: deal.createdAt.toISOString(),
    billingTaskId: deal.billingTasks[0]?.id ?? null,
    projectId: deal.relatedProjectId,
    lostReason: deal.lostReason,
    visibleToSalesMonitors: deal.visibleToSalesMonitors,
    canEdit,
  };
}

function toDealDetail(deal: DealForDetail, canEdit: boolean, ctx: TaskAccessContext): DealDetail {
  return {
    ...toTaskDetail(deal, ctx),
    stage: toStageDto(deal.dealStage!),
    company: companyRef(deal.company),
    contact: contactRef(deal.contact),
    dealValue: deal.dealValue,
    probability: deal.probability,
    expectedCloseDate: toDateOnly(deal.expectedCloseDate),
    // Il giorno, non l'istante del task: il campo «Vinta il / Persa il» è una
    // data, e con l'ora attaccata il browser lo lasciava vuoto (01/10/2026).
    closedAt: toDateOnly(deal.closedAt),
    billingTaskId: deal.billingTasks[0]?.id ?? null,
    projectId: deal.relatedProjectId,
    lostReason: deal.lostReason,
    visibleToSalesMonitors: deal.visibleToSalesMonitors,
    canEdit,
    linkedTasks: deal.dealTasks.map((task) => ({
      id: task.id,
      title: task.title,
      status: { name: task.status!.name, color: task.status!.color },
      dueDate: toDateOnly(task.dueDate),
      isClosed: task.status!.isClosed,
    })),
  };
}

export async function loadDeal(id: string): Promise<DealForDetail> {
  const deal = await prisma.task.findUnique({ where: { id }, include: dealDetailInclude });
  if (!deal || deal.kind !== TaskKind.DEAL || !deal.dealStage)
    throw notFound("Offerta non trovata");
  return deal;
}

function parseDateOnly(value: string | null | undefined): Date | null | undefined {
  if (value === undefined) return undefined;
  return value === null ? null : new Date(`${value}T00:00:00.000Z`);
}

export function dealRoutes(app: FastifyInstance): void {
  app.get("/api/deals", async (request) => {
    const user = requireUser(request);
    const access = await accessForScope(user, VisibilityScope.DEALS);
    // Gruppi con le Offerte in "Giornate" (sviluppatori): l'elenco sì, in sola
    // consultazione — il resto del modulo (dettaglio, modifica, allegati) resta
    // chiuso, ognuno dal proprio controllo, perché la lente non è un accesso.
    const daysView = access === null && (await hasDealsDaysLens(user));
    if (!daysView) await assertCanSeeDeals(user);
    const filters = dealFiltersSchema.parse(request.query);
    const perimetro = dealOwnerWhere(filters.owner, user.id);
    const perMese = dealMonthsWhere(parseDealMonths(filters.months));
    // Base: tutti i filtri tranne quello sul valore, che ha bisogno della media
    // calcolata proprio su questo insieme (la media "di ciò che stai guardando",
    // non di tutte le offerte esistenti).
    const oggi = oggiAMezzanotte();
    const baseWhere = {
      kind: TaskKind.DEAL,
      ...(filters.stageId ? { dealStageId: filters.stageId } : {}),
      ...(filters.companyId ? { companyId: filters.companyId } : {}),
      // Titolo o cliente: la tendina dei clienti c'è, ma chi digita un nome si
      // aspetta di trovarlo, non di doverlo scegliere altrove.
      ...(filters.q
        ? {
            OR: [
              { title: { contains: filters.q } },
              { company: { name: { contains: filters.q } } },
            ],
          }
        : {}),
      ...(filters.includeClosed ? {} : { dealStage: { isWon: false, isLost: false } }),
      // Dentro `AND` e non steso qui: la ricerca sopra usa già un `OR`, e due
      // `OR` fratelli si sovrascrivono (CLAUDE.md, «trappole già pagate»).
      // Nello stesso `AND` il filtro «Ferme», che di `OR` ne ha anche lui.
      ...(perimetro || filters.stalled || perMese
        ? {
            AND: [
              ...(perimetro ? [perimetro] : []),
              ...(filters.stalled ? [offerteFermeWhere(filters.stalled, oggi)] : []),
              ...(perMese ? [perMese] : []),
            ],
          }
        : {}),
    };

    const { _avg } = await prisma.task.aggregate({ where: baseWhere, _avg: { dealValue: true } });
    const averageValue = _avg.dealValue;

    const where = {
      ...baseWhere,
      // Le offerte senza valore restano fuori da entrambi i lati: non si possono
      // dire né sopra né sotto una media.
      ...(filters.value && averageValue !== null
        ? { dealValue: filters.value === "above" ? { gte: averageValue } : { lt: averageValue } }
        : {}),
    };

    const dir = filters.sortDir ?? "asc";
    const orderBy =
      filters.sortBy === "title"
        ? [{ title: dir }]
        : filters.sortBy === "stage"
          ? [{ dealStage: { order: dir } }]
          : filters.sortBy === "company"
            ? [{ company: { name: dir } }]
            : // Le offerte senza commerciale finiscono in testa in ordine crescente:
              // Prisma non espone `nulls` sull'ordinamento per relazione.
              filters.sortBy === "assignee"
              ? [{ assignee: { name: dir } }, { title: "asc" as const }]
              : filters.sortBy === "value"
                ? [{ dealValue: { sort: dir, nulls: "last" as const } }]
                : filters.sortBy === "probability"
                  ? [{ probability: { sort: dir, nulls: "last" as const } }]
                  : filters.sortBy === "createdAt"
                    ? [{ createdAt: dir }]
                    : [
                        { expectedCloseDate: { sort: dir, nulls: "last" as const } },
                        { createdAt: "desc" as const },
                      ];

    /**
     * La pagina. Per prossimo passo l'ordine non si può chiedere a Prisma (è il
     * minimo di una relazione): si leggono solo gli id e le scadenze dei passi
     * dell'insieme filtrato, si ordina con la regola condivisa, e si carica la
     * pagina. Le offerte sono decine o centinaia: costa poco, e l'ordine è lo
     * stesso che il browser mostrerebbe.
     */
    const caricaPagina = async () => {
      if (filters.sortBy !== "nextStep" && filters.sortBy !== "expectedCloseDate") {
        return prisma.task.findMany({
          where,
          include: dealListInclude,
          orderBy,
          skip: (filters.page - 1) * filters.pageSize,
          take: filters.pageSize,
        });
      }
      const leggeri = await prisma.task.findMany({
        where,
        select: {
          id: true,
          title: true,
          createdAt: true,
          closedAt: true,
          expectedCloseDate: true,
          dealTasks: passiInclude,
        },
      });
      /**
       * **Per chiusura** (01/10/2026) si ordina sulla data che la colonna mostra:
       * per un'offerta vinta o persa quella effettiva, per le altre la prevista
       * (`dealForecastDate`, la regola della previsione). Ordinare sulla prevista
       * mentre la cella diceva l'effettiva metteva un «22/08» prima di un
       * «18/06». Prisma non sa ordinare su «la prima delle due»: si ordina qui.
       */
      const perChiusura = (riga: (typeof leggeri)[number]) =>
        dealForecastDate({
          closedAt: toDateOnly(riga.closedAt),
          expectedCloseDate: toDateOnly(riga.expectedCloseDate),
        });
      const ordinati = leggeri
        .map((riga) => ({
          id: riga.id,
          title: riga.title,
          createdAt: riga.createdAt,
          chiusura: perChiusura(riga),
          passo: prossimoPassoDi(riga.dealTasks),
        }))
        .sort((a, b) => {
          if (filters.sortBy === "expectedCloseDate") {
            // le offerte senza data in fondo, in entrambi i versi, come prima
            if (a.chiusura !== b.chiusura) {
              if (a.chiusura === null) return 1;
              if (b.chiusura === null) return -1;
              return dir === "desc"
                ? b.chiusura.localeCompare(a.chiusura)
                : a.chiusura.localeCompare(b.chiusura);
            }
            return b.createdAt.getTime() - a.createdAt.getTime();
          }
          const perPasso = confrontaPerPasso(a, b);
          return (dir === "desc" ? -perPasso : perPasso) || a.title.localeCompare(b.title, "it");
        });
      const ids = ordinati
        .slice((filters.page - 1) * filters.pageSize, filters.page * filters.pageSize)
        .map((riga) => riga.id);
      const pagina = await prisma.task.findMany({
        where: { id: { in: ids } },
        include: dealListInclude,
      });
      const posizione = new Map(ids.map((id, i) => [id, i]));
      return pagina.sort((a, b) => posizione.get(a.id)! - posizione.get(b.id)!);
    };

    // Valori disponibili per le tendine: calcolati sull'insieme di partenza (senza
    // i filtri attivi) così le opzioni non spariscono man mano che si filtra, ma
    // restano escluse quelle senza offerte.
    const facetWhere = {
      kind: TaskKind.DEAL,
      ...(filters.includeClosed ? {} : { dealStage: { isWon: false, isLost: false } }),
      // Anche i numeri accanto alle voci seguono il perimetro: «3 offerte in
      // trattativa» dev'essere vero per l'elenco che si sta guardando.
      ...(perimetro ? { AND: [perimetro] } : {}),
    };

    /**
     * I numeri del filtro «Ferme», contati **senza** il filtro stesso: come ogni
     * tendina, devono dire quante se ne vedrebbero scegliendo quella voce. Gli
     * altri filtri valgono — è la stessa `where`, meno la clausola «Ferme».
     */
    const whereSenzaFerme: Prisma.TaskWhereInput = {
      ...where,
      AND: [...(perimetro ? [perimetro] : []), ...(perMese ? [perMese] : [])],
    };
    const contaFerme = (filtro: "tutte" | "senzaPasso" | "passoScaduto" | "chiusuraPassata") =>
      prisma.task.count({ where: { AND: [whereSenzaFerme, offerteFermeWhere(filtro, oggi)] } });

    const [deals, total, valueSum, byCompany, byStage, companies, stages, ferme, dateMesi] =
      await Promise.all([
        caricaPagina(),
        prisma.task.count({ where }),
        // Somma nominale dell'insieme filtrato, tutte le pagine: la tabella la
        // mostra sotto l'intestazione Valore. Nessun peso: è la colonna, sommata.
        prisma.task.aggregate({ where, _sum: { dealValue: true } }),
        prisma.task.groupBy({ by: ["companyId"], where: facetWhere, _count: { _all: true } }),
        prisma.task.groupBy({ by: ["dealStageId"], where: facetWhere, _count: { _all: true } }),
        prisma.company.findMany({ select: { id: true, name: true } }),
        prisma.dealStage.findMany({ select: { id: true, name: true, order: true } }),
        Promise.all([
          contaFerme("tutte"),
          contaFerme("senzaPasso"),
          contaFerme("passoScaduto"),
          contaFerme("chiusuraPassata"),
        ]).then(([tutte, senzaPasso, passoScaduto, chiusuraPassata]) => ({
          tutte,
          senzaPasso,
          passoScaduto,
          chiusuraPassata,
        })),
        // I mesi presenti: due date per offerta, raggruppate qui con la regola condivisa.
        prisma.task.findMany({
          where: facetWhere,
          select: { closedAt: true, expectedCloseDate: true },
        }),
      ]);

    const companyName = new Map(companies.map((c) => [c.id, c.name]));
    const stageById = new Map(stages.map((s) => [s.id, s]));
    const facets = {
      companies: byCompany
        .filter((row) => row.companyId !== null)
        .map((row) => ({
          id: row.companyId!,
          name: companyName.get(row.companyId!) ?? "—",
          count: row._count._all,
        }))
        .sort((a, b) => a.name.localeCompare(b.name, "it")),
      stages: byStage
        .filter((row) => row.dealStageId !== null)
        .map((row) => ({
          id: row.dealStageId!,
          name: stageById.get(row.dealStageId!)?.name ?? "—",
          count: row._count._all,
          order: stageById.get(row.dealStageId!)?.order ?? 0,
        }))
        .sort((a, b) => a.order - b.order)
        .map(({ id, name, count }) => ({ id, name, count })),
      stalled: ferme,
      months: dealMonthFacet(dateMesi),
    };
    const items = deals.map((deal) => toDealListItem(deal, canEditDeal(user, deal, access)));
    return {
      items: daysView ? items.map(toDaysViewItem) : items,
      total,
      page: filters.page,
      pageSize: filters.pageSize,
      // Anche media e somma seguono l'unità: nessun euro nella risposta.
      averageValue: daysView ? dealValueToDays(averageValue) : averageValue,
      totalValue: daysView ? dealValueToDays(valueSum._sum.dealValue) : valueSum._sum.dealValue,
      valueUnit: daysView ? "DAYS" : "EUR",
      facets,
    };
  });

  // Export CSV della vista tabella offerte (solo admin).
  /**
   * Export CSV delle offerte (solo admin): scarico grezzo, come quello dei task
   * — onora ricerca, fase e chiuse/aperte, non il cliente né la fascia di
   * valore. È una scelta (06/08/2026): se un giorno dovrà rispecchiare la
   * tabella, i filtri mancanti vanno aggiunti QUI e nel link del client insieme.
   */
  app.get("/api/deals/export", async (request, reply) => {
    requireAdmin(request);
    const filters = dealFiltersSchema.parse(request.query);
    const perimetroExport = dealOwnerWhere(filters.owner, requireUser(request).id);
    const deals = await prisma.task.findMany({
      where: {
        kind: TaskKind.DEAL,
        ...(filters.stageId ? { dealStageId: filters.stageId } : {}),
        ...(filters.q ? { title: { contains: filters.q } } : {}),
        ...(filters.includeClosed ? {} : { dealStage: { isWon: false, isLost: false } }),
        // «Il file esporta quello che vedi»: il perimetro vale anche qui.
        ...(perimetroExport ? { AND: [perimetroExport] } : {}),
      },
      include: dealListInclude,
      orderBy: [{ expectedCloseDate: { sort: "asc", nulls: "last" } }, { createdAt: "desc" }],
    });
    const escape = csvCell;
    const lines = [
      "Offerta;Fase;Azienda;Contatto;Commerciale;Valore;Probabilità;Chiusura prevista",
      ...deals.map((deal) =>
        [
          escape(deal.title),
          escape(deal.dealStage?.name ?? ""),
          escape(deal.company?.name ?? ""),
          escape(deal.contact ? `${deal.contact.firstName} ${deal.contact.lastName}` : ""),
          escape(deal.assignee?.name ?? ""),
          deal.dealValue !== null ? String(deal.dealValue).replace(".", ",") : "",
          deal.probability !== null ? String(deal.probability) : "",
          deal.expectedCloseDate?.toISOString().slice(0, 10) ?? "",
        ].join(";"),
      ),
    ];
    reply.header("Content-Type", "text/csv; charset=utf-8");
    reply.header("Content-Disposition", 'attachment; filename="offerte.csv"');
    return lines.join("\r\n");
  });

  app.get("/api/deals/:id", async (request) => {
    const user = requireUser(request);
    await assertCanSeeDeals(user);
    const access = await accessForScope(user, VisibilityScope.DEALS);
    const { id } = request.params as { id: string };
    const deal = await loadDeal(id);
    return toDealDetail(deal, canEditDeal(user, deal, access), await taskAccessContext(user));
  });

  /**
   * **Un'offerta da un task** (06/10/2026): la crea chi governa quel lavoro (vedi
   * `puoCreareOffertaDaTask`), anche da un task nato da un ticket. Titolo e
   * descrizione proposti dal task — la descrizione senza le figure incollate,
   * che sono file del task —, il cliente del task o del suo progetto, la fase
   * vinta salvo scelta diversa. File e chat del task non si copiano: fra gli
   * allegati va **il link al task**, che si apre nel suo pannello.
   *
   * Un'offerta che nasce vinta fa partire subito il task di fatturazione per
   * l'amministrazione: non ci sono documenti da leggere prima.
   */
  app.post("/api/tasks/:id/deal", async (request, reply) => {
    const user = requireUser(request);
    const { id } = request.params as { id: string };
    const task = await prisma.task.findFirst({
      where: { id, deletedAt: null },
      // `companyIdSelect` meno la colonna: qui si include, il task si legge intero.
      include: {
        relatedDeal: companyIdSelect.relatedDeal,
        sourceDeal: companyIdSelect.sourceDeal,
        project: companyIdSelect.project,
        relatedProject: companyIdSelect.relatedProject,
        status: { select: { category: true } },
      },
    });
    if (!task) throw notFound("Task non trovato");
    await assertTaskViewAccess(user, task);
    if (!(await puoCreareOffertaDaTask(user, task))) {
      throw forbidden("Un'offerta da un task la crea il manager del suo progetto o della sua area");
    }
    const input = createDealFromTaskSchema.parse(request.body);
    await assertValidDealOwner(input.assigneeId);
    const fase = input.stageId
      ? await prisma.dealStage.findUnique({ where: { id: input.stageId } })
      : ((await prisma.dealStage.findFirst({
          where: { isWon: true },
          orderBy: { order: "asc" },
        })) ?? (await prisma.dealStage.findFirst({ orderBy: { order: "asc" } })));
    if (!fase) throw badRequest("Fase non valida");
    if (fase.isWon && (input.dealValue === null || input.dealValue === undefined)) {
      throw badRequest("Indica il valore: un'offerta vinta senza importo conterebbe zero");
    }
    const base = (await readMailSettings()).baseUrl;
    const nomeLink = `Task di origine: ${task.title}`.slice(0, 200);

    const offerta = await creaOfferta(
      {
        title: input.title,
        description: withoutInlineImagesOf(input.description, task.id),
        stageId: fase.id,
        companyId: input.companyId !== undefined ? input.companyId : companyIdOf(task),
        assigneeId: input.assigneeId ?? user.id,
        dealValue: input.dealValue ?? null,
      },
      user,
      async (tx, creata) => {
        if (base) {
          await tx.attachment.create({
            data: {
              type: AttachmentType.LINK,
              name: nomeLink,
              url: taskLinkUrl(base, task.id),
              uploadedById: user.id,
              tasks: { create: { taskId: creata.id } },
            },
          });
          await logActivity(tx, creata.id, user.id, "attachment_added", {
            name: nomeLink,
            type: "LINK",
          });
        }
        await logActivity(tx, task.id, user.id, "deal_created", { title: input.title });
      },
    );
    if (offerta.vinta) {
      try {
        await ensureWonDealTask(offerta.id, user, null);
      } catch (error) {
        request.log.error(error, "Task di fatturazione dell'offerta nata da un task non creato");
      }
    }
    return reply.status(201).send({ id: offerta.id });
  });

  app.post("/api/deals", async (request, reply) => {
    const user = requireUser(request);
    const access = await accessForScope(user, VisibilityScope.DEALS);
    // Creare richiede accesso completo: la sola lettura (es. Amministrativo) no.
    if (user.role !== UserRole.ADMIN && access !== VisibilityAccess.FULL) {
      throw forbidden("Hai accesso alle offerte in sola lettura");
    }
    const input = createDealSchema.parse(request.body);
    await assertValidDealOwner(input.assigneeId);

    const deal = await creaOfferta(input, user);
    const full = await loadDeal(deal.id);
    return reply
      .status(201)
      .send(toDealDetail(full, canEditDeal(user, full, access), await taskAccessContext(user)));
  });

  app.patch("/api/deals/:id", async (request) => {
    const user = requireUser(request);
    await assertCanSeeDeals(user);
    const access = await accessForScope(user, VisibilityScope.DEALS);
    const { id } = request.params as { id: string };
    const input = updateDealSchema.parse(request.body);
    if (input.assigneeId !== undefined) await assertValidDealOwner(input.assigneeId);
    const existing = await loadDeal(id);
    /** Riempito solo se la lettura degli allegati non è ripartita perché c'era già. */
    let avvisoAnalisi: EsitoOffertaVinta["analysisNotice"] = null;
    /** Com'è andata la messa in lettura, per dirlo a chi ha spostato l'offerta. */
    let statoAnalisi: EsitoOffertaVinta["analysisState"] = null;
    // Modifica solo per l'ADMIN o il proprietario (con accesso completo).
    if (!canEditDeal(user, existing, access)) {
      throw forbidden("Solo il proprietario dell'offerta può modificarla");
    }

    // Cambio commerciale e valore: tracciati come lo stato, con i nomi risolti ora.
    const entries: Array<{ action: string; payload: { from: unknown; to: unknown } }> = [];
    if (input.assigneeId !== undefined && input.assigneeId !== existing.assigneeId) {
      const nameOf = async (id: string | null) =>
        id ? ((await prisma.user.findUnique({ where: { id } }))?.name ?? null) : null;
      entries.push({
        action: "assignee_changed",
        payload: { from: await nameOf(existing.assigneeId), to: await nameOf(input.assigneeId) },
      });
    }
    if (input.dealValue !== undefined && input.dealValue !== existing.dealValue) {
      entries.push({
        action: "value_changed",
        payload: { from: existing.dealValue, to: input.dealValue ?? null },
      });
    }
    if (
      input.expectedCloseDate !== undefined &&
      parseDateOnly(input.expectedCloseDate)?.getTime() !== existing.expectedCloseDate?.getTime()
    ) {
      entries.push({
        action: "due_changed",
        payload: {
          from: toDateOnly(existing.expectedCloseDate),
          to: input.expectedCloseDate ?? null,
        },
      });
    }

    let stageChange: { from: string; to: string } | undefined;
    let newStageWon = false;
    let notifyStageEvent = false;
    // Data di chiusura effettiva: quando l'offerta entra in una fase vinta o persa
    // è **quel giorno** che conta, non la chiusura prevista a suo tempo. Serve ai
    // conti della previsione, che altrimenti metterebbero un affare concluso a
    // luglio nel mese in cui si sperava di chiuderlo.
    let closedAt: Date | null | undefined;
    // la fase in cui l'offerta sarà dopo questa modifica: serve alla data di chiusura a mano
    let faseFinale = existing.dealStage;
    if (input.stageId && input.stageId !== existing.dealStageId) {
      const newStage = await prisma.dealStage.findUnique({ where: { id: input.stageId } });
      if (!newStage) throw badRequest("Fase non valida");
      faseFinale = newStage;
      stageChange = { from: existing.dealStage!.name, to: newStage.name };
      newStageWon = newStage.isWon;
      notifyStageEvent = newStage.isWon || newStage.isLost;
      // Tornando in una fase aperta l'offerta è di nuovo in gioco: la data va tolta.
      closedAt = notifyStageEvent ? new Date() : null;
    }

    /**
     * **La data di chiusura corretta a mano** (01/10/2026): solo un super admin,
     * solo su un'offerta vinta o persa. Mezzogiorno UTC, come la convenzione
     * delle date di chiusura (`scripts/set-deal-closed-date.ts`): il giorno
     * resta quello in qualunque fuso. Lascia traccia in cronologia.
     */
    if (input.closedAt !== undefined) {
      if (!isElevated(user)) throw forbidden("La data di chiusura la corregge un super admin");
      if (!faseFinale?.isWon && !faseFinale?.isLost) {
        throw badRequest("La data di chiusura vale solo per un'offerta vinta o persa");
      }
      closedAt = new Date(`${input.closedAt}T12:00:00.000Z`);
      const prima = toDateOnly(existing.closedAt);
      if (prima !== input.closedAt) {
        entries.push({
          action: "closed_date_changed",
          payload: { from: prima, to: input.closedAt },
        });
      }
    }

    /**
     * **La probabilità** (01/10/2026): ogni cambio resta in cronologia, come il
     * valore e la chiusura prevista — sono i tre numeri della previsione. E
     * un'offerta che diventa vinta va al **100%**: la previsione la contava già
     * per intero, ma il campo continuava a dire la stima di prima.
     */
    const probability = newStageWon ? 100 : input.probability;
    if (probability !== undefined && probability !== existing.probability) {
      entries.push({
        action: "probability_changed",
        payload: { from: existing.probability, to: probability },
      });
    }

    // Presa in carico: la prima modifica a un'offerta senza assegnatario la
    // assegna a chi la sta lavorando, come già avviene per i task dello
    // scadenzario. Non scatta se l'assegnatario viene impostato esplicitamente.
    const autoAssign = existing.assigneeId === null && input.assigneeId === undefined;

    /**
     * **Il resto dei campi, in cronologia** (06/10/2026): prima restavano fuori
     * titolo, descrizione, cliente, contatto, motivo della perdita, la
     * condivisione con gli investitori e la presa in carico automatica — un'offerta
     * poteva cambiare cliente o diventare visibile da fuori senza lasciare traccia.
     * Della descrizione si dice che è cambiata, non il testo: può essere lunga e
     * l'ha già chi apre l'offerta.
     */
    if (input.title !== undefined && input.title !== existing.title) {
      entries.push({ action: "renamed", payload: { from: existing.title, to: input.title } });
    }
    if (input.description !== undefined && (input.description ?? null) !== existing.description) {
      entries.push({ action: "description_changed", payload: { from: null, to: null } });
    }
    if (input.companyId !== undefined && (input.companyId ?? null) !== existing.companyId) {
      const nuovo = input.companyId
        ? await prisma.company.findUnique({
            where: { id: input.companyId },
            select: { name: true },
          })
        : null;
      entries.push({
        action: "company_changed",
        payload: { from: existing.company?.name ?? null, to: nuovo?.name ?? null },
      });
    }
    if (input.contactId !== undefined && (input.contactId ?? null) !== existing.contactId) {
      const nuovo = input.contactId
        ? await prisma.contact.findUnique({ where: { id: input.contactId } })
        : null;
      entries.push({
        action: "contact_changed",
        payload: {
          from: contactRef(existing.contact)?.name ?? null,
          to: contactRef(nuovo)?.name ?? null,
        },
      });
    }
    if (input.lostReason !== undefined && (input.lostReason ?? null) !== existing.lostReason) {
      entries.push({
        action: "lost_reason_changed",
        payload: { from: existing.lostReason, to: input.lostReason ?? null },
      });
    }
    if (
      input.visibleToSalesMonitors !== undefined &&
      input.visibleToSalesMonitors !== existing.visibleToSalesMonitors
    ) {
      entries.push({
        action: "sales_monitor_visibility_changed",
        payload: { from: existing.visibleToSalesMonitors, to: input.visibleToSalesMonitors },
      });
    }
    if (autoAssign) {
      entries.push({ action: "assignee_changed", payload: { from: null, to: user.name } });
    }

    const expectedCloseDate = parseDateOnly(input.expectedCloseDate);
    await prisma.$transaction(async (tx) => {
      await tx.task.update({
        where: { id },
        data: {
          ...(autoAssign ? { assigneeId: user.id } : {}),
          ...(input.title !== undefined ? { title: input.title } : {}),
          ...(input.description !== undefined ? { description: input.description } : {}),
          ...(input.stageId !== undefined ? { dealStageId: input.stageId } : {}),
          ...(input.companyId !== undefined ? { companyId: input.companyId } : {}),
          ...(input.contactId !== undefined ? { contactId: input.contactId } : {}),
          ...(input.assigneeId !== undefined ? { assigneeId: input.assigneeId } : {}),
          ...(input.dealValue !== undefined ? { dealValue: input.dealValue } : {}),
          ...(probability !== undefined ? { probability } : {}),
          ...(input.lostReason !== undefined ? { lostReason: input.lostReason } : {}),
          ...(input.visibleToSalesMonitors !== undefined
            ? { visibleToSalesMonitors: input.visibleToSalesMonitors }
            : {}),
          ...(expectedCloseDate !== undefined ? { expectedCloseDate } : {}),
          ...(closedAt !== undefined ? { closedAt } : {}),
        },
      });
      for (const entry of entries) {
        await logActivity(tx, id, user.id, entry.action, entry.payload);
      }
      if (stageChange) {
        await logActivity(tx, id, user.id, "stage_changed", {
          ...stageChange,
          ...(input.lostReason ? { reason: input.lostReason } : {}),
        });
      }
    });

    /**
     * **Vinta: prima si legge, poi si chiede.**
     *
     * Fino al 21/08/2026 lo spostamento in fase vinta apriva subito due domande
     * — il task per l'amministrazione con la sua nota, e il progetto con il suo
     * responsabile — e solo dopo partiva la lettura dei documenti. Erano domande
     * fatte al buio: chi le riceveva non aveva ancora davanti niente su cui
     * decidere, e quando la proposta arrivava si ritrovava un task creato prima
     * e altri proposti dopo, sugli stessi soldi.
     *
     * Ora l'unica cosa che accade qui è mettere l'offerta in lettura. Le domande
     * le fa il pannello della proposta, quando c'è qualcosa da leggere: lì il
     * commerciale vede le righe estratte, le corregge, e decide riga per riga
     * cosa va in amministrazione e cosa nel progetto.
     */
    if (newStageWon) {
      // Un modulo può prendere in mano l'offerta vinta (la lettura dei
      // contratti, che apre lei le domande); senza, il comportamento di sempre:
      // il task di fatturazione, senza nota.
      const gestore = moduliAttivi().find((modulo) => modulo.offertaVinta);
      if (gestore?.offertaVinta) {
        const esito = await gestore.offertaVinta(id, user);
        avvisoAnalisi = esito.analysisNotice;
        statoAnalisi = esito.analysisState;
      } else {
        await ensureWonDealTask(id, user, null);
      }
    }
    if (notifyStageEvent && stageChange) {
      await notifyMany(
        [existing.creatorId, existing.assigneeId],
        user.id,
        NotificationType.DEAL_STAGE,
        {
          message: (t) =>
            t('Offerta "{{title}}" passata in fase {{stage}}', {
              title: existing.title,
              stage: stageChange.to,
            }),
          taskId: id,
          taskKind: TaskKind.DEAL,
        },
      );
    }
    const updated = await loadDeal(id);
    return {
      ...toDealDetail(updated, canEditDeal(user, updated, access), await taskAccessContext(user)),
      analysisNotice: avvisoAnalisi,
      analysisState: statoAnalisi,
    };
  });

  app.delete("/api/deals/:id", async (request, reply) => {
    const user = requireUser(request);
    await assertCanSeeDeals(user);
    const access = await accessForScope(user, VisibilityScope.DEALS);
    const { id } = request.params as { id: string };
    const existing = await loadDeal(id);
    // Eliminare come modificare: ADMIN o proprietario con accesso completo.
    if (!canEditDeal(user, existing, access)) {
      throw forbidden("Solo il proprietario dell'offerta può eliminarla");
    }
    await softDeleteTask(id);
    return reply.status(204).send();
  });
}
