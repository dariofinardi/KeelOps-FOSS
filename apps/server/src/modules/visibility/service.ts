import {
  ActivityCategory,
  ProjectRole,
  UserRole,
  VisibilityAccess,
  VisibilityScope,
  isExternalRole,
} from "@kancrm/shared";
import { prisma } from "../../db";
import { forbidden } from "../../lib/http-errors";
import { cached } from "../../lib/request-context";
import type { User } from "../../generated/prisma/client";

/**
 * Può vedere i timesheet di più persone (non solo il proprio): admin, chi ha il
 * permesso esplicito "vede tutti i timesheet", i manager di progetto e i supervisori
 * di task. Regola solo per il timesheet — non tocca gli scope dello scadenzario.
 */
export async function canViewTeamTimesheet(user: User): Promise<boolean> {
  if (user.role === UserRole.ADMIN || user.canViewAllTimesheets) return true;
  // Manager di progetto: risponde delle ore che ci finiscono dentro.
  //
  // **Non** basta supervisionare dei task: ogni task nasce con il proprio
  // creatore come referente, quindi la condizione era vera per chiunque avesse
  // mai aperto un task — in produzione la tendina dei timesheet altrui compariva
  // a nove utenti su dieci. Chi supervisiona continua a vedere le ore *sui task
  // che segue* (vedi `accessibleEntriesWhere`), che è un'altra cosa dallo
  // sfogliare il timesheet delle persone.
  return (
    (await prisma.projectMember.count({
      where: { userId: user.id, role: ProjectRole.MANAGER },
    })) > 0
  );
}

/**
 * Le persone di cui si possono sfogliare le ore, sé stessi compresi: tutte per
 * l'admin e per chi ha il permesso dedicato, i membri dei propri progetti per un
 * manager. Null significa "tutte".
 *
 * Serve a non proporre in una tendina nomi le cui ore risulterebbero poi vuote:
 * l'elenco deve dire il vero su cosa si può guardare.
 */
export async function timesheetPeopleIds(user: User): Promise<string[] | null> {
  if (user.role === UserRole.ADMIN || user.canViewAllTimesheets) return null;
  const managed = await prisma.projectMember.findMany({
    where: { userId: user.id, role: ProjectRole.MANAGER },
    select: { projectId: true },
  });
  if (managed.length === 0) return [user.id];
  const members = await prisma.projectMember.findMany({
    where: { projectId: { in: managed.map((m) => m.projectId) } },
    select: { userId: true },
  });
  return [...new Set([user.id, ...members.map((m) => m.userId)])];
}

/** L'utente vede il modulo per lo scope dato (ADMIN globale vede tutto). */
export async function canSeeScope(user: User, scope: VisibilityScope): Promise<boolean> {
  return (await accessForScope(user, scope)) !== null;
}

/**
 * Livello di accesso dell'utente allo scope: null se non lo vede, altrimenti
 * READ o FULL. L'ADMIN globale ha sempre FULL. Se l'utente appartiene a più
 * gruppi con livelli diversi vince FULL (il più permissivo).
 *
 * Memoizzato per-richiesta (vedi request-context): `assertTaskViewAccess` lo
 * richiama in cicli e `/api/auth/me` per 4 scope — senza cache erano 2 query a
 * ogni invocazione.
 */
export async function accessForScope(
  user: User,
  scope: VisibilityScope,
): Promise<VisibilityAccess | null> {
  if (user.role === UserRole.ADMIN) return VisibilityAccess.FULL;
  return cached(`access:${user.id}:${scope}`, async () => {
    const allowed = await prisma.visibilitySetting.findMany({ where: { scope } });
    if (allowed.length === 0) return null;
    const memberships = await prisma.groupMember.findMany({
      where: { userId: user.id, groupId: { in: allowed.map((s) => s.groupId) } },
    });
    if (memberships.length === 0) return null;
    const myGroupIds = new Set(memberships.map((m) => m.groupId));
    const levels = allowed
      .filter((s) => myGroupIds.has(s.groupId))
      .map((s) => s.access)
      // "Giornate" non è un accesso al modulo ma una lente sul solo elenco
      // (vedi `hasDealsDaysLens`): filtrarla qui, al passaggio obbligato, fa sì
      // che nessun controllo esistente possa scambiarla per una lettura.
      .filter((level) => level === VisibilityAccess.READ || level === VisibilityAccess.FULL);
    if (levels.length === 0) return null;
    return levels.includes(VisibilityAccess.FULL) ? VisibilityAccess.FULL : VisibilityAccess.READ;
  });
}

