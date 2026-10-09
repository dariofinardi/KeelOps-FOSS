import {
  ActivityCategory,
  NotificationType,
  ProjectRole,
  TaskKind,
  UserRole,
  VisibilityAccess,
  VisibilityScope,
} from "@kancrm/shared";
import { prisma } from "../../db";
import { ruoloDelNucleo } from "../../edition/roles";
import { cached } from "../../lib/request-context";
import { accessForScope, manageableCategories, managedUserIds } from "../visibility/service";
import type { User } from "../../generated/prisma/client";
import type { TaskAccessInfo } from "./access";
import {
  regoleAccessoTask,
  tipoTaskPrevisto,
  type EsitoAccesso,
  type RifiutoAccesso,
} from "./access-rules";

/**
 * Chi può vedere, modificare ed eliminare un task — **una regola sola**, usata sia
 * per bloccare le richieste sia per dire al client cosa mostrare.
 *
 * Prima le due cose erano separate: il server decideva qui, e ogni pagina si
 * riscriveva la propria versione della regola per accendere o spegnere i comandi.
 * Il risultato si vedeva: il menu contestuale offriva "Elimina" su ogni task —
 * anche a chi avrebbe ricevuto un 403 — e il pannello di dettaglio applicava una
 * regola diversa ancora, che ignorava il caso dei ticket.
 *
 * Il costo è il motivo per cui questo file esiste. Il permesso di un task dipende
 * da dati che vanno letti dal database (ruoli sui progetti, livelli di accesso,
 * gruppi gestiti): chiederli task per task significherebbe mille query per un
 * elenco di mille righe. Qui si leggono **una volta per richiesta**
 * (`taskAccessContext`) e poi la decisione è una funzione pura, sincrona e
 * verificabile.
 *
 * **Le edizioni** (08/10/2026): qui stanno i ruoli e i tipi del nucleo. I
 * ticket, il portale e il monitor vendite portano le loro regole da un modulo
 * dell'edizione commerciale (`tasks/access-rules.ts`): il nucleo non li conosce
 * per nome, e nega i ruoli e i tipi di task che nessun modulo porta.
 */

/**
 * Il contesto del nucleo. I moduli dell'edizione lo estendono con i loro campi
 * (dichiarazione di interfaccia nel loro file, valori dal loro `contesto`).
 */
export interface TaskAccessContext {
  user: User;
  isAdmin: boolean;
  adminTasks: VisibilityAccess | null;
  deals: VisibilityAccess | null;
  projects: VisibilityAccess | null;
  /** Ruolo dell'utente in ciascun progetto di cui è membro. */
  projectRoles: Map<string, ProjectRole>;
  /** Aree di lavoro governate dai gruppi di cui l'utente è manager. */
  managedAreas: Set<ActivityCategory>;
  /** Area di ciascuno stato: l'area di un task è quella del suo stato. */
  statusAreas: Map<string, ActivityCategory>;
  /**
   * Task in cui l'utente è stato **menzionato** nella chat: la citazione apre
   * la porta in sola lettura (31/08/2026) — chi viene chiamato in causa deve
   * poter leggere e rispondere, anche fuori dal suo perimetro. La prova è la
   * notifica di menzione, che è ciò che l'ha portato lì.
   */
  mentionedTaskIds: Set<string>;
  /** Le persone dei gruppi di cui l'utente è manager (sé stesso escluso). */
  managedUserIds: Set<string>;
}

/**
 * Legge in blocco tutto ciò che serve a decidere, e lo memorizza per la durata
 * della richiesta: due chiamate nella stessa richiesta non ripagano il costo.
 */
