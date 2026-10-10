// Copyright (c) 2026 Jugaad s.r.l.
// SPDX-License-Identifier: AGPL-3.0-only

import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Input } from "@/components/ui/input";
import { DateField } from "@/components/ui/date-field";
import { Label } from "@/components/ui/label";
import { formatDate } from "@/features/tasks/task-utils";
import { useRecurrencePreview } from "./useRecurrence";

type PresetKind = "daily" | "everyNDays" | "weekly" | "monthly" | "yearly" | "custom";

/** Dove cade la scadenza dentro il mese (per tutte le cadenze mensili). */
type MonthMode = "day" | "nth" | "lastDay";

interface BuilderState {
  kind: PresetKind;
  intervalDays: number; // everyNDays
  weekday: string; // weekly / monthMode "nth" (MO..SU)
  weekInterval: number; // weekly
  monthMode: MonthMode; // monthly
  monthDay: number; // monthMode "day"
  monthInterval: number; // monthly: 1 = mensile, 2 = bimestrale, 3 = trimestrale, 6 = semestrale
  setPos: number; // monthMode "nth" (1..4, -1)
  custom: string; // custom rrule
}

const WEEKDAYS: Array<{ code: string; label: string }> = [
  { code: "MO", label: "lunedì" },
  { code: "TU", label: "martedì" },
  { code: "WE", label: "mercoledì" },
  { code: "TH", label: "giovedì" },
  { code: "FR", label: "venerdì" },
  { code: "SA", label: "sabato" },
  { code: "SU", label: "domenica" },
];

/**
 * Cadenze mensili offerte nella tendina "Frequenza". Erano raggiungibili solo da
 * una seconda tendina, dopo aver scelto "Mensile": chi cercava "trimestrale" non
 * la trovava. L'intervallo è il numero di mesi tra un'occorrenza e la successiva.
 */
const MONTH_INTERVALS: Array<{ value: number; label: string }> = [
  { value: 1, label: "Mensile" },
  { value: 2, label: "Bimestrale (ogni 2 mesi)" },
  { value: 3, label: "Trimestrale (ogni 3 mesi)" },
  { value: 6, label: "Semestrale (ogni 6 mesi)" },
];

const MONTH_MODES: Array<{ value: MonthMode; label: string }> = [
  { value: "day", label: "il giorno fisso" },
  { value: "nth", label: "l'N-esimo giorno della settimana" },
  { value: "lastDay", label: "l'ultimo giorno del mese" },
];

const SET_POSITIONS: Array<{ value: number; label: string }> = [
  { value: 1, label: "primo" },
  { value: 2, label: "secondo" },
  { value: 3, label: "terzo" },
  { value: 4, label: "quarto" },
  { value: -1, label: "ultimo" },
];

export function buildRRule(state: BuilderState): string | null {
  const monthPart = state.monthInterval > 1 ? `;INTERVAL=${state.monthInterval}` : "";
  switch (state.kind) {
    case "daily":
      return "FREQ=DAILY";
    case "everyNDays":
      return state.intervalDays >= 1 ? `FREQ=DAILY;INTERVAL=${state.intervalDays}` : null;
    case "weekly":
      return `FREQ=WEEKLY${state.weekInterval > 1 ? `;INTERVAL=${state.weekInterval}` : ""};BYDAY=${state.weekday}`;
    case "monthly":
      if (state.monthMode === "lastDay") return `FREQ=MONTHLY${monthPart};BYMONTHDAY=-1`;
      if (state.monthMode === "nth") {
        return `FREQ=MONTHLY${monthPart};BYDAY=${state.weekday};BYSETPOS=${state.setPos}`;
      }
      return state.monthDay >= 1 && state.monthDay <= 31
        ? `FREQ=MONTHLY${monthPart};BYMONTHDAY=${state.monthDay}`
        : null;
    case "yearly":
      return "FREQ=YEARLY";
    case "custom":
      return state.custom.trim() || null;
  }
}

