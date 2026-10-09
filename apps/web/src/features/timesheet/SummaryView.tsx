import { Fragment, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { ChevronRight } from "lucide-react";
import { SummaryGroupBy, formatHours, monthOfPeriod, periodKind } from "@kancrm/shared";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { useCurrentUser } from "@/features/auth/useAuth";
import { useTimesheetBreakdown, useTimesheetSummary, useTimesheetUsers } from "./useTimesheet";
import { UserMultiSelect } from "./UserMultiSelect";
import { ProduttivitaOre } from "@/edition/slot-pagine";

/**
 * **I riepiloghi del periodo** — un mese o, dall'08/10/2026, una settimana:
 * totali per progetto e per persona, piatti o pivotati nei due versi
 * (progetti › persone e persone › progetti). La produttività, mensile, è
 * commerciale e arriva da uno slot.
 */
const GROUP_LABELS: Record<SummaryGroupBy, string> = {
  user: "Utente",
  project: "Progetto / modulo",
  task: "Task",
};

export function SummaryView({
  period,
  mode,
  onModeChange,
  groupBy,
  onGroupByChange,
  selectedUserIds,
  onSelectedUserIdsChange,
}: {
  /** A month (`2026-08`) or a week's Monday (`2026-08-03`). */
  period: string;
  mode: "summary" | "breakdown" | "produttivita";
  onModeChange: (mode: "summary" | "breakdown" | "produttivita") => void;
  groupBy: SummaryGroupBy;
  onGroupByChange: (groupBy: SummaryGroupBy) => void;
  selectedUserIds: string[];
  onSelectedUserIdsChange: (ids: string[]) => void;
}) {
  const { t } = useTranslation();
  // A remembered "produttivita" on an edition without it falls back to the summary.
  const modo = mode === "produttivita" && !ProduttivitaOre ? "summary" : mode;
  return (
    <div
      className={cn("flex flex-col gap-3", modo === "produttivita" ? "max-w-none" : "max-w-2xl")}
    >
      <p className="text-sm text-muted-foreground">
        {t(
          "Vedi le tue ore, quelle dei task che supervisioni e dei progetti in cui sei manager (l'admin vede tutto).",
        )}
      </p>
      <div className="flex gap-1 self-start rounded-md border p-0.5">
        <Button
          variant={modo === "summary" ? "default" : "ghost"}
          size="sm"
          onClick={() => onModeChange("summary")}
        >
          {t("Riepilogo")}
        </Button>
        <Button
          variant={modo === "breakdown" ? "default" : "ghost"}
          size="sm"
          onClick={() => onModeChange("breakdown")}
        >
          {t("Per progetto")}
        </Button>
        {ProduttivitaOre && (
          <Button
            variant={modo === "produttivita" ? "default" : "ghost"}
            size="sm"
            onClick={() => onModeChange("produttivita")}
          >
            {t("Produttività")}
          </Button>
        )}
      </div>
      {modo === "summary" ? (
        <FlatSummary period={period} groupBy={groupBy} onGroupByChange={onGroupByChange} />
      ) : modo === "breakdown" || !ProduttivitaOre ? (
        <BreakdownView
          period={period}
          selected={selectedUserIds}
          onSelectedChange={onSelectedUserIdsChange}
        />
      ) : (
        // La produttività è mensile: il mese a cui il periodo appartiene.
        <ProduttivitaOre month={monthOfPeriod(period)} selected={selectedUserIds} />
      )}
    </div>
  );
}

function FlatSummary({
  period,
  groupBy,
  onGroupByChange,
}: {
  period: string;
  groupBy: SummaryGroupBy;
  onGroupByChange: (groupBy: SummaryGroupBy) => void;
}) {
  const { t } = useTranslation();
  const { data: rows, isLoading } = useTimesheetSummary(period, groupBy);

  const total = (rows ?? []).reduce((sum, row) => sum + row.hours, 0);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex gap-1 self-start rounded-md border p-0.5">
        {Object.values(SummaryGroupBy).map((value) => (
          <Button
            key={value}
            variant={groupBy === value ? "default" : "ghost"}
            size="sm"
            onClick={() => onGroupByChange(value)}
          >
            {t(GROUP_LABELS[value])}
          </Button>
        ))}
      </div>
      {isLoading ? (
        <p className="text-sm text-muted-foreground">{t("Caricamento…")}</p>
      ) : (
        <div className="overflow-hidden rounded-lg border">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-muted/50 text-left text-xs uppercase text-muted-foreground">
                <th className="px-4 py-3 font-medium">{t(GROUP_LABELS[groupBy])}</th>
                <th className="px-4 py-3 text-right font-medium">{t("Ore")}</th>
                <th className="px-4 py-3 text-right font-medium">{t("Quota")}</th>
              </tr>
            </thead>
            <tbody>
              {rows?.map((row, index) => (
                <tr
                  key={`${row.label}-${row.context ?? ""}-${index}`}
                  className="border-b last:border-0"
                >
                  <td className="px-4 py-2.5">
                    {row.label}
                    {/* Il progetto sotto il titolo: due task possono chiamarsi
                        uguale, e "Test e bug fixing" da solo non dice di chi è. */}
                    {row.context && (
                      <span className="block text-xs text-muted-foreground">{row.context}</span>
                    )}
                  </td>
                  <td className="px-4 py-2.5 text-right align-top font-medium">
                    {formatHours(row.hours)}
                  </td>
                  {/* La quota sul totale: "97,1" dice quanto lavoro c'è stato,
                    "32%" dice dov'è finito il mese — e per il controllo di
                    gestione è la seconda che si guarda. */}
                  <td className="px-4 py-2.5 text-right align-top tabular-nums text-muted-foreground">
                    {total > 0 ? `${Math.round((row.hours / total) * 100)}%` : "—"}
                  </td>
                </tr>
              ))}
              {(rows?.length ?? 0) === 0 && (
                <tr>
                  <td colSpan={3} className="p-6 text-center text-muted-foreground">
                    {periodKind(period) === "week"
                      ? t("Nessuna ora registrata nella settimana.")
                      : t("Nessuna ora registrata nel mese.")}
                  </td>
                </tr>
              )}
            </tbody>
            {(rows?.length ?? 0) > 0 && (
              <tfoot>
                <tr className="bg-muted/50 font-medium">
                  <td className="px-4 py-2.5">{t("Totale")}</td>
                  <td className="px-4 py-2.5 text-right">{formatHours(total)}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums">100%</td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      )}
    </div>
  );
}

/** Ripartizione per progetto con accordion per-persona e filtro multi-utente. */
function BreakdownView({
  period,
  selected,
  onSelectedChange,
}: {
  period: string;
  // La selezione vive nella pagina: il report cliente deve seguire ciò che
  // questi riepiloghi mostrano, non una selezione parallela della griglia.
  selected: string[];
  onSelectedChange: (ids: string[]) => void;
}) {
  const { t } = useTranslation();
  const canViewTeam = useCurrentUser().canViewTeamTimesheet;
  const { data: users } = useTimesheetUsers(canViewTeam);
  const { data: rows, isLoading } = useTimesheetBreakdown(period, selected);
  const [open, setOpen] = useState<Set<string>>(new Set());
  /** Il verso del raggruppamento: progetti con dentro le persone, o viceversa. */
  const [verso, setVerso] = useState<"progetti" | "persone">("progetti");
  const total = (rows ?? []).reduce((sum, row) => sum + row.hours, 0);

  const toggleRow = (label: string) =>
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(label)) next.delete(label);
      else next.add(label);
      return next;
    });

  /**
   * **Due domande, due versi.** «Chi ha lavorato su questo progetto» e «su cosa
   * ha lavorato questa persona» sono la stessa tabella girata, ma rispondono a
   * cose diverse: la prima serve a fatturare una commessa, la seconda a capire
   * come qualcuno ha speso il mese. I dati sono gli stessi, il perno cambia.
   */
  const righe = useMemo(() => {
    if (!rows) return [];
    if (verso === "progetti") {
      return rows.map((row) => ({
        label: row.label,
        hours: row.hours,
        figli: row.people.map((persona) => ({
          id: persona.userId,
          label: persona.name,
          hours: persona.hours,
          isActive: persona.isActive,
        })),
      }));
    }
    // Perno sulle persone: stessa materia, altro verso.
    const perPersona = new Map<
      string,
      { label: string; isActive: boolean; hours: number; figli: Map<string, number> }
    >();
    for (const progetto of rows) {
      for (const persona of progetto.people) {
        const voce = perPersona.get(persona.userId) ?? {
          label: persona.name,
          isActive: persona.isActive,
          hours: 0,
          figli: new Map<string, number>(),
        };
        voce.hours += persona.hours;
        voce.figli.set(progetto.label, (voce.figli.get(progetto.label) ?? 0) + persona.hours);
        perPersona.set(persona.userId, voce);
      }
    }
    return [...perPersona.values()]
      .sort((a, b) => b.hours - a.hours)
      .map((voce) => ({
        label: voce.label + (voce.isActive ? "" : ` ${t("(disatt.)")}`),
        hours: voce.hours,
        figli: [...voce.figli.entries()]
          .sort(([, x], [, y]) => y - x)
          .map(([label, hours]) => ({ id: label, label, hours, isActive: true })),
      }));
  }, [rows, verso, t]);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex gap-1 self-start rounded-md border p-0.5">
        <Button
          variant={verso === "progetti" ? "default" : "ghost"}
          size="sm"
          onClick={() => setVerso("progetti")}
        >
          {t("Progetti › Persone")}
        </Button>
        <Button
          variant={verso === "persone" ? "default" : "ghost"}
          size="sm"
          onClick={() => setVerso("persone")}
        >
          {t("Persone › Progetti")}
        </Button>
      </div>

      {/* Multi-selezione utenti (solo chi vede i timesheet del team). Disattivati in rosso. */}
      {canViewTeam && (
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground">{t("Utenti:")}</span>
          <UserMultiSelect
            users={users ?? []}
            selected={selected}
            onChange={onSelectedChange}
            allLabel={t("Tutti")}
          />
        </div>
      )}

      {isLoading ? (
        <p className="text-sm text-muted-foreground">{t("Caricamento…")}</p>
      ) : (
        <div className="overflow-hidden rounded-lg border">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-muted/50 text-left text-xs uppercase text-muted-foreground">
                <th className="px-4 py-3 font-medium">
                  {verso === "progetti" ? t("Progetto") : t("Persona")}
                </th>
                <th className="px-4 py-3 text-right font-medium">{t("Ore")}</th>
                <th className="px-4 py-3 text-right font-medium">{t("Quota")}</th>
              </tr>
            </thead>
            <tbody>
              {righe.map((row) => (
                <Fragment key={row.label}>
                  <tr
                    className="cursor-pointer border-b hover:bg-muted/30"
                    onClick={() => toggleRow(row.label)}
                  >
                    <td className="px-4 py-2.5">
                      <ChevronRight
                        className={cn(
                          "mr-1 inline size-4 transition-transform",
                          open.has(row.label) && "rotate-90",
                        )}
                      />
                      {row.label}
                    </td>
                    <td className="px-4 py-2.5 text-right font-medium">{formatHours(row.hours)}</td>
                    {/* Quota sul totale del mese: quanto pesa questo progetto,
                      o quanto ha lavorato questa persona. */}
                    <td className="px-4 py-2.5 text-right tabular-nums text-muted-foreground">
                      {total > 0 ? `${Math.round((row.hours / total) * 100)}%` : "—"}
                    </td>
                  </tr>
                  {open.has(row.label) &&
                    row.figli.map((figlio) => (
                      <tr key={figlio.id} className="border-b bg-muted/20 text-muted-foreground">
                        <td className="px-4 py-1.5 pl-10">
                          <span className={cn(!figlio.isActive && "text-red-600")}>
                            {figlio.label}
                          </span>
                        </td>
                        <td className="px-4 py-1.5 text-right">{formatHours(figlio.hours)}</td>
                        {/* Quota **dentro la riga**: la fetta di questa persona
                          su quel progetto, o di quel progetto sul mese di
                          questa persona. È il numero che si stava cercando. */}
                        <td className="px-4 py-1.5 text-right tabular-nums">
                          {row.hours > 0 ? `${Math.round((figlio.hours / row.hours) * 100)}%` : "—"}
                        </td>
                      </tr>
                    ))}
                </Fragment>
              ))}
              {(rows?.length ?? 0) === 0 && (
                <tr>
                  <td colSpan={3} className="p-6 text-center text-muted-foreground">
                    {periodKind(period) === "week"
                      ? t("Nessuna ora registrata nella settimana.")
                      : t("Nessuna ora registrata nel mese.")}
                  </td>
                </tr>
              )}
            </tbody>
            {(rows?.length ?? 0) > 0 && (
              <tfoot>
                <tr className="bg-muted/50 font-medium">
                  <td className="px-4 py-2.5">{t("Totale")}</td>
                  <td className="px-4 py-2.5 text-right">{formatHours(total)}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums">100%</td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      )}
    </div>
  );
}

/**
 * **Produttività e impegno**: ore rendicontate contro ore da contratto, per
 * persona e per settimana, e come ognuno ha distribuito il proprio tempo.
 *
 * Due avvertenze stanno in pagina e non solo qui, perché senza si legge male:
 *
 *  - **le ore non registrate non sono ore non lavorate.** La copertura dice
 *    quanto del contratto è *rendicontato*: è una misura di quanto si scrive,
 *    prima che di quanto si lavora;
 *  - **si contano settimane intere.** Una settimana appartiene al mese del suo
 *    giovedì, quindi il totale qui può non coincidere con quello del Riepilogo,
 *    che taglia sul mese di calendario. È voluto: confrontare le ore con un
 *    contratto settimanale su un periodo che non è una settimana produce scarti
 *    che nessuno sa spiegare.
 */
