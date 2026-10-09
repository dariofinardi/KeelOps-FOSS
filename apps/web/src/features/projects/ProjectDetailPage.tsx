import { useMemo, useState, type FormEvent } from "react";
import { useDocumentTitle } from "@/lib/use-document-title";
import { useTranslation } from "react-i18next";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import {
  Archive,
  ArchiveRestore,
  Building2,
  ChevronDown,
  ChevronRight,
  CornerDownRight,
  Eye,
  Kanban,
  LifeBuoy,
  List,
  ArrowUpRight,
  ListPlus,
  Pencil,
  Plus,
  Trash2,
  UserRound,
  Users,
} from "lucide-react";
import {
  ACTIVITY_CATEGORY_LABELS,
  ActivityCategory,
  ProjectRole,
  UserRole,
  isRichTextEmpty,
  type ProjectListItem,
  type TaskListItem,
  inDueRange,
} from "@kancrm/shared";
import { ApiError } from "@/lib/api";
import { cn } from "@/lib/utils";
import { useListPrefs } from "@/lib/useListPrefs";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useContextMenu, type ContextMenuItem } from "@/components/ui/context-menu";
import { isDirtyForm, useSaveOrDiscard } from "@/lib/unsaved-changes";
import { Dialog } from "@/components/ui/dialog";
import { ViewSwitch, type ViewOption } from "@/components/ui/view-switch";
import { Input } from "@/components/ui/input";
import { DateField } from "@/components/ui/date-field";
import { Label } from "@/components/ui/label";
import { DescriptionField } from "@/components/ui/rich-text/DescriptionField";
import { useCurrentUser } from "@/features/auth/useAuth";
import { ActivityTypeSelect } from "@/features/tasks/activity-types";
import { UserSelect, type ProjectMemberRef } from "@/features/tasks/UserSelect";
import { AREAS } from "@/components/layout/areas";
import { PluginMenu } from "@/features/plugins/PluginMenu";
import { OpenLinked } from "@/features/tasks/TaskContextSections";
import { FilterSelect } from "@/components/ui/filter-select";
import { DueRangeSelect } from "@/features/tasks/DueRangeSelect";
import { TaskStatusCell } from "@/features/tasks/TaskInlineCells";
import { ProjectFormDialog } from "./ProjectFormDialog";
import { TaskAttachmentsPreview } from "@/features/tasks/TaskAttachmentsPreview";
import { AttachmentsPeek, CommentsPeek } from "@/features/tasks/TaskPeek";
import { selectMyTasks, visibilityReason } from "@/features/tasks/my-tasks";
import { AzioniProgetto } from "@/edition/slot-pagine";
import { TaskDetailDrawer } from "@/features/tasks/TaskDetailDrawer";
import { TaskKanban } from "@/features/tasks/TaskKanban";
import { ticketAccent } from "@/features/tasks/ticket-accent";
import { dueState, dueStateClass, formatDate, todayISO } from "@/features/tasks/task-utils";
import { useToast } from "@/components/ui/toast";
import { useAttachmentStaging } from "@/features/tasks/AttachmentStaging";
import { useTaskMenuItems } from "@/features/tasks/useTaskMenu";
import { useOptions } from "@/features/options/useOptions";
import {
  dominantCategory,
  presentCategories,
  useCreateTask,
  useTaskStatuses,
  useTasks,
  useUserOptions,
} from "@/features/tasks/useTasks";
import { ProgressBar, roleLabel } from "./ProjectsPage";
import {
  useDeleteProject,
  useProjectDetail,
  useUpdateProject,
  useUpdateProjectMembers,
} from "./useProjects";

type ViewMode = "list" | "kanban";

const PREFS_KEY = "kancrm-project-view-prefs";

interface ProjectViewPrefs {
  view: ViewMode;
  /** Mostra anche i task chiusi (vale per entrambe le viste). */
  showClosed: boolean;
  /** Range di scadenza (giorni); null = tutte. */
  dueWithinDays: number | null;
  /** Solo i task di cui mi occupo, da assegnatario o da supervisore. */
  onlyMine: boolean;
}

const DEFAULT_PREFS: ProjectViewPrefs = {
  view: "list",
  showClosed: false,
  onlyMine: false,
  dueWithinDays: null,
};

/** Stesse scorciatoie degli altri moduli: una lettera per vista. */
const VIEW_OPTIONS: Array<ViewOption<ViewMode>> = [
  { value: "list", label: "Elenco", icon: List, key: "E" },
  { value: "kanban", label: "Kanban", icon: Kanban, key: "K" },
];