export async function taskAccessContext(user: User): Promise<TaskAccessContext> {
  return cached(`task-access-ctx:${user.id}`, async () => {
    const regole = regoleAccessoTask();
    const [
      adminTasks,
      deals,
      projects,
      memberships,
      managedAreas,
      statuses,
      mentions,
      managedPeople,
    ] = await Promise.all([
      accessForScope(user, VisibilityScope.ADMIN_TASKS),
      accessForScope(user, VisibilityScope.DEALS),
      accessForScope(user, VisibilityScope.PROJECTS),
      prisma.projectMember.findMany({
        where: { userId: user.id },
        select: { projectId: true, role: true },
      }),
      manageableCategories(user),
      prisma.taskStatus.findMany({ select: { id: true, category: true } }),
      prisma.notification.findMany({
        where: { userId: user.id, type: NotificationType.MENTION },
        select: { payload: true },
      }),
      managedUserIds(user),
    ]);
    const mentionedTaskIds = new Set<string>();
    for (const { payload } of mentions) {
      try {
        const parsed = JSON.parse(payload) as { taskId?: unknown };
        if (typeof parsed.taskId === "string") mentionedTaskIds.add(parsed.taskId);
      } catch {
        // notifiche storiche con un payload diverso: nessun permesso in più
      }
    }
    const estensioni = await Promise.all(regole.map((r) => r.contesto?.(user)));
    return Object.assign(
      {
        user,
        isAdmin: user.role === UserRole.ADMIN,
        adminTasks,
        deals,
        projects,
        projectRoles: new Map(memberships.map((m) => [m.projectId, m.role as ProjectRole])),
        managedAreas,
        statusAreas: new Map(statuses.map((s) => [s.id, s.category as ActivityCategory])),
        mentionedTaskIds,
        managedUserIds: managedPeople,
      },
      ...estensioni,
    ) as TaskAccessContext;
  });
}

const ROLE_RANK: Record<string, number> = {
  [ProjectRole.VIEWER]: 1,
  [ProjectRole.EDITOR]: 2,
  [ProjectRole.MANAGER]: 3,
};

/**
 * Ruolo effettivo su un progetto: la membership, oppure quello implicito dato
 * dallo scope Progetti (sola lettura = osservatore, completo = editor). Tra i due
 * vince il più alto, così assegnare un ruolo non viene annullato dallo scope.
 */
function projectRole(ctx: TaskAccessContext, projectId: string): ProjectRole | "ADMIN" | null {
  if (ctx.isAdmin) return "ADMIN";
  const fromMembership = ctx.projectRoles.get(projectId) ?? null;
  const fromScope =
    ctx.projects === VisibilityAccess.FULL
      ? ProjectRole.EDITOR
      : ctx.projects === VisibilityAccess.READ
        ? ProjectRole.VIEWER
        : null;
  if (!fromMembership) return fromScope;
  if (!fromScope) return fromMembership;
  return (ROLE_RANK[fromMembership] ?? 0) >= (ROLE_RANK[fromScope] ?? 0)
    ? fromMembership
    : fromScope;
}

/**
 * Coinvolgimento personale: assegnatario, supervisore o creatore. Vale in
 * qualunque area, anche senza il permesso del modulo — il lavoro segue la
 * persona. Vale per i ruoli del nucleo: un cliente del portale o un monitor
 * vendite restano nei loro confini.
 */
export function isPersonallyInvolved(ctx: TaskAccessContext, task: TaskAccessInfo): boolean {
  if (!ruoloDelNucleo(ctx.user.role)) return false;
  const me = ctx.user.id;
  return task.assigneeId === me || task.supervisorId === me || task.creatorId === me;
}

/**
 * Il manager legge i task dell'**area che governa**, di chiunque siano (scelta
 * dell'11/08/2026): chi guida il commerciale segue il lavoro commerciale, non
 * "le persone del suo gruppo" — che con qualcuno iscritto ovunque avrebbe
 * significato vedere tutto. L'area di un task è quella del suo stato.
 */
function readsAsAreaManager(ctx: TaskAccessContext, task: TaskAccessInfo): boolean {
  if (ctx.managedAreas.size === 0 || !task.statusId) return false;
  const area = ctx.statusAreas.get(task.statusId);
  return area !== undefined && ctx.managedAreas.has(area);
}

