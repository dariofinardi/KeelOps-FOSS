import { useCallback, useEffect, useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import { PluginMenu } from "@/features/plugins/PluginMenu";
import { useNavigate, useSearchParams } from "react-router-dom";
import {
  Glasses,
  Kanban,
  Download,
  ListTodo,
  Plus,
  Receipt,
  FilterX,
  Table2,
  TrendingUp,
  UserRound,
} from "lucide-react";
import {
  UserRole,
  type DealListItem,
  type DealSortBy,
  type DealStage,
  type DealValueUnit,
  type SortDir,
  type DealOwnerFilter,
  type FiltroOfferteFerme,
  isRichTextEmpty,
  parseDealMonths,
} from "@kancrm/shared";
import { cn } from "@/lib/utils";
import { useCurrentUser } from "@/features/auth/useAuth";
import { useOptions } from "@/features/options/useOptions";
import { ApiError } from "@/lib/api";
import { useMoney } from "@/lib/money";
import { activeCount, invalidSelections } from "@/lib/list-filters";
import { useListPrefs } from "@/lib/useListPrefs";
import { useViewSearch } from "@/lib/view-search";
import { useUrlFilterHandoff } from "@/lib/useUrlFilterHandoff";
import { Button } from "@/components/ui/button";
import { ColorPill } from "@/components/ui/color-pill";
import { Combobox } from "@/components/ui/combobox";
import { FILTER_ICONS, FilterSelect } from "@/components/ui/filter-select";
import { useContextMenu, useCreateAreaMenu } from "@/components/ui/context-menu";
import { isDirtyForm, useSaveOrDiscard } from "@/lib/unsaved-changes";
import { Dialog } from "@/components/ui/dialog";
import { InlineSelect } from "@/components/ui/inline-select";
import { Input } from "@/components/ui/input";
import { DateField } from "@/components/ui/date-field";
import { Label } from "@/components/ui/label";
import { PaginationBar } from "@/components/ui/pagination";
import { ViewSwitch, type ViewOption } from "@/components/ui/view-switch";
import { SkeletonRows } from "@/components/ui/skeleton";
import { SortableHeader } from "@/components/ui/sortable-header";
import { QuickAddCompanyDialog, QuickAddContactDialog } from "@/features/crm/QuickAdd";
import { useCompanies, useContactOptions } from "@/features/crm/useCrm";
import { formatDate, todayISO } from "@/features/tasks/task-utils";
import { ProssimoPasso, VOCI_OFFERTE_FERME } from "./NextStep";
import { ResetColumnOrder } from "../kanban/ResetColumnOrder";
import { DealDetailDrawer } from "./DealDetailDrawer";
import { DealPipeline } from "./DealPipeline";
import { ForecastView } from "./ForecastView";
import { DealMonthFilter } from "./DealMonthFilter";
import { LostReasonDialog } from "./LostReasonDialog";
import { useDealMenu } from "./useDealMenu";
import { useCreateDeal, useDealStages, useDeals, useUpdateDeal } from "./useDeals";
import { DescriptionField } from "@/components/ui/rich-text/DescriptionField";
import {
  closeDateFields,
  displayProbability,
  formatDealValue,
  includeClosedForView,
  type DealsViewMode,
} from "./deals-view";

type ViewMode = DealsViewMode;

/** Le stesse scorciatoie dello Scadenzario: una lettera per vista. */
const VIEW_OPTIONS: Array<ViewOption<ViewMode>> = [
  { value: "table", label: "Tabella", icon: Table2, key: "T" },
  { value: "pipeline", label: "Kanban", icon: Kanban, key: "K" },
  { value: "forecast", label: "Forecast", icon: TrendingUp, key: "F" },
];

const PREFS_KEY = "kancrm-deals-prefs";

interface DealsPrefs {
  view: ViewMode;
  q: string;
  /**
   * Di chi sono le offerte da guardare. «Le mie» è la domanda che ci si fa per
   * prima e non aveva risposta: si scorreva l'elenco intero cercando il proprio
   * nome (04/09/2026).
   */
  owner: DealOwnerFilter;
  stageId: string;
  /** Cliente e fascia di valore: valgono in tutte le viste, non solo in tabella. */
  companyId: string;
  value: "" | "above" | "below";
  includeClosed: boolean;
  /** Offerte ferme: tutte, o una ragione sola; stringa vuota = nessun filtro. */
  stalled: "" | FiltroOfferteFerme;
  /** Mesi di chiusura (`2026-09`, `senza-data`); vuoto = tutti. Valgono in ogni vista. */
  months: string[];
  sortBy?: DealSortBy;
  sortDir: SortDir;
}

const DEFAULT_PREFS: DealsPrefs = {
  view: "pipeline",
  q: "",
  // Qui il default è «tutte»: la pagina Offerte è il posto dove si guarda la
  // pipeline dell'azienda. È il riepilogo della giornata che parte dalle mie.
  owner: "all",
  stageId: "",
  companyId: "",
  value: "",
  includeClosed: false,
  stalled: "",
  months: [],
  sortDir: "asc",
};

/** Probabilità: quella che conta davvero, con la dichiarata nel suggerimento. */
function ProbabilityCell({ deal }: { deal: DealListItem }) {
  const { t } = useTranslation();
  const { percent, declared } = displayProbability(deal);
  return (
    <td className="px-4 py-3 text-right text-muted-foreground">
      <span
        title={
          declared !== null
            ? t(
                "Dichiarata {{declared}}%, ma la trattativa è chiusa: nei conti vale {{percent}}%",
                {
                  declared,
                  percent,
                },
              )
            : undefined
        }
      >
        {percent !== null ? `${percent}%` : "—"}
      </span>
    </td>
  );
}

/** Data di chiusura: quella avvenuta se c'è, altrimenti quella prevista. */
function CloseDateCell({ deal }: { deal: DealListItem }) {
  const { t } = useTranslation();
  const { date, closed } = closeDateFields(deal);
  if (!date) return <td className="px-4 py-3 text-muted-foreground">—</td>;
  return (
    <td className="px-4 py-3 text-muted-foreground">
      <span
        title={
          closed
            ? `${t("Chiusa il {{date}}", { date: formatDate(date) })}${
                deal.expectedCloseDate
                  ? t(" — era prevista per il {{date}}", {
                      date: formatDate(deal.expectedCloseDate),
                    })
                  : ""
              }`
            : t("Chiusura prevista")
        }
        className={closed ? "text-foreground" : undefined}
      >
        {formatDate(date)}
      </span>
    </td>
  );
}

/** La fase della trattativa: stessa pastiglia degli stati (vedi ColorPill). */
function StageBadge({ stage }: { stage: DealStage }) {
  return <ColorPill color={stage.color} label={stage.name} />;
}

export function DealsPage() {
  const { t } = useTranslation();
  const currentUser = useCurrentUser();
  const money = useMoney();
  const isAdmin = currentUser.role === UserRole.ADMIN;
  // Con accesso in sola lettura si consultano le offerte ma non se ne creano.
  const canCreate = currentUser.canEditDeals;
  // Sviluppatori (interni senza privilegio commerciale): solo la tabella, righe
  // non apribili, valore espresso in giornate. La pagina è la stessa: si spoglia.
  const daysView = currentUser.dealsDaysView && !currentUser.canSeeDeals;
  const { prefs, update, heal, page, setPage, clampPageTo } = useListPrefs(
    PREFS_KEY,
    DEFAULT_PREFS,
  );
  const { q, owner, stageId, companyId, value, includeClosed, stalled, sortBy, sortDir } = prefs;
  // Un preferito salvato prima del filtro non ha i mesi, uno vecchio può averne di storti.
  const months = parseDealMonths((prefs.months ?? []).join(","));
  // Arrivo dai contatori di una scheda cliente: la lista si apre già filtrata.
  useUrlFilterHandoff(["cliente"], (values) => update({ companyId: values.cliente ?? "" }));
  const view: ViewMode = daysView ? "table" : prefs.view;
  const [createOpen, setCreateOpen] = useState(false);
  // Tasto destro nello spazio vuoto: crea (sulle righe vince il menu dell'offerta).
  const { areaProps, menu: areaMenu } = useCreateAreaMenu(
    t("Nuova offerta"),
    canCreate ? () => setCreateOpen(true) : null,
  );
  // Apertura anche via ?deal=<id> (deep-link dal banner offerta nel dettaglio task).
  const [searchParams, setSearchParams] = useSearchParams();
  const [selectedId, setSelectedId] = useState<string | null>(() =>
    daysView ? null : searchParams.get("deal"),
  );
  const dealParam = searchParams.get("deal");
  useEffect(() => {
    if (dealParam && !daysView) setSelectedId(dealParam);
  }, [dealParam, daysView]);

  const closeDeal = () => {
    setSelectedId(null);
    if (searchParams.has("deal")) {
      searchParams.delete("deal");
      setSearchParams(searchParams, { replace: true });
    }
  };

  const setView = (view: ViewMode) => update({ view });

  const onSort = (column: DealSortBy) =>
    update(
      sortBy === column
        ? { sortDir: sortDir === "asc" ? "desc" : "asc" }
        : { sortBy: column, sortDir: "asc" },
    );

  const isTable = view === "table";
  const { data: stages } = useDealStages();
  // La ricerca vive in topbar (campo unico locale/globale): arriva qui già a
  // digitazione ferma — il debounce è UNO, dentro la barra di ricerca.
  const searchSetQ = useCallback((value: string) => update({ q: value }), [update]);
  useViewSearch({ q, setQ: searchSetQ, placeholder: t("Cerca offerte…") });
  const { data, isLoading } = useDeals({
    q: q || undefined,
    stageId: isTable && stageId ? stageId : undefined,
    // Cliente e valore filtrano anche pipeline e forecast, non solo la tabella.
    companyId: companyId || undefined,
    value: value || undefined,
    // Le ferme sono offerte aperte: il filtro vale in ogni vista.
    stalled: stalled || undefined,
    // I mesi tagliano tabella, kanban e previsione, e con loro i totali.
    months: months.length > 0 ? months.join(",") : undefined,
    owner,
    includeClosed: includeClosedForView(view, includeClosed),
    page: isTable ? page : 1,
    pageSize: isTable ? 50 : 1000,
    sortBy: isTable ? sortBy : undefined,
    sortDir: isTable ? sortDir : undefined,
  });
  const deals = data?.items;
  // Le tendine propongono solo i valori presenti nei dati (con quante offerte).
  const facets = data?.facets;

  // Autoguarigione: un filtro salvato può puntare a un'azienda o a una fase che
  // non esistono più. Senza correzione la lista resta vuota mentre la tendina
  // mostra "Tutti i clienti", quindi il filtro non si vede e non si può togliere.
  useEffect(() => {
    if (!facets) return;
    const patch = invalidSelections(
      { companyId, stageId },
      {
        companyId: facets.companies.map((c) => c.id),
        stageId: facets.stages.map((s) => s.id),
      },
    );
    heal(patch);
  }, [facets, companyId, stageId, heal]);

  // Pagina fuori range dopo che il totale si è ridotto: tabella vuota con record.
  const total = data?.total ?? 0;
  const effectivePageSize = data?.pageSize ?? 50;
  useEffect(() => {
    if (isTable && data) clampPageTo(total, effectivePageSize);
  }, [isTable, data, total, effectivePageSize, clampPageTo]);

  const filtersActive = activeCount(
    { companyId, value, stalled, stageId: isTable ? stageId : "", months: months.join(",") },
    q,
  );
  const resetFilters = () =>
    update({ q: "", companyId: "", value: "", stageId: "", stalled: "", months: [] });
  // La media è quella dell'insieme filtrato: mostrarla rende esplicito il
  // criterio. L'unità la dichiara la risposta (euro, o giornate per gli sviluppatori).
  const valueUnit: DealValueUnit = data?.valueUnit ?? "EUR";
  const averageLabel =
    data?.averageValue != null
      ? ` (${formatDealValue(Math.round(data.averageValue), valueUnit, money)})`
      : "";

  return (
    <div className="flex h-full flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        {!daysView && (
          <ViewSwitch
            options={VIEW_OPTIONS.map((option) => ({ ...option, label: t(option.label) }))}
            value={view}
            onChange={setView}
          />
        )}
        {/* Filtri comuni prima, controlli di vista dopo: la fila non slitta
            cambiando vista (stessa convenzione dello Scadenzario). */}
        {/* La ricerca sta in TOPBAR (campo unico locale/globale). */}
        {/* Perimetro per primo, come in ogni barra dei filtri (CLAUDE.md). */}
        <FilterSelect
          icon="people"
          label={t("Filtra per commerciale")}
          value={owner}
          onChange={(v) => update({ owner: v as DealOwnerFilter })}
        >
          <option value="all">{t("Tutte le offerte")}</option>
          <option value="mine">{t("Le mie offerte")}</option>
          <option value="others">{t("Quelle degli altri")}</option>
        </FilterSelect>
        {/* I clienti crescono nel tempo: si scrive per cercarli invece di
            scorrere una tendina lunga come l'anagrafica. */}
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
        <FilterSelect
          icon="amount"
          label={t("Filtra per valore rispetto alla media delle offerte mostrate")}
          value={value}
          onChange={(v) => update({ value: v as DealsPrefs["value"] })}
        >
          <option value="">{t("Tutti i valori")}</option>
          <option value="above">
            {t("Sopra la media")}
            {averageLabel}
          </option>
          <option value="below">
            {t("Sotto la media")}
            {averageLabel}
          </option>
        </FilterSelect>
        <DealMonthFilter
          months={facets?.months ?? []}
          selected={months}
          onChange={(scelti) => update({ months: scelti })}
        />
        {/*
          Le offerte ferme: senza prossimo passo, con il passo scaduto, con la
          chiusura prevista passata. I numeri si contano senza questo filtro, e
          una voce a zero non si offre — a meno che sia quella scelta.
        */}
        <FilterSelect
          icon="dueRange"
          label={t("Filtra le offerte ferme")}
          value={stalled}
          onChange={(v) => update({ stalled: v as DealsPrefs["stalled"] })}
        >
          <option value="">{t("Tutte, ferme o no")}</option>
          {VOCI_OFFERTE_FERME.filter(
            (voce) => (facets?.stalled[voce.value] ?? 0) > 0 || voce.value === stalled,
          ).map((voce) => (
            <option key={voce.value} value={voce.value}>
              {t(voce.label)} ({facets?.stalled[voce.value] ?? 0})
            </option>
          ))}
        </FilterSelect>
        {view === "table" && (
          <>
            <FilterSelect
              icon="stage"
              label={t("Filtra per fase")}
              value={stageId}
              onChange={(stageId) => update({ stageId })}
            >
              <option value="">{t("Tutte le fasi")}</option>
              {facets?.stages.map((stage) => (
                <option key={stage.id} value={stage.id}>
                  {stage.name} ({stage.count})
                </option>
              ))}
            </FilterSelect>
            <label className="flex items-center gap-1.5 text-sm text-muted-foreground">
              <input
                type="checkbox"
                checked={includeClosed}
                onChange={(e) => update({ includeClosed: e.target.checked })}
              />
              {t("Mostra vinte/perse")}
            </label>
          </>
        )}
        {view === "pipeline" && <ResetColumnOrder orderKey="deal" />}
        {/* Via di fuga: se la lista è vuota per un filtro che non si individua. */}
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
        <div className="ml-auto flex items-center gap-2">
          {view === "table" && isAdmin && (
            <a
              // Come per i task: l'export è uno scarico grezzo e il server onora
              // solo questi filtri. Mandare anche cliente e fascia di valore
              // faceva credere che il file rispecchiasse la tabella.
              href={`/api/deals/export?${new URLSearchParams({
                ...(q ? { q } : {}),
                ...(stageId ? { stageId } : {}),
                ...(includeClosed ? { includeClosed: "true" } : {}),
                // Il perimetro sì: il file deve contenere quello che vedi.
                ...(owner !== "all" ? { owner } : {}),
              }).toString()}`}
              title={t("Esporta la tabella in CSV")}
            >
              <Button variant="outline">
                <Download className="size-4" /> CSV
              </Button>
            </a>
          )}
          {canCreate && (
            <Button onClick={() => setCreateOpen(true)}>
              <Plus className="size-4" /> {t("Nuova offerta")}
            </Button>
          )}
          <PluginMenu anchor="deals" />
        </div>
      </div>

      <div className="min-h-0 flex-1" {...areaProps}>
        {isLoading ? (
          <SkeletonRows rows={6} />
        ) : view === "table" ? (
          <div className="flex flex-col gap-2">
            <DealTable
              deals={deals ?? []}
              totalValue={data?.totalValue ?? null}
              valueUnit={valueUnit}
              daysView={daysView}
              onOpen={daysView ? null : setSelectedId}
              sortBy={sortBy}
              sortDir={sortDir}
              onSort={onSort}
            />
            <PaginationBar
              page={page}
              pageSize={data?.pageSize ?? 50}
              total={data?.total ?? 0}
              onPageChange={setPage}
            />
          </div>
        ) : view === "forecast" ? (
          <ForecastView deals={deals ?? []} monthFilter={months} />
        ) : (
          <DealPipeline deals={deals ?? []} stages={stages ?? []} onOpen={setSelectedId} />
        )}
      </div>

      {areaMenu}
      <NewDealDialog open={createOpen} onClose={() => setCreateOpen(false)} />
      <DealDetailDrawer dealId={selectedId} onClose={closeDeal} />
    </div>
  );
}