export function ProjectDetailPage() {
  const { t } = useTranslation();
  const { id = "" } = useParams();
  const navigate = useNavigate();
  const currentUser = useCurrentUser();
  const { data: project } = useProjectDetail(id);
  useDocumentTitle(project?.name ?? null);
  const { data: taskData, isLoading } = useTasks({
    projectId: id,
    includeClosed: true,
    pageSize: 1000,
  });
  const tasks = taskData?.items;
  const { data: statuses } = useTaskStatuses();
  const updateProject = useUpdateProject();
  const deleteProject = useDeleteProject();

  /**
   * Come si guarda un progetto è una preferenza personale che vale per tutti:
   * chi lavora a kanban lo vuole all'apertura, e chi filtra sui propri task lo
   * fa perché ha molti progetti altrui sotto gli occhi — ritrovare ogni volta
   * "Tutti" vanifica il filtro. Stesso meccanismo dell'ordine delle colonne e
   * delle viste di Scadenzario e Offerte.
   */
  const { prefs, update } = useListPrefs(PREFS_KEY, DEFAULT_PREFS);
  const { view, showClosed, onlyMine, dueWithinDays } = prefs;
  const setView = (next: ViewMode) => update({ view: next });
  // La categoria del kanban resta momentanea: dipende da quali task ha il
  // progetto aperto, non da come preferisce lavorare la persona.
  const [kanbanCategory, setKanbanCategory] = useState<ActivityCategory | null>(null);
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const [createFor, setCreateFor] = useState<{ parentTaskId: string | null } | null>(null);
  // ?membri=1: ci si arriva dalla voce "Membri" del menù nell'elenco.
  const [searchParams] = useSearchParams();
  const [membersOpen, setMembersOpen] = useState(searchParams.get("membri") === "1");
  const [editOpen, setEditOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);

  // Dopo gli stati, non prima: `visibleTasks` legge `showClosed` durante il
  // render, quindi anticiparlo faceva "Cannot access before initialization" —
  // che il compilatore non vede, perché il riferimento sta dentro una funzione.
  // I conteggi delle tendine devono dire quello che si vedrà, non un altro
  // numero: quindi partono dallo stesso insieme che finisce a schermo (chiusi
  // compresi o no, secondo la spunta).
  // Range di scadenza: stessa regola dello Scadenzario (scaduti + entro N
  // giorni, i senza data fuori) — qui applicata in mano, i task sono già tutti qui.
  const oggi = todayISO();
  const perStato = (tasks ?? []).filter(
    (task) =>
      (showClosed || !task.status.isClosed) && inDueRange(task.dueDate, dueWithinDays, oggi),
  );
  const miei = selectMyTasks(perStato, currentUser.id);
  // Filtrando si mostra **in piano** quello di cui mi occupo: task e subtask,
  // assegnati o supervisionati. Annidare i subtask sotto genitori altrui li
  // rendeva raggiungibili ma non visibili, e il conto non tornava con l'elenco.
  const visibleTasks = onlyMine ? miei.mine : perStato;
  /**
   * Il conteggio per il **limite WIP**, e solo quando si guarda **una persona
   * sola**: il limite dice quante cose *quella* persona tiene aperte insieme.
   * Con "tutti" davanti non c'è nessuno di cui sia il troppo, e mostrarlo lì
   * confrontava il totale della squadra con un limite personale — tre task a
   * schermo e l'avviso che diceva 11/4 (18/08/2026).
   *
   * Conta i task **assegnati** alla persona: supervisionarne trenta non è
   * averne trenta in mano. Parte dall'elenco completo e non da `visibleTasks`,
   * così il numero non cambia al cambiare del range di scadenza — dove i due
   * differiscono, la colonna li mostra entrambi.
   */
  const wipCounts = useMemo(() => {
    if (!onlyMine) return undefined;
    const counts = new Map<string, number>();
    for (const task of tasks ?? []) {
      if (task.status.isClosed) continue;
      if (task.assignee?.id !== currentUser.id) continue;
      counts.set(task.status.id, (counts.get(task.status.id) ?? 0) + 1);
    }
    return counts;
  }, [tasks, onlyMine, currentUser.id]);

  // Per i subtask serve dire dove stanno: il titolo del genitore arriva
  // dall'elenco completo, anche quando il genitore non è fra i miei.
  const parentTitles = new Map((tasks ?? []).map((task) => [task.id, task.title]));
  // Le categorie con almeno un task: di norma una sola (sviluppo).
  const categories = presentCategories(tasks ?? []);

  if (!project) {
    return <p className="text-sm text-muted-foreground">{t("Caricamento progetto…")}</p>;
  }

  const canManage = project.myRole === ProjectRole.MANAGER || currentUser.role === UserRole.ADMIN;
  const canEdit = canManage || project.myRole === ProjectRole.EDITOR;
  const managerNames = project.members
    .filter((m) => m.role === ProjectRole.MANAGER)
    .map((m) => m.user.name)
    .join(", ");

  return (
    <div className="flex h-full flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <Link to="/progetti" className="text-sm text-muted-foreground hover:underline">
          {t("Progetti")}
        </Link>
        <span className="text-muted-foreground">/</span>
        <h2 className="text-lg font-semibold">{project.name}</h2>
        {project.isArchived && <Badge variant="outline">{t("Archiviato")}</Badge>}
        {project.myRole && <Badge variant="secondary">{t(roleLabel(project.myRole))}</Badge>}
        <span className="text-sm text-muted-foreground">
          {t("Manager")}: {managerNames || t("nessuno")}
        </span>
        <div className="ml-auto flex items-center gap-2">
          {AzioniProgetto && (
            <AzioniProgetto
              projectId={project.id}
              projectName={project.name}
              statuses={statuses ?? []}
              onlyOwnTasks={project.onlyOwnTasks ?? false}
              canEdit={canEdit}
            />
          )}
          <Button variant="outline" size="sm" onClick={() => setMembersOpen(true)}>
            <Users className="size-4" /> {t("Membri")} ({project.members.length})
          </Button>
          {canManage && (
            <>
              {/* Le stesse azioni del menù contestuale nell'elenco: modifica,
                  archivia, elimina. Un'azione che esiste là e non qui manda a
                  cercarla dove non c'è. */}
              <Button variant="outline" size="sm" onClick={() => setEditOpen(true)}>
                <Pencil className="size-4" /> {t("Modifica")}
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => updateProject.mutate({ id, isArchived: !project.isArchived })}
              >
                {project.isArchived ? (
                  <>
                    <ArchiveRestore className="size-4" /> {t("Ripristina")}
                  </>
                ) : (
                  <>
                    <Archive className="size-4" /> {t("Archivia")}
                  </>
                )}
              </Button>
              <PluginMenu anchor="project" query={`progetto=${encodeURIComponent(id)}`} />
              <Button
                variant="ghost"
                size="icon"
                title={t("Elimina")}
                onClick={() => setDeleteOpen(true)}
              >
                <Trash2 className="size-4 text-destructive" />
              </Button>
            </>
          )}
          {!canManage && (
            <PluginMenu anchor="project" query={`progetto=${encodeURIComponent(id)}`} />
          )}
        </div>
      </div>

      {/* Provenienza: da quale offerta nasce la commessa. Un dato, un posto —
          la freccia apre l'offerta, come nei campi del Contesto di un task. */}
      {project.deal && (
        <button
          type="button"
          className="flex max-w-md items-center gap-2 rounded-md bg-muted/60 px-3 py-2 text-left text-sm text-muted-foreground hover:bg-muted"
          title={t("Apri l'offerta di provenienza")}
          onClick={() => navigate(`${AREAS.deals.to}?deal=${project.deal!.id}`)}
        >
          <AREAS.deals.icon className="size-4 shrink-0" />
          <span className="min-w-0 flex-1 truncate">
            {t("Nato dall'offerta")}{" "}
            <span className="font-medium text-foreground">{project.deal.title}</span>
          </span>
          <ArrowUpRight className="size-4 shrink-0" />
        </button>
      )}

      <div className="flex max-w-md flex-col gap-2">
        {/* Il cliente qui si LEGGE e basta (14/08/2026). Era una tendina con la
            ✕, in cima alla pagina e sopra i filtri: sembrava un filtro di
            ricerca, e un clic distratto scollegava il cliente dal progetto.
            L'associazione si cambia da "Modifica", dove sta insieme al resto e
            dietro un salvataggio esplicito — ed è già riservata a manager e
            amministratori. */}
        {project.company ? (
          <p className="flex items-center gap-1.5 text-sm text-muted-foreground">
            <Building2 className="size-3.5 shrink-0" />
            <span className="min-w-0 truncate">{project.company.name}</span>
            <OpenLinked
              to={`${AREAS.contacts.to}?azienda=${project.company.id}`}
              title={t("Apri la scheda del cliente")}
            />
          </p>
        ) : (
          canManage && (
            <p className="text-sm text-muted-foreground">
              {t("Nessun cliente associato: lo imposti da Modifica.")}
            </p>
          )
        )}
        <ProgressBar closed={project.closedTaskCount} total={project.taskCount} />
      </div>

      <div className="flex items-center gap-2">
        <ViewSwitch
          options={VIEW_OPTIONS.map((option) => ({ ...option, label: t(option.label) }))}
          value={view}
          onChange={setView}
        />

        <DueRangeSelect
          value={dueWithinDays}
          onChange={(days) => update({ dueWithinDays: days })}
        />
        <FilterSelect
          icon="person"
          label={t(
            "Quali task mostrare: tutti quelli che puoi vedere, o solo quelli di cui ti occupi",
          )}
          value={onlyMine ? "miei" : "tutti"}
          onChange={(v) => update({ onlyMine: v === "miei" })}
        >
          <option value="tutti">
            {t("Tutti i task")} ({perStato.length})
          </option>
          <option value="miei">
            {t("Solo i miei")} ({miei.mineCount})
          </option>
        </FilterSelect>
        {/* Vale per entrambe le viste: è un filtro della bacheca, non del kanban. */}
        <label className="flex items-center gap-1.5 text-sm text-muted-foreground">
          <input
            type="checkbox"
            checked={showClosed}
            onChange={(e) => update({ showClosed: e.target.checked })}
          />
          {t("Mostra chiusi")}
        </label>
        {canEdit && (
          <Button className="ml-auto" onClick={() => setCreateFor({ parentTaskId: null })}>
            <Plus className="size-4" /> {t("Nuovo task")}
          </Button>
        )}
      </div>

      <div className="min-h-0 flex-1">
        {isLoading ? (
          <p className="text-sm text-muted-foreground">{t("Caricamento task…")}</p>
        ) : view === "list" ? (
          <ProjectTaskList
            tasks={visibleTasks}
            // Filtrando, i contenitori si aprono da soli: i miei subtask stanno
            // lì dentro, e lasciarli chiusi vorrebbe dire non mostrarli.
            flat={onlyMine}
            parentTitles={parentTitles}
            canEdit={canEdit}
            onOpen={setSelectedTaskId}
            onAddTask={() => setCreateFor({ parentTaskId: null })}
            onAddSubtask={(parentTaskId) => setCreateFor({ parentTaskId })}
          />
        ) : (
          <>
            {/* La tendina compare solo se il progetto ha task in più categorie:
                di norma sono tutti di sviluppo, e sceglierne un'altra mostrava
                una bacheca vuota che sembrava un guasto. */}
            {categories.length > 1 && (
              <div className="mb-3 flex flex-wrap items-center gap-3">
                <select
                  className="h-9 rounded-md border bg-background px-2 text-sm"
                  value={kanbanCategory ?? dominantCategory(tasks ?? [])}
                  title={t(
                    "Gli stati sono distinti per categoria: la bacheca ne mostra una alla volta",
                  )}
                  onChange={(e) => setKanbanCategory(e.target.value as ActivityCategory)}
                >
                  {categories.map(({ category, count }) => (
                    <option key={category} value={category}>
                      {t(ACTIVITY_CATEGORY_LABELS[category])} ({count})
                    </option>
                  ))}
                </select>
              </div>
            )}
            <TaskKanban
              tasks={visibleTasks}
              wipCounts={wipCounts}
              statuses={statuses ?? []}
              category={kanbanCategory ?? dominantCategory(tasks ?? [])}
              closedLoaded={showClosed}
              onOpen={setSelectedTaskId}
            />
          </>
        )}
      </div>

      <TaskDetailDrawer
        taskId={selectedTaskId}
        onClose={() => setSelectedTaskId(null)}
        onOpenTask={setSelectedTaskId}
      />
      {createFor && (
        <NewProjectTaskDialog
          projectId={id}
          parentTaskId={createFor.parentTaskId}
          projectMembers={project.members.map((m) => ({ userId: m.user.id, role: m.role }))}
          onClose={() => setCreateFor(null)}
        />
      )}
      <MembersDialog project={project} open={membersOpen} onClose={() => setMembersOpen(false)} />
      {/* Montato solo da aperto e con key: i campi ripartono sempre dal salvato. */}
      {editOpen && (
        <ProjectFormDialog key={project.id} project={project} onClose={() => setEditOpen(false)} />
      )}
      <Dialog
        open={deleteOpen}
        onClose={() => setDeleteOpen(false)}
        title={t('Eliminare "{{name}}"?', { name: project.name })}
      >
        <p className="mb-4 text-sm text-muted-foreground">
          {t("Verranno eliminati anche tutti i task e subtask del progetto.")}
        </p>
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={() => setDeleteOpen(false)}>
            {t("Annulla")}
          </Button>
          <Button
            variant="destructive"
            disabled={deleteProject.isPending}
            onClick={() =>
              deleteProject.mutate(id, {
                onSuccess: () => {
                  window.location.href = "/progetti";
                },
              })
            }
          >
            {t("Elimina progetto")}
          </Button>
        </div>
      </Dialog>
    </div>
  );
}

