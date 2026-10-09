import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { ChevronLeft, ChevronRight, PanelRight, Plus, Trash2, LifeBuoy } from "lucide-react";
import { formatHours, parseHours, type TimesheetRow, type TimesheetTaskRef } from "@kancrm/shared";
import { ApiError } from "@/lib/api";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { useConfirm } from "@/components/ui/confirm";
import { useToast } from "@/components/ui/toast";
import { Input } from "@/components/ui/input";
import { intentOf } from "./grid-keys";
import { todayISO } from "@/features/tasks/task-utils";
import { useDebouncedValue } from "@/lib/useDebouncedValue";
import { localeTag } from "@/lib/i18n";
import { useAddRow, useDeleteRow, useTimesheetPeriod, useUpsertEntry, useVisibleTasks } from "./useTimesheet";
import { RigheDalleAttivita, useOreSuggerite } from "@/edition/slot-pagine";

/** Without the commercial timesheet there are no suggested hours. */
const nessunSuggerimento = () => ({ data: undefined });
import { AttachmentsPeek, CommentsPeek } from "@/features/tasks/TaskPeek";
import { useRecordOpener } from "@/features/tasks/useRecordOpener";
import { cellKey, dayFlag, dayTotals, monthTotal } from "./totals";
import { daysOfPeriod } from "./period";

/**
 * **La griglia delle ore**: la vista quotidiana e quella a periodo, con le
 * celle modificabili e il selettore dei task. Era il corpo centrale di un
 * TimesheetPage da 1.700 righe: ogni vista ora è un file, e chi tocca la
 * griglia non passa più in mezzo ai riepiloghi.
 */
export function TimesheetDayView({ period, userIds }: { period: string; userIds: string[] }) {
  const { t, i18n } = useTranslation();
  const { data, isLoading } = useTimesheetPeriod(period, userIds);
  const addRow = useAddRow();
  const days = useMemo(
    () => daysOfPeriod(period, localeTag(i18n.language)),
    [period, i18n.language],
  );
  const today = todayISO();
  const dayInPeriod = (iso: string) => days.some((day) => day.iso === iso);
  const firstDay = () => (dayInPeriod(today) ? today : days[0]!.iso);
  const [selectedDate, setSelectedDate] = useState(firstDay);
  // Cambio di periodo dall'intestazione: riallinea il giorno selezionato.
  if (!dayInPeriod(selectedDate)) setSelectedDate(firstDay());

  if (isLoading || !data) {
    return <p className="text-sm text-muted-foreground">{t("Caricamento timesheet…")}</p>;
  }

  const dayIndex = days.findIndex((d) => d.iso === selectedDate);
  const day = days[dayIndex];
  // Le righe arrivano tutte dal server: quelle con ore e quelle tenute a mano.
  const rows: TimesheetRow[] = data.rows;
  const visibleRows = data.editable
    ? rows
    : rows.filter((row) => (row.entries[selectedDate] ?? 0) > 0);
  const dayTotal = rows.reduce((sum, row) => sum + (row.entries[selectedDate] ?? 0), 0);

  const shiftDay = (delta: number) => {
    const next = days[dayIndex + delta];
    if (next) setSelectedDate(next.iso);
  };

  const weekdayLong = new Intl.DateTimeFormat("it-IT", {
    timeZone: "Europe/Rome",
    weekday: "long",
  }).format(new Date(`${selectedDate}T12:00:00Z`));

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between rounded-lg border bg-card p-2">
        <Button
          variant="ghost"
          size="icon"
          disabled={dayIndex <= 0}
          onClick={() => shiftDay(-1)}
          aria-label={t("Giorno precedente")}
        >
          <ChevronLeft className="size-4" />
        </Button>
        <div className="text-center">
          <p className={cn("text-sm font-semibold capitalize", day?.isToday && "text-primary")}>
            {weekdayLong} {day?.dayNum}
          </p>
          <p className="text-xs text-muted-foreground">
            {t("Totale giorno: {{hours}}h", { hours: formatHours(dayTotal) || "0" })}
          </p>
        </div>
        <Button
          variant="ghost"
          size="icon"
          disabled={dayIndex >= days.length - 1}
          onClick={() => shiftDay(1)}
          aria-label={t("Giorno successivo")}
        >
          <ChevronRight className="size-4" />
        </Button>
      </div>

      {data.editable && (
        <AddTaskPicker
          excludeIds={rows.map((row) => row.task.id)}
          onAdd={(task) => addRow.mutate({ taskId: task.id, period })}
          period={period}
        />
      )}

      {/* Anche questa è una griglia, a una colonna sola: su e giù passano da
          un task all'altro. */}
      <ul data-griglia className="flex flex-col gap-2">
        {visibleRows.map((row, indiceRiga) => (
          <li
            key={row.task.id}
            className="flex items-center gap-3 rounded-lg border bg-card px-3 py-2 transition-colors hover:border-primary/40 hover:bg-primary/5"
          >
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium">{row.task.title}</p>
              <p className="truncate text-xs text-muted-foreground">
                {row.task.context}
                {row.task.company && ` · ${row.task.company}`} · {formatHours(row.total) || "0"}h{" "}
                {t("nel mese")}
              </p>
            </div>
            <div className="shrink-0 rounded-md border">
              <HourCell
                riga={indiceRiga}
                colonna={0}
                taskId={row.task.id}
                date={selectedDate}
                value={row.entries[selectedDate] ?? 0}
                editable={data.editable}
              />
            </div>
          </li>
        ))}
        {visibleRows.length === 0 && (
          <li className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
            {t("Nessuna ora registrata in questo giorno.")}
          </li>
        )}
      </ul>
    </div>
  );
}

