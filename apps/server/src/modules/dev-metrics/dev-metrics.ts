// Copyright (c) 2026 Jugaad s.r.l.
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * L'andamento della squadra tecnica: i numeri del pannello in "La mia giornata".
 *
 * Qui c'è **solo il calcolo**, senza banca dati, perché è dove stanno le
 * decisioni che si possono sbagliare in silenzio — e infatti la misura sui dati
 * veri (18/08/2026) ne ha corrette due prima ancora di scrivere il pannello:
 *
 *  1. **Il task nato già chiuso non è lavoro veloce, è lavoro registrato dopo.**
 *     Su 53 task chiusi dopo il go-live, 22 erano stati creati e chiusi nella
 *     stessa ora — e la ripartizione era impietosa (una persona 14 su 15). Una
 *     classifica sulla velocità avrebbe premiato *l'abitudine a scrivere il task
 *     alla fine*, non la rapidità. Quei task restano contati (il lavoro c'è
 *     stato) ma **fuori dai tempi**, in una voce loro.
 *  2. **Lo storico importato non è lavoro di questo mese.** Dei 155 task tecnici
 *     "chiusi" nelle ultime quattro settimane, **104 erano archivio** caricato
 *     da ClickUp e osTicket con la sua data d'origine — alcuni del 2023. Il
 *     tempo mediano di squadra usciva **156 giorni**. Si riconoscono senza
 *     bisogno di un contrassegno: la loro data di creazione **precede la prima
 *     traccia che hanno lasciato qui dentro** (vedi `isImportedHistory`), e sui
 *     dati veri i due gruppi non si toccano nemmeno — 51 task con scarto zero,
 *     104 oltre i tre giorni, niente in mezzo.
 *  3. **Le ore danno la taglia.** "Venti task contro sette" non vuol dire niente
 *     con task che vanno da un'ora a undici: senza le ore per task il confronto
 *     tra persone è aria fritta, e infatti qui non esiste — i numeri personali
 *     si leggono contro i propri mesi precedenti, mai in classifica.
 *
 * Terza regola, che non viene dai dati ma dal buon senso: **mai una graduatoria
 * sul monte ore**. Premiare chi ne registra di più è l'unico incentivo capace di
 * corrompere il dato stesso, e il timesheet serve a fatturare.
 */

import { mondayOf, toDateOnly } from "../../lib/date";
// `median` e `quantile` stanno in lib/stats (il vuoto è `null`, come qui);
// l'export li lascia dov'erano per chi li ha sempre presi da questo modulo.
import { median, quantile } from "../../lib/stats";
export { median, quantile };

/** Un task chiuso, ridotto a ciò che serve al calcolo. */
export interface ClosedTask {
  id: string;
  assigneeId: string | null;
  createdAt: Date;
  closedAt: Date;
  /**
   * La **prima traccia lasciata qui dentro** (la riga più vecchia del registro
   * attività). Su un task nato in KeelOps coincide con la creazione; su un
   * record importato è il momento dell'importazione, mesi dopo la data
   * d'origine — ed è così che si distinguono i due.
   */
  firstLogAt: Date | null;
  /** Primo cambio di stato registrato, se c'è. */
  firstChangeAt: Date | null;
  /** Ore a timesheet su quel task, da chiunque. */
  hours: number;
}

/** Soglia sotto la quale un task "non ha vissuto": è stato scritto a cose fatte. */
export const BORN_CLOSED_MINUTES = 60;

export function isBornClosed(task: { createdAt: Date; closedAt: Date }): boolean {
  return (task.closedAt.getTime() - task.createdAt.getTime()) / 60_000 < BORN_CLOSED_MINUTES;
}

/**
 * **Archivio, non lavoro**: la data di creazione del record precede di più di un
 * giorno la sua prima traccia nel registro attività, quindi è una data copiata
 * da un altro sistema. Un task senza nessuna traccia non si può datare, e nel
 * dubbio resta fuori dalle misure invece di falsarle.
 *
 * Un giorno di tolleranza e non un'ora: un'importazione può girare a cavallo
 * della mezzanotte, e sui dati veri non cambia nulla (lo scarto o è zero o è di
 * mesi).
 */
export function isImportedHistory(task: { createdAt: Date; firstLogAt: Date | null }): boolean {
  if (!task.firstLogAt) return true;
  return task.firstLogAt.getTime() - task.createdAt.getTime() > 86_400_000;
}

const days = (from: Date, to: Date) => (to.getTime() - from.getTime()) / 86_400_000;



/**
 * I tre tempi, in giorni, **sui soli task che hanno vissuto**.
 *
 * - `presaInCarico`: dalla creazione al primo cambio di stato. Ha senso solo
 *   dove l'arrivo lo decide qualcun altro (un ticket, un task assegnato): su un
 *   task che uno si scrive da sé misura la distanza tra due sue azioni, quindi
 *   il pannello lo mostra accanto al numero di task su cui è calcolato.
 * - `lavorazione`: dal primo cambio alla chiusura.
 * - `totale`: creazione → chiusura.
 */
export interface Times {
  presaInCarico: number | null;
  lavorazione: number | null;
  totale: number | null;
  /** Su quanti task è calcolato: un tempo su tre task non è una tendenza. */
  campione: number;
  /** Quelli esclusi perché nati già chiusi: si dichiara, non si nasconde. */
  natiChiusi: number;
}