/** Ricostruisce lo stato del builder da una RRULE esistente (per la modifica). */
export function parseToBuilderState(rrule: string): BuilderState {
  const defaults: BuilderState = {
    kind: "custom",
    intervalDays: 15,
    weekday: "MO",
    weekInterval: 1,
    monthMode: "day",
    monthDay: 15,
    monthInterval: 1,
    setPos: 2,
    custom: rrule,
  };
  const parts = new Map(
    rrule
      .split(";")
      .filter(Boolean)
      .map((piece) => {
        const [key, value] = piece.split("=");
        return [key?.toUpperCase() ?? "", value ?? ""] as const;
      }),
  );
  const freq = parts.get("FREQ")?.toUpperCase();
  const interval = Number(parts.get("INTERVAL") ?? 1);
  const byday = parts.get("BYDAY");
  const bymonthday = parts.get("BYMONTHDAY");
  const bysetpos = parts.get("BYSETPOS");

  if (freq === "DAILY") {
    return interval === 1
      ? { ...defaults, kind: "daily" }
      : { ...defaults, kind: "everyNDays", intervalDays: interval };
  }
  if (freq === "WEEKLY" && byday && !byday.includes(",")) {
    return { ...defaults, kind: "weekly", weekday: byday, weekInterval: interval };
  }
  // Un intervallo fuori dalle cadenze offerte (es. ogni 5 mesi) non è
  // rappresentabile nella tendina: resta modificabile come regola avanzata.
  if (freq === "MONTHLY" && MONTH_INTERVALS.some((option) => option.value === interval)) {
    const monthly = { ...defaults, kind: "monthly" as const, monthInterval: interval };
    if (bymonthday === "-1") return { ...monthly, monthMode: "lastDay" };
    if (bymonthday) return { ...monthly, monthMode: "day", monthDay: Number(bymonthday) };
    if (byday && bysetpos) {
      return { ...monthly, monthMode: "nth", weekday: byday, setPos: Number(bysetpos) };
    }
  }
  if (freq === "YEARLY" && interval === 1) return { ...defaults, kind: "yearly" };
  return defaults;
}

interface RecurrenceBuilderProps {
  initialRRule?: string;
  dtstart: string;
  onDtstartChange: (value: string) => void;
  onRRuleChange: (rrule: string | null) => void;
}

