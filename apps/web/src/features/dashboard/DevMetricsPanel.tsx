import { useTranslation } from "react-i18next";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import {
  ArrowDownToLine,
  ArrowUpFromLine,
  Building2,
  CalendarCheck2,
  CheckCircle2,
  Clock3,
  TriangleAlert,
  Gauge,
  Timer,
  Users,
} from "lucide-react";
import type { DevMetrics, DevSize, DevTimes } from "@kancrm/shared";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";
import { localeTag } from "@/lib/i18n";
import { Skeleton, SkeletonRows } from "@/components/ui/skeleton";

/**
 * **L'andamento**: la seconda vista di "La mia giornata".
 *
 * Due letture che non si mescolano — **la squadra** (flusso, coda, dove sono
 * finite le ore: nessun nome) e **la persona che guarda** (i propri numeri) —
 * più, per chi guida l'area, l'elenco dei suoi. Le regole di lettura sono
 * scritte in pagina e non solo qui, perché un numero senza il suo margine di
 * errore viene creduto:
 *
 *  - i **tempi** escludono i task nati già chiusi (registrati a cose fatte) e
 *    lo **storico importato** da ClickUp/osTicket, e dichiarano su quanti sono
 *    calcolati: alla prima misura, 51 task lavorati su 155 "chiusi";
 *  - le **ore** sono dichiarate da chi le scrive, quindi servono a dare la
 *    *taglia* del lavoro, mai a fare una classifica. L'elenco delle persone è
 *    in ordine alfabetico apposta.
 */
export function useDevMetrics() {
  return useQuery({
    queryKey: ["dev-metrics"],
    queryFn: () => api<DevMetrics>("/api/dashboard/dev-metrics"),
    refetchInterval: 10 * 60_000,
  });
}

/* ── formati ────────────────────────────────────────────────────────────── */

// La lingua la decide l'utente (`localeTag`), il fuso resta quello aziendale:
// la stessa regola dei formattatori delle date in `tasks/task-utils`.
const number = (value: number) => value.toLocaleString(localeTag(), { maximumFractionDigits: 1 });

const hours = (value: number) => `${number(value)} h`;

/** Giorni con una cifra; sotto la giornata si legge in ore. */
function days(value: number | null): string {
  if (value === null) return "—";
  if (value < 1) return `${Math.round(value * 24)} h`;
  return `${number(value)} gg`;
}

const formatDay = (iso: string) =>
  new Date(`${iso}T12:00:00Z`).toLocaleDateString(localeTag(), {
    timeZone: "Europe/Rome",
    day: "numeric",
    month: "short",
  });

