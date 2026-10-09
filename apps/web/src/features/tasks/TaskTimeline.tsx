import { useEffect, useLayoutEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import { useCaricamentiBloccati } from "@/features/auth/useAuth";
import { CalendarClock, EyeOff, Paperclip, Send, Lock, X } from "lucide-react";
import {
  attachmentLabel,
  firstRejectedAttachment,
  TaskKind,
  TICKET_ATTACHMENT_EXTENSIONS,
  UserRole,
  type Activity,
  type Attachment,
  type TaskDetail,
} from "@kancrm/shared";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { MessageInput } from "@/components/ui/message-input";
import { Label } from "@/components/ui/label";
import { Combobox } from "@/components/ui/combobox";
import { useToast } from "@/components/ui/toast";
import { ApiError } from "@/lib/api";
import { useCurrentUser } from "@/features/auth/useAuth";
import { useMeetings } from "@/features/meetings/useMeetings";
import { formatDate, formatDateTime } from "./task-utils";
import {
  useAddComment,
  useDeleteComment,
  useTaskActivities,
  useTaskComments,
  useUploadAttachment,
  useUserOptions,
} from "./useTasks";
import { AttachmentIcon } from "@/features/attachments/AttachmentIcon";
import { useAttachmentReader } from "@/features/attachments/useAttachmentReader";
import { formatBytes } from "@/lib/bytes";
import { slot } from "@/edition/slots";
import { SecretMessage } from "./SecretMessage";
import { ascoltaVaiAlMessaggio } from "./message-focus";

/** Senza il modulo dei ticket non ci sono richieste, né persone su di esse. */
const nessunaPersona = () => ({ data: undefined });

/** Una voce della tendina delle menzioni: una persona, oppure una parola chiave. */
interface MentionOption {
  id: string;
  name: string;
  keyword: boolean;
}

/**
 * Le parole chiave della chat: comandi, non persone, e per questo stanno in
 * cima e non si filtrano.
 *
 * - `@secret` cifra il messaggio (vedi SecretMessage). Solo per gli interni
 *   dal 16/09/2026: al portale i messaggi cifrati non arrivano, e un cliente
 *   non può mandare un testo che poi non potrebbe rileggere;
 * - `@user` lo manda per email al cliente che ha aperto la richiesta — e
 *   compare **solo dove un cliente c'è davvero e non è lui a scrivere**.
 *   «Davvero» non vuol dire «nata da un ticket»: l'area ticket la usano anche
 *   gli interni, e una richiesta aperta da un collega non ha nessuno fuori a
 *   cui scrivere (02/09/2026). Lo dice il server con `openedByClient`.
 * - `@reserved` tiene il messaggio **fra colleghi**: il cliente del portale e
 *   il monitor vendite non lo vedono (16/09/2026). Si offre agli interni e
 *   solo dove qualcuno da fuori legge davvero la chat — una richiesta aperta
 *   da un cliente, un'offerta condivisa con i monitor vendite: altrove ogni
 *   messaggio è già fra colleghi, e la parola sarebbe rumore.
 */
const PAROLA_SECRET: MentionOption = { id: "__secret__", name: "secret", keyword: true };
const PAROLA_USER: MentionOption = { id: "__user__", name: "user", keyword: true };
const PAROLA_RESERVED: MentionOption = { id: "__reserved__", name: "reserved", keyword: true };

function paroleChiave({
  interno,
  scriveAlCliente,
  qualcunoLeggeDaFuori,
}: {
  interno: boolean;
  scriveAlCliente: boolean;
  qualcunoLeggeDaFuori: boolean;
}): MentionOption[] {
  return [
    ...(interno ? [PAROLA_SECRET] : []),
    ...(scriveAlCliente ? [PAROLA_USER] : []),
    ...(qualcunoLeggeDaFuori ? [PAROLA_RESERVED] : []),
  ];
}

/** Cosa fa una parola chiave, detto a chi la incontra la prima volta. */
function descrizioneParola(name: string, t: (chiave: string) => string): string {
  if (name === "secret") return t("il testo viene cifrato: per dati riservati");
  if (name === "reserved") return t("solo per i colleghi: il cliente non lo vede");
  return t("manda il messaggio al cliente, per email");
}

/**
 * **"Nota presa durante"**: l'incontro a cui appartiene il commento che si sta
 * scrivendo. Resta selezionato fra un messaggio e l'altro, così si trascrive un
 * verbale intero senza riscegliere ogni volta.
 *
 * Estratto dalla chat (20/08/2026) per poterlo mettere dove appartiene: nel
 * pannello del task sta in fondo a *Stato e tempo*, perché è un dato del
 * **quando**, e nella conversazione ancorata rubava spazio proprio alla parte
 * che si usa. Dove nessuno lo colloca (offerte, richieste) resta dov'era: la
 * chat se lo disegna da sé.
 */
export function MeetingNotePicker({
  value,
  onChange,
  className,
  /**
   * **Due posti, due forme.** Sopra la casella di risposta è una strisciolina:
   * etichetta piccola a fianco, perché lì è un'annotazione di contorno. Dentro
   * una sezione di campi è un campo come gli altri — etichetta sopra, in nero,
   * larghezza piena — altrimenti si legge come una didascalia capitata lì per
   * sbaglio: schiacciata accanto ai Tag, con l'etichetta a mezz'altezza e il
   * campo dei tag mozzato (20/08/2026).
   */
  inline = false,
}: {
  value: string;
  onChange: (id: string) => void;
  className?: string;
  inline?: boolean;
}) {
  const { t } = useTranslation();
  const { data: meetings } = useMeetings();
  if ((meetings?.length ?? 0) === 0) return null;
  const combo = (
    <Combobox
      className={inline ? "min-w-40 flex-1" : undefined}
      value={value || null}
      onChange={(id) => onChange(id ?? "")}
      items={(meetings ?? []).map((meeting) => ({
        id: meeting.id,
        label: meeting.dueDate ? `${meeting.dueDate} — ${meeting.title}` : meeting.title,
      }))}
      placeholder={t("Cerca un incontro…")}
      emptyLabel={t("Nessun incontro")}
    />
  );
  if (inline) {
    return (
      <label
        className={cn("flex flex-wrap items-center gap-2 text-xs text-muted-foreground", className)}
      >
        {t("Nota presa durante")}
        {combo}
      </label>
    );
  }
  return (
    <label className={cn("flex min-w-0 flex-col gap-1.5", className)}>
      <Label>{t("Nota presa durante")}</Label>
      {combo}
    </label>
  );
}

export function CommentsSection({
  task,
  /**
   * Il campo per rispondere resta **appiccicato in fondo** alla zona che
   * scorre, invece di stare in coda ai messaggi.
   *
   * Serve dove la conversazione ha una regione sua con un'altezza scelta (il
   * pannello del task, 20/08/2026): stretta o larga che sia, si deve poter
   * scrivere senza prima scorrere fino in fondo. **Non è il caso di tutti**:
   * dove la chat è una sezione in mezzo ad altre — l'offerta ha lo storico
   * sotto — un campo che galleggia coprirebbe quello che viene dopo.
   */
  stickyInput = false,
  /**
   * L'incontro scelto **fuori** dalla chat. Passandolo, il selettore qui dentro
   * non si disegna: lo sta già mostrando chi ci ospita. Senza, tutto resta
   * com'era — è così che offerte e richieste continuano a funzionare senza
   * sapere niente di questa aggiunta.
   */
  meeting,
  /**
   * Il pannello si apre **per scrivere**: il fuoco parte da qui. Lo dichiara
   * chi ospita, perché dipende dal record — su una richiesta la prima cosa che
   * si fa è rispondere, su un task si guarda il titolo (24/08/2026).
   */
  autoFocusInput = false,
  /**
   * Il nome del collega che **sta gestendo la richiesta**. C'è solo quando
   * qualcun altro l'ha presa in carico: allora la casella per rispondere non
   * si disegna proprio. Due risposte scritte insieme, e il cliente ne legge
   * due che si contraddicono — meglio dire chi sta rispondendo (04/09/2026).
   */
  bloccataDa,
  /**
   * Prendere la richiesta al collega, con conferma (25/09/2026): lì dove la
   * casella manca è dove si cerca il modo di rispondere lo stesso.
   */
  onPrendiComunque,
}: {
  task: TaskDetail;
  stickyInput?: boolean;
  meeting?: { id: string; onChange: (id: string) => void };
  autoFocusInput?: boolean;
  bloccataDa?: string | null;
  onPrendiComunque?: () => void;
}) {
  const { t } = useTranslation();
  const currentUser = useCurrentUser();
  const addComment = useAddComment();
  const toast = useToast();
  const deleteComment = useDeleteComment();
  // Commenti caricati in modo lazy: le pagine arrivano dalla più recente; qui si
  // srotolano dal più vecchio al più recente per la lettura a conversazione.
  const commentsQuery = useTaskComments(task.id);
  const comments = (commentsQuery.data?.pages.flatMap((page) => page.items) ?? [])
    .slice()
    .reverse();
  /**
   * Due sorgenti per le menzioni, secondo chi guarda.
   *
   * Gli **interni** hanno l'elenco utenti filtrato per permessi. Il **cliente
   * dal portale** no, e non deve averlo: `@` non può diventare l'organigramma
   * dell'azienda in mano a chi sta fuori. Al suo posto riceve le persone
   * presenti **su quella richiesta** — supervisore, chi ci lavora, chi ha già
   * scritto nella chat — cioè i nomi che ha già davanti in quella pagina
   * (18/08/2026).
   */
  const isPortal = currentUser.role === UserRole.PORTAL;
  const isTicket = task.createdViaTicket || task.kind === TaskKind.TICKET;
  const { data: users } = useUserOptions(!isPortal);
  const { data: ticketPeople } = (slot.usePersoneDellaRichiesta ?? nessunaPersona)(
    isPortal && isTicket ? task.id : null,
  );
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const [body, setBody] = useState("");
  /**
   * **I file in attesa di partire con il messaggio.**
   *
   * Si accumulano qui (trascinandoli sulla barra, o con la graffetta) e salgono
   * al momento dell'invio: prima diventano allegati del task — con i permessi e
   * i formati che quell'endpoint sa applicare — e poi il messaggio dice con
   * quali è arrivato. Caricarli subito riempirebbe il task di file di un
   * messaggio che magari non si manda.
   */
  const [inCoda, setInCoda] = useState<File[]>([]);
  const [trascinando, setTrascinando] = useState(false);
  const bloccati = useCaricamentiBloccati();
  const [caricando, setCaricando] = useState(false);
  const upload = useUploadAttachment();
  const reader = useAttachmentReader();
  /**
   * Al cliente del portale il selettore propone i formati che il server accetta
   * (l'elenco arriva da lui, con le estensioni aggiunte in configurazione): il
   * no definitivo resta del server, questo evita il giro a vuoto.
   */
  const ammesse = currentUser.attachmentExtensions?.length
    ? currentUser.attachmentExtensions
    : [...TICKET_ATTACHMENT_EXTENSIONS];
  // Nota presa durante un incontro: resta selezionato tra un commento e l'altro,
  // così si trascrive un verbale intero senza riscegliere ogni volta.
  const [meetingProprio, setMeetingProprio] = useState("");
  const meetingId = meeting ? meeting.id : meetingProprio;
  const setMeetingId = meeting ? meeting.onChange : setMeetingProprio;
  // Autocomplete menzioni: token "@parola" prima del cursore.
  const [mention, setMention] = useState<{ query: string; start: number } | null>(null);
  /**
   * La tendina delle menzioni vive in un portale, con coordinate fisse
   * ancorate al campo: dentro la barra della chat era `absolute`, e il
   * contenitore che scorre (e si ridimensiona) la tagliava a una riga
   * (31/08/2026). Si ricalcola a ogni apertura, scorrimento e ridimensionamento.
   */
  const [posizioneTendina, setPosizioneTendina] = useState<{
    left: number;
    bottom: number;
  } | null>(null);
  const tendinaAperta = mention !== null;
  useLayoutEffect(() => {
    if (!tendinaAperta) return;
    const aggiorna = () => {
      const r = inputRef.current?.getBoundingClientRect();
      if (r) setPosizioneTendina({ left: r.left, bottom: window.innerHeight - r.top + 4 });
    };
    aggiorna();
    window.addEventListener("resize", aggiorna);
    window.addEventListener("scroll", aggiorna, true);
    return () => {
      window.removeEventListener("resize", aggiorna);
      window.removeEventListener("scroll", aggiorna, true);
    };
  }, [tendinaAperta]);
  const [activeIndex, setActiveIndex] = useState(0);
  /**
   * Il messaggio su cui si è appena saltati (dagli allegati): si accende per
   * qualche secondo, perché arrivare in mezzo a venti righe uguali senza sapere
   * quale sia quella cercata non è arrivare.
   */
  const [evidenziato, setEvidenziato] = useState<string | null>(null);
  /**
   * Il messaggio cercato può essere **fuori dalle pagine caricate**: la chat
   * ne tiene venti per volta, e l'allegato può venire da un mese fa. Si
   * srotola finché non salta fuori, poi ci si porta sopra.
   *
   * `commentsQuery` in una ref: la funzione che ascolta si registra una volta
   * sola, e senza questo leggerebbe per sempre la prima pagina che ha visto.
   */
  const queryRef = useRef(commentsQuery);
  queryRef.current = commentsQuery;
  useEffect(
    () =>
      ascoltaVaiAlMessaggio(async (commentId) => {
        const caricate = () => queryRef.current.data?.pages.flatMap((pagina) => pagina.items) ?? [];
        // Il tetto è la garanzia che si finisca: venti pagine sono quattrocento
        // messaggi, e più indietro di così l'allegato non lo cerca nessuno.
        for (let giro = 0; giro < 20; giro += 1) {
          if (caricate().some((messaggio) => messaggio.id === commentId)) break;
          if (!queryRef.current.hasNextPage) break;
          await queryRef.current.fetchNextPage();
        }
        setEvidenziato(commentId);
      }),
    [],
  );
  useEffect(() => {
    if (!evidenziato) return;
    // Dopo il disegno: il messaggio appena caricato non c'era, un attimo fa.
    const nodo = document.getElementById(`messaggio-${evidenziato}`);
    nodo?.scrollIntoView?.({ block: "center", behavior: "smooth" });
    const spegni = setTimeout(() => setEvidenziato(null), 4000);
    return () => clearTimeout(spegni);
  }, [evidenziato]);

  /**
   * Chi si può citare con `@`.
   *
   * L'elenco utenti esclude i ruoli esterni — giusto ovunque, perché a un
   * cliente non si assegna un task — ma su una **richiesta** il cliente è
   * esattamente la persona con cui si sta parlando, e non trovarlo nella
   * tendina faceva pensare che non gli arrivasse niente (18/08/2026). Sta in
   * cima: in una chat di assistenza è il primo nome che serve.
   *
   * Il server, dal canto suo, riconosce le menzioni leggendo il testo
   * (`findMentionedUserIds`) e non filtra per ruolo: scrivendo il nome a mano
   * la notifica partiva già. Qui si toglie solo il "come facevo a saperlo".
   */
  const richiedente = isTicket ? task.creator : null;
  const citabili = useMemo(() => {
    if (isPortal) return ticketPeople ?? [];
    const elenco = users ?? [];
    return !richiedente || elenco.some((u) => u.id === richiedente.id)
      ? elenco
      : [richiedente, ...elenco];
  }, [isPortal, ticketPeople, users, richiedente]);

  /**
   * Le parole chiave stanno SEMPRE in cima alla tendina, qualunque cosa si
   * stia scrivendo dopo la chiocciola, e si vedono diverse dalle persone
   * (grassetto, colore d'accento, lucchetto): "@secret" non è un collega, è
   * il comando che cifra il messaggio, e va trovato senza saperlo già
   * (31/08/2026). Dal 16/09/2026 le parole chiave sono solo degli interni: al
   * cliente del portale la tendina propone le persone e basta.
   */
  const matches: MentionOption[] =
    mention !== null
      ? [
          ...paroleChiave({
            interno: !isPortal,
            scriveAlCliente: task.openedByClient && !isPortal,
            qualcunoLeggeDaFuori:
              !isPortal &&
              (task.openedByClient ||
                ("visibleToSalesMonitors" in task && task.visibleToSalesMonitors === true)),
          }),
          ...citabili
            .filter((u) => u.name.toLowerCase().includes(mention.query))
            .slice(0, 6)
            .map((u) => ({ id: u.id, name: u.name, keyword: false as const })),
        ]
      : [];

  const onChangeBody = (event: React.ChangeEvent<HTMLTextAreaElement>) => {
    const value = event.target.value;
    setBody(value);
    const caret = event.target.selectionStart ?? value.length;
    const token = value.slice(0, caret).match(/@([\p{L}]*)$/u);
    setMention(
      token ? { query: (token[1] ?? "").toLowerCase(), start: caret - token[0].length } : null,
    );
    setActiveIndex(0);
  };

  const applyMention = (name: string) => {
    if (!mention) return;
    const caret = inputRef.current?.selectionStart ?? body.length;
    setBody(`${body.slice(0, mention.start)}@${name} ${body.slice(caret)}`);
    setMention(null);
    requestAnimationFrame(() => inputRef.current?.focus());
  };

  /**
   * La tendina delle menzioni si usa **senza staccare le mani dalla tastiera**:
   * frecce per scegliere, Invio o Tab per confermare, Esc per rinunciare.
   *
   * Gira prima di `MessageInput`: finché la tendina è aperta, Invio sceglie la
   * persona e non manda il messaggio — `preventDefault()` è il modo con cui i
   * due si mettono d'accordo su chi ha preso il tasto.
   *
   * Esc **si ferma qui** (`stopPropagation`): la pila di `useEscapeToClose`
   * ascolta su `window`, e senza fermarlo un Esc chiudeva la tendina *e* il
   * pannello di dettaglio dietro — con dentro il messaggio scritto a metà.
   */
  const onKeyDown = (event: React.KeyboardEvent) => {
    if (mention === null || matches.length === 0) return;
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActiveIndex((i) => (i + 1) % matches.length);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActiveIndex((i) => (i - 1 + matches.length) % matches.length);
    } else if (event.key === "Enter" || event.key === "Tab") {
      event.preventDefault();
      applyMention(matches[activeIndex]!.name);
    } else if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      setMention(null);
    }
  };

  /**
   * **Il campo si svuota subito, il messaggio parte per conto suo.**
   *
   * Prima l'invio si fermava se ce n'era uno ancora in volo
   * (`addComment.isPending`): scrivendo due righe di fila — che in una chat è
   * la norma — la seconda veniva **ingoiata in silenzio**, il testo restava
   * nel campo e chi scriveva ci passava sopra con la riga dopo. L'ha stanato
   * la prova nel browser, che manda sei messaggi uno dietro l'altro
   * (24/08/2026).
   *
   * Se l'invio fallisce il testo **torna nel campo** con un avviso: sparire
   * senza dire niente è il difetto di prima con un altro nome.
   */
  /**
   * **Il rifiuto dice quale file.** Trascinandone sei, «formato non ammesso»
   * lascia da indovinare quale sia quello sbagliato: la regola sta in un posto
   * solo (`firstRejectedAttachment`) e vale anche per i file trascinati, che
   * l'attributo `accept` non lo guardano.
   */
  const accoda = (scelti: FileList | File[]) => {
    const elenco = Array.from(scelti);
    if (elenco.length === 0) return;
    const rifiutato = isPortal
      ? firstRejectedAttachment(
          elenco.map((f) => f.name),
          ammesse,
        )
      : null;
    if (rifiutato) {
      toast(
        t("{{file}} non si può allegare: sono ammessi {{formats}}.", {
          file: rifiutato,
          formats: attachmentLabel(ammesse),
        }),
        "error",
      );
      return;
    }
    setInCoda((prima) => [...prima, ...elenco]);
    inputRef.current?.focus();
  };

  const send = () => {
    const trimmed = body.trim();
    // Un allegato senza una parola sopra è un messaggio: «ecco il file».
    if (!trimmed && inCoda.length === 0) return;
    const allegati = inCoda;
    setBody("");
    setInCoda([]);
    setMention(null);
    // Se qualcosa va storto si rimette tutto com'era, testo e file: riscrivere
    // il messaggio è seccante, ritrovare i file da allegare lo è di più.
    const rimetti = (messaggio: string, azione?: { etichetta: string; fai: () => void }) => {
      toast(messaggio, "error", azione ? { azione } : undefined);
      setBody((corrente) => (corrente === "" ? trimmed : corrente));
      setInCoda((corrente) => (corrente.length === 0 ? allegati : corrente));
    };

    /**
     * `forza` scavalca la presa in carico di un collega. Non parte da sola: la
     * prima volta si prova normalmente, e **solo se il server dice che la
     * richiesta è in carico** l'avviso offre «Invia ugualmente». Chi lo clicca
     * ha appena letto di chi è, e insiste apposta — il collega in riunione che
     * ha preso la richiesta e non risponde non deve poter bloccare il cliente.
     */
    const manda = (attachmentIds: string[], forza = false) =>
      addComment.mutate(
        { taskId: task.id, body: trimmed, meetingId: meetingId || null, attachmentIds, forza },
        {
          onError: (error) => {
            const bloccato = error instanceof ApiError && error.code === "TICKET_LOCKED";
            rimetti(
              error instanceof ApiError ? error.message : t("Messaggio non inviato: riprova."),
              bloccato && !forza
                ? {
                    etichetta: t("Invia ugualmente"),
                    fai: () => {
                      // Il campo torna vuoto: il messaggio che riparte è quello
                      // di prima, non quello che si sta magari già riscrivendo.
                      setBody("");
                      setInCoda([]);
                      manda(attachmentIds, true);
                    },
                  }
                : undefined,
            );
          },
        },
      );

    if (allegati.length === 0) return manda([]);
    /**
     * I file salgono **prima** del messaggio: è l'endpoint degli allegati a
     * decidere se un file si può caricare, e serve il suo identificativo per
     * legarlo. Se il caricamento non riesce il messaggio non parte — meglio
     * riprovare tutto insieme che mandare una frase senza il file di cui parla.
     */
    setCaricando(true);
    void Promise.all(allegati.map((file) => upload.mutateAsync({ taskId: task.id, file })))
      .then((caricati) => manda(caricati.map((allegato) => allegato.id)))
      .catch((errore: unknown) =>
        rimetti(errore instanceof ApiError ? errore.message : t("Allegato non caricato: riprova.")),
      )
      .finally(() => setCaricando(false));
  };

  const submit = (event: FormEvent) => {
    event.preventDefault();
    send();
  };

  return (
    <section className="mt-6">
      <h3 className="mb-2 text-sm font-semibold">
        {t("Commenti")} ({task.commentCount})
      </h3>
      {!meeting && (
        <MeetingNotePicker inline className="mb-2" value={meetingId} onChange={setMeetingId} />
      )}
      {commentsQuery.hasNextPage && (
        <button
          type="button"
          onClick={() => void commentsQuery.fetchNextPage()}
          disabled={commentsQuery.isFetchingNextPage}
          className="mb-2 text-xs text-muted-foreground hover:text-foreground hover:underline disabled:opacity-50"
        >
          {commentsQuery.isFetchingNextPage ? t("Caricamento…") : t("Mostra commenti precedenti")}
        </button>
      )}
      <ul className="flex flex-col gap-2">
        {comments.map((comment) => (
          <li
            key={comment.id}
            id={`messaggio-${comment.id}`}
            className={cn(
              "rounded-md border p-3 text-sm transition-colors",
              // Il messaggio a cui si è appena saltati dagli allegati.
              evidenziato === comment.id && "ring-2 ring-primary",
              // Un messaggio cifrato si riconosce dal bordo, prima ancora del
              // lucchetto: il colore è quello d'accento del tema (31/08/2026).
              comment.secret && "border-primary/60 bg-primary/5 ring-1 ring-primary/25",
              // Riservato agli interni: il bordo tratteggiato dice «resta qui
              // dentro» prima ancora dell'etichetta (16/09/2026).
              comment.reserved && "border-dashed border-muted-foreground/50 bg-muted/40",
            )}
          >
            <div className="mb-1 flex items-center justify-between">
              <span className="flex flex-wrap items-center gap-2">
                <span className="font-medium">{comment.author.name}</span>
                {/*
                  Mandato al cliente con `@user`. Il comando sparisce dal testo,
                  quindi senza questa marcatura, riaprendo la chat, non ci sarebbe
                  modo di sapere se al cliente è stato scritto — e questa funzione
                  serve proprio a decidere cosa gli arriva (02/09/2026).
                  Al cliente non si mostra: a lui è arrivato, lo sa.
                */}
                {/*
                  Riservato agli interni con `@reserved`: anche qui il comando
                  sparisce dal testo, e la marcatura ricorda a chi rilegge che
                  il cliente questo messaggio non l'ha mai visto. Al portale non
                  arriva proprio, quindi non c'è niente da nascondergli.
                */}
                {comment.reserved && (
                  <span
                    className="inline-flex items-center gap-1 rounded-full border border-muted-foreground/40 bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground"
                    title={t(
                      "I clienti del portale e i monitor vendite non vedono questo messaggio",
                    )}
                  >
                    <EyeOff className="size-3" aria-hidden />
                    {t("solo interni")}
                  </span>
                )}
                {comment.sentToClient && !isPortal && (
                  <span
                    className="inline-flex items-center gap-1 rounded-full border border-primary/40 bg-primary/5 px-2 py-0.5 text-xs font-medium text-primary"
                    title={t("Il cliente ha ricevuto questo messaggio per email")}
                  >
                    <Send className="size-3" />
                    {t("inviato al cliente")}
                  </span>
                )}
              </span>
              <div className="flex items-center gap-1 text-xs text-muted-foreground">
                {formatDateTime(comment.createdAt)}
                {(comment.author.id === currentUser.id || currentUser.role === UserRole.ADMIN) && (
                  <button
                    className="ml-1 text-destructive hover:underline"
                    onClick={() => deleteComment.mutate({ taskId: task.id, commentId: comment.id })}
                  >
                    {t("Elimina")}
                  </button>
                )}
              </div>
            </div>
            {comment.meeting && (
              <p className="mb-1 inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">
                <CalendarClock className="size-3" />
                {comment.meeting.dueDate
                  ? t("Incontro del {{date}}", { date: formatDate(comment.meeting.dueDate) })
                  : comment.meeting.title}
              </p>
            )}
            {comment.secret ? (
              <SecretMessage taskId={task.id} commentId={comment.id} />
            ) : (
              // Un messaggio può essere il solo allegato: «ecco il file». Una
              // riga vuota sopra i documenti direbbe che manca qualcosa.
              comment.body !== "" && <p className="whitespace-pre-wrap">{comment.body}</p>
            )}
            <AllegatiDelMessaggio allegati={comment.attachments} onApri={reader.open} />
          </li>
        ))}
      </ul>
      {bloccataDa ? (
        <p
          className={cn(
            "mt-2 flex items-center gap-2 rounded-md border border-dashed px-3 py-2 text-sm text-muted-foreground",
            stickyInput && "sticky -mx-4 -mb-3 bottom-0 z-10 border-x-0 border-b-0 bg-background",
          )}
        >
          <Lock className="size-4 shrink-0" aria-hidden />
          <span className="min-w-0 flex-1">
            {t("{{name}} sta rispondendo: attendi che lasci la richiesta", { name: bloccataDa })}
          </span>
          {onPrendiComunque && (
            <Button type="button" size="sm" variant="outline" onClick={onPrendiComunque}>
              {t("Prendi comunque")}
            </Button>
          )}
        </p>
      ) : (
        <form
          onSubmit={submit}
          className={cn(
            "relative mt-2 flex flex-col gap-2",
            // I margini negativi annullano il rientro della zona che scorre, così
            // la barra tocca i bordi e niente passa nella fessura sotto.
            stickyInput && "sticky -mx-4 -mb-3 bottom-0 z-10 border-t bg-background px-4 py-2",
            trascinando && "rounded-md outline-dashed outline-2 outline-offset-2 outline-primary",
          )}
          /*
           * **Un file si allega trascinandolo qui sopra.** È il gesto con cui si
           * allega ovunque, e la barra del messaggio è dove si sta guardando
           * quando viene in mente di mandarne uno. `dragOver` va sempre
           * annullato: altrimenti il browser si prende il file e apre il PDF al
           * posto della pagina.
           */
          onDragEnter={(e) => {
            if (!bloccati && e.dataTransfer.types.includes("Files")) {
              e.preventDefault();
              setTrascinando(true);
            }
          }}
          onDragOver={(e) => {
            if (!bloccati && e.dataTransfer.types.includes("Files")) e.preventDefault();
          }}
          onDragLeave={(e) => {
            // Solo uscendo davvero dalla barra: passando sopra il campo di testo
            // l'evento arriva lo stesso, e il bordo lampeggerebbe.
            if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setTrascinando(false);
          }}
          onDrop={(e) => {
            if (bloccati || !e.dataTransfer.types.includes("Files")) return;
            e.preventDefault();
            setTrascinando(false);
            accoda(e.dataTransfer.files);
          }}
        >
          {inCoda.length > 0 && (
            <ul className="flex flex-wrap gap-1.5">
              {inCoda.map((file, indice) => (
                <li
                  key={`${file.name}-${indice}`}
                  className="flex max-w-full items-center gap-1.5 rounded-full border bg-muted/40 py-1 pl-3 pr-1 text-xs"
                >
                  <Paperclip className="size-3 shrink-0 text-muted-foreground" />
                  <span className="truncate">{file.name}</span>
                  <span className="shrink-0 text-muted-foreground">{formatBytes(file.size)}</span>
                  <button
                    type="button"
                    className="shrink-0 rounded-full p-0.5 text-muted-foreground hover:bg-accent hover:text-foreground"
                    title={t("Togli l'allegato")}
                    aria-label={t("Togli {{file}}", { file: file.name })}
                    onClick={() => setInCoda((prima) => prima.filter((_, i) => i !== indice))}
                  >
                    <X className="size-3" />
                  </button>
                </li>
              ))}
            </ul>
          )}
          <div className="flex items-end gap-2">
            {matches.length > 0 &&
              createPortal(
                <ul
                  role="listbox"
                  aria-label={t("Persone e parole chiave da menzionare")}
                  // La tendina galleggia sopra la pagina (portale, `fixed`) e il
                  // bordo chiaro di sistema si perdeva sui riquadri sotto: qui il
                  // grigio scuro della palette, che la stacca senza gridare.
                  // L'accento è riservato alla riga scelta, dove serve davvero.
                  className="fixed z-[120] max-h-48 w-72 overflow-y-auto rounded-md border border-muted-foreground bg-popover text-popover-foreground shadow-lg"
                  style={posizioneTendina ?? { left: 0, bottom: 0 }}
                >
                  {matches.map((user, index) => (
                    <li key={user.id}>
                      <button
                        type="button"
                        role="option"
                        id={`mention-${user.id}`}
                        aria-selected={index === activeIndex}
                        // La riga scelta con le frecce deve restare visibile: con otto
                        // colleghi l'elenco scorre, e la scelta finiva sotto il bordo.
                        ref={(node) => {
                          // `?.()`: in jsdom (i test) scrollIntoView non esiste.
                          if (index === activeIndex) node?.scrollIntoView?.({ block: "nearest" });
                        }}
                        className={cn(
                          // Il bordo trasparente c'è su TUTTE le righe: solo il
                          // colore cambia sulla riga scelta. Metterlo solo lì
                          // sposterebbe di due pixel tutte le altre a ogni freccia.
                          "flex w-full items-center gap-1.5 border border-transparent px-3 py-1.5 text-left text-sm hover:bg-muted",
                          index === activeIndex && "border-primary bg-muted",
                          user.keyword && "font-semibold text-primary",
                          // Il filo sotto l'ultima parola chiave separa i comandi
                          // dalle persone: il colore va detto, perché sopra è
                          // trasparente e resterebbe invisibile.
                          user.keyword && !matches[index + 1]?.keyword && "border-b-border",
                        )}
                        onMouseDown={(e) => {
                          e.preventDefault();
                          applyMention(user.name);
                        }}
                      >
                        {user.keyword ? (
                          /*
                           * Una parola chiave non è un collega: chi la incontra la
                           * prima volta non ha modo di sapere cosa fa, e "@secret"
                           * da solo non lo dice. La riga sotto lo dice — a cosa
                           * serve, non come è implementato.
                           */
                          <span className="flex flex-col items-start gap-0.5">
                            <span className="flex items-center gap-1.5">
                              {user.name === "reserved" ? (
                                <EyeOff className="size-3.5 shrink-0" aria-hidden />
                              ) : (
                                <Lock className="size-3.5 shrink-0" aria-hidden />
                              )}
                              {`@${user.name}`}
                            </span>
                            <span className="text-xs font-normal leading-snug text-muted-foreground">
                              {descrizioneParola(user.name, t)}
                            </span>
                          </span>
                        ) : (
                          user.name
                        )}
                      </button>
                    </li>
                  ))}
                </ul>,
                document.body,
              )}
            <MessageInput
              ref={inputRef}
              {...(autoFocusInput ? { "data-autofocus": true } : {})}
              placeholder={
                meetingId
                  ? t("Nota presa durante l'incontro…")
                  : t("Scrivi un commento… (@nome per menzionare, Shift+Invio per andare a capo)")
              }
              value={body}
              onChange={onChangeBody}
              onKeyDown={onKeyDown}
              onSend={send}
              aria-activedescendant={
                matches.length > 0 ? `mention-${matches[activeIndex]?.id ?? ""}` : undefined
              }
            />
            <input
              ref={fileRef}
              type="file"
              multiple
              className="hidden"
              accept={isPortal ? ammesse.join(",") : undefined}
              onChange={(e) => {
                if (e.target.files) accoda(e.target.files);
                // Si azzera: riscegliendo lo stesso file, `change` non scatterebbe.
                e.target.value = "";
              }}
            />
            <Button
              type="button"
              size="icon"
              variant="ghost"
              disabled={caricando}
              title={t("Allega un file (o trascinalo qui)")}
              aria-label={t("Allega un file")}
              onClick={() => fileRef.current?.click()}
            >
              <Paperclip className="size-4" />
            </Button>
            <Button
              type="submit"
              size="icon"
              disabled={(body.trim() === "" && inCoda.length === 0) || caricando}
              title={caricando ? t("Carico gli allegati…") : t("Invia")}
            >
              <Send className="size-4" />
            </Button>
          </div>
        </form>
      )}
      {reader.panel}
    </section>
  );
}