/**
 * L'utente appartiene a un gruppo con le Offerte in "Giornate": vede l'elenco in
 * sola consultazione, con gli importi tradotti in giornate di lavoro. È il caso
 * degli sviluppatori, che vogliono sapere quanto lavoro sta arrivando senza
 * entrare nel merito commerciale.
 *
 * Vale solo per gli interni; gli esterni (portale, monitor vendite) hanno le
 * loro aree e non passano di qui.
 */
export async function hasDealsDaysLens(user: User): Promise<boolean> {
  if (isExternalRole(user.role)) return false;
  if (user.role === UserRole.ADMIN) return false;
  return cached(`deals-days:${user.id}`, async () => {
    const groups = await prisma.visibilitySetting.findMany({
      where: { scope: VisibilityScope.DEALS, access: VisibilityAccess.DAYS },
      select: { groupId: true },
    });
    if (groups.length === 0) return false;
    const membership = await prisma.groupMember.findFirst({
      where: { userId: user.id, groupId: { in: groups.map((g) => g.groupId) } },
      select: { userId: true },
    });
    return membership !== null;
  });
}

/**
 * Id degli utenti "gestiti": i membri dei gruppi in cui l'utente è manager
 * (sé stesso escluso). Il manager legge le loro attività in ogni area, anche
 * senza i permessi del modulo. Vuoto per chi non è manager di nulla.
 * Memoizzato per-richiesta: viene consultato nei cicli dei controlli di accesso.
 */
export async function managedUserIds(user: User): Promise<Set<string>> {
  return cached(`managed:${user.id}`, async () => {
    const managed = await prisma.groupMember.findMany({
      where: { userId: user.id, isManager: true },
      select: { groupId: true },
    });
    if (managed.length === 0) return new Set<string>();
    const members = await prisma.groupMember.findMany({
      where: { groupId: { in: managed.map((m) => m.groupId) } },
      select: { userId: true },
    });
    const ids = new Set(members.map((m) => m.userId));
    ids.delete(user.id);
    return ids;
  });
}

/** true se l'utente è manager di almeno un gruppo (anche se ne è l'unico membro). */
export async function isGroupManager(user: User): Promise<boolean> {
  if (user.role === UserRole.ADMIN) return true;
  return cached(`is-manager:${user.id}`, async () => {
    const count = await prisma.groupMember.count({ where: { userId: user.id, isManager: true } });
    return count > 0;
  });
}

/**
 * **Manager di qualcosa**, senza guardare l'ambito: di un gruppo o di un
 * progetto. Serve dove conta il ruolo e non l'area — la coda delle note di
 * rilascio, che è una risorsa condivisa e va sorvegliata da chi guida del
 * lavoro, quale che sia.
 *
 * Distinto da `isGroupManager`, che governa la **configurazione** (stati, tipi):
 * lì l'ambito conta, qui no.
 */
export async function isAnyManager(user: User): Promise<boolean> {
  if (user.role === UserRole.ADMIN) return true;
  return cached(`is-any-manager:${user.id}`, async () => {
    const [gruppi, progetti] = await Promise.all([
      prisma.groupMember.count({ where: { userId: user.id, isManager: true } }),
      prisma.projectMember.count({ where: { userId: user.id, role: ProjectRole.MANAGER } }),
    ]);
    return gruppi + progetti > 0;
  });
}

/** Configurazione riservata: admin o manager di gruppo (stati, tipi di attività). */
export async function assertAdminOrGroupManager(user: User): Promise<void> {
  if (!(await isGroupManager(user))) {
    throw forbidden("Riservato agli amministratori e ai manager di gruppo");
  }
}

