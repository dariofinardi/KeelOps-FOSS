import { TaskKind, type CreateTaskInput } from "@kancrm/shared";
import { prisma } from "../db";
import { config } from "../config";
import { evaluateTaskAccess, taskAccessContext } from "../modules/tasks/permissions";
import { createTaskAs } from "../modules/tasks/create";

/**
 * **I task, prestati ai plugin** (22/09/2026, per le azioni correttive di QABox).
 *
 * Un plugin non scrive in `Task`: il cancello dell'SDK glielo impedisce, e fa
 * bene — creare un task vuol dire applicare una dozzina di regole del core
 * (perimetro, stato iniziale della categoria, referente di default, notifiche,
 * registro attività) che nessun plugin deve ricopiare. Qui il core lo fa **per
 * conto suo**, passando dal servizio che usano già la rotta web e l'API delle
 * integrazioni: `createTaskAs`. Una porta, non una scorciatoia.
 *
 * Il permesso è quello di chi preme il pulsante, non del plugin: se quella
 * persona non può creare un task in quel progetto, il rifiuto arriva da lì,
 * con il suo messaggio.
 */

export interface TaskPerPlugin {
  id: string;
  title: string;
  kind: string;
  /** Lo stato attuale e se è uno stato di chiusura: serve a dire «l'azione è chiusa». */
  status: string | null;
  statusClosed: boolean;
  assigneeId: string | null;
  assignee: string | null;
  dueDate: string | null;
  projectId: string | null;
  /** Se chi guarda lo può anche modificare: al plugin serve per offrire o no i comandi. */
  canEdit: boolean;
  /** Il plugin che l'ha creato, se non è nato in KeelOps. */
  pluginNick?: string | null;
  pluginRef?: string | null;
}

/** Cosa un plugin può chiedere quando crea un task. Il resto lo decide il core. */
export interface NuovoTaskDaPlugin {
  /**
   * Il riferimento del plugin: l'id del suo record (la non conformità, il
   * documento). Finisce in `Task.pluginRef` accanto al nick, e serve il
   * giorno della disinstallazione — «questi 14 task sono di QABox, e questo
   * è il suo record» — oltre che a ritrovare la strada all'indietro.
   */
  ref?: string | null;
  title: string;
  description?: string | null;
  projectId?: string | null;
  assigneeId?: string | null;
  supervisorId?: string | null;
  dueDate?: string | null;
  statusId?: string | null;
  activityTypeId?: string | null;
}

async function utenteValido(userId: string) {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user || !user.isActive) throw new Error("utente non valido");
  return user;
}

/**
 * Crea un task a nome di `userId`. Torna il task come lo leggerebbe quella
 * persona, così il plugin non deve rileggerlo subito dopo.
 *
 * Nella dimostrazione non si scrive niente: una demo aperta al mondo che si
 * riempie di task creati da un plugin è lo stesso problema dei caricamenti di
 * file, e la risposta è la stessa.
 */
export async function creaTaskPerPlugin(
  nick: string | null,
  userId: string,
  input: NuovoTaskDaPlugin,
): Promise<TaskPerPlugin> {
  if (config.demo) throw new Error("Nella dimostrazione non si creano task.");
  const user = await utenteValido(userId);
  const titolo = String(input.title ?? "").trim();
  if (!titolo) throw new Error("un task vuole un titolo");

  const perIlCore: CreateTaskInput = {
    title: titolo.slice(0, 200),
    description: input.description ?? null,
    projectId: input.projectId ?? null,
    assigneeId: input.assigneeId ?? null,
    supervisorId: input.supervisorId ?? null,
    dueDate: input.dueDate ?? null,
    ...(input.statusId ? { statusId: input.statusId } : {}),
    activityTypeId: input.activityTypeId ?? null,
  };
  // Le regole, gli stati, le notifiche e il registro sono di createTaskAs:
  // qui non se ne ricopia nessuna, e un rifiuto arriva con il suo messaggio.
  const creato = await createTaskAs(user, perIlCore);
  /**
   * **Il marchio**, subito dopo: il task è del core in tutto e per tutto —
   * stato, notifiche, perimetro — ma la riga ricorda chi l'ha chiesto. Una
   * scrittura in più che il giorno della disinstallazione vale più di tutta
   * la documentazione che si potrebbe scrivere al posto suo.
   */
  if (nick) {
    await prisma.task.update({
      where: { id: creato.id },
      data: { pluginNick: nick, pluginRef: input.ref ?? null },
    });
  }
  const letto = await leggiTaskPerPlugin(userId, creato.id);
  if (!letto) throw new Error("task creato ma non leggibile: permessi incoerenti");
  return letto;
}

/**
 * Il task come lo vede quella persona, o `null` se non lo vede: un permesso
 * negato non è un guasto, e un plugin che riceve `null` mostra semplicemente
 * meno — mai un errore a schermo per qualcosa che non lo riguarda.
 *
 * Esiste perché l'alternativa sarebbe leggere `Task` con `ctx.db`, e lì il
 * plugin si troverebbe a ricopiare il perimetro di visibilità del core: la
 * cosa che il contratto dei plugin vieta per prima.
 */
export async function leggiTaskPerPlugin(
  userId: string,
  taskId: string,
): Promise<TaskPerPlugin | null> {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user || !user.isActive) return null;
  const task = await prisma.task.findUnique({
    where: { id: taskId },
    include: { status: true, assignee: true },
  });
  if (!task || task.deletedAt) return null;
  const verdetto = evaluateTaskAccess(await taskAccessContext(user), task);
  if (!verdetto.canView) return null;
  return {
    id: task.id,
    title: task.title,
    kind: task.kind,
    status: task.status?.name ?? null,
    statusClosed: task.status?.isClosed ?? false,
    assigneeId: task.assigneeId,
    assignee: task.assignee?.name ?? null,
    dueDate: task.dueDate ? task.dueDate.toISOString().slice(0, 10) : null,
    projectId: task.projectId,
    canEdit: verdetto.canEdit,
    pluginNick: task.pluginNick,
    pluginRef: task.pluginRef,
  };
}

/** I task di un plugin, letti in blocco: un elenco di schede ne chiede dieci insieme. */
export async function leggiTaskPerPluginMolti(
  userId: string,
  taskIds: string[],
): Promise<Map<string, TaskPerPlugin>> {
  const out = new Map<string, TaskPerPlugin>();
  const unici = [...new Set(taskIds)].filter(Boolean);
  if (unici.length === 0) return out;
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user || !user.isActive) return out;
  const ctx = await taskAccessContext(user);
  const tasks = await prisma.task.findMany({
    where: { id: { in: unici }, deletedAt: null },
    include: { status: true, assignee: true },
  });
  for (const task of tasks) {
    const verdetto = evaluateTaskAccess(ctx, task);
    if (!verdetto.canView) continue;
    out.set(task.id, {
      id: task.id,
      title: task.title,
      kind: task.kind,
      status: task.status?.name ?? null,
      statusClosed: task.status?.isClosed ?? false,
      assigneeId: task.assigneeId,
      assignee: task.assignee?.name ?? null,
      dueDate: task.dueDate ? task.dueDate.toISOString().slice(0, 10) : null,
      projectId: task.projectId,
      canEdit: verdetto.canEdit,
      pluginNick: task.pluginNick,
      pluginRef: task.pluginRef,
    });
  }
  return out;
}

export { TaskKind };