export function times(tasks: ClosedTask[]): Times {
  // L'archivio importato resta fuori anche qui, non solo a monte: è la rete che
  // impedisce a un chiamante nuovo di far ricomparire i 156 giorni.
  const propri = tasks.filter((task) => !isImportedHistory(task));
  const vissuti = propri.filter((task) => !isBornClosed(task));
  const conCambio = vissuti.filter((task) => task.firstChangeAt !== null);
  return {
    presaInCarico: median(conCambio.map((t) => days(t.createdAt, t.firstChangeAt!))),
    lavorazione: median(conCambio.map((t) => days(t.firstChangeAt!, t.closedAt))),
    totale: median(vissuti.map((t) => days(t.createdAt, t.closedAt))),
    campione: vissuti.length,
    natiChiusi: propri.length - vissuti.length,
  };
}

/** La taglia del lavoro: ore per task chiuso, con il campo di variazione. */
export interface Size {
  medianaOre: number | null;
  q25: number | null;
  q75: number | null;
  /** Quanti dei task chiusi hanno almeno un'ora registrata. */
  conOre: number;
  totali: number;
}

export function size(tasks: ClosedTask[]): Size {
  const conOre = tasks.filter((task) => task.hours > 0).map((task) => task.hours);
  return {
    medianaOre: median(conOre),
    q25: quantile(conOre, 0.25),
    q75: quantile(conOre, 0.75),
    conOre: conOre.length,
    totali: tasks.length,
  };
}

/**
 * Copertura del timesheet: **giorni compilati ÷ giorni in cui si è lavorato**.
 *
 * È un **comportamento**, non una prestazione: binario, raggiungibile da tutti,
 * e non si falsifica gonfiando le ore.
 *
 * Il denominatore sono i giorni lavorati, **non i giorni feriali del periodo**
 * (18/08/2026). Con i feriali, due settimane di ferie contavano come due
 * settimane di timesheet non compilato: una persona rientrata dalle vacanze
 * risultava al 35% quando in realtà aveva registrato sei giorni su sette
 * lavorati, cioè l'86%. "Ha lavorato" è la stessa regola dei promemoria del
 * venerdì (`timesheet/reminders.ts`, per inclusione: cambi di stato, note,
 * commenti, allegati) **unita ai giorni con ore**: si può registrare le ore di
 * un giorno senza aver toccato nessun record, ed è comunque un giorno lavorato.
 *
 * Il fine settimana resta fuori da entrambi i lati: chi lavora di sabato non
 * deve risultare più diligente di chi non lo fa.
 *
 * Senza nemmeno un giorno lavorato non c'è una percentuale da dare: `null`, che
 * in pagina si legge "—". Uno zero direbbe che chi era in ferie è in ritardo.
 */
export function coverage(
  /** Giorni con ore a timesheet (`YYYY-MM-DD`). */
  hoursDays: string[],
  /** Giorni con una traccia di lavoro, secondo la regola dei promemoria. */
  activeDays: string[],
  from: Date,
  to: Date,
): { compilati: number; lavorati: number; percento: number | null } {
  const feriali = new Set<string>();
  for (let day = new Date(from); day <= to; day.setUTCDate(day.getUTCDate() + 1)) {
    const weekday = day.getUTCDay();
    if (weekday !== 0 && weekday !== 6) feriali.add(day.toISOString().slice(0, 10));
  }
  const withHours = new Set(hoursDays.filter((day) => feriali.has(day)));
  const worked = new Set([...withHours, ...activeDays.filter((day) => feriali.has(day))]);
  return {
    compilati: withHours.size,
    lavorati: worked.size,
    percento: worked.size === 0 ? null : Math.round((withHours.size / worked.size) * 100),
  };
}

/**
 * Ripartizione delle ore per progetto, dalla più grande. Le ore **senza
 * progetto** non si buttano: sono un buco nella ripartizione (l'11% del totale,
 * alla prima misura) e chi guarda deve vederlo.
 */
export function hoursByProject(
  rows: Array<{ project: string | null; hours: number }>,
): Array<{ project: string | null; hours: number }> {
  const sums = new Map<string | null, number>();
  for (const row of rows) sums.set(row.project, (sums.get(row.project) ?? 0) + row.hours);
  return [...sums.entries()]
    .map(([project, hours]) => ({ project, hours: Math.round(hours * 10) / 10 }))
    .sort((a, b) => b.hours - a.hours);
}

/**
 * Il flusso della settimana: quanti ne sono entrati, quanti usciti. Due numeri
 * che insieme dicono se la coda cresce — l'unica domanda a cui una squadra può
 * rispondere agendo, mentre "quanti ne ha chiusi Tizio" non lo è.
 */
export function weeklyFlow(
  created: Date[],
  closed: Date[],
  weeks: string[],
): Array<{ week: string; entrati: number; usciti: number }> {
  const bucket = (date: Date) => mondayKeyOf(date);
  const entrati = new Map<string, number>();
  const usciti = new Map<string, number>();
  for (const date of created) entrati.set(bucket(date), (entrati.get(bucket(date)) ?? 0) + 1);
  for (const date of closed) usciti.set(bucket(date), (usciti.get(bucket(date)) ?? 0) + 1);
  return weeks.map((week) => ({
    week,
    entrati: entrati.get(week) ?? 0,
    usciti: usciti.get(week) ?? 0,
  }));
}

/** Il lunedì della settimana di una data (chiave `YYYY-MM-DD`, UTC). */
export function mondayKeyOf(date: Date): string {
  return toDateOnly(mondayOf(date));
}

/** Le ultime `count` settimane, dalla più vecchia: le colonne del grafico. */
export function lastWeeks(now: Date, count: number): string[] {
  const weeks: string[] = [];
  const cursor = new Date(now);
  for (let i = 0; i < count; i += 1) {
    weeks.unshift(mondayKeyOf(cursor));
    cursor.setUTCDate(cursor.getUTCDate() - 7);
  }
  return weeks;
}
