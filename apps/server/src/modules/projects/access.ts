import { ProjectRole, UserRole, VisibilityAccess, VisibilityScope } from "@kancrm/shared";
import { prisma } from "../../db";
import { forbidden, notFound } from "../../lib/http-errors";
import type { Prisma, User } from "../../generated/prisma/client";
import { accessForScope, canSeeScope } from "../visibility/service";

/**
 * **Quali progetti vede questo utente**, come filtro Prisma: la versione "a
 * insieme" di `assertProjectView`, in un posto solo.
 *
 * Era scritta tre volte e già divergente — l'elenco progetti contava anche i
 * coinvolti, la ricerca e la scheda cliente solo i membri — così lo stesso
 * referente vedeva un progetto nell'elenco ma non lo trovava cercandolo, e il
 * cliente ne contava zero. La regola è una: **membro, oppure con del lavoro
 * assegnato/supervisionato** (chi ci ha solo del lavoro entra con `onlyOwnTasks`,
 * vedi `assertProjectView`). Admin e scope Progetti li vedono tutti.
 */
export async function visibleProjectsWhere(
  user: User,
  /**
   * `onlyOpenWork` distingue **"lo posso aprire"** da **"me lo mostri in
   * elenco"**, che non sono la stessa domanda (18/08/2026).
   *
   * Chi ha lavorato in un progetto continua a **poterlo aprire** anche a lavoro
   * finito: il task chiuso resta suo, lo trova dalla ricerca e dalla propria
   * bacheca, e cliccando la freccia deve arrivare da qualche parte. Ma
   * l'**elenco Progetti** è la scrivania, non l'archivio: un progetto dove non
   * si è membri e non è rimasto niente da fare non ci va — restava lì per
   * sempre, con la spunta "Non sei membro" accanto (SatizTMP: cinque task tutti
   * rilasciati).
   */
  { onlyOpenWork = false }: { onlyOpenWork?: boolean } = {},
): Promise<Prisma.ProjectWhereInput> {
  const seesAll =
    user.role === UserRole.ADMIN || (await canSeeScope(user, VisibilityScope.PROJECTS));
  if (seesAll) return { deletedAt: null };
  return {
    deletedAt: null,
    OR: [
      { members: { some: { userId: user.id } } },
      {
        tasks: {
          some: {
            deletedAt: null,
            OR: [{ assigneeId: user.id }, { supervisorId: user.id }],
            ...(onlyOpenWork ? { status: { isClosed: false } } : {}),
          },
        },
      },
    ],
  };
}

/** Ruolo implicito dato dallo scope di gruppo sui progetti (nessuno se non lo ha). */
async function roleFromProjectsScope(user: User): Promise<ProjectRole | null> {
  const access = await accessForScope(user, VisibilityScope.PROJECTS);
  if (access === VisibilityAccess.FULL) return ProjectRole.EDITOR;
  if (access === VisibilityAccess.READ) return ProjectRole.VIEWER;
  return null;
}

const ROLE_RANK: Record<string, number> = {
  [ProjectRole.VIEWER]: 1,
  [ProjectRole.EDITOR]: 2,
  [ProjectRole.MANAGER]: 3,
};

/**
 * Ruolo dell'utente nel progetto (ai fini dei permessi); "ADMIN" per l'admin
 * globale. L'admin vince SEMPRE, anche se è anche membro con un ruolo minore
 * (es. aggiunto come assegnatario/supervisore): la membership non lo declassa.
 *
 * Oltre alla membership conta lo scope di gruppo "Progetti": chi lo ha in sola
 * lettura è osservatore di tutti i progetti, chi lo ha completo può modificarne
 * i task. Tra membership e scope vince il ruolo più alto, così assegnare a
 * qualcuno il ruolo di manager su un progetto non viene annullato dallo scope.
 */
export async function projectRoleOf(
  user: User,
  projectId: string,
): Promise<ProjectRole | "ADMIN" | null> {
  if (user.role === UserRole.ADMIN) return "ADMIN";
  const membership = await prisma.projectMember.findUnique({
    where: { projectId_userId: { projectId, userId: user.id } },
  });
  const fromMembership = membership ? (membership.role as ProjectRole) : null;
  const fromScope = await roleFromProjectsScope(user);
  if (!fromMembership) return fromScope;
  if (!fromScope) return fromMembership;
  return (ROLE_RANK[fromMembership] ?? 0) >= (ROLE_RANK[fromScope] ?? 0)
    ? fromMembership
    : fromScope;
}

/**
 * Coinvolto senza essere membro: ha task assegnati o supervisionati qui.
 *
 * Capita per disegno — l'amministrativa che fa da referente su "Consegna beta"
 * non entra nella squadra di sviluppo — e deve poter arrivare al suo task: la
 * regola per-record glielo concede già, ma senza questo il progetto non
 * comparirebbe da nessuna parte e la pagina risponderebbe 404.
 */
export async function isInvolvedInProject(user: User, projectId: string): Promise<boolean> {
  const task = await prisma.task.findFirst({
    where: {
      projectId,
      deletedAt: null,
      OR: [{ assigneeId: user.id }, { supervisorId: user.id }],
    },
    select: { id: true },
  });
  return task !== null;
}

/**
 * Accesso in lettura a un progetto. `onlyOwnTasks` distingue chi entra **solo
 * perché ci ha del lavoro**: vede il progetto e i propri task, non quelli degli
 * altri — la squadra resta cosa dei membri.
 */
export async function assertProjectView(
  user: User,
  projectId: string,
): Promise<{ onlyOwnTasks: boolean }> {
  const role = await projectRoleOf(user, projectId);
  if (role !== null) return { onlyOwnTasks: false };
  if (await isInvolvedInProject(user, projectId)) return { onlyOwnTasks: true };
  // 404 (non 403) per non rivelare l'esistenza di progetti altrui.
  throw notFound("Progetto non trovato");
}

const EDIT_ROLES = new Set<string>(["ADMIN", ProjectRole.MANAGER, ProjectRole.EDITOR]);

export async function assertProjectEdit(user: User, projectId: string): Promise<void> {
  await assertProjectView(user, projectId);
  const role = await projectRoleOf(user, projectId);
  if (!role || !EDIT_ROLES.has(role)) {
    throw forbidden("Non hai i permessi per modificare i task di questo progetto");
  }
}

export async function assertProjectManage(user: User, projectId: string): Promise<void> {
  await assertProjectView(user, projectId);
  const role = await projectRoleOf(user, projectId);
  if (role !== "ADMIN" && role !== ProjectRole.MANAGER) {
    throw forbidden("Riservato ai manager del progetto");
  }
}
