import { useState } from "react";
import { useTranslation } from "react-i18next";
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import { SortableContext, horizontalListSortingStrategy } from "@dnd-kit/sortable";
import {
  AlertTriangle,
  CornerDownRight,
  GripVertical,
  HandCoins,
  Link2,
  Repeat,
  Workflow,
  X,
} from "lucide-react";
import {
  statusCategoryOf,
  type ActivityCategory,
  type TaskListItem,
  type TaskStatus,
} from "@kancrm/shared";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { useContextMenu } from "@/components/ui/context-menu";
import { pointerFirstCollision } from "@/lib/dnd";
import { dueState, dueStateClass, formatDue } from "./task-utils";
import { ticketAccent } from "./ticket-accent";
import { ActivityTypeBadge } from "./activity-types";
import { TaskContext } from "./TaskContext";
import { AttachmentsPeek, CommentsPeek } from "./TaskPeek";
import { useTaskMenuItems } from "./useTaskMenu";
// Spunta "fatto" tolta dalle card il 14/08/2026 (vedi più sotto), e dal
// 05/09/2026 da ogni vista: il componente non esiste più.
import { useUpdateTask, useUpdateTaskWithSequenceConfirm } from "./useTasks";
import {
  applyColumnOrder,
  reorderColumns,
  useColumnOrder,
  useSortableColumn,
} from "../kanban/useColumnOrder";
import { CardDragPreview } from "../kanban/CardDragPreview";
import { ColumnDragPreview } from "../kanban/ColumnDragPreview";
import { COLLAPSED_COLUMN_CLASS, CollapsedColumn } from "../kanban/CollapsedColumn";

interface TaskKanbanProps {
  tasks: TaskListItem[];
  statuses: TaskStatus[];
  /**
   * Categoria della bacheca: gli stati (e quindi le colonne) sono distinti per
   * categoria di attività, quindi una bacheca ne mostra una sola alla volta.
   */
  category: ActivityCategory;
  /**
   * I task chiusi **sono già arrivati dal server**: le colonne chiuse mostrano
   * il loro contenuto invece dell'invito a spuntare "Mostra chiusi". Non è la
   * spunta: anche una ricerca o la scelta di uno stato preciso li portano
   * dentro (`hideClosedTasks`), e in quel caso la colonna piena non deve dire
   * che è vuota.
   */
  closedLoaded: boolean;
  onOpen: (id: string) => void;
  /**
   * Task **assegnati a una persona sola**, aperti, per stato: è il numero che
   * si confronta con il limite WIP. Arriva solo quando la bacheca è filtrata su
   * una persona — il limite dice quante cose *quella* persona tiene aperte
   * insieme, e con i task di tutti davanti non c'è nessuno di cui sia il
   * troppo. Assente = nessun indicatore, e il conteggio resta quello di sempre.
   */
  wipCounts?: Map<string, number>;
}