/** Esito della valutazione: cosa si può fare e, se no, perché. */
export interface TaskAccessVerdict {
  canView: boolean;
  canEdit: boolean;
  canDelete: boolean;
  /** Motivo del rifiuto in lettura, con lo stato HTTP da restituire. */
  viewDenial?: { status: 403 | 404; message: string };
  editDenial?: { status: 403 | 404; message: string };
}

/** Il primo parere di una regola dei moduli, se ce n'è uno. */
function parereDeiModuli(
  pareri: Iterable<EsitoAccesso>,
): { deciso: true; rifiuto: RifiutoAccesso | undefined } | { deciso: false } {
  for (const esito of pareri) {
    if (esito) return { deciso: true, rifiuto: "nega" in esito ? esito.nega : undefined };
  }
  return { deciso: false };
}

function evaluateView(
  ctx: TaskAccessContext,
  task: TaskAccessInfo,
): TaskAccessVerdict["viewDenial"] {
  /**
   * La citazione apre la porta, in sola lettura: chi è stato menzionato nella
   * chat legge il task e risponde, qualunque sia l'area — è stato chiamato in
   * causa, e una notifica che porta a un 403 chiama senza far entrare
   * (31/08/2026). La modifica resta regolata dalle regole di sempre (sotto):
   * la menzione non la concede mai da sola. Vale per i ruoli e i tipi del
   * nucleo: un cliente del portale resta nei suoi confini, e un ticket su
   * un'edizione che non li serve non si apre con una menzione.
   */
  if (
    ruoloDelNucleo(ctx.user.role) &&
    tipoTaskPrevisto(task.kind) &&
    task.id !== undefined &&
    ctx.mentionedTaskIds.has(task.id)
  ) {
    return undefined;
  }
  // Le regole dei moduli dell'edizione (ticket e portale, monitor vendite).
  const parere = parereDeiModuli(regoleAccessoTask().map((r) => r.vista?.(ctx, task) ?? null));
  if (parere.deciso) return parere.rifiuto;
  // Un ruolo o un tipo che nessun modulo porta non si legge: è il caso di
  // un'edizione community su un database commerciale. 404, come per ciò che
  // non si deve sapere che esiste.
  if (!ruoloDelNucleo(ctx.user.role) || !tipoTaskPrevisto(task.kind)) {
    return { status: 404, message: "Non trovato" };
  }
  if (isPersonallyInvolved(ctx, task)) return undefined;
  if (readsAsAreaManager(ctx, task)) return undefined;
  if (task.kind === TaskKind.DEAL) {
    return ctx.deals === null
      ? { status: 403, message: "Non hai accesso al modulo Offerte/CRM" }
      : undefined;
  }
  if (task.kind === TaskKind.PROJECT && task.projectId) {
    // 404 (non 403) per non rivelare l'esistenza di progetti altrui.
    return projectRole(ctx, task.projectId) === null
      ? { status: 404, message: "Progetto non trovato" }
      : undefined;
  }
  return ctx.adminTasks === null
    ? { status: 403, message: "Non hai accesso a questo task" }
    : undefined;
}