export function DevMetricsPanel() {
  const { t } = useTranslation();
  const { data, isLoading } = useDevMetrics();

  if (isLoading || !data) return <DevMetricsSkeleton />;

  const { me, team } = data;
  return (
    <div className="flex flex-col gap-6">
      <p className="text-sm text-muted-foreground">
        {t("Area tecnica, dal {{from}} a oggi.", { from: formatDay(data.from) })}
      </p>

      {/* ── Io ─────────────────────────────────────────────────────────── */}
      <section className="flex min-w-0 flex-col gap-3">
        <SectionTitle icon={<Gauge className="size-4 text-primary" />}>{t("Il mio")}</SectionTitle>
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Tile
            icon={<Clock3 className="size-4" />}
            label={t("Aperti su di me")}
            value={me.aperti}
          />
          <Tile
            icon={<CheckCircle2 className="size-4" />}
            label={t("Chiusi nel periodo")}
            value={me.chiusi}
            note={
              me.natiChiusi > 0
                ? t("{{count}} annotati a cose fatte", { count: me.natiChiusi })
                : undefined
            }
          />
          <Tile
            icon={<Timer className="size-4" />}
            label={t("Ore registrate")}
            value={hours(me.ore)}
          />
          <Tile
            icon={<CalendarCheck2 className="size-4" />}
            label={t("Timesheet compilato")}
            value={me.copertura.percento === null ? "—" : `${me.copertura.percento}%`}
            // Il denominatore sono i **giorni lavorati**, non quelli del
            // calendario: due settimane di ferie non sono due settimane di
            // timesheet mancante. Scritto in chiaro perché il numero si legge
            // in modo diverso a seconda di cosa ci sta sotto.
            note={
              me.copertura.percento === null
                ? t("Nessun giorno lavorato nel periodo.")
                : t("{{done}} giorni su {{total}} lavorati", {
                    done: me.copertura.compilati,
                    total: me.copertura.lavorati,
                  })
            }
            // La copertura è l'unico numero personale con un verso giusto: è un
            // comportamento, uguale per tutti e non falsificabile gonfiando le
            // ore. Sotto la metà vale la pena vederlo.
            tone={coverageTone(me.copertura.percento)}
          />
        </div>
        <div className="grid gap-3 lg:grid-cols-2">
          <TimesCard title={t("I miei tempi")} times={me.tempi} />
          <SizeCard title={t("Quanto costa un mio task")} size={me.taglia} />
        </div>
      </section>

      {/* ── I limiti in sofferenza (solo a chi guida l'area) ───────────── */}
      {data.wip && <WipSection loads={data.wip} />}

      {/* ── La squadra ─────────────────────────────────────────────────── */}
      <section className="flex min-w-0 flex-col gap-3">
        <SectionTitle icon={<Users className="size-4 text-primary" />}>
          {t("La squadra")}
        </SectionTitle>

        <div className="grid gap-3 lg:grid-cols-2">
          <Card>
            <CardTitle>{t("Entrati e usciti, per settimana")}</CardTitle>
            <FlowChart weeks={data.weeks} />
            <p className="mt-3 text-xs text-muted-foreground">
              {t(
                "La coda cresce quando la colonna di sinistra supera quella di destra. Oggi: {{open}} task tecnici aperti.",
                { open: team.aperti },
              )}{" "}
              {/* Lo storico caricato da ClickUp e osTicket è archivio, non
                  lavoro del mese: fuori dai conti, ma dichiarato — sparire
                  senza spiegazione avrebbe fatto pensare a numeri sbagliati. */}
              {team.storico > 0 &&
                t(
                  "Esclusi {{count}} record di storico importato, chiusi al momento del caricamento.",
                  { count: team.storico },
                )}
            </p>
          </Card>

          <Card>
            <CardTitle>{t("Dov'è fermo il lavoro aperto")}</CardTitle>
            <div className="flex flex-wrap gap-2">
              {team.coda.map((status) => (
                <span
                  key={status.id}
                  className="inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-sm"
                  style={{ borderColor: status.color }}
                >
                  <span className="size-2 rounded-full" style={{ backgroundColor: status.color }} />
                  {status.name}
                  <span className="font-semibold">{status.count}</span>
                </span>
              ))}
              {team.coda.length === 0 && (
                <p className="text-sm text-muted-foreground">{t("Niente di aperto.")}</p>
              )}
            </div>
          </Card>

          <TimesCard title={t("Tempi della squadra")} times={team.tempi} />
          <SizeCard title={t("Quanto costa un task chiuso")} size={team.taglia} />

          <Card className="lg:col-span-2">
            <CardTitle>{t("Dove sono finite le ore")}</CardTitle>
            <HoursByProject rows={team.orePerProgetto} />
            {team.oreSenzaCliente > 0 && (
              // Non è un indicatore: è ciò che manca per averne uno. Finché i
              // progetti non portano la loro azienda, "quanto lavoriamo per i
              // clienti" non si può rispondere senza mentire.
              <p className="mt-3 flex items-start gap-1.5 text-xs text-muted-foreground">
                <Building2 className="mt-0.5 size-3.5 shrink-0" />
                {t(
                  "{{hours}} su progetti senza azienda collegata: finché mancano, la divisione fra lavoro dei clienti e interno non si può calcolare.",
                  { hours: hours(team.oreSenzaCliente) },
                )}
              </p>
            )}
          </Card>
        </div>
      </section>

      {/* ── Le persone (solo a chi guida l'area) ───────────────────────── */}
      {data.people && data.people.length > 0 && (
        <section className="flex min-w-0 flex-col gap-3">
          <SectionTitle icon={<Users className="size-4 text-primary" />}>
            {t("Le persone")}
          </SectionTitle>
          <Card>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[42rem] text-sm">
                <thead>
                  <tr className="border-b text-left text-xs uppercase text-muted-foreground">
                    <th className="pb-2 font-medium">{t("Persona")}</th>
                    <th className="pb-2 text-right font-medium">{t("In mano")}</th>
                    <th className="pb-2 text-right font-medium">{t("Da fare")}</th>
                    <th className="pb-2 text-right font-medium">{t("In corso")}</th>
                    <th
                      className="pb-2 text-right font-medium"
                      title={t("Task aperti in mano alla persona con la scadenza già passata")}
                    >
                      {t("In ritardo")}
                    </th>
                    <th className="pb-2 text-right font-medium">{t("Chiusi")}</th>
                    <th className="pb-2 text-right font-medium">{t("Ore")}</th>
                    <th className="pb-2 text-right font-medium">{t("Timesheet")}</th>
                  </tr>
                </thead>
                <tbody>
                  {data.people.map((person) => (
                    <tr key={person.id} className="border-b">
                      <td className="py-2 pr-3">{person.name}</td>
                      <Share value={person.assegnati} total={team.aperti} strong />
                      <Share value={person.daFare} total={team.aperti} />
                      <Share value={person.inCorso} total={team.aperti} />
                      <td
                        className={cn(
                          "py-2 text-right tabular-nums",
                          person.inRitardo > 0 && "text-amber-600 dark:text-amber-500",
                        )}
                      >
                        {person.inRitardo}
                      </td>
                      <td className="py-2 text-right tabular-nums">{person.chiusi}</td>
                      <td className="py-2 text-right tabular-nums">{hours(person.ore)}</td>
                      <td
                        className={cn(
                          "py-2 text-right tabular-nums",
                          coverageTone(person.copertura) === "warn" &&
                            "text-amber-600 dark:text-amber-500",
                        )}
                      >
                        {person.copertura === null ? "—" : `${person.copertura}%`}
                      </td>
                    </tr>
                  ))}
                  {/* Il lavoro che non è in mano a nessuno chiude la tabella:
                      senza, le quote non tornano a cento e la coda senza
                      padrone — la voce più grossa — non si vedrebbe. */}
                  {team.nonAssegnati > 0 && (
                    <tr className="text-muted-foreground">
                      <td className="py-2 pr-3 italic">{t("Non assegnati")}</td>
                      <Share value={team.nonAssegnati} total={team.aperti} strong />
                      <Share value={team.nonAssegnatiDaFare} total={team.aperti} />
                      <Share
                        value={team.nonAssegnati - team.nonAssegnatiDaFare}
                        total={team.aperti}
                      />
                      <td colSpan={4} />
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
            {/* In ordine alfabetico, e detto a chiare lettere: sono numeri per
                capire il carico, non per fare una gara. */}
            <p className="mt-3 text-xs text-muted-foreground">
              {t(
                "Le percentuali sono quote dei {{total}} task tecnici aperti: «in mano» è tutto il lavoro aperto della persona, «da fare» la parte non ancora toccata, «in corso» il resto.",
                { total: team.aperti },
              )}{" "}
              {t(
                "In ordine alfabetico: non è una classifica. Task di taglia diversa non si confrontano contandoli, e le ore le dichiara chi le scrive.",
              )}{" "}
              {t(
                "«Timesheet» è la quota di giorni compilati sui giorni davvero lavorati: le ferie non contano come giorni mancanti.",
              )}{" "}
              {/* Chi non è più della squadra non ha una riga — comparirebbe a
                  zero ore come se fosse in ritardo — ma il suo lavoro aperto
                  non è finito: qualcuno lo deve riprendere. */}
              {team.fuoriSquadra > 0 && (
                <span className="text-amber-600 dark:text-amber-500">
                  {t(
                    "{{count}} task aperti sono intestati a persone non più in squadra: sono da riassegnare, e restano fuori da questi conti.",
                    { count: team.fuoriSquadra },
                  )}
                </span>
              )}
            </p>
          </Card>
        </section>
      )}
    </div>
  );
}

/* ── pezzi ──────────────────────────────────────────────────────────────── */

function SectionTitle({ icon, children }: { icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <h3 className="flex items-center gap-1.5 text-sm font-semibold">
      {icon}
      {children}
    </h3>
  );
}

/**
 * Una quota della coda: il numero, e sotto la sua fetta del totale.
 *
 * Il conteggio resta il dato principale e la percentuale gli sta sotto in
 * piccolo: "23" dice quanto lavoro c'è da fare, "7%" dice se è tanto rispetto
 * alla coda di tutti — servono insieme, e messe sulla stessa riga la seconda
 * si legge come parte della prima. Uno zero non si scrive: in una tabella di
 * carichi le caselle vuote fanno risaltare dov'è il lavoro.
 */
function Share({ value, total, strong }: { value: number; total: number; strong?: boolean }) {
  const percent = total === 0 ? 0 : Math.round((value / total) * 100);
  return (
    <td className="py-2 pl-3 text-right">
      <span className={cn("tabular-nums", strong && "font-semibold")}>
        {value > 0 ? value : "—"}
      </span>
      {value > 0 && (
        <span className="ml-1.5 text-xs tabular-nums text-muted-foreground">{percent}%</span>
      )}
    </td>
  );
}

/**
 * **Chi ha troppe cose aperte insieme**, in qualunque progetto.
 *
 * Sta in alto, subito dopo i propri numeri: un avviso in fondo a due schermate
 * di grafici non è un avviso. Quando non c'è niente da segnalare resta una
 * riga sola — dire "tutto nei limiti" costa poco e vale molto di più di una
 * sezione che sparisce, che non si distingue da una che non è stata calcolata.
 *
 * **Cosa c'è dentro il numero**, scritto sotto la tabella perché è la prima
 * domanda che si fa guardandolo: i task **assegnati** alla persona, aperti, in
 * quello stato e in quel progetto. Non chi li supervisiona né chi li ha
 * creati: quelli non li sta lavorando nessuno dei due.
 */
function WipSection({ loads }: { loads: NonNullable<DevMetrics["wip"]> }) {
  const { t } = useTranslation();
  const oltre = loads.filter((load) => load.level === "oltre").length;
  return (
    <section className="flex min-w-0 flex-col gap-3">
      <SectionTitle
        icon={
          <TriangleAlert
            className={cn("size-4", oltre > 0 ? "text-destructive" : "text-muted-foreground")}
          />
        }
      >
        {t("Troppe cose aperte insieme")}
      </SectionTitle>
      <Card>
        {loads.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            {t("Nessun limite di lavoro in corso superato: tutti i carichi sono nei limiti.")}
          </p>
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[34rem] text-sm">
                <thead>
                  <tr className="border-b text-left text-xs uppercase text-muted-foreground">
                    <th className="pb-2 font-medium">{t("Persona")}</th>
                    <th className="pb-2 font-medium">{t("Progetto")}</th>
                    <th className="pb-2 font-medium">{t("Colonna")}</th>
                    <th className="pb-2 text-right font-medium">{t("In mano")}</th>
                    <th className="pb-2 text-right font-medium">{t("Limite")}</th>
                  </tr>
                </thead>
                <tbody>
                  {loads.map((load) => (
                    <tr
                      key={`${load.projectId}-${load.statusId}-${load.userId}`}
                      className="border-b last:border-0"
                    >
                      <td className="py-2 pr-3">{load.userName}</td>
                      <td className="py-2 pr-3">
                        {/* Il nome del progetto porta al progetto: l'avviso dice
                          dove intervenire, e da lì si interviene. */}
                        <Link
                          to={`/progetti/${load.projectId}`}
                          className="hover:text-primary hover:underline"
                        >
                          {load.projectName}
                        </Link>
                      </td>
                      <td className="py-2 pr-3 text-muted-foreground">{load.statusName}</td>
                      <td
                        className={cn(
                          "py-2 text-right font-semibold tabular-nums",
                          load.level === "oltre"
                            ? "text-destructive"
                            : "text-amber-600 dark:text-amber-500",
                        )}
                      >
                        {load.count}
                      </td>
                      <td className="py-2 text-right tabular-nums text-muted-foreground">
                        {load.limit}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="mt-3 text-xs text-muted-foreground">
              {t(
                "In rosso chi ha superato il limite, in ambra chi ci è esattamente sopra: non è ancora troppo, ma la prossima cosa presa in carico lo diventa.",
              )}{" "}
              {t(
                "Si contano i task assegnati alla persona, aperti, in quella colonna e in quel progetto: non quelli che supervisiona né quelli che ha creato.",
              )}{" "}
              {/* Perché un carico può crescere senza che nessuno se ne accorga:
                  è la regola `autoAssign` di `tasks/update-service.ts`. */}
              {t(
                "Sulla bacheca di un progetto, spostare un task che non è di nessuno lo prende in carico: anche mettere ordine aumenta il proprio carico.",
              )}
            </p>
          </>
        )}
      </Card>
    </section>
  );
}

/**
 * Il colore della copertura. Nessun numero, nessun colore: chi non ha lavorato
 * nel periodo non è né bravo né in ritardo.
 */
function coverageTone(percent: number | null): "good" | "warn" | undefined {
  if (percent === null) return undefined;
  if (percent >= 80) return "good";
  return percent < 50 ? "warn" : undefined;
}

function Card({ className, children }: { className?: string; children: React.ReactNode }) {
  return <div className={cn("min-w-0 rounded-lg border bg-card p-4", className)}>{children}</div>;
}

function CardTitle({ children }: { children: React.ReactNode }) {
  return <h4 className="mb-3 text-sm font-semibold">{children}</h4>;
}

function Tile({
  icon,
  label,
  value,
  note,
  tone,
}: {
  icon: React.ReactNode;
  label: string;
  value: string | number;
  note?: string;
  tone?: "good" | "warn";
}) {
  return (
    <div className="min-w-0 rounded-lg border bg-card p-3">
      <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <span className="text-primary">{icon}</span>
        <span className="truncate">{label}</span>
      </p>
      <p
        className={cn(
          "mt-1 text-2xl font-semibold tabular-nums",
          tone === "good" && "text-emerald-600 dark:text-emerald-500",
          tone === "warn" && "text-amber-600 dark:text-amber-500",
        )}
      >
        {value}
      </p>
      {note && <p className="text-xs text-muted-foreground">{note}</p>}
    </div>
  );
}

/** I tre tempi, con il campione dichiarato accanto: senza, sono un oroscopo. */
function TimesCard({ title, times }: { title: string; times: DevTimes }) {
  const { t } = useTranslation();
  return (
    <Card>
      <CardTitle>{title}</CardTitle>
      {times.campione === 0 ? (
        <p className="text-sm text-muted-foreground">
          {t("Nessun task che abbia vissuto abbastanza da misurarlo.")}
        </p>
      ) : (
        <dl className="flex flex-col gap-1.5 text-sm">
          <Row label={t("Dalla creazione al primo movimento")} value={days(times.presaInCarico)} />
          <Row label={t("Dal primo movimento alla chiusura")} value={days(times.lavorazione)} />
          <Row label={t("Dalla creazione alla chiusura")} value={days(times.totale)} strong />
        </dl>
      )}
      <p className="mt-3 text-xs text-muted-foreground">
        {t("Mediane su {{count}} task.", { count: times.campione })}{" "}
        {times.natiChiusi > 0 &&
          t("Esclusi {{count}} creati e chiusi nella stessa ora: sono lavori annotati dopo.", {
            count: times.natiChiusi,
          })}
      </p>
    </Card>
  );
}

/** La taglia: è ciò che rende confrontabili i conteggi di task. */
function SizeCard({ title, size }: { title: string; size: DevSize }) {
  const { t } = useTranslation();
  return (
    <Card>
      <CardTitle>{title}</CardTitle>
      {size.medianaOre === null ? (
        <p className="text-sm text-muted-foreground">{t("Nessuna ora registrata sui chiusi.")}</p>
      ) : (
        <>
          <p className="text-2xl font-semibold tabular-nums">{hours(size.medianaOre)}</p>
          <p className="text-sm text-muted-foreground">
            {t("di solito fra {{min}} e {{max}}", {
              min: hours(size.q25 ?? 0),
              max: hours(size.q75 ?? 0),
            })}
          </p>
        </>
      )}
      <p className="mt-3 text-xs text-muted-foreground">
        {t("{{withHours}} task chiusi su {{total}} hanno delle ore.", {
          withHours: size.conOre,
          total: size.totali,
        })}
      </p>
    </Card>
  );
}

/**
 * Barre in CSS, due per settimana, senza librerie di grafici.
 *
 * **Il colore porta il significato, non la posizione**: la barra e il suo
 * numero sono dello stesso colore della voce in legenda — azzurro entrati,
 * verde chiusi — perché due cifre grigie affiancate ("40 16") non dicono quale
 * è quale, e sotto una certa larghezza la legenda finisce lontana dal numero.
 * La freccia raddoppia il segno per chi i due colori non li distingue.
 *
 * L'altezza è **in pixel, non in percentuale**: un `height: 60%` si risolve
 * contro l'altezza del genitore solo se quella è definita, e in una colonna
 * flex non lo è — le barre erano semplicemente invisibili (18/08/2026).
 */
const CHART_HEIGHT = 96;

// Le chiavi sono quelle dei **dati** (`entrati`/`usciti`), non le etichette:
// scrivendo `chiusi` la barra verde riceveva `undefined` e spariva, e allo
// schermo restava solo un numero grigio in meno. Le etichette stanno a parte.
const FLOW = {
  entrati: { bar: "bg-sky-500", text: "text-sky-600 dark:text-sky-400", Icon: ArrowDownToLine },
  usciti: {
    bar: "bg-emerald-500",
    text: "text-emerald-600 dark:text-emerald-400",
    Icon: ArrowUpFromLine,
  },
} as const;

function FlowChart({ weeks }: { weeks: DevMetrics["weeks"] }) {
  const { t } = useTranslation();
  const max = Math.max(1, ...weeks.flatMap((w) => [w.entrati, w.usciti]));
  const label = { entrati: t("entrati"), usciti: t("chiusi") };
  return (
    <div>
      <div className="flex items-end gap-3" style={{ height: CHART_HEIGHT }}>
        {weeks.map((week) => (
          <div key={week.week} className="flex min-w-0 flex-1 items-end justify-center gap-1.5">
            {(["entrati", "usciti"] as const).map((kind) => (
              <Bar
                key={kind}
                value={week[kind]}
                max={max}
                kind={kind}
                title={`${label[kind]}: ${week[kind]}`}
              />
            ))}
          </div>
        ))}
      </div>
      <div className="mt-1 flex gap-3">
        {weeks.map((week) => (
          <span
            key={week.week}
            className="min-w-0 flex-1 truncate text-center text-[11px] text-muted-foreground"
          >
            {formatDay(week.week)}
          </span>
        ))}
      </div>
      <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs">
        {(["entrati", "usciti"] as const).map((kind) => {
          const { text, Icon, bar } = FLOW[kind];
          return (
            <span key={kind} className={cn("inline-flex items-center gap-1.5 font-medium", text)}>
              <span className={cn("size-2.5 rounded-sm", bar)} />
              <Icon className="size-3.5" /> {label[kind]}
            </span>
          );
        })}
      </div>
    </div>
  );
}

function Bar({
  value,
  max,
  kind,
  title,
}: {
  value: number;
  max: number;
  kind: keyof typeof FLOW;
  title: string;
}) {
  // Spazio per il numero sopra la barra; una colonna a zero resta un filo, così
  // la settimana senza movimento si vede lo stesso.
  const height = value === 0 ? 2 : Math.max(3, Math.round((value / max) * (CHART_HEIGHT - 18)));
  return (
    <div className="flex w-5 flex-col items-center justify-end sm:w-6" title={title}>
      <span className={cn("text-[11px] font-semibold tabular-nums", FLOW[kind].text)}>
        {value > 0 ? value : ""}
      </span>
      <div className={cn("w-full rounded-t", FLOW[kind].bar)} style={{ height }} />
    </div>
  );
}

function HoursByProject({ rows }: { rows: DevMetrics["team"]["orePerProgetto"] }) {
  const { t } = useTranslation();
  const max = Math.max(1, ...rows.map((row) => row.hours));
  if (rows.length === 0) {
    return <p className="text-sm text-muted-foreground">{t("Nessuna ora nel periodo.")}</p>;
  }
  return (
    <ul className="flex flex-col gap-1.5">
      {rows.map((row) => (
        <li key={row.project ?? "-"} className="flex min-w-0 items-center gap-2 text-sm">
          <span
            className={cn(
              "w-28 shrink-0 truncate sm:w-40",
              // Le ore non legate a un progetto sono un buco nella
              // ripartizione, non una voce come le altre: si vedono.
              row.project === null && "italic text-muted-foreground",
            )}
          >
            {row.project ?? t("Senza progetto")}
          </span>
          <span className="h-2 min-w-0 flex-1 rounded-full bg-muted">
            <span
              className="block h-2 rounded-full bg-primary/70"
              style={{ width: `${(row.hours / max) * 100}%` }}
            />
          </span>
          <span className="w-14 shrink-0 text-right tabular-nums text-muted-foreground">
            {hours(row.hours)}
          </span>
        </li>
      ))}
    </ul>
  );
}

function Row({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="min-w-0 text-muted-foreground">{label}</dt>
      <dd className={cn("shrink-0 tabular-nums", strong && "font-semibold")}>{value}</dd>
    </div>
  );
}

function DevMetricsSkeleton() {
  return (
    <div className="flex flex-col gap-6">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {[0, 1, 2, 3].map((tile) => (
          <div key={tile} className="rounded-lg border bg-card p-3">
            <Skeleton className="h-3 w-20" />
            <Skeleton className="mt-2 h-7 w-12" />
          </div>
        ))}
      </div>
      <div className="grid gap-3 lg:grid-cols-2">
        {[0, 1, 2, 3].map((card) => (
          <div key={card} className="rounded-lg border bg-card p-4">
            <Skeleton className="mb-3 h-4 w-40" />
            <SkeletonRows rows={3} />
          </div>
        ))}
      </div>
    </div>
  );
}
