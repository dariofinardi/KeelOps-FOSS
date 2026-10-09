import { useState, type ReactNode } from "react";
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragOverEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import {
  AlertTriangle,
  Bell,
  CalendarCheck,
  CalendarClock,
  CalendarOff,
  Gauge,
  HandCoins,
  Inbox,
  LifeBuoy,
  ListTodo,
} from "lucide-react";
import type { Dashboard } from "@kancrm/shared";
import { api } from "@/lib/api";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { useContextMenu } from "@/components/ui/context-menu";
import { Skeleton, SkeletonRows } from "@/components/ui/skeleton";
import { useCurrentUser } from "@/features/auth/useAuth";
import { useMoney } from "@/lib/money";
import { NotificationPanel } from "@/features/notifications/NotificationBell";
import { Cornice, usePluginEntries } from "@/features/plugins/PluginPanel";
import { iconaDelPlugin } from "@/features/plugins/plugin-icon";
import { useNotifications } from "@/features/notifications/useNotifications";
import { StatusBadge } from "@/features/tasks/StatusBadge";
import { CompanyChip, ContactChip, ContextLine } from "@/features/tasks/TaskContext";
import { TaskContext } from "@/features/tasks/TaskContext";
import { useRecordOpener } from "@/features/tasks/useRecordOpener";
import { useUpdateTask } from "@/features/tasks/useTasks";
import { useListPrefs } from "@/lib/useListPrefs";
import { useTaskMenuItems } from "@/features/tasks/useTaskMenu";
import { PriorityBadge } from "@/features/tasks/priority-badge";
import { formatDate } from "@/features/tasks/task-utils";
import { ViewSwitch, type ViewOption } from "@/components/ui/view-switch";
import { DevMetricsPanel } from "./DevMetricsPanel";
import { statusListLink, statusModuleLabel } from "./status-links";
import { TaskGroup, listaDaPreferenza, type ListaGiornata } from "./TaskGroup";
import { usePluginGroups } from "@/features/plugins/usePluginGroups";
import { chipRiepilogo } from "./chip";
import { DashboardPanel } from "./DashboardPanel";
import {
  RIQUADRI_DI_SERIE,
  chiudiRiquadro,
  colonnaDi,
  normalizzaLayout,
  riordinaRiquadri,
  spostaRiquadro,
  type ColonnaGiornata,
  type LayoutGiornata,
} from "./layout";

/**
 * Le due letture della giornata: **il lavoro** (le scadenze, la coda, le
 * offerte) e **l'andamento** (i numeri dell'area tecnica). Non è "i contatori":
 * quello che si guarda qui non è un totale ma come si muove il lavoro nel
 * tempo — e la scorciatoia resta una lettera, come in ogni altro modulo.
 */
const DASHBOARD_VIEWS: Array<ViewOption<"tasks" | "metrics">> = [
  { value: "tasks", label: "I task", icon: ListTodo, key: "t" },
  { value: "metrics", label: "L'andamento", icon: Gauge, key: "a" },
];

/** Di chi sono le offerte nel riepilogo: le mie, o quelle dei colleghi. */
type OfferteDiChi = "mine" | "others";

/**
 * La disposizione di serie, con una migrazione: prima del 07/09/2026 l'unico
 * riquadro richiudibile era «Senza scadenza» e il suo stato stava in
 * `kancrm-dashboard-sections`; chi l'aveva aperto se lo ritrova aperto.
 */
function layoutDiSerie(): LayoutGiornata {
  try {
    const raw = localStorage.getItem("kancrm-dashboard-sections");
    if (raw) {
      const vecchio = JSON.parse(raw) as { noDueDate?: unknown };
      if (typeof vecchio.noDueDate === "boolean")
        return { ...RIQUADRI_DI_SERIE, chiusi: { noDueDate: !vecchio.noDueDate } };
    }
  } catch {
    // preferenza illeggibile: si parte da quella di serie
  }
  return RIQUADRI_DI_SERIE;
}

