// Copyright (c) 2026 Jugaad s.r.l.
// SPDX-License-Identifier: AGPL-3.0-only

import { useState } from "react";
import { useTranslation } from "react-i18next";
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  useDraggable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import { SortableContext, horizontalListSortingStrategy } from "@dnd-kit/sortable";
import { Glasses, GripVertical, ListTodo, Receipt } from "lucide-react";
import type { DealListItem, DealStage } from "@kancrm/shared";
import { cn } from "@/lib/utils";
import { useMoney } from "@/lib/money";
import { useContextMenu } from "@/components/ui/context-menu";
import { pointerFirstCollision } from "@/lib/dnd";
import { formatDate, todayISO } from "@/features/tasks/task-utils";
import { ProssimoPasso } from "./NextStep";
import {
  applyColumnOrder,
  reorderColumns,
  useColumnOrder,
  useSortableColumn,
} from "../kanban/useColumnOrder";
import { ColumnDragPreview } from "../kanban/ColumnDragPreview";
import { CardDragPreview } from "../kanban/CardDragPreview";
import { COLLAPSED_COLUMN_CLASS, CollapsedColumn } from "../kanban/CollapsedColumn";
import { useDealMenu } from "./useDealMenu";
import { useUpdateDeal } from "./useDeals";
import { LostReasonDialog } from "./LostReasonDialog";

/** Vista kanban delle offerte: colonne per fase, drag delle card e delle colonne. */
export function DealPipeline({
  deals,
  stages,
  onOpen,
}: {
  deals: DealListItem[];
  stages: DealStage[];
  onOpen: (id: string) => void;
}) {
  const updateDeal = useUpdateDeal();
  const money = useMoney();
  const { open, menu } = useContextMenu();
  const { items: dealMenu, node: quickTaskNode } = useDealMenu(onOpen);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));
  const [pendingLost, setPendingLost] = useState<{ deal: DealListItem; stageId: string } | null>(
    null,
  );
  const [activeStage, setActiveStage] = useState<DealStage | null>(null);
  /**
   * L'offerta che si sta trascinando, per disegnarla nel `DragOverlay`.
   *
   * Senza, a muoversi era la card **dove sta**, con una `transform`: ma la sua
   * colonna scorre per conto suo e quindi **ritaglia**, così la si vedeva
   * tagliata a metà e scivolare *sotto* le fasi accanto invece che sopra
   * (21/08/2026). L'overlay la disegna fuori da tutti i riquadri. È la stessa
   * correzione già fatta sulla bacheca dei task.
   */
  const [activeDeal, setActiveDeal] = useState<DealListItem | null>(null);

  // Ordine colonne personale dell'utente per la kanban delle offerte.
  const { orders, setOrder } = useColumnOrder();
  const savedOrder = orders["deal"];
  const orderedStages = applyColumnOrder(stages, savedOrder);
  const stageIds = orderedStages.map((s) => s.id);

  const onDragStart = (event: DragStartEvent) => {
    if (event.active.data.current?.type === "column") {
      setActiveStage(orderedStages.find((s) => s.id === event.active.id) ?? null);
      return;
    }
    setActiveDeal(deals.find((d) => d.id === event.active.id) ?? null);
  };

  const onDragEnd = (event: DragEndEvent) => {
    setActiveStage(null);
    setActiveDeal(null);
    const { active, over } = event;
    if (!over) return;
    // Riordino colonne (fasi).
    if (active.data.current?.type === "column") {
      if (active.id !== over.id) {
        setOrder("deal", reorderColumns(stageIds, String(active.id), String(over.id)));
      }
      return;
    }
    // Spostamento di un'offerta tra fasi.
    const dealId = String(active.id);
    const stageId = String(over.id);
    const deal = deals.find((d) => d.id === dealId);
    // Solo il proprietario può spostare l'offerta di fase.
    if (!deal || !deal.canEdit || deal.stage.id === stageId) return;
    const targetStage = stages.find((s) => s.id === stageId);
    // Fase "Persa": chiedi il motivo prima di spostare.
    if (targetStage?.isLost) {
      setPendingLost({ deal, stageId });
      return;
    }
    // Fase "Vinta": non si chiede niente qui. L'offerta va in lettura e le
    // domande — cosa fatturare, cosa diventa progetto — arrivano con la
    // proposta, quando c'è davanti qualcosa su cui rispondere.
    updateDeal.mutate({ id: dealId, stageId });
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
        setActiveStage(null);
        setActiveDeal(null);
      }}
      onDragEnd={onDragEnd}
    >
      <SortableContext items={stageIds} strategy={horizontalListSortingStrategy}>
        {/*
          **La barra orizzontale in fondo alla finestra, non a metà pagina.**
          Senza `h-full`/`min-h-0` le colonne sono alte quanto il loro contenuto:
          la bacheca cresce, la pagina scorre in verticale e la barra per andare
          alla colonna successiva finisce a mezz'aria — o fuori schermo quando
          una colonna è piena. Con l'altezza legata alla finestra scorre ogni
          colonna per conto suo, e la barra resta dov'è naturale cercarla.
          Stessa correzione della bacheca dei task (20/08/2026).
        */}
        <div data-bacheca="offerte" className="flex h-full min-h-0 gap-4 overflow-x-auto pb-2">
          {orderedStages.map((stage) => (
            <PipelineColumn
              key={stage.id}
              stage={stage}
              deals={deals.filter((d) => d.stage.id === stage.id)}
              onOpen={onOpen}
              onContext={(e, deal) => open(e, dealMenu(deal))}
            />
          ))}
        </div>
      </SortableContext>
      <DragOverlay>
        {activeStage ? (
          <ColumnDragPreview name={activeStage.name} color={activeStage.color} />
        ) : activeDeal ? (
          <CardDragPreview
            title={activeDeal.title}
            subtitle={
              [activeDeal.company?.name, activeDeal.contact?.name].filter(Boolean).join(" · ") ||
              null
            }
            meta={activeDeal.dealValue !== null ? money.format(activeDeal.dealValue) : null}
          />
        ) : null}
      </DragOverlay>
      {quickTaskNode}
      {menu}
      <LostReasonDialog
        open={pendingLost !== null}
        dealTitle={pendingLost?.deal.title ?? ""}
        onCancel={() => setPendingLost(null)}
        onConfirm={(reason) => {
          if (pendingLost) {
            updateDeal.mutate({
              id: pendingLost.deal.id,
              stageId: pendingLost.stageId,
              lostReason: reason,
            });
          }
          setPendingLost(null);
        }}
      />
    </DndContext>
  );
}

