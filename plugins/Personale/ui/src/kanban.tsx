import { useEffect, useState, type CSSProperties, type FormEvent, type MouseEvent } from "react";
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  pointerWithin,
  rectIntersection,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type CollisionDetection,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  horizontalListSortingStrategy,
  useSortable,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { api } from "./api";
import { t, todayISO } from "./i18n";
import { FinestraCard, Scadenza, useConferma } from "./dialogs";
import type { Board, BoardStatus, BoardTask, UserRef } from "./types";

/**
 * La kanban, come `features/boards/BoardKanban.tsx` del core: colonne
 * trascinabili (l'ordine personale sta nel profilo del core, chiave
 * `board:<id>`), card che si spostano fra colonne, aggiunta rapida con un
 * titolo, la spunta di completamento con conferma, il menù col tasto destro.
 * L'anteprima di ciò che si trascina sta in un `DragOverlay`: la colonna
 * scorre per conto suo e ritaglierebbe la card in movimento.
 */

/** La colonna la sceglie il puntatore, non l'area della card (come `lib/dnd.ts`). */
const collisione: CollisionDetection = (args) => {
  const sotto = pointerWithin(args);
  return sotto.length > 0 ? sotto : rectIntersection(args);
};

const ordina = <T extends { id: string }>(colonne: T[], salvato?: string[]): T[] => {
  if (!salvato || salvato.length === 0) return colonne;
  const indice = new Map(salvato.map((id, i) => [id, i]));
  return [...colonne].sort(
    (a, b) => (indice.get(a.id) ?? Infinity) - (indice.get(b.id) ?? Infinity),
  );
};