/** Una colonna della giornata: un bersaglio per i riquadri che arrivano dall'altra. */
function Colonna({
  id,
  items,
  children,
}: {
  id: ColonnaGiornata;
  items: string[];
  children: ReactNode;
}) {
  const { setNodeRef } = useDroppable({ id: `colonna:${id}` });
  return (
    <section ref={setNodeRef} className="flex min-w-0 flex-col gap-3" data-colonna={id}>
      <SortableContext items={items} strategy={verticalListSortingStrategy}>
        {children}
      </SortableContext>
    </section>
  );
}

function useDashboard() {
  return useQuery({
    queryKey: ["dashboard"],
    queryFn: () => api<Dashboard>("/api/dashboard"),
    refetchInterval: 5 * 60_000,
  });
}

export function DashboardPage() {
  const { t } = useTranslation();
  const currentUser = useCurrentUser();
  const money = useMoney();
  const navigate = useNavigate();
  /**
   * La scelta si ricorda, come ogni filtro dell'applicazione (CLAUDE.md): chi
   * guarda le offerte dei colleghi di solito lo rifà anche domani.
   */
  const { prefs: perOfferte, update: setOfferte } = useListPrefs("kancrm-dashboard-offerte", {
    di: "mine" as OfferteDiChi,
  });
  const offerte = perOfferte.di;
  const { data, isLoading } = useDashboard();
  // Le due liste arrivano insieme: cambiare pastiglia non torna al server.
  const offerteMostrate =
    offerte === "others" ? (data?.openDeals.others ?? []) : (data?.openDeals.mine ?? []);
  const { data: notifications } = useNotifications();
  const updateTask = useUpdateTask();
  const { open, menu } = useContextMenu();
  // Le notifiche rimandano anche alle offerte: apre il pannello giusto.
  const record = useRecordOpener();
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  // Stesse azioni del tasto destro che si hanno negli elenchi: dalla dashboard si
  // prende in carico o si completa senza dover prima aprire il task.
  const taskMenu = useTaskMenuItems(record.openTask);
  // Ogni sezione delle scadenze ricorda quale lista si stava guardando
  // (miei / supervisionati), come tutti i filtri dell'applicazione.
  // (miei / supervisionati / personali): il valore è la lista, e le preferenze
  // scritte come booleano prima della terza pastiglia si leggono ancora.
  const { prefs: watch, update: setWatch } = useListPrefs("kancrm-dashboard-watch", {
    overdue: "mine" as ListaGiornata | boolean,
    dueToday: "mine" as ListaGiornata | boolean,
    dueTomorrow: "mine" as ListaGiornata | boolean,
    nextDays: "mine" as ListaGiornata | boolean,
    noDueDate: "mine" as ListaGiornata | boolean,
  });
  // Le card dei plugin nei gruppi della giornata (Personale): i numeri delle pastiglie.
  const { conteggi: personali } = usePluginGroups();
  // La vista scelta si ricorda, come ogni altro filtro dell'applicazione. Chi
  // perde il permesso torna ai task: la preferenza resta scritta, ma non può
  // tenere aperta una vista che il server non serve più.
  const { prefs: viewPref, update: setViewPref } = useListPrefs("kancrm-dashboard-view", {
    view: "tasks" as "tasks" | "metrics",
  });
  const view = currentUser.canSeeDevMetrics ? viewPref.view : "tasks";
  const setView = (value: "tasks" | "metrics") => setViewPref({ view: value });
  /**
   * La disposizione dei riquadri — quale colonna, in che ordine, quali chiusi —
   * si ricorda nel browser (layout.ts). I riquadri dei plugin entrano con il
   * loro nome; quelli che dicono di essere vuoti non si disegnano ma restano
   * al loro posto.
   */
  const { prefs: layoutPrefs, update: setLayoutPrefs } = useListPrefs(
    "kancrm-dashboard-layout",
    layoutDiSerie(),
  );
  const plugins = usePluginEntries("dashboard");
  const [vuoti, setVuoti] = useState<Record<string, boolean>>({});
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  if (isLoading || !data) {
    return <DashboardSkeleton />;
  }

  const idPlugin = (nome: string) => `plugin:${nome}`;
  const conosciuti = [
    ...RIQUADRI_DI_SERIE.sinistra,
    ...RIQUADRI_DI_SERIE.destra,
    ...plugins.map((plugin) => idPlugin(plugin.nome)),
  ];
  const layout = normalizzaLayout(layoutPrefs, conosciuti);
  const salva = (prossimo: LayoutGiornata) => setLayoutPrefs(prossimo);
  const chiuso = (id: string) => layout.chiusi[id] === true;
  const chiudi = (id: string) => (valore: boolean) => salva(chiudiRiquadro(layout, id, valore));

  const onDragOver = ({ active, over }: DragOverEvent) => {
    if (!over) return;
    const attivo = String(active.id);
    const sopra = String(over.id);
    const da = colonnaDi(layout, attivo);
    const [target, primaDi]: [ColonnaGiornata | null, string | null] = sopra.startsWith("colonna:")
      ? [sopra.slice("colonna:".length) as ColonnaGiornata, null]
      : [colonnaDi(layout, sopra), sopra];
    if (!target || target === da) return;
    salva(spostaRiquadro(layout, attivo, target, primaDi));
  };
  const onDragEnd = ({ active, over }: DragEndEvent) => {
    if (!over) return;
    const attivo = String(active.id);
    const sopra = String(over.id);
    if (sopra.startsWith("colonna:") || attivo === sopra) return;
    if (colonnaDi(layout, attivo) === colonnaDi(layout, sopra))
      salva(riordinaRiquadri(layout, attivo, sopra));
  };

  const gruppo = (
    id: "overdue" | "dueToday" | "dueTomorrow" | "nextDays" | "noDueDate",
    chiave: "overdue" | "today" | "tomorrow" | "next" | "none",
    title: string,
    icon: ReactNode,
    emptyText: string,
    tone?: "danger",
  ) => (
    <TaskGroup
      key={id}
      id={id}
      title={title}
      icon={icon}
      tone={tone}
      section={data[id]}
      lista={listaDaPreferenza(watch[id])}
      onLista={(value) => setWatch({ [id]: value })}
      gruppo={chiave}
      personali={personali?.[chiave] ?? null}
      collapsed={chiuso(id)}
      onCollapsed={chiudi(id)}
      emptyText={emptyText}
      onOpen={record.openTask}
      onContext={(e, task) => open(e, taskMenu(task))}
    />
  );
  const nonVuoto = (id: "dueTomorrow" | "nextDays" | "noDueDate") =>
    data[id].mine.length + data[id].supervised.length > 0;

  /** Ogni riquadro: quando c'è, e come si disegna. La disposizione decide dove. */
  const riquadri: Record<string, { visibile: boolean; render: () => ReactNode }> = {
    overdue: {
      visibile: true,
      render: () =>
        gruppo(
          "overdue",
          "overdue",
          t("In ritardo"),
          <AlertTriangle className="size-4 text-destructive" />,
          t("Nessun task in ritardo. Ottimo!"),
          "danger",
        ),
    },
    dueToday: {
      visibile: true,
      render: () =>
        gruppo(
          "dueToday",
          "today",
          t("In scadenza oggi"),
          <CalendarCheck className="size-4 text-amber-600" />,
          t("Niente in scadenza oggi."),
        ),
    },
    // Domani e i giorni dopo: solo se c'è qualcosa, per non allungare la
    // pagina con riquadri vuoti tutti i giorni.
    dueTomorrow: {
      visibile: nonVuoto("dueTomorrow"),
      render: () =>
        gruppo(
          "dueTomorrow",
          "tomorrow",
          t("Domani"),
          <CalendarClock className="size-4 text-muted-foreground" />,
          "",
        ),
    },
    nextDays: {
      visibile: nonVuoto("nextDays"),
      render: () =>
        gruppo(
          "nextDays",
          "next",
          t("Prossimi giorni"),
          <CalendarClock className="size-4 text-muted-foreground" />,
          "",
        ),
    },
    // Senza scadenza: non è "la giornata", ma un lavoro che si segue non
    // deve sparire solo perché nessuno gli ha messo una data.
    noDueDate: {
      visibile: nonVuoto("noDueDate"),
      render: () =>
        gruppo(
          "noDueDate",
          "none",
          t("Senza scadenza"),
          <CalendarOff className="size-4 text-muted-foreground" />,
          "",
        ),
    },
    byStatus: {
      visibile: true,
      render: () => (
        <DashboardPanel
          key="byStatus"
          id="byStatus"
          title={t("I miei task per stato")}
          icon={<ListTodo className="size-4" />}
          collapsed={chiuso("byStatus")}
          onCollapsed={chiudi("byStatus")}
        >
          <div className="flex flex-wrap gap-2">
            {data.myTasksByStatus.map((status) => {
              // Lo stesso nome può ricorrere in moduli diversi ("Da contattare"
              // su un'offerta e su un task dello scadenzario) o in categorie
              // diverse ("Da fare" in Sviluppo e in Generali): l'etichetta del
              // modulo compare solo quando serve a distinguere, e dice anche
              // dove porta il clic.
              const ambiguous =
                data.myTasksByStatus.filter((other) => other.name === status.name).length > 1;
              const target = statusListLink(status);
              return (
                <button
                  key={`${status.kind}-${status.id}`}
                  type="button"
                  className="inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-sm transition-colors hover:bg-muted/60"
                  style={{ borderColor: status.color }}
                  title={`Apri i tuoi task in "${status.name}"`}
                  onClick={() => navigate(target)}
                >
                  <span className="size-2 rounded-full" style={{ backgroundColor: status.color }} />
                  {status.name}
                  {ambiguous && (
                    <span className="text-xs text-muted-foreground">
                      {statusModuleLabel(status.kind)}
                    </span>
                  )}
                  <span className="font-semibold">{status.count}</span>
                </button>
              );
            })}
            {data.myTasksByStatus.length === 0 && (
              <p className="text-sm text-muted-foreground">{t("Nessun task assegnato a te.")}</p>
            )}
          </div>
        </DashboardPanel>
      ),
    },
    // In alto a destra di serie: è la coda condivisa, la si vede appena si apre la pagina.
    unassigned: {
      visibile: data.unassignedTasks.length > 0,
      render: () => (
        <DashboardPanel
          key="unassigned"
          id="unassigned"
          title={`${t("Da prendere in carico")} (${data.unassignedTasks.length})`}
          icon={<Inbox className="size-4" />}
          collapsed={chiuso("unassigned")}
          onCollapsed={chiudi("unassigned")}
        >
          <ul className="flex flex-col gap-1.5">
            {data.unassignedTasks.map((task) => (
              <li key={task.id} className="flex min-w-0 items-center gap-2">
                <button
                  // Come le altre righe: sul telefono il titolo prende la
                  // riga e stato e data vanno sotto.
                  className="flex min-w-0 flex-1 flex-wrap items-center gap-x-2 gap-y-1 rounded-md border px-3 py-2 text-left text-sm hover:bg-muted/40"
                  onClick={() => record.openTask(task.id)}
                  onContextMenu={(e) => open(e, taskMenu(task))}
                >
                  <span className="flex w-full min-w-0 flex-col sm:w-auto sm:flex-1">
                    <span className="truncate font-medium">{task.title}</span>
                    <TaskContext task={task} />
                  </span>
                  <StatusBadge status={task.status} />
                  <span className="ml-auto shrink-0 text-right text-xs text-muted-foreground sm:ml-0">
                    {task.dueDate ? formatDate(task.dueDate) : ""}
                  </span>
                </button>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={updateTask.isPending}
                  onClick={() => updateTask.mutate({ id: task.id, assigneeId: currentUser.id })}
                  title={t("Assegna a me")}
                >
                  {t("Prendi")}
                </Button>
              </li>
            ))}
          </ul>
        </DashboardPanel>
      ),
    },
    deals: {
      visibile: currentUser.canSeeDeals,
      render: () => (
        <DashboardPanel
          key="deals"
          id="deals"
          title={t("Offerte in corso")}
          icon={<HandCoins className="size-4" />}
          collapsed={chiuso("deals")}
          onCollapsed={chiudi("deals")}
          // Le stesse pastiglie dei task, non una tendina: è il modo in cui
          // questa pagina fa questa domanda. «Tutte» non c'è apposta — la
          // pipeline dell'azienda si guarda dalla pagina Offerte (04/09/2026).
          chips={
            <>
              <button
                type="button"
                className={chipRiepilogo(offerte === "mine")}
                title={t("Le offerte che segui tu")}
                onClick={() => setOfferte({ di: "mine" })}
              >
                {t("Le mie")} ({data.openDeals.mineTotal})
              </button>
              <button
                type="button"
                className={chipRiepilogo(offerte === "others")}
                title={t("Le offerte seguite dai colleghi")}
                onClick={() => setOfferte({ di: "others" })}
              >
                {t("Degli altri")} ({data.openDeals.othersTotal})
              </button>
            </>
          }
        >
          <ul className="flex flex-col gap-1.5">
            {offerteMostrate.map((deal) => (
              <li key={deal.id}>
                <button
                  // Stessa riga dei task: titolo e, sotto, azienda e
                  // interlocutore; su schermo stretto valore, fase e data
                  // vanno a capo (05/09/2026).
                  className="flex w-full flex-wrap items-center gap-x-2 gap-y-1 rounded-md border px-3 py-2 text-left text-sm hover:bg-muted/40"
                  onClick={() => record.open(deal.id, "DEAL")}
                >
                  <span className="flex w-full min-w-0 flex-col sm:w-auto sm:flex-1">
                    <span className="truncate font-medium">{deal.title}</span>
                    {(deal.company || deal.contact) && (
                      <ContextLine>
                        {deal.company && <CompanyChip name={deal.company.name} />}
                        {deal.contact && <ContactChip name={deal.contact.name} />}
                      </ContextLine>
                    )}
                  </span>
                  {deal.dealValue !== null && (
                    <span className="text-xs text-muted-foreground">
                      {money.format(deal.dealValue)}
                    </span>
                  )}
                  <Badge variant="outline" style={{ color: deal.stageColor }}>
                    {deal.stageName}
                  </Badge>
                  {deal.expectedCloseDate && (
                    <span className="w-16 text-right text-xs text-muted-foreground">
                      {formatDate(deal.expectedCloseDate)}
                    </span>
                  )}
                </button>
              </li>
            ))}
            {offerteMostrate.length === 0 && (
              <p className="text-sm text-muted-foreground">{t("Nessuna offerta aperta.")}</p>
            )}
          </ul>
        </DashboardPanel>
      ),
    },
    tickets: {
      visibile: currentUser.canManageTickets && data.openTickets.length > 0,
      render: () => (
        <DashboardPanel
          key="tickets"
          id="tickets"
          title={t("Ticket in attesa")}
          icon={<LifeBuoy className="size-4" />}
          collapsed={chiuso("tickets")}
          onCollapsed={chiudi("tickets")}
        >
          <ul className="flex flex-col gap-1.5">
            {data.openTickets.map((ticket) => (
              <li key={ticket.id}>
                <button
                  className="flex w-full items-center gap-2 rounded-md border px-3 py-2 text-left text-sm hover:bg-muted/40"
                  onClick={() => navigate("/ticket")}
                >
                  <span className="min-w-0 flex-1 truncate font-medium">{ticket.title}</span>
                  <span className="hidden text-xs text-muted-foreground sm:block">
                    {ticket.requesterName}
                  </span>
                  <PriorityBadge priority={ticket.priority} />
                </button>
              </li>
            ))}
          </ul>
        </DashboardPanel>
      ),
    },
  };
  // I riquadri dei plugin (le bacheche personali, 05/09/2026): la pagina del
  // plugin dentro un riquadro come gli altri; se dice di essere vuota, sparisce.
  for (const plugin of plugins) {
    const id = idPlugin(plugin.nome);
    const Icona = iconaDelPlugin(plugin);
    riquadri[id] = {
      visibile: vuoti[plugin.nome] !== true,
      render: () => (
        <DashboardPanel
          key={id}
          id={id}
          title={t(plugin.voce)}
          icon={<Icona className="size-4" />}
          collapsed={chiuso(id)}
          onCollapsed={chiudi(id)}
        >
          <Cornice
            nome={plugin.nome}
            titolo={plugin.voce}
            anchor="dashboard"
            senzaTitolo
            onVuoto={(vuoto) =>
              setVuoti((prev) =>
                prev[plugin.nome] === vuoto ? prev : { ...prev, [plugin.nome]: vuoto },
              )
            }
          />
        </DashboardPanel>
      ),
    };
  }

  return (
    <div className="flex flex-col gap-6">
      {/* Il pulsante va a capo sul telefono invece di schiacciare il saluto. */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold">
            {t("Ciao {{name}} 👋", {
              name: currentUser.nickName ?? currentUser.name.split(" ")[0],
            })}
          </h2>
          <p className="text-sm text-muted-foreground">
            {t("Hai {{count}} task aperti", { count: data.myOpenTaskCount })}
            {data.overdue.mine.length > 0 &&
              t(", di cui {{count}} in ritardo", { count: data.overdue.mine.length })}
            .
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {/* Il selettore sta a sinistra delle notifiche: sono due cose
              diverse — questa cambia la pagina, quella apre un pannello.
              Compare solo a chi lavora nell'area tecnica o la governa. */}
          {currentUser.canSeeDevMetrics && (
            <ViewSwitch options={DASHBOARD_VIEWS} value={view} onChange={(v) => setView(v)} />
          )}
          {/* Le notifiche non occupano più un riquadro fisso: si aprono da qui,
              nello stesso pannello della campanella in alto. */}
          <Button variant="outline" onClick={() => setNotificationsOpen(true)}>
            <Bell className="size-4" /> {t("Notifiche")}
            {(notifications?.unreadCount ?? 0) > 0 && (
              <span className="ml-1 rounded-full bg-destructive px-1.5 text-xs font-semibold text-destructive-foreground">
                {notifications!.unreadCount > 9 ? "9+" : notifications!.unreadCount}
              </span>
            )}
          </Button>
        </div>
      </div>

      {view === "metrics" && <DevMetricsPanel />}

      {/*
        `min-w-0` sulle due colonne: un elemento di griglia ha `min-width: auto`,
        cioè non scende MAI sotto la larghezza minima del suo contenuto — una
        riga con titolo, pastiglia e data la portava a 534px su uno schermo da
        390, ed è da lì che nasceva la barra di scorrimento orizzontale della
        dashboard sul telefono (16/08/2026).
      */}
      {view === "tasks" && (
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragOver={onDragOver}
          onDragEnd={onDragEnd}
        >
          <div className="grid gap-6 lg:grid-cols-2">
            {(["sinistra", "destra"] as const).map((colonna) => {
              const visibili = layout[colonna].filter((id) => riquadri[id]?.visibile);
              return (
                <Colonna key={colonna} id={colonna} items={visibili}>
                  {visibili.map((id) => riquadri[id]!.render())}
                </Colonna>
              );
            })}
          </div>
        </DndContext>
      )}

      {/* Finestra delle notifiche: stesso pannello della campanella. */}
      <Dialog
        open={notificationsOpen}
        onClose={() => setNotificationsOpen(false)}
        title={t("Notifiche")}
        // Lo spazio c'è: i testi delle notifiche andavano a capo tre volte
        // dentro una finestra stretta (24/08/2026).
        size="lg"
      >
        <div className="-m-4">
          <NotificationPanel
            onOpenRecord={(notification) => {
              setNotificationsOpen(false);
              record.openNotification(notification);
            }}
          />
        </div>
      </Dialog>
      {/* Un solo paio di pannelli, con dentro anche il TicketDrawer: la
          dashboard prima ne teneva una seconda copia con stato locale, e due
          pannelli potevano aprirsi insieme (un task dalla lista, uno da una
          notifica) con l'Esc che chiudeva quello sbagliato. */}
      {record.node}
      {menu}
    </div>
  );
}

function DashboardSkeleton() {
  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-2">
        <Skeleton className="h-7 w-48" />
        <Skeleton className="h-4 w-64" />
      </div>
      <div className="grid gap-6 lg:grid-cols-2">
        {[0, 1].map((col) => (
          <div key={col} className="flex flex-col gap-3">
            {[0, 1].map((card) => (
              <div key={card} className="rounded-lg border bg-card p-4">
                <Skeleton className="mb-3 h-4 w-32" />
                <SkeletonRows rows={3} />
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