export function RecurrenceBuilder({
  initialRRule,
  dtstart,
  onDtstartChange,
  onRRuleChange,
}: RecurrenceBuilderProps) {
  const { t } = useTranslation();
  const [state, setState] = useState<BuilderState>(() =>
    initialRRule
      ? parseToBuilderState(initialRRule)
      : {
          kind: "monthly",
          intervalDays: 15,
          weekday: "MO",
          weekInterval: 1,
          monthMode: "day",
          monthDay: 15,
          monthInterval: 1,
          setPos: 2,
          custom: "",
        },
  );

  const rrule = useMemo(() => buildRRule(state), [state]);
  // Notifica il padre a ogni cambiamento della regola.
  const notifiedRef = useState<{ current: string | null }>({ current: null })[0];
  if (notifiedRef.current !== rrule) {
    notifiedRef.current = rrule;
    onRRuleChange(rrule);
  }

  const preview = useRecurrencePreview(rrule, dtstart);
  const update = (patch: Partial<BuilderState>) => setState((prev) => ({ ...prev, ...patch }));

  const selectClass = "h-9 rounded-md border bg-background px-2 text-sm";

  return (
    <div className="flex flex-col gap-3 rounded-md border p-3">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div className="flex flex-col gap-1.5">
          <Label>{t("Frequenza")}</Label>
          {/* Le cadenze mensili sono voci di primo livello: "monthly-3" = trimestrale. */}
          <select
            className={selectClass}
            value={state.kind === "monthly" ? `monthly-${state.monthInterval}` : state.kind}
            onChange={(e) => {
              const value = e.target.value;
              update(
                value.startsWith("monthly-")
                  ? { kind: "monthly", monthInterval: Number(value.slice("monthly-".length)) }
                  : { kind: value as PresetKind },
              );
            }}
          >
            <option value="daily">{t("Ogni giorno")}</option>
            <option value="everyNDays">{t("Ogni N giorni (es. quindicinale)")}</option>
            <option value="weekly">{t("Settimanale")}</option>
            {MONTH_INTERVALS.map((option) => (
              <option key={option.value} value={`monthly-${option.value}`}>
                {t(option.label)}
              </option>
            ))}
            <option value="yearly">{t("Annuale")}</option>
            <option value="custom">{t("Avanzata (RRULE)")}</option>
          </select>
        </div>
        <div className="flex flex-col gap-1.5">
          <Label>{t("Prima occorrenza")}</Label>
          <DateField value={dtstart} onCommit={(v) => onDtstartChange(v ?? "")} />
        </div>
      </div>

      {state.kind === "everyNDays" && (
        <div className="flex items-center gap-2 text-sm">
          {t("Ogni")}
          <Input
            type="number"
            min={1}
            max={365}
            className="w-20"
            value={state.intervalDays}
            onChange={(e) => update({ intervalDays: Number(e.target.value) })}
          />
          {t("giorni")} <span className="text-muted-foreground">{t("(15 = quindicinale)")}</span>
        </div>
      )}

      {state.kind === "weekly" && (
        <div className="flex items-center gap-2 text-sm">
          {t("Ogni")}
          <select
            className={selectClass}
            value={state.weekInterval}
            onChange={(e) => update({ weekInterval: Number(e.target.value) })}
          >
            <option value={1}>{t("settimana")}</option>
            <option value={2}>{t("2 settimane")}</option>
            <option value={3}>{t("3 settimane")}</option>
            <option value={4}>{t("4 settimane")}</option>
          </select>
          {t("il")}
          <select
            className={selectClass}
            value={state.weekday}
            onChange={(e) => update({ weekday: e.target.value })}
          >
            {WEEKDAYS.map((day) => (
              <option key={day.code} value={day.code}>
                {t(day.label)}
              </option>
            ))}
          </select>
        </div>
      )}

      {state.kind === "monthly" && (
        <div className="flex flex-wrap items-center gap-2 text-sm">
          {t("Scade")}
          <select
            className={selectClass}
            value={state.monthMode}
            onChange={(e) => update({ monthMode: e.target.value as MonthMode })}
          >
            {MONTH_MODES.map((option) => (
              <option key={option.value} value={option.value}>
                {t(option.label)}
              </option>
            ))}
          </select>
          {state.monthMode === "day" && (
            <Input
              type="number"
              min={1}
              max={31}
              className="w-20"
              value={state.monthDay}
              onChange={(e) => update({ monthDay: Number(e.target.value) })}
            />
          )}
          {state.monthMode === "nth" && (
            <>
              <select
                className={selectClass}
                value={state.setPos}
                onChange={(e) => update({ setPos: Number(e.target.value) })}
              >
                {SET_POSITIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {t(option.label)}
                  </option>
                ))}
              </select>
              <select
                className={selectClass}
                value={state.weekday}
                onChange={(e) => update({ weekday: e.target.value })}
              >
                {WEEKDAYS.map((day) => (
                  <option key={day.code} value={day.code}>
                    {t(day.label)}
                  </option>
                ))}
              </select>
            </>
          )}
        </div>
      )}

      {state.kind === "custom" && (
        <div className="flex flex-col gap-1.5">
          <Label>{t("Stringa RRULE (RFC 5545)")}</Label>
          <Input
            placeholder={t("es. FREQ=MONTHLY;BYDAY=TU;BYSETPOS=2")}
            value={state.custom}
            onChange={(e) => update({ custom: e.target.value })}
          />
        </div>
      )}

      <div className="rounded-md bg-muted/50 p-3 text-sm">
        {preview.data ? (
          <>
            <p className="font-medium">
              {t("Si ripete {{ruleText}}.", { ruleText: preview.data.ruleText })}
            </p>
            <p className="mt-1 text-muted-foreground">
              {t("Prossime occorrenze: {{dates}}", {
                dates: preview.data.occurrences.map(formatDate).join(", "),
              })}
            </p>
          </>
        ) : preview.isError ? (
          <p className="text-destructive">{t("Regola non valida.")}</p>
        ) : (
          <p className="text-muted-foreground">{t("Anteprima occorrenze…")}</p>
        )}
      </div>
    </div>
  );
}