export function TaskKanban({
  tasks,
  statuses,
  category,
  closedLoaded,
  onOpen,
  wipCounts,
}: TaskKanbanProps) {
  const { t } = useTranslation();
  const updateStatus = useUpdateTaskWithSequenceConfirm();
  const updateTask = useUpdateTask();
  const { open, menu } = useContextMenu();
  const menuItems = useTaskMenuItems(onOpen);
  const sensors = useSensors(
    // Distanza minima: distingue il click (apre il dettaglio) dal drag.
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
  );

  /**
   * Modalità sequenza: il trascinamento non cambia più lo stato ma costruisce la
   * catena dei propedeutici. Lasciando la card X sopra la card Y, X "cade dentro"
   * Y — X diventa il successore (figlio), Y il predecessore (padre). I due assi
   * (stato e sequenza) restano separati: in modalità sequenza le colonne non sono
   * bersagli, lo sono le card. L'indentazione piena tra colonne diverse non è
   * rappresentabile qui, quindi ogni card mostra "↳ dopo <task>".
   */
  const [sequenceMode, setSequenceMode] = useState(false);
  const [activeColumn, setActiveColumn] = useState<TaskStatus | null>(null);
  /**
   * La card che si sta trascinando, per disegnarla nel `DragOverlay`.
   *
   * Da quando ogni colonna scorre per conto suo il suo riquadro **ritaglia**:
   * muovendo la card con una `transform` dove sta, la si vedeva scivolare
   * *sotto* le colonne accanto (20/08/2026). L'overlay la disegna fuori da
   * tutti i riquadri, e il trascinamento fra colonne adiacenti torna continuo.
   */
  const [activeTask, setActiveTask] = useState<TaskListItem | null>(null);

  // Ordine colonne personale dell'utente per questa bacheca (categoria).
  const orderKey = `task:${category}`;
  const { orders, setOrder } = useColumnOrder();
  const savedOrder = orders[orderKey];

  // Tutte le colonne della categoria, comprese quelle chiuse: sono la destinazione
  // naturale di un task che si finisce, e nasconderle rendeva impossibile chiudere
  // un task trascinandolo. L'ordine salvato dall'utente ha la precedenza.
  const columns = applyColumnOrder(
    statuses.filter((s) => s.category === category),
    savedOrder,
  );
  const columnIds = columns.map((c) => c.id);
  // Ogni area ha i propri stati, quindi la propria bacheca: qui compaiono solo
  // i task di questa. Dove sono gli altri lo dice la tendina, con i numeri.
  const visible = tasks.filter((task) => statusCategoryOf(task) === category);
  const titleById = new Map(visible.map((task) => [task.id, task.title]));

  const onDragStart = (event: DragStartEvent) => {
    if (event.active.data.current?.type === "column") {
      setActiveColumn(columns.find((c) => c.id === event.active.id) ?? null);
      return;
    }
    setActiveTask(visible.find((task) => task.id === event.active.id) ?? null);
  };

  const onDragEnd = (event: DragEndEvent) => {
    setActiveColumn(null);
    setActiveTask(null);
    const { active, over } = event;
    if (!over) return;
    // Riordino colonne (disattivato in modalità sequenza).
    if (active.data.current?.type === "column") {
      if (active.id !== over.id) {
        setOrder(orderKey, reorderColumns(columnIds, String(active.id), String(over.id)));
      }
      return;
    }
    const taskId = String(active.id);
    const overId = String(over.id);
    if (overId === taskId) return;
    const task = visible.find((t) => t.id === taskId);
    if (!task) return;

    if (sequenceMode) {
      // Lasciato su un'altra card: il task trascinato le diventa successore. Il
      // server rifiuta i cicli (assertNoSequenceCycle) e mostra il toast d'errore.
      if (task.predecessorId === overId) return;
      updateTask.mutate({ id: taskId, predecessorId: overId });
    } else {
      if (task.status.id === overId) return;
      updateStatus.mutateWithConfirm({ id: taskId, statusId: overId });
    }
  };

  return (
    <DndContext
      sensors={sensors}
      // La colonna la sceglie il puntatore, non l'area della card: vedi lib/dnd.
      collisionDetection={pointerFirstCollision}
      onDragStart={onDragStart}
      // Annullando con Esc non arriva `onDragEnd`: senza questo l'anteprima
      // resterebbe appesa sopra la pagina.
      onDragCancel={() => {
        setActiveColumn(null);
        setActiveTask(null);
      }}
      onDragEnd={onDragEnd}
    >
      {/**
       * **Il kanban vive dentro l'altezza che la pagina gli dà, e scorre lì
       * dentro** (20/08/2026). Prima le colonne crescevano col contenuto: la
       * pagina si allungava e la barra di scorrimento orizzontale — che sta in
       * fondo al riquadro — finiva sotto la piega. Con quarantotto card in una
       * colonna, per scorrere di lato bisognava prima scendere in fondo alla
       * pagina; con poche card, la barra compariva a metà finestra con il vuoto
       * sotto. È la convenzione già scritta: la tabella e il kanban scorrono nel
       * loro riquadro, la pagina no.
       */}
      <div className="flex h-full min-h-0 flex-col">
        <div className="mb-2 flex flex-none flex-wrap items-center gap-3">
          <Button
            variant={sequenceMode ? "default" : "outline"}
            size="sm"
            onClick={() => setSequenceMode((on) => !on)}
            title={t("Trascina una card su un'altra per metterla in sequenza")}
          >
            <Workflow className="size-4" /> {t("Sequenza")}
          </Button>
          {sequenceMode && (
            <p className="text-xs text-muted-foreground">
              {t("Trascina una card")} <strong>{t("sopra")}</strong> {t("un'altra: la metti")}{" "}
              <strong>{t("dopo")}</strong> {t("di essa. Il trascinamento non cambia più lo stato.")}
            </p>
          )}
        </div>
        <SortableContext items={columnIds} strategy={horizontalListSortingStrategy}>
          <div className="flex min-h-0 flex-1 gap-4 overflow-x-auto pb-2">
            {columns.map((status) => (
              <KanbanColumn
                key={status.id}
                status={status}
                tasks={visible.filter((t) => t.status.id === status.id)}
                // Colonna chiusa senza i task chiusi caricati: nessun conteggio.
                countHidden={status.isClosed && !closedLoaded}
                wipCount={wipCounts?.get(status.id)}
                sequenceMode={sequenceMode}
                titleById={titleById}
                onOpen={onOpen}
                onContext={(e, task) => open(e, menuItems(task))}
                onUnchain={(id) => updateTask.mutate({ id, predecessorId: null })}
              />
            ))}
          </div>
        </SortableContext>
      </div>
      <DragOverlay>
        {activeColumn ? (
          <ColumnDragPreview name={activeColumn.name} color={activeColumn.color} />
        ) : activeTask ? (
          <CardDragPreview
            title={activeTask.title}
            activityType={activeTask.activityType}
            subtitle={activeTask.assignee?.name}
          />
        ) : null}
      </DragOverlay>
      {menu}
    </DndContext>
  );
}