export function Kanban({
  board,
  tasks,
  users,
  ordineSalvato,
  onOrdine,
  onChange,
}: {
  board: Board;
  tasks: BoardTask[];
  users: UserRef[];
  ordineSalvato?: string[];
  onOrdine: (order: string[]) => void;
  onChange: () => void;
}) {
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));
  const conferma = useConferma();
  const [editing, setEditing] = useState<BoardTask | null>(null);
  const [creating, setCreating] = useState<{ statusId: string } | null>(null);
  const [colonnaAttiva, setColonnaAttiva] = useState<BoardStatus | null>(null);
  const [cardAttiva, setCardAttiva] = useState<BoardTask | null>(null);
  const [menu, setMenu] = useState<{ x: number; y: number; task: BoardTask } | null>(null);
  const oggi = todayISO();

  const colonne = ordina(
    [...board.statuses].sort((a, b) => a.order - b.order),
    ordineSalvato,
  );
  const idColonne = colonne.map((c) => c.id);
  const chiusa = colonne.find((s) => s.isClosed);
  const iniziale = colonne.find((s) => s.isInitial);

  useEffect(() => {
    if (!menu) return;
    const chiudi = () => setMenu(null);
    window.addEventListener("click", chiudi);
    window.addEventListener("keydown", chiudi);
    return () => {
      window.removeEventListener("click", chiudi);
      window.removeEventListener("keydown", chiudi);
    };
  }, [menu]);

  const sposta = async (task: BoardTask, statusId: string) => {
    await api.updateTask(board.id, task.id, { boardStatusId: statusId });
    onChange();
  };

  // La spunta: verso «chiuso» si chiede conferma; togliendola si torna all'iniziale.
  const completa = async (task: BoardTask) => {
    if (task.closedAt) {
      if (iniziale) await sposta(task, iniziale.id);
      return;
    }
    if (!chiusa) return;
    const ok = await conferma.chiedi({
      titolo: t("Completare il task?"),
      messaggio: t('"{{title}}" verrà spostato in "{{status}}".', {
        title: task.title,
        status: chiusa.name,
      }),
      conferma: t("Completa"),
    });
    if (ok) await sposta(task, chiusa.id);
  };

  const onDragStart = (event: DragStartEvent) => {
    if (event.active.data.current?.type === "column") {
      setColonnaAttiva(colonne.find((c) => c.id === event.active.id) ?? null);
      return;
    }
    setCardAttiva(tasks.find((x) => x.id === event.active.id) ?? null);
  };

  const onDragEnd = (event: DragEndEvent) => {
    setColonnaAttiva(null);
    setCardAttiva(null);
    const { active, over } = event;
    if (!over) return;
    if (active.data.current?.type === "column") {
      if (active.id !== over.id) {
        onOrdine(
          arrayMove(
            idColonne,
            idColonne.indexOf(String(active.id)),
            idColonne.indexOf(String(over.id)),
          ),
        );
      }
      return;
    }
    const task = tasks.find((x) => x.id === String(active.id));
    if (!task || task.boardStatusId === String(over.id)) return;
    void sposta(task, String(over.id));
  };

  const elimina = async (task: BoardTask) => {
    const ok = await conferma.chiedi({
      titolo: t("Eliminare il task?"),
      messaggio: t('"{{title}}" verrà eliminato definitivamente.', { title: task.title }),
      conferma: t("Elimina"),
      pericolo: true,
    });
    if (!ok) return;
    await api.deleteTask(board.id, task.id);
    onChange();
  };

  return (
    <>
      <DndContext
        sensors={sensors}
        collisionDetection={collisione}
        onDragStart={onDragStart}
        onDragCancel={() => {
          setColonnaAttiva(null);
          setCardAttiva(null);
        }}
        onDragEnd={onDragEnd}
      >
        <SortableContext items={idColonne} strategy={horizontalListSortingStrategy}>
          <div className="kanban">
            {colonne.map((status) => (
              <Colonna
                key={status.id}
                status={status}
                tasks={tasks.filter((x) => x.boardStatusId === status.id)}
                oggi={oggi}
                onQuickAdd={async (title) => {
                  await api.createTask(board.id, { title, boardStatusId: status.id });
                  onChange();
                }}
                onAddDetailed={() => setCreating({ statusId: status.id })}
                onOpen={setEditing}
                onToggleDone={(task) => void completa(task)}
                onContext={(e, task) => {
                  e.preventDefault();
                  e.stopPropagation();
                  setMenu({ x: e.clientX, y: e.clientY, task });
                }}
              />
            ))}
          </div>
        </SortableContext>
        <DragOverlay>
          {colonnaAttiva ? (
            <div className="anteprima colonna-anteprima">
              <span className="pallino" style={{ backgroundColor: colonnaAttiva.color }} />
              {colonnaAttiva.name}
            </div>
          ) : cardAttiva ? (
            <div className="anteprima">{cardAttiva.title}</div>
          ) : null}
        </DragOverlay>
      </DndContext>

      {menu && (
        <div
          className="menu"
          role="menu"
          style={{ left: Math.min(menu.x, window.innerWidth - 200), top: menu.y }}
        >
          <button type="button" onClick={() => setEditing(menu.task)}>
            {t("Modifica")}
          </button>
          {chiusa && menu.task.boardStatusId !== chiusa.id && (
            <button type="button" onClick={() => void sposta(menu.task, chiusa.id)}>
              {t("Completa")}
            </button>
          )}
          <button
            type="button"
            onClick={async () => {
              await api.updateTask(board.id, menu.task.id, { archived: !menu.task.archived });
              onChange();
            }}
          >
            {menu.task.archived ? t("Ripristina") : t("Archivia")}
          </button>
          <hr />
          <button type="button" className="pericolo" onClick={() => void elimina(menu.task)}>
            {t("Elimina")}
          </button>
        </div>
      )}

      {editing && (
        <FinestraCard
          board={board}
          task={editing}
          users={users}
          onClose={() => setEditing(null)}
          onSaved={onChange}
          onDeleted={onChange}
        />
      )}
      {creating && (
        <FinestraCard
          board={board}
          task={null}
          defaultStatusId={creating.statusId}
          users={users}
          onClose={() => setCreating(null)}
          onSaved={onChange}
          onDeleted={onChange}
        />
      )}
      {conferma.nodo}
    </>
  );
}