/**
 * Cella "Fase" editabile inline: click sul badge → combo con le fasi ammesse.
 * stopPropagation ovunque per non aprire il drawer della riga.
 */
function StageCell({
  deal,
  stages,
  onChange,
}: {
  deal: DealListItem;
  stages: DealStage[];
  onChange: (stageId: string) => void;
}) {
  const { t } = useTranslation();
  return (
    <InlineSelect
      value={deal.stage.id}
      title={t("Cambia fase")}
      // Sola lettura: badge non cliccabile per chi non è proprietario dell'offerta.
      readOnly={!deal.canEdit}
      options={stages.map((stage) => ({ value: stage.id, label: stage.name }))}
      onChange={onChange}
    >
      <StageBadge stage={deal.stage} />
    </InlineSelect>
  );
}

/** Cella "Commerciale" (assegnatario dell'offerta), modificabile inline come la fase. */
function AssigneeCell({
  deal,
  onChange,
}: {
  deal: DealListItem;
  onChange: (assigneeId: string | null) => void;
}) {
  const { t } = useTranslation();
  // Sola lettura (offerta non propria, o vista sviluppatori): nome e basta,
  // senza nemmeno chiedere al server l'elenco dei commerciali.
  if (!deal.canEdit) {
    return (
      <span className="text-sm">
        {deal.assignee?.name ?? <span className="italic">{t("Non assegnata")}</span>}
      </span>
    );
  }
  return <EditableAssigneeCell deal={deal} onChange={onChange} />;
}