function evaluateEdit(
  ctx: TaskAccessContext,
  task: TaskAccessInfo,
  viewDenial: TaskAccessVerdict["viewDenial"],
): TaskAccessVerdict["editDenial"] {
  // Le regole dei moduli dell'edizione (il portale e il monitor vendite non scrivono).
  const parere = parereDeiModuli(
    regoleAccessoTask().map((r) => r.modifica?.(ctx, task, viewDenial) ?? null),
  );
  if (parere.deciso) return parere.rifiuto;
  // Ruoli e tipi che nessun modulo porta: non si scrivono, nemmeno da chi li
  // aveva creati o presi in carico.
  if (!ruoloDelNucleo(ctx.user.role) || !tipoTaskPrevisto(task.kind)) {
    return viewDenial ?? { status: 403, message: "Accesso in sola lettura" };
  }
  // Chi ha il task in carico lo lavora, in qualunque area e senza permessi di
  // modulo: altrimenti riceverebbe un'attività che non può né avanzare né
  // completare. Lo stesso vale per chi lo ha creato. Il supervisore invece LEGGE.
  if (task.assigneeId === ctx.user.id || task.creatorId === ctx.user.id) {
    return undefined;
  }
  if (task.kind === TaskKind.PROJECT && task.projectId) {
    const role = projectRole(ctx, task.projectId);
    if (role === null) {
      // Il 404 serve a non rivelare progetti altrui: vale per chi il task NON
      // lo vede. A chi ce l'ha aperto davanti non nasconde niente, e lascia un
      // errore inspiegabile — il supervisore di un task in un progetto di cui
      // non e' membro provava a passare la supervisione al capoprogetto e
      // leggeva "Progetto non trovato" (20/08/2026). Se il task si vede, il
      // rifiuto dice il motivo vero.
      return (
        viewDenial ?? {
          status: 403,
          message: "Non sei membro di questo progetto: puoi seguire il task, non modificarlo",
        }
      );
    }
    if (role !== "ADMIN" && role !== ProjectRole.MANAGER && role !== ProjectRole.EDITOR) {
      return {
        status: 403,
        message: "Non hai i permessi per modificare i task di questo progetto",
      };
    }
    return undefined;
  }
  if (task.kind === TaskKind.DEAL) {
    if (viewDenial) return viewDenial;
    if (ctx.isAdmin) return undefined;
    const ownerId = task.assigneeId ?? task.creatorId;
    if (ctx.deals !== VisibilityAccess.FULL || ownerId !== ctx.user.id) {
      return { status: 403, message: "Solo il proprietario dell'offerta può modificarla" };
    }
    return undefined;
  }
  if (viewDenial) return viewDenial;
  if (ctx.isAdmin) return undefined;
  // Modificare i task "di altri" richiede accesso COMPLETO all'area: la sola
  // lettura consulta e basta, e chi vede il task per altre vie (supervisore,
  // manager di gruppo) non acquisisce la modifica.
  const perTipo = regoleAccessoTask().find((r) => r.accessoArea?.[task.kind])?.accessoArea?.[
    task.kind
  ];
  const access = perTipo ? perTipo(ctx) : ctx.adminTasks;
  return access !== VisibilityAccess.FULL
    ? { status: 403, message: "Hai accesso in sola lettura a quest'area" }
    : undefined;
}

/**
 * Regola di eliminazione: oltre a poter modificare, serve **essere il creatore o
 * un amministratore** (i moduli possono restringerla: i ticket li elimina solo
 * l'amministratore). Deciso esplicitamente: chi lavora un task non deve poterlo
 * far sparire a chi lo ha aperto.
 */
function evaluateDelete(ctx: TaskAccessContext, task: TaskAccessInfo, canEdit: boolean): boolean {
  if (!canEdit) return false;
  for (const regola of regoleAccessoTask()) {
    const esito = regola.eliminazione?.(ctx, task);
    if (esito !== null && esito !== undefined) return esito;
  }
  return ctx.isAdmin || task.creatorId === ctx.user.id;
}

/** Cosa può fare l'utente su questo task. Sincrona: il contesto è già in mano. */
export function evaluateTaskAccess(
  ctx: TaskAccessContext,
  task: TaskAccessInfo,
): TaskAccessVerdict {
  const viewDenial = evaluateView(ctx, task);
  const editDenial = evaluateEdit(ctx, task, viewDenial);
  const canEdit = !editDenial;
  return {
    canView: !viewDenial,
    canEdit,
    canDelete: evaluateDelete(ctx, task, canEdit),
    viewDenial,
    editDenial,
  };
}