/**
 * **I file arrivati con un messaggio.**
 *
 * Sono allegati del task come tutti gli altri — si ritrovano nella sezione
 * Allegati, e da lì si scaricano o si eliminano — ma qui stanno accanto alla
 * frase che li accompagnava, che è il modo in cui uno se li ricorda: non «il
 * quarto documento del task», ma «quello che mi ha mandato Giacomo dicendo
 * che era l'ultima versione». Il clic apre il lettore, come ovunque.
 */
function AllegatiDelMessaggio({
  allegati,
  onApri,
}: {
  /**
   * Facoltativo di proposito: il tipo descrive quello che il server manda
   * *oggi*, ma la risposta arriva dalla rete e durante un rilascio la pagina
   * nuova può parlare per un istante con il server vecchio, che questo campo
   * non lo conosce. Una conversazione non si deve spegnere per questo.
   */
  allegati: Attachment[] | undefined;
  onApri: (attachmentId: string) => Promise<void>;
}) {
  const { t } = useTranslation();
  if (!allegati || allegati.length === 0) return null;
  return (
    <ul className="mt-2 flex flex-wrap gap-1.5">
      {allegati.map((allegato) => (
        <li key={allegato.id}>
          <button
            type="button"
            className="flex max-w-full items-center gap-1.5 rounded-full border bg-background px-3 py-1 text-xs hover:bg-muted"
            title={t("Apri {{file}}", { file: allegato.name })}
            onClick={() => void onApri(allegato.id)}
          >
            <AttachmentIcon
              attachment={allegato}
              className="size-3.5 shrink-0 text-muted-foreground"
            />
            <span className="truncate">{allegato.name}</span>
            {allegato.size !== null && (
              <span className="shrink-0 text-muted-foreground">{formatBytes(allegato.size)}</span>
            )}
          </button>
        </li>
      ))}
    </ul>
  );
}

