// Copyright (c) 2026 Jugaad s.r.l.
// SPDX-License-Identifier: AGPL-3.0-only

import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, BarChart3, ChevronLeft, ChevronRight, Grid3X3, Lightbulb, Lock, LockOpen, Calculator } from "lucide-react";
import { SummaryGroupBy, UserRole, monthOfPeriod, shiftPeriod, toMonthPeriod, toWeekPeriod, weekStartOf, type PeriodKind } from "@kancrm/shared";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { useConfirm } from "@/components/ui/confirm";
import { useToast } from "@/components/ui/toast";
import { Badge } from "@/components/ui/badge";
import { useCurrentUser } from "@/features/auth/useAuth";
import { todayISO } from "@/features/tasks/task-utils";
import { localeTag } from "@/lib/i18n";
import { useListPrefs } from "@/lib/useListPrefs";
import { PluginMenu } from "@/features/plugins/PluginMenu";
import { useTimesheetPeriod, useTimesheetUsers } from "./useTimesheet";
import { UserMultiSelect } from "./UserMultiSelect";
import { SummaryView } from "./SummaryView";
import { EsportazioniOre, VistaReportOre, useOreSuggerite } from "@/edition/slot-pagine";
import { edizione } from "@/edition/rotte";
import { TimesheetDayView, TimesheetGrid } from "./TimesheetGrid";
import { monthYearLabel, periodLabel, type ViewMode } from "./period";

/**
 * **Il guscio del timesheet**: periodo, persone, scambio di vista. Le viste
 * vere stanno ognuna nel suo file — la griglia (TimesheetGrid), i riepiloghi
 * (SummaryView), la produttività (ProductivityView) — perché a 1.700 righe
 * ogni feature nuova passava da qui e i conflitti se la contendevano.
 */