/**
 * Ordina i task di una colonna per catena: ogni predecessore precede i suoi
 * successori (finché stanno nella stessa colonna), che vengono indentati sotto.
 * Le radici — task senza predecessore, o col predecessore in un'altra colonna —
 * restano nell'ordine di partenza (scadenza/creazione). Senza questo un successore
 * poteva comparire sopra il proprio predecessore.
 */
function orderByChain(tasks: TaskListItem[]): Array<{ task: TaskListItem; depth: number }> {
  const inColumn = new Set(tasks.map((t) => t.id));
  const childrenOf = new Map<string, TaskListItem[]>();
  const roots: TaskListItem[] = [];
  for (const task of tasks) {
    if (task.predecessorId && inColumn.has(task.predecessorId)) {
      const siblings = childrenOf.get(task.predecessorId) ?? [];
      siblings.push(task);
      childrenOf.set(task.predecessorId, siblings);
    } else {
      roots.push(task);
    }
  }
  const out: Array<{ task: TaskListItem; depth: number }> = [];
  const visited = new Set<string>();
  const walk = (task: TaskListItem, depth: number) => {
    if (visited.has(task.id)) return; // anti-ciclo (il server li impedisce, qui è sicurezza)
    visited.add(task.id);
    out.push({ task, depth });
    for (const child of childrenOf.get(task.id) ?? []) walk(child, depth + 1);
  };
  for (const root of roots) walk(root, 0);
  for (const task of tasks) if (!visited.has(task.id)) out.push({ task, depth: 0 });
  return out;
}