function EditableAssigneeCell({
  deal,
  onChange,
}: {
  deal: DealListItem;
  onChange: (assigneeId: string | null) => void;
}) {
  const { t } = useTranslation();
  // Solo chi può essere titolare di un'offerta: interni con accesso completo.
  const { users } = useOptions({ module: "DEAL" });

  return (
    <InlineSelect
      value={deal.assignee?.id ?? null}
      title={t("Cambia commerciale")}
      className="text-sm underline-offset-2 hover:underline"
      readOnly={!deal.canEdit}
      emptyLabel={t("Non assegnata")}
      options={(users ?? []).map((user) => ({ value: user.id, label: user.name }))}
      onChange={(assigneeId) => onChange(assigneeId || null)}
    >
      {deal.assignee?.name ?? <span className="italic">{t("Non assegnata")}</span>}
    </InlineSelect>
  );
}

function DealTable({
  deals,
  totalValue,
  valueUnit,
  daysView,
  onOpen,
  sortBy,
  sortDir,
  onSort,
}: {
  deals: DealListItem[];
  /** Somma nominale dell'insieme filtrato (tutte le pagine), mostrata sotto "Valore". */
  totalValue: number | null;
  /** Unità dei valori, dichiarata dalla risposta: euro o giornate. */
  valueUnit: DealValueUnit;
  /** Vista per sviluppatori: righe di sola consultazione, colonne ridotte. */
  daysView: boolean;
  /** Apre il dettaglio; null quando le righe non sono apribili (vista giornate). */
  onOpen: ((id: string) => void) | null;
  sortBy?: DealSortBy;
  sortDir: SortDir;
  onSort: (column: DealSortBy) => void;
}) {
  const { t } = useTranslation();
  const { data: stages } = useDealStages();
  const money = useMoney();
  const updateDeal = useUpdateDeal();
  const { open, menu } = useContextMenu();
  // Il menu contestuale apre il dettaglio: senza apertura (vista giornate) le
  // righe non lo espongono, e il fallback qui non viene mai chiamato.
  const {
    items: dealMenu,
    node: quickTaskNode,
    aggiungiTask,
  } = useDealMenu(onOpen ?? (() => undefined));
  const navigate = useNavigate();
  const oggi = todayISO();
  const [pendingLost, setPendingLost] = useState<{ deal: DealListItem; stageId: string } | null>(
    null,
  );

  const changeStage = (deal: DealListItem, stageId: string) => {
    const targetStage = stages?.find((s) => s.id === stageId);
    // Fase "Persa": chiedi il motivo prima di spostare (come nel kanban).
    if (targetStage?.isLost) {
      setPendingLost({ deal, stageId });
      return;
    }
    // Fase "Vinta": l'offerta va in lettura, le domande arrivano con la
    // proposta (vedi DealPipeline).
    updateDeal.mutate({ id: deal.id, stageId });
  };

  if (deals.length === 0) {
    return (
      <div className="rounded-lg border border-dashed p-10 text-center text-sm text-muted-foreground">
        {t("Nessuna offerta trovata.")}
      </div>
    );
  }
  return (
    <div className="overflow-x-auto rounded-lg border">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b bg-muted/50 text-left text-xs uppercase text-muted-foreground">
            <SortableHeader
              label={t("Offerta")}
              column="title"
              sortBy={sortBy}
              sortDir={sortDir}
              onSort={onSort}
            />
            <SortableHeader
              label={t("Fase")}
              column="stage"
              sortBy={sortBy}
              sortDir={sortDir}
              onSort={onSort}
            />
            <SortableHeader
              label={daysView ? t("Azienda") : t("Azienda / Contatto")}
              column="company"
              sortBy={sortBy}
              sortDir={sortDir}
              onSort={onSort}
            />
            <SortableHeader
              label={t("Commerciale")}
              column="assignee"
              sortBy={sortBy}
              sortDir={sortDir}
              onSort={onSort}
            />
            <SortableHeader
              label={daysView ? t("Giornate") : t("Valore")}
              column="value"
              sortBy={sortBy}
              sortDir={sortDir}
              onSort={onSort}
              align="right"
              // La somma di quello che si sta guardando, filtri compresi e su
              // tutte le pagine: nominale, senza pesi — è la colonna, sommata.
              // Per gli sviluppatori la stessa somma, espressa in giornate.
              sub={
                totalValue !== null
                  ? `Σ ${formatDealValue(totalValue, valueUnit, money)}`
                  : undefined
              }
            />
            <SortableHeader
              label={t("Prob.")}
              column="probability"
              sortBy={sortBy}
              sortDir={sortDir}
              onSort={onSort}
              align="right"
            />
            <SortableHeader
              label={t("Chiusura")}
              column="expectedCloseDate"
              sortBy={sortBy}
              sortDir={sortDir}
              onSort={onSort}
            />
            {/* Cosa c'è da fare adesso: la chiusura dice dove si vuole arrivare. */}
            <SortableHeader
              label={t("Prossimo passo")}
              column="nextStep"
              sortBy={sortBy}
              sortDir={sortDir}
              onSort={onSort}
            />
          </tr>
        </thead>
        <tbody>
          {deals.map((deal) => (
            <tr
              key={deal.id}
              className={cn("border-b last:border-0", onOpen && "cursor-pointer hover:bg-muted/30")}
              onClick={onOpen ? () => onOpen(deal.id) : undefined}
              onContextMenu={onOpen ? (e) => open(e, dealMenu(deal)) : undefined}
            >
              <td className="px-4 py-3 font-medium">
                {/*
                  Il simbolo dice che l'offerta ha già la sua fattura da fare:
                  il titolo sta nello Scadenzario. Il fumetto lo dice a parole —
                  un'icona sola, senza, è un indovinello (04/09/2026). Va sullo
                  `<span>`: `title` su un'icona di lucide non arriva al DOM.
                */}
                {deal.billingTaskId && (
                  <span title={t("Task di fatturazione generato nello Scadenzario.")}>
                    <Receipt
                      className="mr-1.5 inline size-3.5 text-muted-foreground"
                      aria-label={t("Task di fatturazione generato nello Scadenzario.")}
                    />
                  </span>
                )}
                {/* Occhiali: qualcuno da fuori sta guardando questa offerta. */}
                {deal.visibleToSalesMonitors && (
                  <span title={t("Visibile ai monitor vendite")}>
                    <Glasses
                      className="mr-1.5 inline size-3.5 text-sky-600 dark:text-sky-400"
                      aria-label={t("Visibile ai monitor vendite")}
                    />
                  </span>
                )}
                {deal.title}
                {deal.openTaskCount > 0 && (
                  <span
                    className="ml-2 inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-xs font-normal text-muted-foreground"
                    title={t("{{count}} task collegati aperti", { count: deal.openTaskCount })}
                  >
                    <ListTodo className="size-3" /> {deal.openTaskCount}
                  </span>
                )}
              </td>
              <td className="px-4 py-3">
                <StageCell
                  deal={deal}
                  stages={stages ?? []}
                  onChange={(stageId) => void changeStage(deal, stageId)}
                />
              </td>
              <td className="px-4 py-3 text-muted-foreground">
                {[deal.company?.name, deal.contact?.name].filter(Boolean).join(" · ") || "—"}
              </td>
              <td className="px-4 py-3 text-muted-foreground">
                <AssigneeCell
                  deal={deal}
                  onChange={(assigneeId) => updateDeal.mutate({ id: deal.id, assigneeId })}
                />
              </td>
              <td className="px-4 py-3 text-right">
                {formatDealValue(deal.dealValue, valueUnit, money)}
              </td>
              <ProbabilityCell deal={deal} />
              <CloseDateCell deal={deal} />
              <td className="px-4 py-3">
                <ProssimoPasso
                  passo={deal.nextStep}
                  conclusa={deal.stage.isWon || deal.stage.isLost}
                  oggi={oggi}
                  altri={Math.max(0, deal.openTaskCount - 1)}
                  // La vista in giornate non apre niente: legge e basta.
                  onApri={
                    onOpen && deal.nextStep
                      ? () => navigate(`/bacheche?task=${deal.nextStep!.id}`)
                      : undefined
                  }
                  onAggiungi={onOpen ? () => aggiungiTask(deal) : undefined}
                />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
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
      {quickTaskNode}
      {menu}
    </div>
  );
}

function NewDealDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t } = useTranslation();
  const saveOrDiscard = useSaveOrDiscard();
  const createDeal = useCreateDeal();
  const { data: stages } = useDealStages();
  const companies = useCompanies("").data?.items;
  const currentUser = useCurrentUser();
  // Senza scope CONTACTS il campo persona non è disponibile (evita 403).
  const canSeeContacts = currentUser.canSeeContacts;
  // Solo chi può essere titolare di un'offerta: interni con accesso completo.
  const { users } = useOptions({ module: "DEAL" });

  const [title, setTitle] = useState("");
  const [stageId, setStageId] = useState("");
  const [companyId, setCompanyId] = useState("");
  const [contactId, setContactId] = useState("");
  // Un'offerta nasce assegnata a chi la crea (modificabile).
  const [assigneeId, setAssigneeId] = useState(currentUser.id);
  const [dealValue, setDealValue] = useState("");
  const [probability, setProbability] = useState("");
  const [expectedCloseDate, setExpectedCloseDate] = useState("");
  // Gli stessi due campi del pannello di dettaglio (21/09/2026): prima si
  // creava l'offerta e poi la si riapriva per scrivere la descrizione e
  // aprirla ai monitor vendite — due passaggi per una cosa sola.
  const [visibleToSalesMonitors, setVisibleToSalesMonitors] = useState(false);
  const [description, setDescription] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [quickCompanyOpen, setQuickCompanyOpen] = useState(false);
  const [quickContactOpen, setQuickContactOpen] = useState(false);
  // Scelta l'azienda, restano solo i suoi referenti.
  const contacts = useContactOptions(companyId, canSeeContacts);

  const selectClass = "h-9 w-full rounded-md border bg-background px-2 text-sm";

  const reset = () => {
    setTitle("");
    setStageId("");
    setCompanyId("");
    setContactId("");
    setAssigneeId("");
    setDealValue("");
    setProbability("");
    setExpectedCloseDate("");
    setVisibleToSalesMonitors(false);
    setDescription("");
    setError(null);
  };

  // Uscendo (Annulla, ✕, Esc) si sceglie: creare, o buttare via quel che si è scritto.
  const onSubmit = (event?: FormEvent) => {
    event?.preventDefault();
    setError(null);
    if (canSeeContacts && !contactId) {
      setError(t("Scegli la persona di riferimento"));
      return;
    }
    createDeal.mutate(
      {
        title,
        stageId: stageId || undefined,
        companyId: companyId || null,
        contactId: contactId || null,
        assigneeId: assigneeId || null,
        dealValue: dealValue === "" ? null : Number(dealValue),
        probability: probability === "" ? null : Number(probability),
        expectedCloseDate: expectedCloseDate || null,
        visibleToSalesMonitors,
        description: isRichTextEmpty(description) ? null : description,
      },
      {
        onSuccess: () => {
          reset();
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
        [companyId, ""],
        [contactId, ""],
        [assigneeId, currentUser.id],
        [dealValue, ""],
        [probability, ""],
        [expectedCloseDate, ""],
        [visibleToSalesMonitors, false],
        [isRichTextEmpty(description) ? "" : description, ""],
      ]),
      canSave: title.trim() !== "",
      what: t("la nuova offerta"),
      onSave: () => onSubmit(),
      onDiscard: onClose,
    });

  return (
    <Dialog open={open} onClose={requestClose} title={t("Nuova offerta")}>
      <form onSubmit={onSubmit} className="flex flex-col gap-4">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="deal-title" importance="required">
            {t("Titolo")}
          </Label>
          <Input
            id="deal-title"
            required
            autoFocus
            value={title}
            onChange={(e) => setTitle(e.target.value)}
          />
        </div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div className="flex flex-col gap-1.5">
            <Label importance="recommended">{t("Fase")}</Label>
            <select
              className={selectClass}
              value={stageId}
              onChange={(e) => setStageId(e.target.value)}
            >
              <option value="">{t("Prima fase")}</option>
              {stages?.map((stage) => (
                <option key={stage.id} value={stage.id}>
                  {stage.name}
                </option>
              ))}
            </select>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label importance="recommended">{t("Commerciale")}</Label>
            <Combobox
              value={assigneeId || null}
              onChange={(id) => setAssigneeId(id ?? "")}
              items={(users ?? []).map((user) => ({ id: user.id, label: user.name }))}
              emptyLabel={t("Nessuno")}
              placeholder={t("Cerca un commerciale…")}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label importance="recommended">{t("Azienda")}</Label>
            <div className="flex gap-1">
              <Combobox
                className="flex-1"
                value={companyId || null}
                onChange={(id) => {
                  setCompanyId(id ?? "");
                  // Il contatto scelto potrebbe non appartenere alla nuova azienda.
                  setContactId("");
                }}
                items={(companies ?? []).map((company) => ({
                  id: company.id,
                  label: company.name,
                }))}
                emptyLabel={t("Nessuna")}
                placeholder={t("Cerca un'azienda…")}
              />
              <Button
                variant="outline"
                size="icon"
                title={t("Crea azienda al volo")}
                onClick={() => setQuickCompanyOpen(true)}
              >
                <Plus className="size-4" />
              </Button>
            </div>
          </div>
          {canSeeContacts && (
            <div className="flex flex-col gap-1.5">
              <Label>{t("Contatto *")}</Label>
              <div className="flex gap-1">
                <Combobox
                  className="flex-1"
                  value={contactId || null}
                  onChange={(id) => setContactId(id ?? "")}
                  items={(contacts ?? []).map((contact) => ({
                    id: contact.id,
                    label: `${contact.firstName} ${contact.lastName}`,
                  }))}
                  placeholder={t("Cerca una persona…")}
                  emptyLabel={t("Nessun contatto")}
                  icon={<UserRound className="size-4 shrink-0 text-muted-foreground" />}
                />
                <Button
                  variant="outline"
                  size="icon"
                  title={t("Crea contatto al volo")}
                  onClick={() => setQuickContactOpen(true)}
                >
                  <Plus className="size-4" />
                </Button>
              </div>
            </div>
          )}
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="deal-value" importance="recommended">
              {t("Valore (€)")}
            </Label>
            <Input
              id="deal-value"
              type="number"
              min={0}
              step="0.01"
              value={dealValue}
              onChange={(e) => setDealValue(e.target.value)}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="deal-prob" importance="recommended">
              {t("Probabilità (%)")}
            </Label>
            <Input
              id="deal-prob"
              type="number"
              min={0}
              max={100}
              value={probability}
              onChange={(e) => setProbability(e.target.value)}
            />
          </div>
          <div className="col-span-2 flex flex-col gap-1.5">
            <Label htmlFor="deal-close" importance="recommended">
              {t("Chiusura prevista")}
            </Label>
            <DateField
              id="deal-close"
              value={expectedCloseDate}
              onCommit={(v) => setExpectedCloseDate(v ?? "")}
            />
          </div>
        </div>

        {/* Stesso ordine del pannello: numeri, poi la visibilità, poi il contenuto. */}
        <label className="flex items-start gap-2 rounded-md border p-3 text-sm">
          <input
            type="checkbox"
            className="mt-0.5"
            checked={visibleToSalesMonitors}
            onChange={(e) => setVisibleToSalesMonitors(e.target.checked)}
          />
          <span>
            <span className="font-medium">{t("Visibile ai monitor vendite")}</span>
            <span className="mt-0.5 block text-xs text-muted-foreground">
              {t(
                "Nella loro area riservata vedranno titolo, cliente, importo, probabilità, fase, commerciale, cronologia, allegati e",
              )}{" "}
              <strong>{t("i messaggi di questa chat")}</strong>
              {t(", dove possono anche scrivere. Non possono modificare né scaricare i documenti.")}
            </span>
          </span>
        </label>

        <DescriptionField
          value={description}
          onChange={setDescription}
          dialogTitle={title.trim() || t("Nuova offerta")}
          placeholder={t("Aggiungi una descrizione…")}
        />

        {error && <p className="text-sm text-destructive">{error}</p>}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={requestClose}>
            {t("Annulla")}
          </Button>
          <Button type="submit" disabled={createDeal.isPending}>
            {createDeal.isPending ? t("Creazione…") : t("Crea offerta")}
          </Button>
        </div>
      </form>

      <QuickAddCompanyDialog
        open={quickCompanyOpen}
        onClose={() => setQuickCompanyOpen(false)}
        onCreated={setCompanyId}
      />
      <QuickAddContactDialog
        open={quickContactOpen}
        onClose={() => setQuickContactOpen(false)}
        // La persona porta la sua azienda: creandola per un cliente diverso da
        // quello scelto, l'offerta segue lei — altrimenti resterebbe fuori
        // dall'elenco dei referenti e sembrerebbe non essersi creata.
        onCreated={(id, company) => {
          if (company) setCompanyId(company);
          setContactId(id);
        }}
        defaultCompanyId={companyId || null}
      />
    </Dialog>
  );
}
