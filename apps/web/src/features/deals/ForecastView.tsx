// Copyright (c) 2026 Jugaad s.r.l.
// SPDX-License-Identifier: AGPL-3.0-only

import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { ChevronUp, History } from "lucide-react";
import { cn } from "@/lib/utils";
import { useMoney } from "@/lib/money";
import { useListPrefs } from "@/lib/useListPrefs";
import { ForecastWeeksChart } from "./ForecastWeeksChart";
import {
  buildForecast,
  currentMonthKey,
  formatShare,
  isInForecastTotal,
  isPastForecastMonth,
  sumForecastMonths,
  type ForecastDeal,
} from "./forecast";

/** Forecast mensile: offerte raggruppate per mese di chiusura prevista. */
export function ForecastView({
  deals,
  coverage,
  showLostValue = false,
  monthFilter = [],
}: {
  deals: ForecastDeal[];
  /**
   * Quota del valore del mese rappresentata da queste offerte, per chiave di mese.
   * La passa l'area monitor vendite, che vede una parte del quadro e deve dire
   * quale parte; dentro l'azienda non serve, perché il quadro è intero.
   */
  coverage?: Record<string, number | null>;
  /**
   * Accanto al numero delle perse, fra parentesi, anche quanto valevano. Lo
   * chiede l'area monitor vendite per chi vede tutte le offerte (01/10/2026):
   * resta un'informazione a parte, i totali continuano a pesarle zero.
   */
  showLostValue?: boolean;
  /**
   * I mesi scelti nel filtro per mese (03/10/2026). Le offerte arrivano già
   * filtrate; con dei mesi scelti il periodo del totale e del grafico sono loro,
   * tutti mostrati nell'elenco, e le etichette dei mesi passati non servono.
   */
  monthFilter?: readonly string[];
}) {
  const { t } = useTranslation();
  const money = useMoney();
  const months = useMemo(() => buildForecast(deals), [deals]);

  // I mesi passati sono storia, non previsione: si riducono a etichette in alto
  // e la lista parte da quello corrente. Un'etichetta cliccata riapre il suo
  // mese al posto giusto dell'elenco, e dal box lo si richiude.
  const nowKey = currentMonthKey();
  // I mesi riaperti cambiano il totale: si ricordano, come ogni selezione.
  const { prefs, update } = useListPrefs<{ riaperti: string[] }>("kancrm-forecast-reopened", {
    riaperti: [],
  });
  const riaperti = prefs.riaperti;
  const passati = months.filter((m) => isPastForecastMonth(m.key, nowKey));
  const filtroMesi = monthFilter.length > 0;
  const visibili = filtroMesi
    ? months
    : months.filter((m) => !isPastForecastMonth(m.key, nowKey) || riaperti.includes(m.key));
  const commuta = (key: string) =>
    update({
      riaperti: riaperti.includes(key) ? riaperti.filter((k) => k !== key) : [...riaperti, key],
    });

  const maxWeighted = Math.max(1, ...months.map((m) => m.weighted));
  // Il totale in testa: da questo mese a dicembre, più i mesi passati riaperti
  // (`isInForecastTotal`). I mesi passati dell'anno hanno anche la loro riga di
  // consuntivo, sommata con la stessa logica.
  const previsione = sumForecastMonths(
    filtroMesi ? months : months.filter((m) => isInForecastTotal(m.key, nowKey, riaperti)),
  );
  const annoCorrente = nowKey.slice(0, 4);
  const mesiScelti = passati.filter((m) => riaperti.includes(m.key)).map((m) => m.key);
  const consuntivo = sumForecastMonths(passati.filter((m) => m.key.startsWith(annoCorrente)));

  /**
   * Quota condivisa, attaccata al **pesato**: è il rapporto fra due valori attesi,
   * calcolati con la stessa regola (vinta 100%, persa 0%, aperta la sua
   * probabilità). Accanto al totale nominale sembrava dire un'altra cosa — una
   * trattativa persa da 20.000 € è una fetta grossa del mese e vale zero.
   */
  const shareLabel = (month: (typeof months)[number]) => {
    const share = formatShare(coverage?.[month.key]);
    if (!share) return null;
    return (
      <span
        title={t(
          "I {{amount}} attesi dalle offerte condivise con te sono il {{share}} di quanto questo mese si aspetta in tutto (importo per probabilità: vinte 100%, perse 0%)",
          { amount: money.format(month.weighted), share },
        )}
      >
        {" · "}
        <span className="font-medium text-foreground">{share}</span> {t("del previsto del mese")}
      </span>
    );
  };

  /** "4 perse", e per chi deve vederlo "4 perse (12.000 €)". */
  const lostLabel = (count: number, value: number) =>
    t("{{count}} perse", { count }) + (showLostValue ? ` (${money.format(value)})` : "");

  const monthLabel = (key: string) => {
    if (key === "senza-data") return t("Senza data di chiusura");
    return new Intl.DateTimeFormat("it-IT", { month: "long", year: "numeric" }).format(
      new Date(`${key}-01T12:00:00Z`),
    );
  };

  if (deals.length === 0) {
    return (
      <div className="rounded-lg border border-dashed p-10 text-center text-sm text-muted-foreground">
        {t("Nessuna offerta da prevedere.")}
      </div>
    );
  }

  return (
    <div className="flex max-w-3xl flex-col gap-4">
      <p className="text-sm text-muted-foreground">
        {t(
          "{{period}}: {{total}} è il valore pieno delle offerte aperte e vinte, {{weighted}} quello che ci si aspetta di incassare (il pesato: ogni offerta aperta per la sua probabilità, le vinte per intero). Le offerte senza data contano a dicembre, le perse non contano.",
          {
            period: filtroMesi
              ? t("Mesi scelti ({{months}})", { months: monthFilter.map(monthLabel).join(", ") })
              : t("Da questo mese a dicembre {{year}}", { year: annoCorrente }) +
                (mesiScelti.length > 0
                  ? t(", più {{months}}", { months: mesiScelti.map(monthLabel).join(", ") })
                  : ""),
            total: money.format(previsione.total),
            weighted: money.format(previsione.weighted),
          },
        )}
      </p>
      {passati.length > 0 && !filtroMesi && (
        <div className="flex flex-wrap items-center gap-1.5">
          <span
            className="inline-flex items-center gap-1 text-xs text-muted-foreground"
            title={t("Mesi già conclusi: clicca un'etichetta per riaprirli nell'elenco")}
          >
            <History className="size-3.5" /> {t("Passati:")}
          </span>
          {passati.map((month) => {
            const aperto = riaperti.includes(month.key);
            return (
              <button
                key={month.key}
                type="button"
                onClick={() => commuta(month.key)}
                title={
                  aperto
                    ? t("Riduci di nuovo a etichetta")
                    : t("{{count}} offerte · pesato {{weighted}} — mostra nell'elenco", {
                        count: month.count + month.lostCount,
                        weighted: money.format(month.weighted),
                      })
                }
                className={cn(
                  "rounded-full border px-2.5 py-0.5 text-xs font-medium capitalize transition-colors",
                  aperto
                    ? "border-primary bg-primary/10 text-primary"
                    : "text-muted-foreground hover:bg-muted",
                )}
              >
                {monthLabel(month.key)}
              </button>
            );
          })}
          {consuntivo.count + consuntivo.lostCount > 0 && (
            <span
              className="text-xs text-muted-foreground"
              title={t(
                "I mesi già conclusi del {{year}}: quanto si è vinto, e le offerte rimaste aperte con la data di chiusura passata — da aggiornare, perché la previsione le conta ancora per la loro probabilità",
                { year: annoCorrente },
              )}
            >
              {t("— {{year}} fin qui:", { year: annoCorrente })}{" "}
              <span className="font-medium text-foreground">
                {consuntivo.wonCount > 0
                  ? t("{{amount}} vinti con {{count}} offerte", {
                      amount: money.format(consuntivo.wonTotal),
                      count: consuntivo.wonCount,
                    })
                  : t("nessuna offerta vinta")}
              </span>
              {consuntivo.count > consuntivo.wonCount &&
                ` · ${t(
                  "{{count}} ancora aperte con la data passata: {{amount}}, pesate {{weighted}}",
                  {
                    count: consuntivo.count - consuntivo.wonCount,
                    amount: money.format(consuntivo.total - consuntivo.wonTotal),
                    weighted: money.format(consuntivo.weighted - consuntivo.wonTotal),
                  },
                )}`}
              {consuntivo.lostCount > 0 &&
                ` · ${lostLabel(consuntivo.lostCount, consuntivo.lostTotal)}`}
            </span>
          )}
        </div>
      )}
      <ForecastWeeksChart deals={deals} nowKey={nowKey} reopened={riaperti} scelti={monthFilter} />
      <ul className="flex flex-col gap-3">
        {visibili.map((month) => (
          <li key={month.key} className="rounded-lg border bg-card p-4">
            <div className="mb-2 flex items-baseline justify-between gap-2">
              <span className="font-semibold capitalize">{monthLabel(month.key)}</span>
              <span className="text-sm text-muted-foreground">
                {month.count > 0
                  ? t("{{count}} offerte", { count: month.count })
                  : t("nessuna in previsione")}
                {month.lostCount > 0 && (
                  <span title={t("Trattative perse in questo mese: non entrano nei totali")}>
                    {" · "}
                    {lostLabel(month.lostCount, month.lostTotal)}
                  </span>
                )}
                {!filtroMesi && isPastForecastMonth(month.key, nowKey) && (
                  <button
                    type="button"
                    onClick={() => commuta(month.key)}
                    title={t("Riduci a etichetta")}
                    aria-label={t("Riduci {{month}} a etichetta", { month: monthLabel(month.key) })}
                    className="ml-1 inline-flex align-middle text-muted-foreground hover:text-foreground"
                  >
                    <ChevronUp className="size-4" />
                  </button>
                )}
              </span>
            </div>
            <div className="mb-1.5 h-3 overflow-hidden rounded-full bg-muted">
              <div
                className="h-full rounded-full bg-primary"
                style={{ width: `${Math.round((month.weighted / maxWeighted) * 100)}%` }}
              />
            </div>
            <p className="text-sm">
              <span
                title={t(
                  "Pesato: quanto ci si aspetta di incassare — ogni offerta aperta per la sua probabilità, le vinte per intero, le perse zero",
                )}
              >
                <span className="font-medium">{money.format(month.weighted)}</span>
                <span className="text-muted-foreground"> {t("pesato")}</span>
              </span>
              <span className="text-muted-foreground">
                {shareLabel(month)} ·{" "}
                <span
                  title={t(
                    "Totale: il valore pieno delle offerte aperte e vinte del mese, senza le perse",
                  )}
                >
                  {money.format(month.total)} {t("totale")}
                </span>
                {month.wonCount > 0 &&
                  ` · ${t("di cui {{amount}} vinti", { amount: money.format(month.wonTotal) })}`}
              </span>
            </p>
          </li>
        ))}
      </ul>
    </div>
  );
}
