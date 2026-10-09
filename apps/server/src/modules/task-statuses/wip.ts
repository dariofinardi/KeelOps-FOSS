import { prisma } from "../../db";

/**
 * **Limite WIP**: quanti task di uno stesso progetto possono stare insieme in
 * uno stato prima che diventi un avviso.
 *
 * Tre scelte che vale la pena avere scritte, perché sono le domande che si
 * fanno guardando il numero:
 *
 *  1. **Per persona.** Il limite dice quante cose *una persona* tiene aperte
 *     insieme: è la sua attenzione a essere divisa, non quella del progetto.
 *     Contarli per progetto — la prima versione, corretta il 18/08/2026 — dava
 *     un numero che non corrispondeva a niente di quello che si aveva davanti:
 *     con il filtro su una persona si vedevano tre task e l'avviso diceva
 *     11/4, dove 11 era il totale di tutti. Si contano i task **assegnati**:
 *     supervisionarne trenta non è avere trenta cose in mano.
 *     Il progetto resta la cornice — il limite si valuta dentro un progetto,
 *     che è l'insieme che si ha davanti sulla bacheca — e i task **senza
 *     progetto** non partecipano.
 *  2. **Non blocca.** Superare il limite non impedisce di spostare un task: un
 *     limite che rifiuta il lavoro si aggira mettendo i task altrove, e da quel
 *     momento il numero smette di dire la verità. Avvisa, e basta.
 *  3. **Solo gli aperti.** Uno stato chiuso non è lavoro in corso; se qualcuno
 *     mette un limite su uno stato chiuso, non conta niente per costruzione.
 */

/**
 * **Quanto è grave.** `oltre` è il limite superato; `attenzione` è esattamente
 * al limite — non è ancora una violazione, ma è la condizione in cui la
 * prossima cosa presa in carico lo diventa, ed è lì che si può ancora
 * decidere. Le **notifiche restano sulle sole violazioni**: avvisare anche chi
 * è al limite riempirebbe la campanella di messaggi in cui non è successo
 * niente. L'attenzione si guarda dove si guardano i carichi, cioè nel pannello
 * dell'andamento.
 */
export type WipLevel = "attenzione" | "oltre";

/** Una persona che, in un progetto, tiene aperte in uno stato più cose del limite. */
export interface WipBreach {
  projectId: string;
  projectName: string;
  statusId: string;
  statusName: string;
  userId: string;
  userName: string;
  /** Task **assegnati a quella persona**, aperti, in quello stato e in quel progetto. */
  count: number;
  limit: number;
}

/**
 * Le violazioni, dalla più grave (lo scarto più grande dal limite): se in un
 * riepilogo ne entra solo una, dev'essere quella che pesa di più.
 */
export function sortBreaches<T extends WipBreach>(breaches: T[]): T[] {
  return [...breaches].sort((a, b) => b.count - b.limit - (a.count - a.limit) || b.count - a.count);
}

/**
 * La frase, una sola, riusata da notifica ed email — così quello che si legge
 * nella campanella e quello che arriva la mattina non possono divergere.
 *
 * Dice **il fatto** (quanti, dove, qual è il limite), **perché importa** e
 * **cosa fare**: un avviso che si ferma al primo dei tre si legge come un
 * rimprovero senza sbocco.
 */
export function wipMessage(
  t: (key: string, params?: Record<string, string | number>) => string,
  breach: WipBreach,
): string {
  return t(
    "Nel progetto {{project}}, {{person}} ha {{count}} task in «{{status}}», oltre il limite di {{limit}}: troppe cose aperte insieme allungano i tempi di tutte. Portane a termine qualcuna prima di cominciarne altre.",
    {
      project: breach.projectName,
      person: breach.userName,
      count: breach.count,
      status: breach.statusName,
      limit: breach.limit,
    },
  );
}

/** Una violazione con l'indicazione di quanto è grave. */
export interface WipLoad extends WipBreach {
  level: WipLevel;
}

/**
 * I carichi **al limite o oltre**, per progetto. Una query sola: `groupBy` su
 * progetto e stato, poi il confronto con il limite in memoria — SQLite non ha
 * un `HAVING` che possa confrontare il conteggio con una colonna di un'altra
 * tabella, e farlo in due passi costa meno di una query grezza da mantenere.
 */