const activityLabels: Record<string, string> = {
  created: "ha creato il task",
  updated: "ha aggiornato il task",
  renamed: "ha rinominato",
  status_changed: "ha cambiato lo stato",
  // Fusione di due stati dalla pagina Stati: il task non è stato lavorato, è la
  // configurazione dell'area che è cambiata sotto di lui. Detto con parole
  // diverse da un cambio di stato a mano, perché è una cosa diversa.
  status_merged: "ha migrato lo stato in una fusione di stati",
  stage_changed: "ha cambiato fase",
  assignee_changed: "ha cambiato assegnatario",
  supervisor_changed: "ha cambiato supervisore",
  activity_type_changed: "ha cambiato tipo di attività",
  predecessor_changed: "ha cambiato il propedeutico",
  due_changed: "ha cambiato la scadenza",
  closed_date_changed: "ha corretto la data di chiusura",
  value_changed: "ha cambiato il valore",
  probability_changed: "ha cambiato la probabilità",
  description_changed: "ha cambiato la descrizione",
  contact_changed: "ha cambiato il contatto",
  lost_reason_changed: "ha cambiato il motivo della perdita",
  sales_monitor_visibility_changed: "ha cambiato la visibilità ai monitor vendite",
  deal_created: "ha creato un'offerta da questo task",
  moved: "ha spostato il task",
  company_changed: "ha cambiato il cliente",
  deleted: "ha spostato nel cestino",
  restored: "ha ripristinato dal cestino",
  billing_task_created: "ha generato il task di fatturazione",
  billing_milestone: "ha raggiunto una tappa da fatturare",
  recurrence_advanced: "ha completato il ciclo e avanzato la scadenza",
  commented: "ha commentato",
  attachment_added: "ha aggiunto un allegato",
  attachment_removed: "ha rimosso un allegato",
};