/**
 * Colonna del task nella griglia: titolo, sotto il progetto e il cliente, e le
 * stesse tre azioni degli altri elenchi — apri il dettaglio, sbircia gli
 * allegati, sbircia la chat. Nessun componente nuovo: sono quelli di sempre
 * (`useRecordOpener`, `AttachmentsPeek`, `CommentsPeek`), così si comportano
 * allo stesso modo ovunque.
 */
function TaskCell({
  task,
  onOpen,
}: {
  task: TimesheetTaskRef;
  /** Apre il record giusto per natura: un'offerta ha il SUO pannello. */
  onOpen: (id: string, kind: string) => void;
}) {
  const { t } = useTranslation();
  return (
    <div className="flex items-center gap-2">
      <div className="min-w-0 flex-1">
        {/* A capo su due righe, non troncato a una: la colonna è a larghezza
            fissa e il titolo si adatta a lei, non il contrario. Il testo
            completo sta nel tooltip (e ad aprire il task ci vuole un clic). */}
        <p className="line-clamp-2 break-words font-medium" title={task.title}>
          {task.title}
        </p>
        <p className="flex items-center gap-1 truncate text-xs text-muted-foreground">
          {/* Nato come richiesta: si dice qui, con l'icona che i ticket hanno
              in tutta l'applicazione. È un segno di provenienza, non un dato
              nuovo — aiuta a ricordare le ore delle prove fatte prima di
              aprirla (26/08/2026). */}
          {task.fromTicket && (
            <LifeBuoy
              className="size-3 shrink-0 text-primary"
              aria-label={t("Nato come richiesta di supporto")}
            >
              <title>{t("Nato come richiesta di supporto")}</title>
            </LifeBuoy>
          )}
          <span className="truncate">
            {task.context}
            {task.company && ` · ${task.company}`}
          </span>
        </p>
      </div>
      <span className="flex shrink-0 items-center gap-1.5 text-muted-foreground">
        <AttachmentsPeek taskId={task.id} count={task.attachmentCount} />
        <CommentsPeek taskId={task.id} count={task.commentCount} />
        <button
          type="button"
          className="rounded-md p-1 hover:bg-muted hover:text-foreground"
          title={t("Apri il task")}
          aria-label={t("Apri {{title}}", { title: task.title })}
          onClick={() => onOpen(task.id, task.kind)}
        >
          <PanelRight className="size-3.5" />
        </button>
      </span>
    </div>
  );
}

