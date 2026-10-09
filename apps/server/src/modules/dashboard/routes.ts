import type { FastifyInstance } from "fastify";
import { startOfTodayUTC } from "../../lib/date";
import { TaskKind, UserRole, VisibilityScope, type Dashboard } from "@kancrm/shared";
import { prisma } from "../../db";
import type { Prisma } from "../../generated/prisma/client";
import { requireUser } from "../../plugins/auth";
import { taskListInclude, toTaskListItem } from "../tasks/serializers";
import { taskAccessContext } from "../tasks/permissions";
import { canSeeScope } from "../visibility/service";
import { dealOwnerWhere } from "../deals/owner";
import { moduliAttivi } from "../../edition/registry";

type SectionTasks = { mine: unknown[]; supervised: unknown[] };

function mapSection(
  section: {
    mine: Parameters<typeof toTaskListItem>[0][];
    supervised: Parameters<typeof toTaskListItem>[0][];
  },
  accessCtx: Parameters<typeof toTaskListItem>[1],
): SectionTasks {
  return {
    mine: section.mine.map((t) => toTaskListItem(t, accessCtx)),
    supervised: section.supervised.map((t) => toTaskListItem(t, accessCtx)),
  };
}

export function dashboardRoutes(app: FastifyInstance): void {
  // Home "La mia giornata": scadenze, i miei task per stato, offerte aperte.
  app.get("/api/dashboard", async (request) => {
    const user = requireUser(request);
    const today = startOfTodayUTC();
    const tomorrow = new Date(today);
    tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);

    // Le scadenze parlano di due responsabilità: i task che l'utente ESEGUE
    // (assegnatario) e quelli di cui RISPONDE (supervisore). Una query sola;
    // chi è entrambe le cose conta una volta, tra i suoi.
    const watchedOpenTasks = await prisma.task.findMany({
      where: {
        OR: [{ assigneeId: user.id }, { supervisorId: user.id }],
        status: { isClosed: false },
      },
      include: taskListInclude,
      orderBy: [{ dueDate: { sort: "asc", nulls: "last" } }, { createdAt: "desc" }],
    });
    const myOpenTasks = watchedOpenTasks.filter((t) => t.assigneeId === user.id);
    const supervisedOnly = watchedOpenTasks.filter(
      (t) => t.supervisorId === user.id && t.assigneeId !== user.id,
    );

    const dayAfterTomorrow = new Date(tomorrow);
    dayAfterTomorrow.setUTCDate(dayAfterTomorrow.getUTCDate() + 1);
    // "Prossimi giorni": da dopodomani, per i tre giorni successivi (+2…+5).
    const horizonEnd = new Date(today);
    horizonEnd.setUTCDate(horizonEnd.getUTCDate() + 6);

    type OpenTask = (typeof watchedOpenTasks)[number];
    const inWindow = (from: Date | null, to: Date | null) => (t: OpenTask) =>
      t.dueDate !== null && (from === null || t.dueDate >= from) && (to === null || t.dueDate < to);
    const section = (from: Date | null, to: Date | null) => ({
      mine: myOpenTasks.filter(inWindow(from, to)),
      supervised: supervisedOnly.filter(inWindow(from, to)),
    });

    const overdue = section(null, today);
    const dueToday = section(today, tomorrow);
    // Anteprima di domani: serve per preparare la giornata, non solo per subirla.
    const dueTomorrow = section(tomorrow, dayAfterTomorrow);
    const nextDays = section(dayAfterTomorrow, horizonEnd);
    // Senza scadenza: fuori dalle finestre per definizione, ma non per questo
    // da nascondere — chi supervisiona un lavoro deve poterlo ritrovare.
    const undated = (t: OpenTask) => t.dueDate === null;
    const noDueDate = {
      mine: myOpenTasks.filter(undated),
      supervised: supervisedOnly.filter(undated),
    };

    // Conteggi per stato E per tipo di task: ogni badge deve corrispondere a un
    // elenco preciso. Lo stesso stato può essere condiviso da moduli diversi
    // ("Da contattare" su un'offerta e su un task dello scadenzario): sommandoli
    // il numero non tornava mai con la lista che si apre cliccando.
    // Gli stati sono anche per categoria, quindi lo stesso NOME può esistere in
    // liste diverse ("Da fare" in Sviluppo e in Generali): la chiave usa l'id.
    const byStatus = new Map<
      string,
      { id: string; name: string; category: string; color: string; count: number; kind: string }
    >();
    for (const task of myOpenTasks) {
      // Lo scadenzario elenca solo i task di primo livello: un subtask sarebbe
      // contato qui ma non comparirebbe in lista (si vede dentro il padre).
      if (task.kind === TaskKind.ADMIN && task.parentTaskId !== null) continue;
      const key = `${task.status!.id}|${task.kind}`;
      const entry = byStatus.get(key) ?? {
        // Id e tipo viaggiano col conteggio: cliccando il badge si apre l'elenco
        // del modulo giusto, già filtrato su quello stato.
        id: task.status!.id,
        name: task.status!.name,
        category: task.status!.category,
        color: task.status!.color,
        count: 0,
        kind: task.kind,
      };
      entry.count += 1;
      byStatus.set(key, entry);
    }
    const statusCounts = [...byStatus.values()];

    // Offerte aperte (solo se il modulo è visibile all'utente).
    type OffertaRiepilogo = {
      id: string;
      title: string;
      company: { id: string; name: string } | null;
      contact: { id: string; name: string } | null;
      stageName: string;
      stageColor: string;
      dealValue: number | null;
      expectedCloseDate: string | null;
    };
    let openDeals: {
      mine: OffertaRiepilogo[];
      others: OffertaRiepilogo[];
      mineTotal: number;
      othersTotal: number;
    } = { mine: [], others: [], mineTotal: 0, othersTotal: 0 };
    if (await canSeeScope(user, VisibilityScope.DEALS)) {
      /**
       * **Il riepilogo è della propria giornata**, quindi si guarda una lista
       * alla volta — le mie o quelle degli altri — e il numero accanto dice
       * cosa c'è nell'altra. «Tutte» non è un'opzione: per quello c'è la pagina
       * Offerte, che è il posto dove si guarda la pipeline dell'azienda
       * (richiesta del 04/09/2026).
       */
      const aperte = { kind: TaskKind.DEAL, dealStage: { isWon: false, isLost: false } };
      const perimetroDi = (chi: "mine" | "others") => {
        const dove = dealOwnerWhere(chi, user.id);
        return { ...aperte, ...(dove ? { AND: [dove] } : {}) };
      };
      const primeCinque = async (chi: "mine" | "others"): Promise<OffertaRiepilogo[]> =>
        (
          await prisma.task.findMany({
            where: perimetroDi(chi),
            include: { dealStage: true, company: true, contact: true },
            orderBy: [{ expectedCloseDate: { sort: "asc", nulls: "last" } }],
            take: 5,
          })
        ).map((deal) => ({
          id: deal.id,
          title: deal.title,
          company: deal.company ? { id: deal.company.id, name: deal.company.name } : null,
          contact: deal.contact
            ? {
                id: deal.contact.id,
                name: `${deal.contact.firstName} ${deal.contact.lastName}`.trim(),
              }
            : null,
          stageName: deal.dealStage?.name ?? "—",
          stageColor: deal.dealStage?.color ?? "#6b7280",
          dealValue: deal.dealValue,
          expectedCloseDate: deal.expectedCloseDate?.toISOString().slice(0, 10) ?? null,
        }));
      const [mine, others, mineTotal, othersTotal] = await Promise.all([
        primeCinque("mine"),
        primeCinque("others"),
        prisma.task.count({ where: perimetroDi("mine") }),
        prisma.task.count({ where: perimetroDi("others") }),
      ]);
      openDeals = { mine, others, mineTotal, othersTotal };
    }

    // Task non assegnati che posso prendere in carico (auto-claim al primo che lavora):
    //  - ADMIN: tutti se ho lo scope, altrimenti i miei (di cui sono creatore);
    //  - PROJECT: quelli dei progetti di cui sono membro (o tutti per l'admin).
    const seesAllAdmin = await canSeeScope(user, VisibilityScope.ADMIN_TASKS);
    const memberProjectIds = (
      await prisma.projectMember.findMany({ where: { userId: user.id } })
    ).map((m) => m.projectId);

    const unassignedOr: Prisma.TaskWhereInput[] = [
      { kind: TaskKind.ADMIN, ...(seesAllAdmin ? {} : { creatorId: user.id }) },
    ];
    if (user.role === UserRole.ADMIN) {
      unassignedOr.push({ kind: TaskKind.PROJECT });
    } else if (memberProjectIds.length > 0) {
      unassignedOr.push({ kind: TaskKind.PROJECT, projectId: { in: memberProjectIds } });
    }
    const unassignedTasks = await prisma.task.findMany({
      where: { assigneeId: null, status: { isClosed: false }, OR: unassignedOr },
      include: taskListInclude,
      orderBy: [{ dueDate: { sort: "asc", nulls: "last" } }, { createdAt: "desc" }],
      take: 8,
    });

    const accessCtx = await taskAccessContext(user);
    const risposta = {
      overdue: mapSection(overdue, accessCtx),
      dueToday: mapSection(dueToday, accessCtx),
      dueTomorrow: mapSection(dueTomorrow, accessCtx),
      nextDays: mapSection(nextDays, accessCtx),
      noDueDate: mapSection(noDueDate, accessCtx),
      unassignedTasks: unassignedTasks.map((t) => toTaskListItem(t, accessCtx)),
      myTasksByStatus: statusCounts,
      // Le card delle bacheche personali non contano più qui: sono del plugin.
      myOpenTaskCount: myOpenTasks.length,
      openDeals,
      // Le sezioni dei moduli dell'edizione (i ticket in attesa) sovrascrivono
      // il loro vuoto, che resta al suo posto nel JSON.
      openTickets: [] as Dashboard["openTickets"],
    };
    const sezioni = await Promise.all(
      moduliAttivi().map(async (modulo) => (await modulo.dashboard?.(user)) ?? {}),
    );
    return Object.assign(risposta, ...sezioni);
  });
}
