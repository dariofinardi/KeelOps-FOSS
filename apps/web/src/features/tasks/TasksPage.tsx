import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { PluginMenu } from "@/features/plugins/PluginMenu";
import { useSearchParams } from "react-router-dom";
import {
  CalendarDays,
  CheckCircle2,
  Download,
  FilterX,
  Kanban,
  Plus,
  Repeat,
  Table2,
} from "lucide-react";
import {
  ACTIVITY_CATEGORY_ORDER,
  ActivityCategory,
  UserRole,
  type SortDir,
  type TaskSortBy,
  hideClosedTasks,
} from "@kancrm/shared";
import { useCurrentUser } from "@/features/auth/useAuth";
import { assigneeOptions } from "./assignee-options";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { useCreateAreaMenu } from "@/components/ui/context-menu";
import { PaginationBar } from "@/components/ui/pagination";
import { ViewSwitch, type ViewOption } from "@/components/ui/view-switch";
import { SkeletonRows } from "@/components/ui/skeleton";
import { TemplatesView } from "@/features/recurrence/TemplatesView";
import { AgendaView } from "./AgendaView";
import { NewTaskDialog } from "./NewTaskDialog";
import { AreaPicker } from "./AreaPicker";
import { Combobox } from "@/components/ui/combobox";
import { FILTER_ICONS, FilterSelect } from "@/components/ui/filter-select";
import { MobileFilters } from "@/components/ui/mobile-filters";
import { DueRangeSelect } from "./DueRangeSelect";
import { TaskDetailDrawer } from "./TaskDetailDrawer";
import { TaskKanban } from "./TaskKanban";
import { TaskTable } from "./TaskTable";
import { ResetColumnOrder } from "../kanban/ResetColumnOrder";
import { useTaskStatuses, useTasks } from "./useTasks";
import { TASK_SORT_OPTIONS, activeFilterCount, invalidFilters, taskExportQuery } from "./filters";
import { useListPrefs } from "@/lib/useListPrefs";
import { useUrlFilterHandoff } from "@/lib/useUrlFilterHandoff";
import { useViewSearch } from "@/lib/view-search";
import { useTags } from "@/features/tags/useTags";

type ViewMode = "agenda" | "table" | "kanban" | "recurrence";

const PREFS_KEY = "kancrm-tasks-prefs";

interface TasksPrefs {
  view: ViewMode;
  /** Categoria di attività mostrata nel kanban (le colonne dipendono da questa). */
  kanbanCategory: ActivityCategory;
  statusId: string;
  assigneeId: string;
  activityTypeId: string;
  tagId: string;
  /** Cliente ("" = tutti): come in Offerte e Progetti. */
  companyId: string;
  /** Area di lavoro in agenda e tabella ("" = tutte); il kanban ha la sua. */
  area: ActivityCategory | "";
  includeClosed: boolean;
  /** Range di scadenza (giorni); null = tutte. */
  dueWithinDays: number | null;
  sortBy?: TaskSortBy;
  sortDir: SortDir;
}

const DEFAULT_PREFS: TasksPrefs = {
  view: "agenda",
  kanbanCategory: ActivityCategory.ADMIN,
  statusId: "",
  assigneeId: "",
  activityTypeId: "",
  tagId: "",
  companyId: "",
  area: "",
  includeClosed: false,
  dueWithinDays: null,
  sortDir: "asc",
};

const VIEW_OPTIONS: Array<ViewOption<ViewMode>> = [
  { value: "agenda", label: "Agenda", icon: CalendarDays, key: "A" },
  { value: "recurrence", label: "Ricorrenze", icon: Repeat, key: "R" },
  { value: "table", label: "Tabella", icon: Table2, key: "T" },
  { value: "kanban", label: "Kanban", icon: Kanban, key: "K" },
];