/** Voci con payload {from, to}: nella timeline diventano "prima → dopo". */
const FROM_TO_ACTIONS = new Set([
  "moved",
  "status_merged",
  "company_changed",
  "status_changed",
  "stage_changed",
  "renamed",
  "assignee_changed",
  "supervisor_changed",
  "activity_type_changed",
  "predecessor_changed",
  "due_changed",
  "closed_date_changed",
  "value_changed",
  "probability_changed",
  "contact_changed",
  "lost_reason_changed",
  "recurrence_advanced",
]);

function activityDetail(activity: Activity, t: (key: string) => string): string | null {
  const payload = activity.payload as Record<string, unknown> | null;
  if (FROM_TO_ACTIONS.has(activity.action) && payload) {
    const unit = activity.action === "probability_changed" ? "%" : "";
    const value = (raw: unknown) =>
      raw === null || raw === undefined ? "—" : `${String(raw)}${unit}`;
    return `${value(payload.from)} → ${value(payload.to)}`;
  }
  if (
    (activity.action === "attachment_added" || activity.action === "attachment_removed") &&
    payload
  ) {
    return String(payload.name);
  }
  // Visibilità agli investitori: un sì/no, detto a parole.
  if (activity.action === "sales_monitor_visibility_changed" && payload) {
    return payload.to ? t("ora visibile") : t("non più visibile");
  }
  if (activity.action === "deal_created" && payload) return String(payload.title);
  // Tappa da fatturare: dire quale stato l'ha fatta scattare è metà
  // dell'informazione — l'altra metà è che è scattata.
  if (activity.action === "billing_milestone" && payload) return String(payload.status);
  return null;
}