export async function wipLoads(options: { projectId?: string } = {}): Promise<WipLoad[]> {
  const limited = await prisma.taskStatus.findMany({
    where: { wipLimit: { not: null }, isClosed: false },
    select: { id: true, name: true, wipLimit: true },
  });
  if (limited.length === 0) return [];

  const rows: Array<{
    projectId: string | null;
    statusId: string | null;
    assigneeId: string | null;
    _count: { _all: number };
  }> = await prisma.task.groupBy({
    by: ["projectId", "statusId", "assigneeId"],
    where: {
      deletedAt: null,
      statusId: { in: limited.map((status) => status.id) },
      projectId: options.projectId ? options.projectId : { not: null },
      // Senza assegnatario non c'è nessuno che le tenga aperte: un mucchio da
      // prendere in carico non è il lavoro in corso di qualcuno.
      assigneeId: { not: null },
      // Un progetto archiviato non è lavoro in corso: "non ci lavoro più" vale
      // anche per il conteggio di quanto ci si lavora.
      project: { isArchived: false },
    },
    _count: { _all: true },
  });

  const byStatus = new Map(limited.map((status) => [status.id, status]));
  const [projects, users] = await Promise.all([
    prisma.project.findMany({
      where: { id: { in: [...new Set(rows.map((row) => row.projectId!))] } },
      select: { id: true, name: true },
    }),
    prisma.user.findMany({
      // Nessun utente di servizio: un'automazione non ha una giornata da
      // difendere, e un avviso sul suo carico non lo leggerebbe nessuno.
      where: {
        id: { in: [...new Set(rows.map((row) => row.assigneeId!))] },
        isActive: true,
        isSystem: false,
      },
      select: { id: true, name: true },
    }),
  ]);
  const projectName = new Map(projects.map((project) => [project.id, project.name]));
  const userName = new Map(users.map((user) => [user.id, user.name]));

  const breaches: WipLoad[] = [];
  for (const row of rows) {
    const status = byStatus.get(row.statusId!);
    const project = projectName.get(row.projectId!);
    const person = userName.get(row.assigneeId!);
    // Chi non è più attivo non ha "lavoro in corso": è lavoro da riassegnare, e
    // lo dice il pannello dell'andamento, non un avviso di sovraccarico.
    if (!status?.wipLimit || !project || !person) continue;
    const count = row._count._all;
    if (count < status.wipLimit) continue;
    breaches.push({
      level: count > status.wipLimit ? "oltre" : "attenzione",
      projectId: row.projectId!,
      projectName: project,
      statusId: status.id,
      statusName: status.name,
      userId: row.assigneeId!,
      userName: person,
      count,
      limit: status.wipLimit,
    });
  }
  return sortBreaches(breaches);
}

/**
 * Le sole **violazioni**: è ciò su cui si avvisa. Chi è esattamente al limite
 * non ha fatto niente di male e non va svegliato per questo.
 */
export async function wipBreaches(options: { projectId?: string } = {}): Promise<WipBreach[]> {
  return (await wipLoads(options)).filter((load) => load.level === "oltre");
}

/**
 * Chi va avvisato di una violazione: i **manager del progetto**. Sono le
 * persone che possono farci qualcosa — riassegnare, chiudere, dire di
 * aspettare. Avvisare tutta la squadra farebbe di un avviso utile un rumore di
 * fondo che si impara a ignorare.
 */
export async function wipRecipients(breach: WipBreach): Promise<string[]> {
  const managers = await prisma.projectMember.findMany({
    where: {
      projectId: breach.projectId,
      role: "MANAGER",
      user: { isActive: true, isSystem: false },
    },
    select: { userId: true },
  });
  // Prima la persona: è la sua giornata, ed è quella che può decidere di
  // chiudere qualcosa prima di aprire altro. I manager dopo, perché è a loro
  // che tocca se la cosa non si sblocca.
  return [...new Set([breach.userId, ...managers.map((member) => member.userId)])];
}

/**
 * Lo stato di un singolo progetto+stato, anche quando è nei limiti: serve a chi
 * deve decidere se **questo** spostamento ha appena fatto superare la soglia.
 */
export async function wipStateFor(
  projectId: string,
  statusId: string,
  assigneeId: string,
): Promise<{ count: number; limit: number } | null> {
  const status = await prisma.taskStatus.findUnique({
    where: { id: statusId },
    select: { wipLimit: true, isClosed: true },
  });
  if (!status?.wipLimit || status.isClosed) return null;
  const count = await prisma.task.count({
    where: { projectId, statusId, assigneeId, deletedAt: null },
  });
  return { count, limit: status.wipLimit };
}