export function TasksPage() {
  const { t } = useTranslation();
  const currentUser = useCurrentUser();
  const isAdmin = currentUser.role === UserRole.ADMIN;
  // Ogni utente interno può creare un proprio task (personale, di progetto o
  // collegato a un'offerta): il dialog adatta i campi disponibili.
  const canCreate = currentUser.role !== UserRole.PORTAL;
  const { prefs, update, heal, page, setPage, clampPageTo } = useListPrefs(
    PREFS_KEY,
    DEFAULT_PREFS,
  );
  const {
    view,
    kanbanCategory,
    statusId,
    assigneeId,
    activityTypeId,
    tagId,
    companyId,
    area,
    includeClosed,
    dueWithinDays,
    sortBy,
    sortDir,
  } = prefs;
  const [q, setQ] = useState("");
  const [createOpen, setCreateOpen] = useState(false);
  // Tasto destro nello spazio vuoto dell'elenco: crea (sulle righe vince il menu
  // del task).
  const { areaProps, menu: areaMenu } = useCreateAreaMenu(
    t("Nuovo task"),
    canCreate ? () => setCreateOpen(true) : null,
  );
  const viewOptions = VIEW_OPTIONS.map((option) => ({ ...option, label: t(option.label) }));
  // Apertura anche via ?task=<id> (deep-link dai task collegati di un'offerta).
  const [searchParams, setSearchParams] = useSearchParams();
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(() =>
    searchParams.get("task"),
  );
  const taskParam = searchParams.get("task");
  useEffect(() => {
    if (taskParam) setSelectedTaskId(taskParam);
  }, [taskParam]);

  // Deep-link con filtri: ?statusId=<id>&mine=1 (dai badge "I miei task per stato"
  // della dashboard) e ?view=recurrence (dalla ricerca globale).
  // `cliente` come in Offerte e Progetti: adesso che le bacheche hanno il
  // filtro, `/bacheche?cliente=<id>` apre l'elenco già ristretto.
  useUrlFilterHandoff(["statusId", "mine", "view", "cliente"], (values) => {
    const requestedView = VIEW_OPTIONS.some((option) => option.value === values.view)
      ? (values.view as ViewMode)
      : null;
    update({
      ...(values.statusId ? { statusId: values.statusId } : {}),
      ...(values.mine === "1" ? { assigneeId: currentUser.id } : {}),
      ...(values.cliente ? { companyId: values.cliente } : {}),
      // L'elenco filtrato si legge in tabella: agenda e kanban raggruppano altro.
      ...(values.statusId || values.mine || values.cliente ? { view: "table" } : {}),
      ...(requestedView ? { view: requestedView } : {}),
    });
  });

  const closeTask = () => {
    setSelectedTaskId(null);
    if (searchParams.has("task")) {
      searchParams.delete("task");
      setSearchParams(searchParams, { replace: true });
    }
  };

  const setView = (view: ViewMode) => update({ view });

  const onSort = (column: TaskSortBy) =>
    update(
      sortBy === column
        ? { sortDir: sortDir === "asc" ? "desc" : "asc" }
        : { sortBy: column, sortDir: "asc" },
    );

  // Il kanban ha bisogno di tutti gli stati, comprese le colonne vuote: è una
  // cosa diversa dalle tendine dei filtri, che mostrano solo i valori usati.
  const { data: statuses } = useTaskStatuses();
  // I tag servono ancora all'autoguarigione del filtro (il combo sta in topbar).
  const { data: tags } = useTags();

  const isTable = view === "table";
  // La ricerca vive in topbar (campo unico locale/globale): arriva qui già a
  // digitazione ferma — il debounce è UNO, dentro la barra di ricerca.
  const searchSetQ = useCallback(
    (value: string) => {
      setQ(value);
      setPage(1);
    },
    [setPage],
  );
  const searchSetTagId = useCallback((id: string | null) => update({ tagId: id ?? "" }), [update]);
  useViewSearch({
    q,
    setQ: searchSetQ,
    placeholder: t("Cerca nei task…"),
    tag: { tagId, setTagId: searchSetTagId },
  });
  const { data, isLoading } = useTasks({
    q: q || undefined,
    statusId: statusId || undefined,
    assigneeId: assigneeId || undefined,
    activityTypeId: activityTypeId || undefined,
    tagId: tagId || undefined,
    companyId: companyId || undefined,
    // L'area filtra solo agenda e tabella: il kanban riceve tutti i task e
    // disegna le colonne della bacheca scelta (`kanbanCategory`).
    category: (view === "agenda" || view === "table") && area ? area : undefined,
    // Riepilogo completo (11/08/2026): scadenzario PIÙ i task di progetto, così
    // il lavoro tecnico si legge tutto insieme senza entrare progetto per
    // progetto. Ogni riga porta il suo progetto, con la freccia per aprirlo.
    includeProjectTasks: true,
    includeClosed,
    dueWithinDays: dueWithinDays ?? undefined,
    // Agenda e kanban lavorano sull'insieme completo (aperto), la tabella è paginata.
    page: isTable ? page : 1,
    pageSize: isTable ? 50 : 1000,
    // L'ordine scelto vale in tutte e tre le viste: in agenda ordina dentro i
    // gruppi di scadenza, nel kanban dentro le colonne — dove con settantaquattro
    // card "prima i più vecchi" è l'unico modo per non lasciarne indietro.
    sortBy,
    sortDir,
  });
  const tasks = data?.items;
  /**
   * Le aree da offrire: quelle che hanno davvero dei task (facet dal server,
   * esatta e indipendente dai filtri attivi) più quella scelta ora — una
   * tendina che non contiene il proprio valore mostrerebbe un'altra voce, e
   * chi ha scelto un'area poi svuotata non potrebbe più uscirne. Offrire
   * un'area vuota vuol dire promettere task che non ci sono: nello scadenzario
   * i tecnici stanno nei progetti, non qui (11/08/2026).
   */
  const areaItems = (selected: ActivityCategory | "") => {
    const present = data?.facets.areas ?? [];
    const items = present.map(({ category, count }) => ({ category, count }));
    if (selected && !items.some((item) => item.category === selected)) {
      items.push({ category: selected, count: 0 });
    }
    return items.sort(
      (a, b) =>
        ACTIVITY_CATEGORY_ORDER.indexOf(a.category) - ACTIVITY_CATEGORY_ORDER.indexOf(b.category),
    );
  };
  // Le tendine propongono solo i valori presenti nei task visibili (con quanti).
  const facets = data?.facets;

  // Autoguarigione dei filtri: un valore salvato può puntare a un'entità che non
  // esiste più (stato unito o eliminato, utente rimosso, tipo cancellato). Senza
  // questo la lista resta vuota e la tendina non mostra nessun filtro attivo,
  // quindi non c'è modo di togliierlo.
  useEffect(() => {
    if (!facets) return;
    const patch = invalidFilters(
      { statusId, assigneeId, activityTypeId, tagId, companyId },
      {
        statusIds: facets.statuses.map((s) => s.id),
        assigneeIds: facets.assignees.map((a) => a.id),
        activityTypeIds: facets.activityTypes.map((t) => t.id),
        tagIds: (tags ?? []).map((t) => t.id),
        companyIds: facets.companies.map((c) => c.id),
      },
    );
    heal(patch);
  }, [facets, tags, statusId, assigneeId, activityTypeId, tagId, companyId, heal]);

  // Pagina fuori range (il totale si è ridotto): la tabella mostrerebbe una pagina
  // vuota pur avendo record, e prima si sbloccava solo riaprendo l'applicazione.
  const total = data?.total ?? 0;
  const effectivePageSize = data?.pageSize ?? 50;
  useEffect(() => {
    if (isTable && data) clampPageTo(total, effectivePageSize);
  }, [isTable, data, total, effectivePageSize, clampPageTo]);

  const filtersActive =
    activeFilterCount(
      { statusId, assigneeId, activityTypeId, tagId, companyId },
      q,
      includeClosed,
    ) + (area ? 1 : 0);
  const resetFilters = () => {
    setQ("");
    update({
      statusId: "",
      assigneeId: "",
      activityTypeId: "",
      tagId: "",
      companyId: "",
      area: "",
      includeClosed: false,
    });
  };

  if (view === "recurrence") {
    return (
      <div className="flex h-full flex-col gap-4">
        <ViewSwitch options={viewOptions} value={view} onChange={setView} />
        {/* Il drawer serve alla vista calendario: da lì si apre la singola occorrenza. */}
        <TemplatesView onOpenTask={setSelectedTaskId} />
        <TaskDetailDrawer
          taskId={selectedTaskId}
          onClose={closeTask}
          onOpenTask={setSelectedTaskId}
        />
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <ViewSwitch options={viewOptions} value={view} onChange={setView} />

        {/* Filtri comuni in ordine PIRAMIDALE, lo stesso in ogni vista (scelta
            10/08/2026): prima i tagli di perimetro (area, scadenza), poi i
            raffinamenti (persona, stato, tipo, tag), in coda il bisturi (la
            ricerca) e gli interruttori. I controlli specifici di una vista
            stanno dopo — l'area del kanban NON è un filtro ma la scelta della
            bacheca, però occupa lo stesso posto con la stessa faccia. */}
        {view === "kanban" ? (
          <AreaPicker
            value={kanbanCategory}
            onChange={(category) => {
              if (category !== "") update({ kanbanCategory: category });
            }}
            items={areaItems(kanbanCategory)}
          />
        ) : (
          // In agenda e tabella è un FILTRO con "Tutte" (le righe portano lo
          // stato, mescolarle si può); nel kanban invece SCEGLIE la bacheca.
          <AreaPicker
            includeAll
            value={area}
            onChange={(area) => update({ area })}
            items={areaItems(area)}
          />
        )}
        {/* Da qui in giù sono raffinamenti: sul telefono stanno dietro il
            pulsante "Filtri", da tablet in su la barra è quella di sempre. */}
        <MobileFilters count={filtersActive} storageKey="kancrm-tasks-mobile-filters">
          <DueRangeSelect
            value={dueWithinDays}
            onChange={(days) => update({ dueWithinDays: days })}
          />
          <FilterSelect
            icon="person"
            label={t("Filtra per assegnatario")}
            value={assigneeId}
            onChange={(assigneeId) => update({ assigneeId })}
          >
            {assigneeOptions(facets?.assignees, currentUser.id).map((o) => (
              <option key={o.value} value={o.value}>
                {o.isMe || o.count === null ? t(o.label) : o.label}
                {o.count !== null ? ` (${o.count})` : ""}
              </option>
            ))}
          </FilterSelect>
          {/* Stato: prima era un filtro salvato ma senza tendina, quindi invisibile e
            impossibile da azzerare (lista vuota senza spiegazione). */}
          <FilterSelect
            icon="status"
            label={t("Filtra per stato")}
            value={statusId}
            onChange={(statusId) => update({ statusId })}
          >
            <option value="">{t("Tutti gli stati")}</option>
            {facets?.statuses.map((status) => (
              <option key={status.id} value={status.id}>
                {status.name} ({status.count})
              </option>
            ))}
          </FilterSelect>
          <FilterSelect
            icon="activityType"
            label={t("Filtra per tipo di attività")}
            value={activityTypeId}
            onChange={(activityTypeId) => update({ activityTypeId })}
          >
            <option value="">{t("Tutti i tipi")}</option>
            {facets?.activityTypes.map((type) => (
              <option key={type.id} value={type.id}>
                {type.name} ({type.count})
              </option>
            ))}
          </FilterSelect>
          {/* Cliente: **stessa forma di Offerte e Progetti** — un combo in cui
            si scrive, non una tendina. I clienti crescono nel tempo, e a un
            certo punto scorrere l\'anagrafica per intero costa più che
            digitare tre lettere. Il cliente di un task non è un suo campo:
            arriva dall\'offerta o dal progetto collegati, ed è il server a
            risolverlo (`modules/tasks/company.ts`) — altrimenti il filtro
            nasconderebbe righe che l\'elenco mostra col cliente scritto sopra. */}
          <Combobox
            className="w-52"
            value={companyId || null}
            onChange={(id) => update({ companyId: id ?? "" })}
            items={(facets?.companies ?? []).map((company) => ({
              id: company.id,
              label: `${company.name} (${company.count})`,
            }))}
            emptyLabel={t("Tutti i clienti")}
            placeholder={t("Cerca un cliente…")}
            icon={<FILTER_ICONS.company className="size-4 shrink-0 text-primary" />}
          />
          {/* Ordinamento: in tabella si fa anche dalle intestazioni, ma agenda e
            kanban le intestazioni non ce l'hanno — e l'ordine serve soprattutto
            lì (14/08/2026). */}
          <FilterSelect
            icon="sort"
            label={t("Ordina i task")}
            value={sortBy ?? "dueDate"}
            onChange={(value) => {
              update({ sortBy: value as TaskSortBy, sortDir: "asc" });
              setPage(1); // cambiando ordine la pagina corrente non vuol dire più niente
            }}
          >
            {TASK_SORT_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {t(option.label)}
              </option>
            ))}
          </FilterSelect>

          {/* Ricerca testo e tag stanno in TOPBAR (campo unico con toggle
            locale/globale, vedi lib/view-search): la barra dei filtri non
            ospita più campi con la lente. */}
          <Button
            variant={includeClosed ? "default" : "outline"}
            size="icon"
            title={t("Mostra chiusi")}
            aria-label={t("Mostra chiusi")}
            aria-pressed={includeClosed}
            onClick={() => update({ includeClosed: !includeClosed })}
          >
            <CheckCircle2 className="size-4" />
          </Button>
          {/* Via di fuga sempre disponibile: se la lista è vuota per un filtro che non
            si riesce a individuare, un clic riporta tutto visibile. */}
          {filtersActive > 0 && (
            <Button
              variant="ghost"
              size="sm"
              onClick={resetFilters}
              title={t("Rimuovi tutti i filtri")}
            >
              <FilterX className="size-4" /> {t("Azzera filtri")} ({filtersActive})
            </Button>
          )}

          {view === "kanban" && <ResetColumnOrder orderKey={`task:${kanbanCategory}`} />}
        </MobileFilters>

        <div className="ml-auto flex items-center gap-2">
          {view === "table" && isAdmin && (
            <a
              // Stessi filtri della tabella, stessa serializzazione della lista:
              // prima l'export ignorava tipo, tag e range di scadenza, e il CSV
              // non corrispondeva a ciò che si vedeva.
              href={`/api/tasks/export?${taskExportQuery({
                q: q || undefined,
                statusId: statusId || undefined,
                assigneeId: assigneeId || undefined,
                activityTypeId: activityTypeId || undefined,
                tagId: tagId || undefined,
                dueWithinDays: dueWithinDays ?? undefined,
                includeClosed,
              })}`}
              title={t("Esporta la tabella in CSV")}
            >
              <Button variant="outline">
                <Download className="size-4" /> CSV
              </Button>
            </a>
          )}
          {canCreate && (
            <Button onClick={() => setCreateOpen(true)}>
              <Plus className="size-4" /> {t("Nuovo task")}
            </Button>
          )}
          <PluginMenu anchor="boards" />
        </div>
      </div>

      <div className={cn("flex-1", view === "kanban" && "min-h-0")} {...areaProps}>
        {isLoading ? (
          <SkeletonRows rows={6} />
        ) : view === "agenda" ? (
          <AgendaView
            tasks={tasks ?? []}
            onOpen={setSelectedTaskId}
            // Filtrando per persona il nome sarebbe ripetuto su ogni riga.
            showAssignee={!assigneeId}
          />
        ) : view === "table" ? (
          <div className="flex flex-col gap-2">
            <TaskTable
              tasks={tasks ?? []}
              onOpen={setSelectedTaskId}
              sortBy={sortBy}
              sortDir={sortDir}
              onSort={onSort}
            />
            <PaginationBar
              page={page}
              pageSize={effectivePageSize}
              total={total}
              onPageChange={setPage}
            />
          </div>
        ) : (
          <>
            <TaskKanban
              tasks={tasks ?? []}
              statuses={statuses ?? []}
              category={kanbanCategory}
              closedLoaded={!hideClosedTasks({ includeClosed, statusId, q })}
              onOpen={setSelectedTaskId}
            />
          </>
        )}
      </div>

      {areaMenu}
      <NewTaskDialog open={createOpen} onClose={() => setCreateOpen(false)} />
      <TaskDetailDrawer
        taskId={selectedTaskId}
        onClose={closeTask}
        onOpenTask={setSelectedTaskId}
      />
    </div>
  );
}