export function ActivitySection({
  activities,
  hasMore,
  loadingMore,
  onLoadMore,
  labels,
}: {
  activities: Activity[];
  hasMore?: boolean;
  loadingMore?: boolean;
  onLoadMore?: () => void;
  /** Voci dette diversamente in un contesto: in un'offerta la "scadenza" è la chiusura prevista. */
  labels?: Record<string, string>;
}) {
  const { t } = useTranslation();
  return (
    <section className="mt-6">
      <h3 className="mb-2 text-sm font-semibold">{t("Attività")}</h3>
      <ul className="flex flex-col gap-1.5 border-l pl-4">
        {activities.map((activity) => {
          const detail = activityDetail(activity, t);
          const label = labels?.[activity.action] ?? activityLabels[activity.action];
          return (
            <li key={activity.id} className={cn("relative text-xs text-muted-foreground")}>
              <span className="absolute -left-[21px] top-1 size-2 rounded-full bg-border" />
              <span className="font-medium text-foreground">{activity.user.name}</span>{" "}
              {label ? t(label) : activity.action}
              {detail && <span className="text-foreground"> — {detail}</span>}
              <span className="ml-1">· {formatDateTime(activity.createdAt)}</span>
            </li>
          );
        })}
      </ul>
      {hasMore && (
        <button
          type="button"
          onClick={onLoadMore}
          disabled={loadingMore}
          className="mt-2 text-xs text-muted-foreground hover:text-foreground hover:underline disabled:opacity-50"
        >
          {loadingMore ? t("Caricamento…") : t("Mostra attività precedenti")}
        </button>
      )}
    </section>
  );
}

/** Timeline (di task, offerte o ticket: tutti Task) caricata in modo lazy dagli endpoint. */
export function TaskActivitySection({
  taskId,
  labels,
}: {
  taskId: string;
  labels?: Record<string, string>;
}) {
  const query = useTaskActivities(taskId);
  const activities = query.data?.pages.flatMap((page) => page.items) ?? [];
  return (
    <ActivitySection
      activities={activities}
      hasMore={query.hasNextPage}
      loadingMore={query.isFetchingNextPage}
      onLoadMore={() => void query.fetchNextPage()}
      labels={labels}
    />
  );
}