/**
 * Categorie di attività che l'utente può configurare (stati e tipi).
 *
 * L'admin le governa tutte. Un manager di gruppo governa solo le aree del proprio
 * gruppo: chi guida gli amministrativi tocca gli stati amministrativi, chi guida
 * gli sviluppatori quelli di sviluppo, e così via — non gli stati altrui. Serve
 * l'accesso COMPLETO al modulo: la sola lettura fa consultare, non riorganizzare
 * il flusso di lavoro di quell'area.
 */
export async function manageableCategories(user: User): Promise<Set<ActivityCategory>> {
  if (user.role === UserRole.ADMIN) return new Set(Object.values(ActivityCategory));
  return cached(`manageable-cats:${user.id}`, async () => {
    const managed = await prisma.groupMember.findMany({
      where: { userId: user.id, isManager: true },
      select: { group: { select: { managedArea: true } } },
    });
    const categories = new Set<ActivityCategory>();
    for (const row of managed) {
      const area = row.group.managedArea;
      if (area && area in ActivityCategory) categories.add(area as ActivityCategory);
    }
    return categories;
  });
}

/**
 * L'inverso di `manageableCategories`: chi governa un'area di lavoro, cioè i
 * manager dei gruppi che hanno accesso completo al modulo corrispondente. Serve
 * a sapere "chi sono i manager degli sviluppatori" senza inventare un secondo
 * elenco da tenere allineato a mano.
 *
 * Ordinati per nome perché finiscono in una tendina. Restano fuori i disattivati,
 * gli utenti di sistema e i clienti del portale: non possono prendersi in carico
 * nulla.
 */
export async function usersManagingCategory(category: ActivityCategory): Promise<User[]> {
  const managers = await prisma.groupMember.findMany({
    where: { isManager: true, group: { managedArea: category } },
    select: { userId: true },
  });
  if (managers.length === 0) return [];
  return prisma.user.findMany({
    where: {
      id: { in: [...new Set(managers.map((m) => m.userId))] },
      isActive: true,
      isSystem: false,
      role: { not: UserRole.PORTAL },
    },
    orderBy: { name: "asc" },
  });
}

/** Blocca la configurazione di stati e tipi fuori dalle aree che l'utente governa. */
export async function assertCanManageCategory(
  user: User,
  category: ActivityCategory,
): Promise<void> {
  const allowed = await manageableCategories(user);
  if (!allowed.has(category)) {
    throw forbidden("Puoi configurare stati e tipi solo per le aree dei gruppi che gestisci");
  }
}

export async function assertCanSeeDeals(user: User): Promise<void> {
  if (!(await canSeeScope(user, VisibilityScope.DEALS))) {
    throw forbidden("Non hai accesso al modulo Offerte/CRM");
  }
}

export async function assertCanSeeTickets(user: User): Promise<void> {
  if (!(await canSeeScope(user, VisibilityScope.TICKETS))) {
    throw forbidden("Non hai accesso al modulo Ticket");
  }
}

export async function assertCanSeeContacts(user: User): Promise<void> {
  if (!(await canSeeScope(user, VisibilityScope.CONTACTS))) {
    throw forbidden("Non hai accesso alle persone/contatti");
  }
}

/**
 * Chi lavora nell'**area tecnica**: i membri dei gruppi che la governano
 * (`Group.managedArea = DEV`). Niente campo nuovo da tenere aggiornato — chi
 * entra nel gruppo comincia a contare, chi ne esce smette. Restano fuori i
 * disattivati, gli utenti di sistema e chi non è interno.
 *
 * Una definizione sola, due usi: il promemoria del timesheet e il pannello
 * dell'andamento. Averne due voleva dire che un giorno avrebbero smesso di
 * parlare della stessa squadra.
 */
export async function devAreaMembers(): Promise<Array<{ id: string; name: string }>> {
  return prisma.user.findMany({
    where: {
      isActive: true,
      isSystem: false,
      role: { in: [UserRole.ADMIN, UserRole.MEMBER] },
      groups: { some: { group: { managedArea: ActivityCategory.DEV } } },
    },
    select: { id: true, name: true },
    orderBy: { name: "asc" },
  });
}