function KanbanColumn({
  status,
  tasks,
  countHidden = false,
  wipCount,
  sequenceMode,
  titleById,
  onOpen,
  onContext,
  onUnchain,
}: {
  status: TaskStatus;
  tasks: TaskListItem[];
  countHidden?: boolean;
  /** Task assegnati alla persona scelta in questo stato: il numero del WIP. */
  wipCount?: number;
  sequenceMode: boolean;
  titleById: Map<string, string>;
  onOpen: (id: string) => void;
  onContext: (e: React.MouseEvent, task: TaskListItem) => void;
  onUnchain: (id: string) => void;
}) {
  const { t } = useTranslation();
  // In modalità sequenza i bersagli sono le card, non le colonne: si disattiva sia il
  // rilascio sulla colonna sia il riordino colonne.
  const { setNodeRef, style, isDragging, isOver, handleProps } = useSortableColumn(
    status.id,
    sequenceMode,
  );

  // Colonna vuota: si restringe a striscia (vedi CollapsedColumn).
  const collapsed = tasks.length === 0;

  const grip = (
    <button
      type="button"
      {...handleProps}
      title={t("Trascina per riordinare la colonna")}
      className="cursor-grab touch-none text-muted-foreground/50 hover:text-muted-foreground active:cursor-grabbing"
    >
      <GripVertical className="size-3.5" />
    </button>
  );

  return (
    <div
      ref={setNodeRef}
      style={style}
      title={
        collapsed
          ? countHidden
            ? t(
                '{{name}} — trascina qui per chiudere; spunta "Mostra chiusi" per vedere cosa contiene',
                { name: status.name },
              )
            : t("{{name}} — nessun task, trascina qui per spostarcene uno", { name: status.name })
          : undefined
      }
      // Appiglio per la prova nel browser: la colonna come riquadro.
      data-colonna={status.id}
      className={cn(
        // `h-full`: colonne tutte alte uguali, che è anche il bersaglio più
        // generoso per chi trascina una card in una colonna vuota.
        "flex h-full min-h-0 shrink-0 flex-col gap-2 rounded-lg border bg-muted/30 p-3 transition-colors",
        collapsed ? COLLAPSED_COLUMN_CLASS : "w-72",
        isOver && "border-ring bg-accent",
        isDragging && "opacity-40",
      )}
    >
      {collapsed ? (
        <CollapsedColumn name={status.name} color={status.color} grip={grip} />
      ) : (
        <>
          <div className="flex items-center justify-between gap-1 px-1">
            <span
              className="inline-flex min-w-0 items-center gap-1.5 text-sm font-semibold"
              style={{ color: status.color }}
            >
              {grip}
              <span
                className="size-2.5 shrink-0 rounded-full"
                style={{ backgroundColor: status.color }}
              />
              <span className="truncate">{status.name}</span>
            </span>
            {!countHidden && (
              <ColumnCount status={status} shown={tasks.length} wipCount={wipCount} />
            )}
          </div>
          {/* Le card scorrono dentro la loro colonna: una colonna da
              quarantotto non deve allungare tutta la bacheca. */}
          <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto pr-0.5">
            {orderByChain(tasks).map(({ task, depth }) => (
              <KanbanCard
                key={task.id}
                task={task}
                depth={depth}
                sequenceMode={sequenceMode}
                predecessorTitle={
                  task.predecessorId ? titleById.get(task.predecessorId) : undefined
                }
                onOpen={onOpen}
                onContext={onContext}
                onUnchain={onUnchain}
              />
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function KanbanCard({
  task,
  depth,
  sequenceMode,
  predecessorTitle,
  onOpen,
  onContext,
  onUnchain,
}: {
  task: TaskListItem;
  /** Profondità nella catena della colonna: rientra la card sotto il predecessore. */
  depth: number;
  sequenceMode: boolean;
  /** Titolo del predecessore, se è nella stessa bacheca; per la riga "↳ dopo …". */
  predecessorTitle?: string;
  onOpen: (id: string) => void;
  onContext: (e: React.MouseEvent, task: TaskListItem) => void;
  onUnchain: (id: string) => void;
}) {
  const { t } = useTranslation();
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: task.id,
  });
  // In modalità sequenza la card è anche un bersaglio: le si aggancia sotto un'altra.
  const droppable = useDroppable({ id: task.id, disabled: !sequenceMode });
  const due = dueState(task);
  // Nato da un ticket: il bordo prende il colore della priorità dichiarata dal
  // cliente. Il filo del predecessore resta a sinistra: due bordi diversi, due
  // cose diverse.
  const accent = ticketAccent(task);

  return (
    <div
      ref={(node) => {
        setNodeRef(node);
        droppable.setNodeRef(node);
      }}
      title={accent ? t(accent.titleKey) : undefined}
      {...listeners}
      {...attributes}
      style={{
        // Indentazione per profondità (max 3 livelli, per non assottigliare troppo
        // le card di catene lunghe). Il trascinamento sovrascrive il margine.
        ...(depth > 0 ? { marginLeft: Math.min(depth, 3) * 14 } : {}),
        // Niente `transform` mentre si trascina: a muoversi è l'anteprima
        // nell'overlay, e la card qui resta al suo posto sbiadita — sia perché
        // il riquadro della colonna la ritaglierebbe, sia perché due copie che
        // si muovono insieme sono un disegno confuso.
      }}
      className={cn(
        "relative cursor-grab rounded-md border bg-card p-3 text-sm shadow-sm transition-shadow hover:shadow",
        accent?.border,
        isDragging && "opacity-40",
        // In sequenza, la card sopra cui si sta rilasciando si evidenzia come bersaglio.
        sequenceMode && droppable.isOver && !isDragging && "border-ring ring-1 ring-ring",
        // Predecessore in un'altra colonna (nessuna card sopra a cui agganciarsi):
        // un filo a sinistra segnala comunque "questo viene dopo qualcosa".
        task.predecessorId && depth === 0 && "border-l-2 border-l-muted-foreground/40",
      )}
      onClick={() => onOpen(task.id)}
      onContextMenu={(e) => onContext(e, task)}
    >
      {/* Connettore a gomito verso il predecessore (che è la card subito sopra,
          meno indentata): scende dalla sua colonna e punta dentro questa card. */}
      {depth > 0 && (
        <svg
          className="pointer-events-none absolute text-muted-foreground/60"
          style={{ left: -14, top: -10, width: 16, height: 30 }}
          viewBox="0 0 16 30"
          aria-hidden="true"
        >
          <path d="M4 0 V20 H14" fill="none" stroke="currentColor" strokeWidth="1.5" />
          <path d="M11 16.5 L16 20 L11 23.5 Z" fill="currentColor" />
        </svg>
      )}
      {/* Posizione in sequenza: "↳ dopo <task>". Solo in modalità sequenza, dove è
          l'informazione che conta; con la × per staccare la catena. */}
      {sequenceMode && task.predecessorId && (
        <div className="mb-1.5 flex items-center gap-1 text-xs text-muted-foreground">
          <CornerDownRight className="size-3 shrink-0" />
          <span className="min-w-0 flex-1 truncate">
            {t("dopo {{title}}", { title: predecessorTitle ?? t("un task") })}
          </span>
          <button
            type="button"
            className="shrink-0 hover:text-foreground"
            aria-label={t("Togli dalla sequenza")}
            title={t("Togli dalla sequenza")}
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => {
              e.stopPropagation();
              onUnchain(task.id);
            }}
          >
            <X className="size-3" />
          </button>
        </div>
      )}
      {/*
        La spunta "fatto" sulla card è stata tolta il 14/08/2026: una casella di
        spunta, nel resto dell'applicazione, vuol dire **selezione multipla** —
        e qui invece chiudeva il task al primo clic. Il codice resta qui, com'era,
        se un giorno si decidesse di rimetterla con un segno diverso; il task si
        chiude dal menu col tasto destro o dal suo pannello, che sono gesti
        espliciti.

        <TaskDoneCheckbox task={task} />
      */}
      <p className="flex items-start gap-2 font-medium leading-snug">
        <span className="min-w-0 flex-1">
          {task.recurrenceTemplateId && (
            <Repeat
              className="mr-1 inline size-3 text-muted-foreground"
              aria-label={t("Ricorrente")}
            />
          )}
          {task.predecessorId && !sequenceMode && (
            <Link2
              className="mr-1 inline size-3 text-muted-foreground"
              aria-label={t("In sequenza")}
            />
          )}
          {task.title}
          {task.relatedDeal && (
            <HandCoins
              className="ml-1 inline size-3 text-muted-foreground"
              aria-label={t("Collegato all'offerta {{title}}", { title: task.relatedDeal.title })}
            />
          )}
        </span>
      </p>
      {task.activityType && (
        <div className="mt-1.5">
          <ActivityTypeBadge type={task.activityType} />
        </div>
      )}
      {task.tags.length > 0 && (
        <div className="mt-1.5 flex flex-wrap gap-1">
          {task.tags.map((tag) => (
            <span
              key={tag.id}
              className="rounded-full border px-1.5 py-0.5 text-[10px] leading-none text-muted-foreground"
              style={tag.color ? { borderColor: tag.color, color: tag.color } : undefined}
            >
              {tag.name}
            </span>
          ))}
        </div>
      )}
      {/* Azienda e progetto, quando ci sono: gli stessi campi della tabella. */}
      <TaskContext task={task} showModule={false} />
      <div className="mt-2 flex items-center justify-between text-xs text-muted-foreground">
        <span>{task.assignee?.name ?? t("Non assegnato")}</span>
        <div className="flex items-center gap-2">
          <AttachmentsPeek taskId={task.id} count={task.attachmentCount} />
          <CommentsPeek taskId={task.id} count={task.commentCount} />
          {task.dueDate && (
            <span className={cn(due ? dueStateClass[due] : "")}>{formatDue(task)}</span>
          )}
        </div>
      </div>
    </div>
  );
}

/**
 * Il numero in testa alla colonna, e — con un **limite WIP** e una persona
 * sola davanti — quanti ne ha lei rispetto a quanti se ne ammettono: `4/3`, col
 * triangolo giallo quando è superato.
 *
 * Il limite è **personale**: compare solo dove la bacheca è filtrata su una
 * persona. Contando i task di tutti si confrontava il totale della squadra con
 * un limite individuale, e con tre task a schermo l'avviso diceva 11/4
 * (18/08/2026).
 *
 * Il conteggio non segue gli **altri** filtri (range di scadenza, ricerca): il
 * WIP è quanto quella persona ha aperto in quello stato, non quanto se ne vede
 * adesso. Dove i due numeri differiscono si mostra **solo il WIP**: affiancare
 * anche il conteggio delle card dava "4 · 2/4", tre numeri di cui due uguali e
 * di significato diverso, che è meno chiaro di uno solo spiegato dal
 * suggerimento (18/08/2026).
 */
function ColumnCount({
  status,
  shown,
  wipCount,
}: {
  status: TaskStatus;
  shown: number;
  wipCount?: number;
}) {
  const { t } = useTranslation();
  const limit = status.wipLimit;
  // Senza limite, senza persona scelta, o con niente in mano a quella persona:
  // il conteggio di sempre. Uno "0/4" accanto a delle card che si vedono
  // (perché supervisionate, non assegnate) direbbe più confusione che altro.
  if (!limit || !wipCount) {
    return <span className="text-xs text-muted-foreground">{shown}</span>;
  }
  const over = wipCount > limit;
  return (
    <span
      className="inline-flex items-center gap-1 text-xs"
      title={
        over
          ? t(
              "{{count}} task assegnati a questa persona su un limite di {{limit}}: troppe cose aperte insieme allungano i tempi di tutte.",
              { count: wipCount, limit },
            )
          : t("{{count}} task assegnati a questa persona su un limite di {{limit}}.", {
              count: wipCount,
              limit,
            })
      }
    >
      <span
        className={cn(
          "tabular-nums",
          over ? "font-semibold text-amber-600 dark:text-amber-500" : "text-muted-foreground",
        )}
      >
        {wipCount}/{limit}
      </span>
      {over && (
        <AlertTriangle
          className="size-3.5 shrink-0 text-amber-600 dark:text-amber-500"
          aria-label={t("Limite WIP superato")}
        />
      )}
    </span>
  );
}