export function TimesheetPage() {
  const { t, i18n } = useTranslation();
  const currentUser = useCurrentUser();
  // Vista, sotto-vista e selezioni si ricordano (useListPrefs, come ogni altro
  // pannello — erano rimaste useState nude, trovate in review). Il mese NO: si
  // riparte sempre da quello corrente, un timesheet aperto su marzo a giugno
  // farebbe registrare ore nel posto sbagliato.
  const { prefs: pagePrefs, update: setPagePrefs } = useListPrefs<{
    view: ViewMode;
    /** Lente del calendario: tutto il mese o la sola settimana (12/08/2026). */
    gridPeriodKind: PeriodKind;
    /** Ore suggerite in grigio nelle caselle vuote (14/08/2026). */
    showHints: boolean;
    /** Selezione utenti della griglia ([] = il mio timesheet). */
    gridUserIds: string[];
    /** Riepilogo piatto o Per progetto. */
    summaryMode: "summary" | "breakdown" | "produttivita";
    /** Selezione utenti dei Riepiloghi ([] = tutti quelli visibili). */
    summaryUserIds: string[];
    groupBy: SummaryGroupBy;
    /**
     * Il report conta solo il periodo mostrato dal selettore (09/09/2026).
     * Acceso di serie: è la domanda con cui si fattura. Togliendolo si torna a
     * «tutte le ore mai registrate», che è l'altra domanda buona — quanto è
     * costato fare una cosa, dall'inizio.
     */
    reportSoloPeriodo: boolean;
  }>("kancrm-timesheet-view", {
    view: "grid",
    gridPeriodKind: "month",
    showHints: true,
    gridUserIds: [],
    summaryMode: "summary",
    summaryUserIds: [],
    groupBy: SummaryGroupBy.USER,
    reportSoloPeriodo: true,
  });
  const {
    view,
    gridPeriodKind,
    showHints,
    gridUserIds: selectedUserIds,
    summaryMode,
    summaryUserIds,
    groupBy,
    reportSoloPeriodo,
  } = pagePrefs;
  const setSelectedUserIds = (ids: string[]) => setPagePrefs({ gridUserIds: ids });
  // Il periodo NON si ricorda (vedi sopra): si riparte sempre da oggi — dal mese
  // o dalla settimana correnti, secondo la lente scelta.
  const [period, setPeriod] = useState(() =>
    gridPeriodKind === "week" ? weekStartOf(todayISO()) : todayISO().slice(0, 7),
  );
  // Ciò che resta mensile (lucchetto, export, report cliente) guarda il mese di
  // appartenenza del periodo: per una settimana a cavallo, quello del giovedì.
  const month = monthOfPeriod(period);

  /**
   * **I riepiloghi seguono la lente** (08/10/2026): mese o settimana, come il
   * calendario. Fino ad allora erano solo mensili, e passando ai riepiloghi il
   * periodo diventava il mese di appartenenza (21/08/2026). Il Report resta
   * sul periodo mostrato, come sempre.
   */
  const setView = (view: ViewMode) => {
    setPagePrefs({ view });
    if (gridPeriodKind === "week") setPeriod((attuale) => toWeekPeriod(attuale, todayISO()));
  };
  /**
   * Who sees the Summaries tab: everyone in the commercial edition (within
   * their own hours); only managers in the community edition, where the
   * server refuses the others (decided 08/10/2026).
   */
  const timesheetCompleto = edizione.moduli.has("timesheet");
  const vedeRiepiloghi = timesheetCompleto || currentUser.canViewTeamTimesheet;
  const vistaEffettiva: ViewMode =
    (view === "summary" && !vedeRiepiloghi) || (view === "report" && !VistaReportOre)
      ? "grid"
      : view;
  const setPeriodKind = (kind: PeriodKind) => {
    setPagePrefs({ gridPeriodKind: kind });
    setPeriod(kind === "week" ? toWeekPeriod(period, todayISO()) : toMonthPeriod(period));
  };
  // Utenti del combo: interni attivi + disattivati con ore (mostrati in rosso).
  const { data: users } = useTimesheetUsers(currentUser.canViewTeamTimesheet);
  const { data: monthData } = useTimesheetPeriod(period, selectedUserIds);
  const confirm = useConfirm();
  const toast = useToast();
  const queryClient = useQueryClient();
  const setLock = useMutation({
    mutationFn: (locked: boolean) =>
      api(`/api/timesheet/locks/${month}`, { method: "PUT", body: { locked } }),
    onSuccess: (_data, locked) => {
      void queryClient.invalidateQueries({ queryKey: ["timesheet"] });
      toast(
        locked
          ? t("Mese {{month}} chiuso: ore bloccate.", { month })
          : t("Mese {{month}} riaperto.", { month }),
        "success",
      );
    },
  });

  const monthLabel = monthYearLabel(month, localeTag(i18n.language));
  const currentLabel = periodLabel(period, localeTag(i18n.language));
  const isWeek = gridPeriodKind === "week";

  return (
    <div className="flex h-full flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex rounded-md border p-0.5">
          <Button
            variant={vistaEffettiva === "grid" ? "default" : "ghost"}
            size="sm"
            onClick={() => setView("grid")}
          >
            <Grid3X3 className="size-4" /> {t("Calendario")}
          </Button>
          {vedeRiepiloghi && (
            <Button
              variant={vistaEffettiva === "summary" ? "default" : "ghost"}
              size="sm"
              onClick={() => setView("summary")}
            >
              <BarChart3 className="size-4" /> {t("Riepiloghi")}
            </Button>
          )}
          {VistaReportOre && currentUser.canViewAllTimesheets && (
            <Button
              variant={vistaEffettiva === "report" ? "default" : "ghost"}
              size="sm"
              onClick={() => setView("report")}
            >
              <Calculator className="size-4" /> {t("Report")}
            </Button>
          )}
        </div>
        <PluginMenu anchor="timesheet" />

        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="icon"
            onClick={() => setPeriod(shiftPeriod(period, -1))}
            title={isWeek ? t("Settimana precedente") : t("Mese precedente")}
          >
            <ChevronLeft className="size-4" />
          </Button>
          <span className="w-40 text-center text-sm font-semibold">{currentLabel}</span>
          <Button
            variant="ghost"
            size="icon"
            onClick={() => setPeriod(shiftPeriod(period, 1))}
            title={isWeek ? t("Settimana successiva") : t("Mese successivo")}
          >
            <ChevronRight className="size-4" />
          </Button>
        </div>

        {/* Lente: tutto il mese, o la sola settimana — con trenta righe da
            compilare non se ne compila nessuna (richiesta del 12/08/2026). Vale
            anche per i riepiloghi, dall'08/10/2026. */}
        {vistaEffettiva !== "report" &&
          !(vistaEffettiva === "summary" && summaryMode === "produttivita") && (
          <div className="flex rounded-md border p-0.5">
            <Button
              variant={!isWeek ? "default" : "ghost"}
              size="sm"
              aria-pressed={!isWeek}
              onClick={() => setPeriodKind("month")}
            >
              {t("Mese")}
            </Button>
            <Button
              variant={isWeek ? "default" : "ghost"}
              size="sm"
              aria-pressed={isWeek}
              onClick={() => setPeriodKind("week")}
            >
              {t("Settimana")}
            </Button>
          </div>
        )}

        {monthData?.locked && (
          <Badge variant="outline">
            <Lock className="mr-1 size-3" /> {t("Mese chiuso")}
          </Badge>
        )}
        {/* La vista dei colleghi può essere parziale: senza dirlo, "vedo poco"
            e "non c'è niente" sono indistinguibili — e un admin non elevato è
            il primo a crederci (18/08/2026: 8 ore a schermo su 443 vere). */}
        {monthData?.filtered && (
          <span className="inline-flex items-center gap-1.5 rounded-md border border-amber-300 bg-amber-50 px-2.5 py-1 text-xs text-amber-800 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-300">
            <AlertTriangle className="size-3.5 shrink-0" />
            {t(
              "Vista parziale: vedi solo le ore sui task che supervisioni e sui progetti che guidi.",
            )}
            {currentUser.canElevate && " " + t("Con i privilegi di amministratore vedresti tutto.")}
          </span>
        )}
        {currentUser.role === UserRole.ADMIN && (
          <Button
            variant="outline"
            size="sm"
            disabled={setLock.isPending}
            onClick={() => {
              const locking = !monthData?.locked;
              void confirm({
                title: locking
                  ? t("Chiudere {{month}}?", { month: monthLabel })
                  : t("Riaprire {{month}}?", { month: monthLabel }),
                message: locking
                  ? t(
                      "Nessuno potrà più registrare o modificare ore in questo mese finché non verrà riaperto.",
                    )
                  : t("Le ore del mese torneranno modificabili da tutti."),
                confirmLabel: locking ? t("Chiudi mese") : t("Riapri mese"),
              }).then((ok) => {
                if (ok) setLock.mutate(locking);
              });
            }}
          >
            {monthData?.locked ? (
              <>
                <LockOpen className="size-4" /> {t("Riapri mese")}
              </>
            ) : (
              <>
                <Lock className="size-4" /> {t("Chiudi mese")}
              </>
            )}
          </Button>
        )}

        {/* I suggerimenti sono un promemoria, non un valore: chi li trova
            rumorosi li spegne qui, e la scelta si ricorda. */}
        {useOreSuggerite && vistaEffettiva === "grid" && selectedUserIds.length === 0 && (
          <Button
            variant={showHints ? "default" : "outline"}
            size="icon"
            aria-pressed={showHints}
            title={
              showHints
                ? t("Nascondi le ore suggerite nelle caselle vuote")
                : t("Mostra le ore suggerite nelle caselle vuote")
            }
            onClick={() => setPagePrefs({ showHints: !showHints })}
          >
            <Lightbulb className="size-4" />
          </Button>
        )}

        {vistaEffettiva === "grid" && currentUser.canViewTeamTimesheet && (
          <UserMultiSelect
            users={users ?? []}
            selected={selectedUserIds}
            onChange={setSelectedUserIds}
            allLabel={t("Il mio timesheet")}
          />
        )}

        {vistaEffettiva === "summary" && EsportazioniOre && (
          <div className="ml-auto flex flex-wrap items-center gap-2">
            {/* The client report (.docx) and the CSV export: commercial (slot). */}
            {EsportazioniOre && (
              <EsportazioniOre
                month={month}
                breakdownUserIds={summaryMode === "breakdown" ? summaryUserIds : []}
              />
            )}
          </div>
        )}
      </div>

      {vistaEffettiva === "grid" ? (
        <>
          {/* Desktop: griglia mese completa. Mobile: vista per singolo giorno. */}
          <div className="hidden min-h-0 flex-1 flex-col md:flex">
            <TimesheetGrid period={period} userIds={selectedUserIds} showHints={showHints} />
          </div>
          <div className="md:hidden">
            <TimesheetDayView period={period} userIds={selectedUserIds} />
          </div>
        </>
      ) : vistaEffettiva === "report" && VistaReportOre ? (
        <>
          <VistaReportOre
            period={period}
            soloPeriodo={reportSoloPeriodo}
            onSoloPeriodo={(reportSoloPeriodo) => setPagePrefs({ reportSoloPeriodo })}
            etichettaPeriodo={currentLabel}
          />
        </>
      ) : (
        <SummaryView
          period={period}
          mode={summaryMode}
          onModeChange={(summaryMode) => setPagePrefs({ summaryMode })}
          groupBy={groupBy}
          onGroupByChange={(groupBy) => setPagePrefs({ groupBy })}
          selectedUserIds={summaryUserIds}
          onSelectedUserIdsChange={(summaryUserIds) => setPagePrefs({ summaryUserIds })}
        />
      )}
    </div>
  );
}

/** Vista mobile: ore di un singolo giorno, con navigazione giorno per giorno. */