function Colonna({
  status,
  tasks,
  oggi,
  onQuickAdd,
  onAddDetailed,
  onOpen,
  onToggleDone,
  onContext,
}: {
  status: BoardStatus;
  tasks: BoardTask[];
  oggi: string;
  onQuickAdd: (title: string) => Promise<void>;
  onAddDetailed: () => void;
  onOpen: (task: BoardTask) => void;
  onToggleDone: (task: BoardTask) => void;
  onContext: (e: MouseEvent, task: BoardTask) => void;
}) {
  // La colonna è insieme ordinabile (per la maniglia) e bersaglio delle card.
  const sortable = useSortable({ id: status.id, data: { type: "column" } });
  const { setNodeRef: setDropRef, isOver } = useDroppable({ id: status.id });
  const [adding, setAdding] = useState(false);
  const [title, setTitle] = useState("");
  const style: CSSProperties = {
    transform: CSS.Transform.toString(sortable.transform),
    transition: sortable.transition,
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (title.trim() === "") return;
    await onQuickAdd(title.trim());
    setTitle("");
    setAdding(false);
  };

  return (
    <div
      ref={(node) => {
        sortable.setNodeRef(node);
        setDropRef(node);
      }}
      style={style}
      onContextMenu={(e) => {
        e.preventDefault();
        onAddDetailed();
      }}
      className={`colonna${isOver ? " sopra" : ""}${sortable.isDragging ? " trascinata" : ""}`}
    >
      <div className="colonna-testa">
        <span className="colonna-titolo">
          <button
            type="button"
            className="maniglia"
            title={t("Trascina per riordinare la colonna")}
            {...sortable.attributes}
            {...sortable.listeners}
          >
            <svg className="icona" viewBox="0 0 24 24">
              <circle cx="9" cy="5" r="1" />
              <circle cx="9" cy="12" r="1" />
              <circle cx="9" cy="19" r="1" />
              <circle cx="15" cy="5" r="1" />
              <circle cx="15" cy="12" r="1" />
              <circle cx="15" cy="19" r="1" />
            </svg>
          </button>
          <span className="pallino" style={{ backgroundColor: status.color }} />
          <span className="nome">{status.name}</span>
          <span className="contatore">{tasks.length}</span>
        </span>
        <button
          type="button"
          className="bottone leggero icona piccolo"
          title={t("Aggiungi task")}
          onClick={() => setAdding(true)}
        >
          +
        </button>
      </div>
      {adding && (
        <form onSubmit={(e) => void submit(e)} style={{ padding: "0 0.25rem" }}>
          <input
            autoFocus
            className="rapido"
            value={title}
            placeholder={t("Titolo del task…")}
            onChange={(e) => setTitle(e.target.value)}
            onBlur={() => !title && setAdding(false)}
          />
        </form>
      )}
      <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
        {tasks.map((task) => (
          <Card
            key={task.id}
            task={task}
            oggi={oggi}
            onOpen={() => onOpen(task)}
            onToggleDone={() => onToggleDone(task)}
            onContext={onContext}
          />
        ))}
      </div>
    </div>
  );
}

function Card({
  task,
  oggi,
  onOpen,
  onToggleDone,
  onContext,
}: {
  task: BoardTask;
  oggi: string;
  onOpen: () => void;
  onToggleDone: () => void;
  onContext: (e: MouseEvent, task: BoardTask) => void;
}) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id: task.id });
  return (
    <div
      ref={setNodeRef}
      {...listeners}
      {...attributes}
      onClick={onOpen}
      onContextMenu={(e) => onContext(e, task)}
      className={`card${isDragging ? " trascinata" : ""}${task.archived ? " archiviata" : ""}`}
    >
      <div className="card-testa">
        <input
          type="checkbox"
          checked={!!task.closedAt}
          title={t("Segna come completato")}
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => e.stopPropagation()}
          onChange={onToggleDone}
        />
        <span className="card-titolo">{task.title}</span>
      </div>
      {task.description && (
        <p className="card-descrizione">{task.description.replace(/<[^>]+>/g, " ")}</p>
      )}
      <div className="card-piede">
        <Scadenza task={task} oggi={oggi} />
        {task.assignee && <span>· {task.assignee.name}</span>}
        {task.archived && <span style={{ fontStyle: "italic" }}>· {t("archiviato")}</span>}
      </div>
    </div>
  );
}