export function TimesheetGrid({
  period,
  userIds,
  showHints,
}: {
  period: string;
  userIds: string[];
  showHints: boolean;
}) {
  const { t, i18n } = useTranslation();
  const { data, isLoading } = useTimesheetPeriod(period, userIds);
  // Suggerimenti solo sul PROPRIO timesheet e solo se li si vuole vedere: la
  // griglia aggregata di più persone è in sola lettura, e lì non si scrive.
  const { data: hints } = (useOreSuggerite ?? nessunSuggerimento)(
    period,
    showHints && userIds.length === 0,
  );
  const hintOf = useMemo(() => {
    const map = new Map<string, number>();
    for (const hint of hints ?? []) map.set(cellKey(hint.taskId, hint.date), hint.hours);
    return map;
  }, [hints]);
  const deleteRow = useDeleteRow();
  const confirmDialog = useConfirm();
  const addRow = useAddRow();
  const record = useRecordOpener();
  const days = useMemo(
    () => daysOfPeriod(period, localeTag(i18n.language)),
    [period, i18n.language],
  );
  // Ore ancora nella casella, non salvate: pesano già nei totali in fondo, che
  // è il modo per accorgersi di una giornata da 12 ore mentre la si scrive.
  const [drafts, setDrafts] = useState<Record<string, number>>({});
  // Cambiando periodo o persone la griglia parla di altre caselle.
  const scope = `${period}|${userIds.join(",")}`;
  const scopeRef = useRef(scope);
  if (scopeRef.current !== scope) {
    scopeRef.current = scope;
    setDrafts({});
  }

  if (isLoading || !data) {
    return <p className="text-sm text-muted-foreground">{t("Caricamento timesheet…")}</p>;
  }

  // Le righe arrivano tutte dal server: quelle con ore e quelle tenute a mano.
  const rows: TimesheetRow[] = data.rows;

  const columnTotals = dayTotals(
    rows,
    days.map((day) => day.iso),
    drafts,
  );
  const total = monthTotal(columnTotals);
  const people = Math.max(1, userIds.length);

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      {data.editable && (
        <AddTaskPicker
          excludeIds={rows.map((row) => row.task.id)}
          onAdd={(task) => addRow.mutate({ taskId: task.id, period })}
          period={period}
        />
      )}

      {/* La griglia scorre dentro di sé: i giorni in cima e i totali in fondo
          restano a schermo anche con quaranta righe di task. */}
      <div className="min-h-0 flex-1 overflow-auto rounded-lg border">
        <table data-griglia className="w-full border-collapse text-sm">
          <thead className="sticky top-0 z-20">
            <tr className="bg-muted/50 text-xs text-muted-foreground">
              {/* Larghezza FISSA: senza, la colonna insegue il titolo più lungo
                  e spinge i giorni (e il cestino) fuori dallo schermo — vedere
                  la riga intera vale più del titolo su una riga sola. */}
              <th className="sticky left-0 z-10 w-56 min-w-56 max-w-56 border-b border-r bg-muted px-3 py-2 text-left font-medium">
                {t("Task")}
              </th>
              {days.map((day) => (
                <th
                  key={day.iso}
                  className={cn(
                    "border-b bg-muted px-1 py-2 text-center font-medium",
                    day.isWeekend && "bg-muted/70",
                    day.isToday && "bg-primary/10 text-primary",
                  )}
                >
                  <div>{day.weekdayLabel}</div>
                  <div>{day.dayNum}</div>
                </th>
              ))}
              <th className="border-b border-l bg-muted px-2 py-2 text-right font-medium">
                {t("Tot")}
              </th>
              {data.editable && <th className="w-10 border-b bg-muted" />}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, indiceRiga) => (
              // `group`: la riga sotto il mouse si evidenzia TUTTA — anche la
              // cella sticky del task, che ha uno sfondo suo (opaco, deve
              // coprire ciò che le scorre sotto) e l'hover del tr non la tocca.
              <tr key={row.task.id} className="group">
                <td
                  className={cn(
                    "sticky left-0 z-10 max-w-56 border-b border-r bg-background px-3 py-1.5",
                    // Bordo colorato a sinistra: dice su quale riga sei anche
                    // con la coda dell'occhio, senza spostare niente (il bordo
                    // trasparente c'è sempre).
                    "border-l-2 border-l-transparent transition-colors",
                    "group-hover:border-l-primary group-hover:bg-muted",
                  )}
                >
                  <TaskCell task={row.task} onOpen={record.open} />
                </td>
                {days.map((day, colonna) => (
                  <td
                    key={day.iso}
                    className={cn(
                      "border-b p-0 text-center transition-colors group-hover:bg-primary/10",
                      day.isWeekend && "bg-muted/40",
                      day.isToday && "bg-primary/5",
                    )}
                  >
                    <HourCell
                      riga={indiceRiga}
                      colonna={colonna}
                      taskId={row.task.id}
                      date={day.iso}
                      value={row.entries[day.iso] ?? 0}
                      hint={hintOf.get(cellKey(row.task.id, day.iso))}
                      editable={data.editable}
                      onDraft={(hours) =>
                        setDrafts((prev) => {
                          const next = { ...prev };
                          const key = cellKey(row.task.id, day.iso);
                          if (hours === null) delete next[key];
                          else next[key] = hours;
                          return next;
                        })
                      }
                    />
                  </td>
                ))}
                <td className="border-b border-l px-2 py-1.5 text-right font-medium transition-colors group-hover:bg-primary/10">
                  {formatHours(row.total) || "0"}
                </td>
                {data.editable && (
                  <td className="border-b px-1 text-center transition-colors group-hover:bg-primary/10">
                    <Button
                      variant="ghost"
                      size="icon"
                      title={t("Elimina riga (tutte le ore del mese su questo task)")}
                      onClick={() => {
                        // Riga senza ore: si toglie e basta, non c'è niente da perdere.
                        if (row.total === 0) {
                          deleteRow.mutate({ taskId: row.task.id, period });
                          return;
                        }
                        void confirmDialog({
                          title: t("Eliminare la riga?"),
                          message: t(
                            'Tutte le ore di "{{title}}" in questo mese ({{hours}}h) verranno eliminate.',
                            { title: row.task.title, hours: formatHours(row.total) },
                          ),
                          confirmLabel: t("Elimina riga"),
                          tone: "danger",
                        }).then((ok) => {
                          if (ok) deleteRow.mutate({ taskId: row.task.id, period });
                        });
                      }}
                    >
                      <Trash2 className="size-3.5 text-destructive" />
                    </Button>
                  </td>
                )}
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td
                  colSpan={days.length + (data.editable ? 3 : 2)}
                  className="p-8 text-center text-sm text-muted-foreground"
                >
                  {t("Nessuna ora registrata nel mese. Aggiungi un task per iniziare.")}
                </td>
              </tr>
            )}
          </tbody>
          {rows.length > 0 && (
            <tfoot className="sticky bottom-0 z-20">
              <tr className="bg-muted text-xs font-medium">
                <td className="sticky left-0 z-10 border-t border-r bg-muted px-3 py-2">
                  {t("Totale giorno")}
                </td>
                {days.map((day, index) => {
                  const hours = columnTotals[index]!;
                  const flag = dayFlag(hours, people);
                  return (
                    <td
                      key={day.iso}
                      title={
                        flag === "impossibile"
                          ? t(
                              "Più ore di quante ne abbia un giorno: il salvataggio verrà rifiutato",
                            )
                          : flag === "oltre"
                            ? t("Più di una giornata di lavoro")
                            : undefined
                      }
                      className={cn(
                        "border-t px-1 py-2 text-center",
                        flag === "oltre" && "text-amber-600",
                        flag === "impossibile" && "text-destructive",
                      )}
                    >
                      {formatHours(hours)}
                    </td>
                  );
                })}
                <td className="border-t border-l px-2 py-2 text-right">
                  {formatHours(total) || "0"}
                </td>
                {data.editable && <td className="border-t" />}
              </tr>
            </tfoot>
          )}
        </table>
      </div>
      {record.node}
    </div>
  );
}