function PipelineColumn({
  stage,
  deals,
  onOpen,
  onContext,
}: {
  stage: DealStage;
  deals: DealListItem[];
  onOpen: (id: string) => void;
  onContext: (e: React.MouseEvent, deal: DealListItem) => void;
}) {
  const { t } = useTranslation();
  const money = useMoney();
  const { setNodeRef, style, isDragging, isOver, handleProps } = useSortableColumn(stage.id);
  const total = deals.reduce((sum, d) => sum + (d.dealValue ?? 0), 0);
  // Valore pesato: Σ valore × probabilità.
  const weighted = deals.reduce(
    (sum, d) => sum + ((d.dealValue ?? 0) * (d.probability ?? 0)) / 100,
    0,
  );

  // Fase senza offerte: si riduce a striscia come nella kanban dei task, così le
  // fasi che contengono qualcosa hanno spazio. Resta bersaglio di rilascio.
  const collapsed = deals.length === 0;

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
          ? t("{{name}} — nessuna offerta, trascina qui per spostarcene una", { name: stage.name })
          : undefined
      }
      className={cn(
        // `h-full`: colonne tutte alte uguali — ed è anche il bersaglio più
        // grande su cui lasciar cadere un'offerta.
        "flex h-full min-h-0 shrink-0 flex-col gap-2 rounded-lg border bg-muted/30 p-3 transition-colors",
        collapsed ? COLLAPSED_COLUMN_CLASS : "w-72",
        isOver && "border-ring bg-accent",
        isDragging && "opacity-40",
      )}
    >
      {collapsed ? (
        <CollapsedColumn name={stage.name} color={stage.color} grip={grip} />
      ) : (
        <>
          <div className="px-1">
            <div className="flex items-center justify-between gap-1">
              <span
                className="inline-flex min-w-0 items-center gap-1.5 text-sm font-semibold"
                style={{ color: stage.color }}
              >
                {grip}
                <span
                  className="size-2.5 shrink-0 rounded-full"
                  style={{ backgroundColor: stage.color }}
                />
                <span className="truncate">{stage.name}</span>
              </span>
              <span className="text-xs text-muted-foreground">{deals.length}</span>
            </div>
            <p className="mt-0.5 text-xs text-muted-foreground">
              {money.format(total)} · {t("pesato")} {money.format(weighted)}
            </p>
          </div>
          {/* Scorre la colonna, non la pagina: `min-h-0` perché in una colonna
            flex il figlio non scende sotto il proprio contenuto senza. */}
          <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto pr-0.5">
            {deals.map((deal) => (
              <PipelineCard key={deal.id} deal={deal} onOpen={onOpen} onContext={onContext} />
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function PipelineCard({
  deal,
  onOpen,
  onContext,
}: {
  deal: DealListItem;
  onOpen: (id: string) => void;
  onContext: (e: React.MouseEvent, deal: DealListItem) => void;
}) {
  const { t } = useTranslation();
  const money = useMoney();
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: deal.id,
    // Le offerte non proprie sono consultabili ma non trascinabili.
    disabled: !deal.canEdit,
  });
  return (
    <div
      ref={setNodeRef}
      {...(deal.canEdit ? listeners : {})}
      {...attributes}
      className={cn(
        // Niente `transform` mentre si trascina: a muoversi è l'anteprima
        // nel `DragOverlay`, che non è ritagliata dalla colonna.
        "rounded-md border bg-card p-3 text-sm shadow-sm transition-shadow hover:shadow",
        deal.canEdit ? "cursor-grab" : "cursor-pointer",
        isDragging && "opacity-40",
      )}
      onClick={() => onOpen(deal.id)}
      onContextMenu={(e) => onContext(e, deal)}
    >
      <p className="font-medium leading-snug">
        {/* Come nell'elenco: il simbolo si spiega da sé solo a chi l'ha già visto. */}
        {deal.billingTaskId && (
          <span title={t("Task di fatturazione generato nello Scadenzario.")}>
            <Receipt
              className="mr-1 inline size-3 text-muted-foreground"
              aria-label={t("Task di fatturazione generato nello Scadenzario.")}
            />
          </span>
        )}
        {deal.visibleToSalesMonitors && (
          <span title={t("Visibile ai monitor vendite")}>
            <Glasses
              className="mr-1 inline size-3 text-sky-600 dark:text-sky-400"
              aria-label={t("Visibile ai monitor vendite")}
            />
          </span>
        )}
        {deal.title}
      </p>
      <p className="mt-1 truncate text-xs text-muted-foreground">
        {[deal.company?.name, deal.contact?.name].filter(Boolean).join(" · ") || "—"}
      </p>
      <div className="mt-1.5 flex items-center justify-between text-xs">
        <span className="font-medium">
          {deal.dealValue !== null ? money.format(deal.dealValue) : "—"}
        </span>
        <span className="flex items-center gap-2 text-muted-foreground">
          {deal.openTaskCount > 0 && (
            <span
              className="inline-flex items-center gap-0.5"
              title={t("{{count}} task collegati aperti", { count: deal.openTaskCount })}
            >
              <ListTodo className="size-3" /> {deal.openTaskCount}
            </span>
          )}
          {deal.probability !== null ? `${deal.probability}%` : ""}
          {deal.expectedCloseDate ? ` · ${formatDate(deal.expectedCloseDate)}` : ""}
        </span>
      </div>
      {/* Il prossimo passo, anche sulla card: la tabella e la pipeline dicono lo stesso. */}
      <div className="mt-1 flex min-w-0 text-xs">
        <ProssimoPasso
          passo={deal.nextStep}
          conclusa={deal.stage.isWon || deal.stage.isLost}
          oggi={todayISO()}
          altri={Math.max(0, deal.openTaskCount - 1)}
          compatto
        />
      </div>
    </div>
  );
}