function ProjectTaskList({
  tasks,
  canEdit,
  onOpen,
  onAddTask,
  onAddSubtask,
  flat = false,
  parentTitles,
}: {
  tasks: TaskListItem[];
  canEdit: boolean;
  onOpen: (id: string) => void;
  onAddTask: () => void;
  onAddSubtask: (parentTaskId: string) => void;
  /**
   * Elenco in piano: ogni task una riga, subtask compresi. Si usa quando la
   * selezione è già stata fatta a monte (filtro "solo i miei"), dove annidare
   * nasconderebbe proprio ciò che si è chiesto di vedere.
   */
  flat?: boolean;
  /** Titolo del genitore, per dire dove sta un subtask mostrato in piano. */
  parentTitles?: Map<string, string>;
}) {
  const { t } = useTranslation();
  // Righe aperte a fisarmonica: dentro ci stanno i subtask e gli allegati. Chiuse
  // di default — l'elenco deve restare leggibile a colpo d'occhio, e la riga dice
  // già quanti subtask e quanti allegati ci sono.
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const { open, menu } = useContextMenu();
  const taskMenu = useTaskMenuItems(onOpen);

  /** Menu di un task: le voci comuni più "aggiungi subtask" sui task principali. */
  const menuFor = (task: TaskListItem): ContextMenuItem[] => {
    const items = taskMenu(task);
    if (!canEdit || task.parentTaskId !== null) return items;
    return [
      ...items.slice(0, 1),
      {
        label: t("Aggiungi subtask"),
        icon: <ListPlus className="size-4" />,
        onSelect: () => onAddSubtask(task.id),
      },
      ...items.slice(1),
    ];
  };

  /** Menu dello spazio vuoto attorno all'elenco: l'unica azione sensata è creare. */
  const listMenu: ContextMenuItem[] = canEdit
    ? [{ label: t("Nuovo task"), icon: <Plus className="size-4" />, onSelect: onAddTask }]
    : [];
  const { parents, byParent } = useMemo(() => {
    // In piano ogni task è una riga a sé, subtask compresi.
    if (flat) return { parents: tasks, byParent: new Map<string, TaskListItem[]>() };
    const parents = tasks.filter((t) => t.parentTaskId === null);
    const byParent = new Map<string, TaskListItem[]>();
    for (const task of tasks) {
      if (!task.parentTaskId) continue;
      const list = byParent.get(task.parentTaskId) ?? [];
      list.push(task);
      byParent.set(task.parentTaskId, list);
    }
    return { parents, byParent };
  }, [tasks, flat]);

  if (parents.length === 0) {
    return (
      <>
        <div
          className="rounded-lg border border-dashed p-10 text-center text-sm text-muted-foreground"
          onContextMenu={(e) => {
            // Sulle righe vince il menu del task, che ha già fermato l'evento.
            if (!e.defaultPrevented) open(e, listMenu);
          }}
        >
          {t("Nessun task nel progetto.")}
        </div>
        {menu}
      </>
    );
  }

  const toggle = (id: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  return (
    <>
      {/* Il tasto destro sull'elenco (anche nello spazio tra le righe) propone di
          creare; sulle righe vince il menu del task. */}
      <ul
        className="flex flex-col gap-1.5"
        onContextMenu={(e) => {
          // Sulle righe vince il menu del task, che ha già fermato l'evento.
          if (!e.defaultPrevented) open(e, listMenu);
        }}
      >
        {parents.map((parent) => {
          const subtasks = byParent.get(parent.id) ?? [];
          // Si apre solo ciò che ha qualcosa dentro: subtask o allegati/link.
          const hasContent = subtasks.length > 0 || parent.attachmentCount > 0;
          const isOpen = hasContent && expanded.has(parent.id);
          return (
            <li key={parent.id}>
              <TaskRow
                task={parent}
                onOpen={onOpen}
                onContext={(e) => open(e, menuFor(parent))}
                left={
                  hasContent ? (
                    <button
                      className="text-muted-foreground"
                      onClick={(e) => {
                        e.stopPropagation();
                        toggle(parent.id);
                      }}
                      aria-label={isOpen ? t("Comprimi") : t("Espandi")}
                      aria-expanded={isOpen}
                    >
                      {isOpen ? (
                        <ChevronDown className="size-4" />
                      ) : (
                        <ChevronRight className="size-4" />
                      )}
                    </button>
                  ) : (
                    <span className="w-4" />
                  )
                }
                right={
                  canEdit && parent.parentTaskId === null ? (
                    <Button
                      variant="ghost"
                      size="sm"
                      title={t("Aggiungi subtask")}
                      onClick={(e) => {
                        e.stopPropagation();
                        onAddSubtask(parent.id);
                      }}
                    >
                      <Plus className="size-3.5" /> {t("Subtask")}
                    </Button>
                  ) : null
                }
                // In piano un subtask dice dentro cosa sta: senza, "Fix crash"
                // in mezzo ad altri non si sa a quale lavoro appartenga.
                parentTitle={
                  flat && parent.parentTaskId
                    ? (parentTitles?.get(parent.parentTaskId) ?? null)
                    : null
                }
                subtaskInfo={
                  subtasks.length > 0
                    ? `${subtasks.filter((s) => s.status.isClosed).length}/${subtasks.length}`
                    : null
                }
              />
              {isOpen && parent.attachmentCount > 0 && (
                <div className="ml-7 mt-1">
                  <TaskAttachmentsPreview taskId={parent.id} />
                </div>
              )}
              {isOpen && subtasks.length > 0 && (
                <ul className="ml-7 mt-1 flex flex-col gap-1">
                  {subtasks.map((subtask) => (
                    <li key={subtask.id}>
                      <TaskRow
                        task={subtask}
                        onOpen={onOpen}
                        onContext={(e) => open(e, menuFor(subtask))}
                        left={<CornerDownRight className="size-3.5 text-muted-foreground" />}
                      />
                    </li>
                  ))}
                </ul>
              )}
            </li>
          );
        })}
      </ul>
      {menu}
    </>
  );
}

function TaskRow({
  task,
  onOpen,
  onContext,
  left,
  right,
  subtaskInfo,
  parentTitle,
}: {
  task: TaskListItem;
  onOpen: (id: string) => void;
  onContext?: (event: React.MouseEvent) => void;
  left?: React.ReactNode;
  right?: React.ReactNode;
  subtaskInfo?: string | null;
  /** Titolo del task che lo contiene, per i subtask mostrati in piano. */
  parentTitle?: string | null;
}) {
  const { t } = useTranslation();
  const due = dueState(task);
  const currentUser = useCurrentUser();
  const mio = visibilityReason(task, currentUser.id);
  const accent = ticketAccent(task);
  return (
    <div
      title={accent ? t(accent.titleKey) : undefined}
      className={cn(
        "flex w-full cursor-pointer items-center gap-3 rounded-md border bg-card px-3 py-2 text-sm hover:bg-muted/40",
        accent?.left,
        task.status.isClosed && "opacity-60",
      )}
      onClick={() => onOpen(task.id)}
      onContextMenu={onContext}
    >
      {left}
      <span className="min-w-0 flex-1 truncate font-medium">
        {/* Nato da un ticket: il cliente lo sta seguendo dalla sua area, e ogni
            commento gli arriva. Meglio saperlo prima di scriverci dentro. */}
        {task.createdViaTicket && (
          <span title={t("Nato da un ticket: il cliente lo segue e legge i commenti")}>
            <LifeBuoy
              className="mr-1.5 inline size-3.5 text-muted-foreground"
              aria-label={t("Nato da un ticket")}
            />
          </span>
        )}
        {/* Perché questo task ti riguarda: senza il segno, in mezzo a
            quattrocento righe i propri non si trovano. */}
        {mio !== "altro" && (
          <span title={mio === "assegnato" ? t("Assegnato a te") : t("Sei il supervisore")}>
            {mio === "assegnato" ? (
              <UserRound
                className="mr-1.5 inline size-3.5 text-primary"
                aria-label={t("Assegnato a te")}
              />
            ) : (
              <Eye
                className="mr-1.5 inline size-3.5 text-primary"
                aria-label={t("Sei il supervisore")}
              />
            )}
          </span>
        )}
        {task.title}
        {parentTitle && (
          <span className="ml-1.5 text-xs font-normal text-muted-foreground">
            <CornerDownRight className="mr-0.5 inline size-3" />
            {parentTitle}
          </span>
        )}
      </span>
      <span className="flex shrink-0 items-center gap-2 text-muted-foreground">
        <AttachmentsPeek taskId={task.id} count={task.attachmentCount} />
        <CommentsPeek taskId={task.id} count={task.commentCount} />
      </span>
      {subtaskInfo && (
        <span className="shrink-0 text-xs text-muted-foreground">
          {subtaskInfo} {t("subtask")}
        </span>
      )}
      <span className="hidden text-xs text-muted-foreground md:block">
        {task.assignee?.name ?? ""}
      </span>
      {/* Stato modificabile dalla riga, come nello scadenzario: la cella è la
          stessa, con le sue conferme (sequenza, subtask). */}
      <TaskStatusCell task={task} />
      <span
        className={cn(
          "w-20 text-right text-xs",
          due ? dueStateClass[due] : "text-muted-foreground",
        )}
      >
        {task.dueDate ? formatDate(task.dueDate) : ""}
      </span>
      {right}
    </div>
  );
}

function NewProjectTaskDialog({
  projectId,
  parentTaskId,
  projectMembers,
  onClose,
}: {
  projectId: string;
  parentTaskId: string | null;
  /** Chi lavora al progetto, col ruolo: mostrato in cima alle tendine. */
  projectMembers: ProjectMemberRef[];
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const saveOrDiscard = useSaveOrDiscard();
  const createTask = useCreateTask();
  // File, link e Google Drive anche qui: erano nel nuovo task dello scadenzario,
  // in quello da un'offerta e nelle richieste, e mancavano solo nel task di
  // progetto — che è il posto dove una specifica o uno screenshot arrivano più
  // spesso (20/08/2026).
  const attachments = useAttachmentStaging();
  const toast = useToast();
  const { users } = useOptions({ module: "PROJECT", projectId });
  const currentUser = useCurrentUser();
  const [title, setTitle] = useState("");
  // Un task nasce assegnato e supervisionato da chi lo crea, ed entrambi si
  // possono cambiare subito: capita spesso di aprire un'attività per un collega
  // e di volerne seguire l'esito senza doverla riaprire dopo averla creata.
  const [assigneeId, setAssigneeId] = useState(currentUser.id);
  const [supervisorId, setSupervisorId] = useState(currentUser.id);
  const [activityTypeId, setActivityTypeId] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [description, setDescription] = useState("");
  const [error, setError] = useState<string | null>(null);

  // Uscendo (Annulla, ✕, Esc) si sceglie: creare, o buttare via quel che si è scritto.
  const onSubmit = (event?: FormEvent) => {
    event?.preventDefault();
    setError(null);
    createTask.mutate(
      {
        title,
        projectId,
        parentTaskId,
        assigneeId: assigneeId || null,
        supervisorId: supervisorId || null,
        dueDate: dueDate || null,
        activityTypeId: activityTypeId || null,
        // L'editor lascia un paragrafo vuoto anche quando non c'è più niente.
        description: isRichTextEmpty(description) ? null : description,
      },
      {
        onSuccess: async (task) => {
          // Gli allegati si caricano ORA: prima il task non aveva un id a cui
          // attaccarli. Un caricamento fallito non annulla il task — è già
          // creato, e dirlo è meglio che far ricominciare da capo.
          if (attachments.hasStaged) {
            const { failed } = await attachments.uploadTo(task.id);
            if (failed > 0) toast(t("{{count}} allegati non caricati", { count: failed }), "error");
          }
          attachments.reset();
          onClose();
        },
        onError: (err) => setError(err instanceof ApiError ? err.message : t("Errore imprevisto")),
      },
    );
  };

  const requestClose = () =>
    saveOrDiscard({
      isDirty: isDirtyForm([
        [title, ""],
        [assigneeId, currentUser.id],
        [supervisorId, currentUser.id],
        [activityTypeId, ""],
        [dueDate, ""],
        [isRichTextEmpty(description) ? "" : description, ""],
        // Un file trascinato e non ancora salvato è lavoro da non buttare via
        // in silenzio, esattamente come una riga scritta nel titolo.
        [attachments.hasStaged ? "allegati" : "", ""],
      ]),
      canSave: title.trim() !== "",
      what: t("il nuovo task"),
      onSave: () => onSubmit(),
      onDiscard: onClose,
    });

  return (
    <Dialog
      open
      onClose={requestClose}
      title={parentTaskId ? t("Nuovo subtask") : t("Nuovo task di progetto")}
    >
      <form onSubmit={onSubmit} className="flex flex-col gap-4">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="pt-title" importance="required">
            {t("Titolo")}
          </Label>
          <Input
            id="pt-title"
            required
            autoFocus
            value={title}
            onChange={(e) => setTitle(e.target.value)}
          />
        </div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="pt-assignee" importance="recommended">
              {t("Assegnatario")}
            </Label>
            <UserSelect
              id="pt-assignee"
              value={assigneeId}
              onChange={setAssigneeId}
              users={users}
              projectMembers={projectMembers}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="pt-supervisor" importance="recommended">
              {t("Supervisore")}
            </Label>
            <UserSelect
              id="pt-supervisor"
              value={supervisorId}
              onChange={setSupervisorId}
              users={users}
              projectMembers={projectMembers}
              title={t("Riceve le notifiche su cambi di stato e commenti")}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="pt-due" importance="recommended">
              {t("Scadenza")}
            </Label>
            <DateField id="pt-due" value={dueDate} onCommit={(v) => setDueDate(v ?? "")} />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label importance="recommended">{t("Tipo di attività")}</Label>
            <ActivityTypeSelect
              kind="PROJECT"
              value={activityTypeId}
              onChange={setActivityTypeId}
            />
          </div>
        </div>
        <DescriptionField
          pendingImages
          value={description}
          onChange={setDescription}
          dialogTitle={parentTaskId ? t("Descrizione del subtask") : t("Descrizione del task")}
        />
        {attachments.node}
        {error && <p className="text-sm text-destructive">{error}</p>}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={requestClose}>
            {t("Annulla")}
          </Button>
          <Button type="submit" disabled={createTask.isPending}>
            {createTask.isPending ? t("Creazione…") : t("Crea")}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

function MembersDialog({
  project,
  open,
  onClose,
}: {
  project: ProjectListItem;
  open: boolean;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const currentUser = useCurrentUser();
  const { data: users } = useUserOptions();
  const saveOrDiscard = useSaveOrDiscard();
  const updateMembers = useUpdateProjectMembers();
  const canManage = project.myRole === ProjectRole.MANAGER || currentUser.role === UserRole.ADMIN;
  const [draft, setDraft] = useState<Map<string, ProjectRole> | null>(null);

  const roles = draft ?? new Map(project.members.map((m) => [m.user.id, m.role]));

  const setRole = (userId: string, role: ProjectRole | null) => {
    const next = new Map(roles);
    if (role === null) next.delete(userId);
    else next.set(userId, role);
    setDraft(next);
  };

  const discard = () => {
    setDraft(null);
    onClose();
  };

  const save = () =>
    updateMembers.mutate(
      {
        id: project.id,
        members: [...roles.entries()].map(([userId, role]) => ({ userId, role })),
      },
      { onSuccess: discard },
    );

  // I ruoli si modificano su una copia e si applicano con "Salva": chiudendo con
  // modifiche in sospeso si sceglie, invece di perderle senza dirlo.
  const close = () =>
    saveOrDiscard({
      isDirty: draft !== null,
      canSave: true,
      what: t("le modifiche ai membri"),
      onSave: save,
      onDiscard: discard,
    });

  return (
    <Dialog open={open} onClose={close} title={t("Membri — {{name}}", { name: project.name })}>
      <div className="mb-4 flex max-h-80 flex-col gap-2 overflow-y-auto">
        {users?.map((user) => {
          const role = roles.get(user.id) ?? null;
          return (
            <div key={user.id} className="flex items-center justify-between gap-2 text-sm">
              <span className={cn(!role && "text-muted-foreground")}>{user.name}</span>
              {canManage ? (
                <select
                  className="h-8 rounded-md border bg-background px-2 text-sm"
                  value={role ?? ""}
                  onChange={(e) =>
                    setRole(user.id, e.target.value === "" ? null : (e.target.value as ProjectRole))
                  }
                >
                  <option value="">{t("Non membro")}</option>
                  <option value={ProjectRole.MANAGER}>{t("Manager")}</option>
                  <option value={ProjectRole.EDITOR}>{t("Editor")}</option>
                  <option value={ProjectRole.VIEWER}>{t("Visualizzatore")}</option>
                </select>
              ) : (
                <span className="text-xs text-muted-foreground">
                  {role ? t(roleLabel(role)) : "—"}
                </span>
              )}
            </div>
          );
        })}
      </div>
      <div className="flex justify-end gap-2">
        <Button variant="outline" onClick={close}>
          {canManage ? t("Annulla") : t("Chiudi")}
        </Button>
        {canManage && (
          <Button disabled={updateMembers.isPending || roles.size === 0} onClick={save}>
            {updateMembers.isPending ? t("Salvataggio…") : t("Salva")}
          </Button>
        )}
      </div>
    </Dialog>
  );
}