/**
 * Sposta il fuoco alla casella accanto. Le caselle si trovano dagli attributi
 * `data-riga`/`data-colonna` invece che da un elenco tenuto in memoria: la
 * griglia è già nel DOM, e una seconda copia della sua forma sarebbe una cosa
 * in più da tenere allineata a ogni riga aggiunta o tolta.
 */
function vaiAllaCasella(da: HTMLElement, riga: number, colonna: number): boolean {
  const griglia = da.closest("[data-griglia]");
  const meta = griglia?.querySelector<HTMLInputElement>(
    `input[data-riga="${riga}"][data-colonna="${colonna}"]`,
  );
  if (!meta) return false;   // fuori dai bordi: si resta dove si è
  meta.focus();
  meta.select();
  // `?.` di proposito: fuori da un browser vero (le prove in jsdom) questo
  // metodo non esiste, e una navigazione da tastiera non deve fallire per una
  // rifinitura di scorrimento.
  meta.scrollIntoView?.({ block: "nearest", inline: "nearest" });
  return true;
}

/** L'ultima colonna della riga: serve al tasto Fine. */
function ultimaColonna(da: HTMLElement, riga: number): number {
  const celle = da.closest("[data-griglia]")?.querySelectorAll<HTMLInputElement>(
    `input[data-riga="${riga}"]`,
  );
  return celle && celle.length > 0 ? celle.length - 1 : 0;
}

