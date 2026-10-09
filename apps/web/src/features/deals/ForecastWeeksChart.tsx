import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { weekStartOf } from "@kancrm/shared";
import { cn } from "@/lib/utils";
import { useMoney } from "@/lib/money";
import { todayISO } from "@/features/tasks/task-utils";
import { buildForecastWeeks, type ForecastWeek } from "./forecast-weeks";
import type { ForecastDeal } from "./forecast";

/**
 * **La previsione per settimana** (01/10/2026), sulla stessa selezione del
 * totale in testa. In alto i KPI del periodo; sotto una riga per settimana: a
 * sinistra il ventaglio degli importi (dal più piccolo al più grande, il punto è
 * la media), a destra quante offerte. Due scale separate, ciascuna sul massimo
 * del periodo: un importo e un conteggio non stanno sullo stesso asse.
 *
 * Niente libreria di grafici: sono barre in CSS, come quelle dei mesi.
 */
export function ForecastWeeksChart({
  deals,
  nowKey,
  reopened,
  scelti = [],
}: {
  deals: ForecastDeal[];
  nowKey: string;
  reopened: readonly string[];
  /** Mesi del filtro per mese: se ci sono, sono loro il periodo. */
  scelti?: readonly string[];
}) {
  const { t } = useTranslation();
  const money = useMoney();
  const { weeks, kpi } = useMemo(
    () => buildForecastWeeks(deals, nowKey, reopened, scelti),
    [deals, nowKey, reopened, scelti],
  );
  const scalaValori = Math.max(1, ...weeks.map((w) => w.max ?? 0));
  const scalaNumero = Math.max(1, ...weeks.map((w) => w.count));
  const settimanaCorrente = weekStartOf(todayISO());
  const importo = (v: number | null) => (v === null ? "—" : money.format(v));

  const etichetta = (w: ForecastWeek) => {
    const giorno = (iso: string) => Number(iso.slice(8, 10));
    const mese = (iso: string) =>
      new Intl.DateTimeFormat("it-IT", { month: "short" }).format(new Date(`${iso}T12:00:00Z`));
    return w.start.slice(5, 7) === w.end.slice(5, 7)
      ? `${giorno(w.start)}–${giorno(w.end)} ${mese(w.end)}`
      : `${giorno(w.start)} ${mese(w.start)} – ${giorno(w.end)} ${mese(w.end)}`;
  };

  const kpiVoci: Array<{ nome: string; valore: string; aiuto?: string }> = [
    { nome: t("Offerte"), valore: String(kpi.count) },
    { nome: t("Valore pieno"), valore: money.format(kpi.total) },
    {
      nome: t("Pesato"),
      valore: money.format(kpi.weighted),
      aiuto: t("Ogni offerta aperta per la sua probabilità, le vinte per intero"),
    },
    {
      nome: t("Vinte"),
      valore: `${money.format(kpi.wonTotal)} (${kpi.wonCount})`,
    },
    { nome: t("Importo minimo"), valore: importo(kpi.min) },
    { nome: t("Importo medio"), valore: importo(kpi.avg) },
    { nome: t("Importo massimo"), valore: importo(kpi.max) },
    {
      nome: t("Senza data"),
      valore: String(kpi.undatedCount),
      aiuto: t("Contate a dicembre, sparse sulla prima metà del mese"),
    },
  ];

  return (
    <section className="rounded-lg border bg-card p-4">
      <h3 className="text-sm font-semibold">{t("Per settimana")}</h3>
      <p className="mt-0.5 text-xs text-muted-foreground">
        {t("Lo stesso periodo del totale; le perse non contano.")}
        {kpi.undatedCount > 0 &&
          ` ${t("{{count}} offerte senza data sono sparse sulla prima metà di dicembre.", {
            count: kpi.undatedCount,
          })}`}
      </p>

      <dl className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
        {kpiVoci.map((voce) => (
          <div key={voce.nome} className="rounded-md bg-muted/50 px-3 py-2" title={voce.aiuto}>
            <dt className="text-xs text-muted-foreground">{voce.nome}</dt>
            <dd className="text-sm font-semibold tabular-nums">{voce.valore}</dd>
          </div>
        ))}
      </dl>

      <p className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
        <span className="inline-flex items-center gap-1.5">
          <span className="inline-block h-2.5 w-6 rounded-full bg-primary/30" />
          {t("gli importi della settimana, dal più piccolo al più grande")}
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="inline-block size-2.5 rounded-full bg-primary" />
          {t("la media")}
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="inline-block h-2.5 w-4 rounded-sm bg-sky-500/70" />
          {t("quante offerte")}
        </span>
      </p>

      <div className="mt-2 grid grid-cols-[5.5rem_minmax(0,1fr)_4.5rem] items-center gap-x-3 gap-y-1 text-xs sm:grid-cols-[7.5rem_minmax(0,1fr)_11rem_6rem]">
        {/* intestazione */}
        <span className="text-muted-foreground">{t("Settimana")}</span>
        <span className="text-muted-foreground">{t("Importi")}</span>
        <span className="hidden sm:block" />
        <span className="text-right text-muted-foreground">{t("Offerte")}</span>

        {weeks.map((w) => {
          const corrente = w.start === settimanaCorrente;
          const sx = w.min !== null ? (w.min / scalaValori) * 100 : 0;
          const dx = w.max !== null ? (w.max / scalaValori) * 100 : 0;
          const media = w.avg !== null ? (w.avg / scalaValori) * 100 : 0;
          const descrizione =
            w.count === 0
              ? t("Nessuna offerta")
              : t("{{count}} offerte · da {{min}} a {{max}}, media {{avg}} · pesato {{weighted}}", {
                  count: w.count,
                  min: importo(w.min),
                  max: importo(w.max),
                  avg: importo(w.avg),
                  weighted: money.format(w.weighted),
                });
          return (
            <div key={w.start} className="contents" title={descrizione}>
              <span
                className={cn(
                  "truncate py-1 tabular-nums",
                  corrente ? "font-semibold text-foreground" : "text-muted-foreground",
                )}
              >
                {etichetta(w)}
              </span>
              <span className="relative h-5">
                <span className="absolute inset-x-0 top-1/2 h-px -translate-y-1/2 bg-border" />
                {w.min !== null && (
                  <>
                    <span
                      className="absolute top-1/2 h-2.5 -translate-y-1/2 rounded-full bg-primary/30"
                      style={{ left: `${sx}%`, width: `max(${dx - sx}%, 4px)` }}
                    />
                    <span
                      className="absolute top-1/2 size-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-primary ring-2 ring-card"
                      style={{ left: `${media}%` }}
                    />
                  </>
                )}
              </span>
              <span className="hidden truncate text-right tabular-nums text-muted-foreground sm:block">
                {w.min === null
                  ? ""
                  : w.min === w.max
                    ? importo(w.min)
                    : `${importo(w.min)} – ${importo(w.max)}`}
              </span>
              <span className="flex items-center justify-end gap-1.5">
                {w.count > 0 && (
                  <span
                    className="h-2.5 rounded-sm bg-sky-500/70"
                    style={{ width: `${Math.max(8, (w.count / scalaNumero) * 40)}px` }}
                  />
                )}
                <span className="w-4 text-right tabular-nums">{w.count > 0 ? w.count : ""}</span>
              </span>
            </div>
          );
        })}
      </div>
    </section>
  );
}