/** Una casella di ore. Esportata anche per le prove da tastiera. */
export function HourCell({
  taskId,
  date,
  value,
  hint,
  editable,
  onDraft,
  riga,
  colonna,
}: {
  taskId: string;
  date: string;
  value: number;
  /**
   * Ore **suggerite** per questa casella: si vedono in grigio come segnaposto e
   * si confermano riscrivendole. Non sono un valore: nessuno salva al posto tuo.
   */
  hint?: number;
  editable: boolean;
  /** Ore in corso di scrittura (null = quello che c'è scritto non sono ore). */
  onDraft?: (hours: number | null) => void;
  /** Posizione nella griglia: la tastiera si muove su queste coordinate. */
  riga: number;
  colonna: number;
}) {
  const { t } = useTranslation();
  const upsert = useUpsertEntry();
  const toast = useToast();
  /**
   * **Selezionata o in scrittura**: è la distinzione di un foglio di calcolo.
   * Da selezionata il campo è in sola lettura — le frecce spostano invece di
   * muovere un cursore che non si vede — e si entra in scrittura digitando una
   * cifra, con Invio o con F2 (26/08/2026).
   */
  const [inScrittura, setInScrittura] = useState(false);
  const campo = useRef<HTMLInputElement>(null);

  if (!editable) {
    return <span className="block px-1 py-1.5">{formatHours(value)}</span>;
  }

  /** Salva quello che c'è scritto adesso; `null` = non sono ore. */
  const salva = (input: HTMLInputElement) => {
    const hours = parseHours(input.value);
    if (hours === null) {
      onDraft?.(null);
      // Scritto qualcosa che non sono ore: si rimette com'era e lo si dice,
      // invece di salvare un numero che l'utente non ha inteso.
      input.value = formatHours(value);
      toast(t("Ore non valide: scrivi per esempio 4, 4,5 oppure 0.75"), "error");
      return;
    }
    if (hours === value) {
      input.value = formatHours(value);
      return;
    }
    // La bozza resta finché il server non conferma: il totale in fondo non
    // deve tornare indietro per un istante mentre il salvataggio viaggia.
    onDraft?.(hours);
    upsert.mutate(
      { taskId, date, hours },
      {
        onError: (error) => {
          onDraft?.(null);
          toast(
            error instanceof ApiError ? error.message : t("Errore nel salvataggio delle ore"),
            "error",
          );
        },
      },
    );
  };

  return (
    <input
      key={`${taskId}-${date}-${value}`}
      ref={campo}
      data-riga={riga}
      data-colonna={colonna}
      // Da selezionata non si scrive: i tasti li legge la griglia. Il cursore
      // sparisce, così si vede a colpo d'occhio in quale dei due stati si è.
      readOnly={!inScrittura}
      // Testo e non "number": con il campo numerico il browser scarta quello che
      // non sa leggere, e "4,5" digitato all'italiana arrivava qui come casella
      // vuota — cioè come una cancellazione delle ore.
      type="text"
      inputMode="decimal"
      defaultValue={formatHours(value)}
      placeholder={hint !== undefined ? formatHours(hint) : undefined}
      title={
        hint !== undefined
          ? t(
              "Suggerito: {{hours}}h da quello che hai fatto quel giorno. Scrivile per confermarle.",
              { hours: formatHours(hint) },
            )
          : t("Ore, anche con i decimali: 4,5 · 4.2 · 0,75")
      }
      className={cn(
        "h-8 w-14 border-0 bg-transparent text-center text-sm outline-none",
        "placeholder:italic placeholder:text-primary/45 focus:ring-2 focus:ring-ring",
        // selezionata: nessun cursore lampeggiante, che prometterebbe scrittura
        !inScrittura && "caret-transparent",
        inScrittura && "bg-background ring-2 ring-primary",
      )}
      onFocus={(e) => e.currentTarget.select()}
      onKeyDown={(e) => {
        const intenzione = intentOf(e, inScrittura);
        if (!intenzione) return;
        const input = e.currentTarget;
        e.preventDefault();
        switch (intenzione.kind) {
          case "move":
            vaiAllaCasella(input, riga + intenzione.dr, colonna + intenzione.dc);
            return;
          case "edge":
            vaiAllaCasella(input, riga, intenzione.to === "start" ? 0 : ultimaColonna(input, riga));
            return;
          case "edit":
            setInScrittura(true);
            if (intenzione.char !== undefined) {
              input.value = intenzione.char;
              onDraft?.(parseHours(intenzione.char) ?? 0);
            }
            // il cursore in fondo, dopo il carattere appena entrato
            requestAnimationFrame(() => input.setSelectionRange(input.value.length, input.value.length));
            return;
          case "commit":
            salva(input);
            setInScrittura(false);
            vaiAllaCasella(input, riga + intenzione.dr, colonna + intenzione.dc);
            return;
          case "cancel":
            // Torna com'era: è la promessa di Esc in ogni griglia.
            input.value = formatHours(value);
            onDraft?.(null);
            setInScrittura(false);
            input.select();
            return;
          case "clear":
            input.value = "";
            salva(input);
            return;
        }
      }}
      // Ogni tasto aggiorna il totale in fondo alla colonna: il controllo sulla
      // giornata si fa mentre si scrive, non dopo aver salvato.
      onChange={(e) => onDraft?.(e.target.value.trim() === "" ? 0 : parseHours(e.target.value))}
      // Uscendo dalla casella si conferma, come in un foglio di calcolo:
      // spostarsi altrove non è annullare.
      onBlur={(e) => {
        setInScrittura(false);
        salva(e.target);
      }}
    />
  );
}

function AddTaskPicker({
  excludeIds,
  onAdd,
  period,
}: {
  excludeIds: string[];
  onAdd: (task: TimesheetTaskRef) => void;
  period: string;
}) {
  const { t } = useTranslation();
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);

  // La ricerca parte a digitazione ferma: ogni tasto è una query sul server.
  const search = useDebouncedValue(q, 250);
  const { data, fetchNextPage, hasNextPage, isFetchingNextPage } = useVisibleTasks(search, period);
  const excluded = new Set(excludeIds);
  const candidates = (data?.pages.flatMap((page) => page.items) ?? []).filter(
    (task) => !excluded.has(task.id),
  );
  // Se l'intera pagina è già in griglia (tutti esclusi) non compare niente da
  // scorrere, e senza questo la paginazione si ferma: si tira avanti da soli
  // finché non spunta un candidato o finiscono le pagine.
  useEffect(() => {
    if (open && candidates.length === 0 && hasNextPage && !isFetchingNextPage) {
      void fetchNextPage();
    }
  }, [open, candidates.length, hasNextPage, isFetchingNextPage, fetchNextPage]);

  return (
    // Sul telefono prende la riga: 384px fissi la facevano sbordare.
    <div className="relative w-full sm:w-96">
      <div className="flex items-center gap-2">
        <Input
          placeholder={t("Aggiungi un task alla griglia…")}
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setOpen(true);
          }}
          data-no-autofocus
          onFocus={() => setOpen(true)}
          onBlur={() => setTimeout(() => setOpen(false), 150)}
        />
        <Plus className="size-4 shrink-0 text-muted-foreground" />
        {/* Rows from activity and removal of empty rows: commercial (slot). */}
        {RigheDalleAttivita && <RigheDalleAttivita period={period} />}
      </div>
      {open && candidates.length > 0 && (
        <ul
          // Sopra l'intestazione fissa della griglia, che è a z-20: a parità di
          // livello vinceva lei, ed è la tendina a coprire, non il contrario.
          className="absolute z-50 mt-1 max-h-64 w-full overflow-y-auto rounded-md border bg-popover shadow-lg"
          // Il blocco successivo arriva scorrendo: l'elenco completo dei task
          // non si serve tutto insieme.
          onScroll={(e) => {
            const el = e.currentTarget;
            if (
              hasNextPage &&
              !isFetchingNextPage &&
              el.scrollTop + el.clientHeight >= el.scrollHeight - 40
            ) {
              void fetchNextPage();
            }
          }}
        >
          {candidates.map((task) => (
            <li key={task.id}>
              <button
                className="flex w-full flex-col px-3 py-2 text-left text-sm hover:bg-muted/50"
                onMouseDown={(e) => {
                  e.preventDefault();
                  onAdd(task);
                  setQ("");
                  setOpen(false);
                }}
              >
                <span className="font-medium">{task.title}</span>
                <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  {task.context}
                  {/* Un task chiuso si sceglie eccome — si finisce il lavoro e
                      poi si registrano le ore — ma è giusto vedere che lo è. */}
                  {task.isClosed && (
                    <span className="rounded border px-1 py-px text-[10px] uppercase">
                      {t("chiuso")}
                    </span>
                  )}
                </span>
              </button>
            </li>
          ))}
          {(hasNextPage || isFetchingNextPage) && (
            <li className="px-3 py-2 text-center text-xs text-muted-foreground">
              {isFetchingNextPage ? t("Carico…") : t("Scorri per vedere altri task")}
            </li>
          )}
        </ul>
      )}
      {/* Il messaggio "niente" solo quando davvero non c'è altro da caricare:
          se restano pagine (tutte escluse finora) si sta ancora scorrendo. */}
      {open && candidates.length === 0 && !hasNextPage && !isFetchingNextPage && (
        <p className="absolute z-50 mt-1 w-full rounded-md border bg-popover px-3 py-2 text-xs text-muted-foreground shadow-lg">
          {search
            ? t("Nessun task trovato tra quelli che puoi vedere.")
            : t("Non hai ancora lavorato su niente in questo periodo: scrivi per cercare un task.")}
        </p>
      )}
    </div>
  );
}

