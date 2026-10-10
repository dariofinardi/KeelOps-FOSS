// Copyright (c) 2026 Jugaad s.r.l.
// SPDX-License-Identifier: AGPL-3.0-only

import { useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { KeelopsMark } from "@/components/ui/keelops-logo";
import {
  CalendarClock,
  ChevronDown,
  ChevronRight,
  Contact,
  FolderKanban,
  HandCoins,
  Home,
  Hourglass,
  Keyboard,
  LifeBuoy,
  Rocket,
  ShieldCheck,
} from "lucide-react";
import { APP_VERSION, UserRole } from "@kancrm/shared";
import { localeTag } from "@/lib/i18n";
import { useCurrentUser } from "@/features/auth/useAuth";
import {
  PRIMA_VERSIONE_COMMUNITY,
  RELEASE_NOTES,
  testoDellaVoce,
  type ReleaseNote,
} from "./release-notes";
import { edizione } from "@/edition/rotte";

interface HelpSection {
  id: string;
  title: string;
  icon: typeof Home;
  visible?: (flags: {
    deals: boolean;
    adminTasks: boolean;
    tickets: boolean;
    admin: boolean;
  }) => boolean;
  Content: () => ReactNode;
}

const P = ({ children }: { children: ReactNode }) => (
  <p className="text-sm leading-relaxed text-muted-foreground">{children}</p>
);
const B = ({ children }: { children: ReactNode }) => (
  <strong className="font-medium text-foreground">{children}</strong>
);
const UL = ({ children }: { children: ReactNode }) => (
  <ul className="flex list-disc flex-col gap-1 pl-5 text-sm leading-relaxed text-muted-foreground">
    {children}
  </ul>
);

/**
 * A passage of the guide that exists with an edition module (08/10/2026):
 * `children` when the module is there, `altrimenti` (or nothing) when not.
 */
function ConModulo({
  modulo,
  altrimenti = null,
  children,
}: {
  modulo: string | string[];
  altrimenti?: ReactNode;
  children: ReactNode;
}) {
  const moduli = Array.isArray(modulo) ? modulo : [modulo];
  return <>{moduli.some((nome) => edizione.moduli.has(nome)) ? children : altrimenti}</>;
}

const SECTIONS: HelpSection[] = [
  {
    id: "release-notes",
    // Titolo in inglese di proposito: dichiara che il contenuto non è tradotto.
    // Non essendo una chiave dei cataloghi, `t()` restituisce questa stessa
    // frase in tutte le lingue — che è esattamente ciò che si vuole.
    title: "Release notes (English only)",
    icon: Rocket,
    Content: ReleaseNotes,
  },
  {
    id: "home",
    title: "La mia giornata",
    icon: Home,
    Content: () => {
      const { t } = useTranslation();
      return (
        <>
          <P>
            {t("È la tua pagina di partenza: le scadenze in quattro riquadri — ")}
            <B>{t("In ritardo")}</B>, <B>{t("In scadenza oggi")}</B>, <B>{t("Domani")}</B>
            {t(" e ")}
            <B>{t("Prossimi giorni")}</B>
            {t(" (da dopodomani, per i tre giorni successivi) — più ")}
            <B>{t("Da prendere in carico")}</B>
            {t(
              " in alto a destra, il conteggio dei tuoi task per stato, le offerte in corso e le ultime notifiche.",
            )}
          </P>
          <P>
            {t("In ogni riquadro i due contatori sono anche il filtro: ")}
            <B>{t("Miei (n)")}</B>
            {t(" sono i task assegnati a te, ")}
            <B>{t("Supervisionati (n)")}</B>
            {t(
              " quelli di cui rispondi ma che esegue qualcun altro. Clicca l'uno o l'altro per cambiare lista: la scelta viene ricordata. L'ultimo riquadro, ",
            )}
            <B>{t("Senza scadenza")}</B>
            {t(
              ", raccoglie i lavori aperti a cui nessuno ha messo una data: senza, sparirebbero dalla pagina.",
            )}
          </P>
          <P>
            {t(
              "Nei pannelli e nelle finestre, accanto al nome di un campo può esserci un pallino: ",
            )}{" "}
            <B>{t("viola")}</B>
            {t(" = campo necessario, ")}
            <B>{t("azzurro")}</B>
            {t(
              " = consigliato (aiuta chi lavora dopo di te). Senza pallino il campo è facoltativo. La scala è la stessa in tutta l'applicazione.",
            )}
          </P>
          <P>
            {t("Se lavori nell'area tecnica, in alto trovi il selettore ")}
            <B>{t("I task")}</B>
            {t(" / ")}
            <B>{t("L'andamento")}</B>
            <ConModulo
              modulo="ticket"
              altrimenti={t(
                ": la seconda vista mostra le ultime quattro settimane — il flusso di squadra (quanti task entrano e quanti escono), dove si ferma il lavoro aperto, i tempi mediani, le ore per progetto, i ritardi di ciascuno e la tua copertura del timesheet. Due avvertenze che sono scritte anche in pagina: i tempi non contano i task creati e chiusi nella stessa ora né lo storico importato da altri strumenti, e le ore servono a dare la ",
              )}
            >
              {t(
                ": la seconda vista mostra le ultime quattro settimane — il flusso di squadra (quanti task entrano e quanti escono), dove si ferma il lavoro aperto, i tempi mediani, le ore per progetto e la tua copertura del timesheet. Due avvertenze che sono scritte anche in pagina: i tempi non contano i task creati e chiusi nella stessa ora né lo storico importato da ClickUp e osTicket, e le ore servono a dare la ",
              )}
            </ConModulo>
            <B>{t("taglia")}</B>
            {t(
              " del lavoro — un task da un'ora e uno da undici non si confrontano contandoli. Non è una classifica, ed è il motivo per cui l'elenco delle persone è in ordine alfabetico.",
            )}
          </P>
        </>
      );
    },
  },
  {
    id: "scadenzario",
    title: "Bacheche: scadenzario e ricorrenze",
    icon: CalendarClock,
    visible: (f) => f.adminTasks,
    Content: () => {
      const { t } = useTranslation();
      return (
        <>
          <P>
            {t("Raccoglie i task amministrativi. Il filtro ")}
            <B>{t("range di scadenza")}</B>
            {t(
              " (entro 7/15/30/60 giorni) mostra gli scaduti più quelli in scadenza nel periodo; i task senza data riappaiono con «Tutte le scadenze». Lo stesso filtro c'è dentro i progetti. Quattro viste:",
            )}{" "}
            <B>{t("Agenda")}</B>
            {t(" (per data, con mini-calendario), ")}
            <B>{t("Tabella")}</B>
            {t(" (ordinabile e filtrabile, esportabile in CSV), ")}
            <B>{t("Kanban")}</B>
            {t(" (trascina le card per cambiare stato) e")} <B>{t("Ricorrenze")}</B>.
          </P>
          <P>
            {t("Il lavoro delle ")}
            <B>{t("altre aree")}</B>
            {t(
              " non si mescola qui — ogni area ha i suoi stati e la sua bacheca — ma non si perde: lo ritrovi dalla ",
            )}
            <B>{t("tua giornata")}</B>
            {t(" (riquadri Miei / Supervisionati), dall'elenco ")}
            <B>{t("Progetti")}</B>
            {t(" (che mostra anche quelli dove hai solo del lavoro) e dalla ")}
            <B>{t("ricerca globale")}</B>.
          </P>
          <P>
            {t("Nell'agenda ogni riga dice ")}
            <B>{t("a cosa fa capo")}</B>
            {t(
              " il task — l'offerta o il progetto da cui nasce, con l'azienda cliente — e, quando non stai filtrando per persona, a chi è intestato, con la tendina per riassegnarlo al volo.",
            )}
          </P>
          <UL>
            <li>
              {t("Le ")}
              <B>{t("categorie")}</B>
              {t(" delle attività sono quattro: amministrative, commerciali, sviluppo e")}{" "}
              <B>{t("trasversali")}</B>
              {t('. Le trasversali (es. "Riunione") valgono in ogni area e ')}
              <em>{t("non")}</em>{" "}
              {t(
                "sono le board Personali: un task trasversale resta nel flusso del suo modulo, mentre le board Personali sono kanban privati che non passano dagli stati condivisi.",
              )}
            </li>
            <li>
              {t("Un progetto può dichiarare l'")}
              <B>{t("offerta di provenienza")}</B>
              {t(
                ": la mette il commerciale chiudendo l'offerta come vinta, oppure la si sceglie a mano quando il progetto si crea (campo \"Offerta di provenienza\"). Nella pagina del progetto la freccia apre l'offerta, con il documento allegato su cui si fattura.",
              )}
            </li>
            <li>
              <B>{t("Converti / Sposta")}</B>
              {t(
                ": dal pannello di un task, l'azione in alto lo porta tra le sue appartenenze — legato a un'",
              )}
              <B>{t("offerta")}</B>
              {t(", dentro un ")}
              <B>{t("progetto")}</B>
              {t(" di sviluppo, o")} <B>{t("amministrativo")}</B>
              {t(
                " nello scadenzario — o in un altro progetto. Quando cambia il mestiere (una richiesta commerciale che diventa sviluppo, e simili) ti viene proposta la",
              )}{" "}
              <B>{t("mappatura")}</B>
              {t(
                " di tipo e stato con un default sensato — stesso nome, o stessa posizione tra gli aperti; un task chiuso resta chiuso — che puoi correggere prima di confermare. Chi converte ne diventa ",
              )}
              <B>{t("supervisore")}</B>
              {t(
                " e sceglie l'assegnatario, ma solo tra chi ha accesso alla destinazione (di un progetto, i suoi membri). Non vale per subtask e occorrenze ricorrenti: la loro sede la decide il task padre o la ricorrenza.",
              )}
            </li>
            <li>
              <B>{t("Attività amministrativa")}</B>
              {t(
                ": nella pagina Stati si può marcare uno stato (per lo sviluppo lo fanno i manager del gruppo Sviluppatori) come tappa da fatturare — consegna beta, consegna in produzione, collaudo. Quando un task ci entra, il suo supervisore (o l'amministrativo di riferimento di chi lo esegue) riceve una notifica dedicata: c'è una fattura da emettere secondo l'offerta.",
              )}
            </li>
            <li>
              <B>{t("Ricorrenze")}</B>
              {t(
                ': crea una regola ("ogni 15 del mese", "secondo martedì", "fine mese", cadenze bimestrali, trimestrali, semestrali…). Esiste ',
              )}
              <B>{t("una sola occorrenza viva")}</B>{" "}
              {t(
                "alla volta: completandola, lo stesso task avanza alla scadenza successiva e torna nello",
              )}{" "}
              <B>{t("stato iniziale")}</B>
              {t(
                ' scelto sulla ricorrenza (es. "Fatture da emettere"). Portarla in uno stato che ',
              )}
              <B>{t("interrompe la ricorrenza")}</B>
              {t(
                ' (es. "Annullato") la ferma lì finché non la sposti a mano. Modificare il template aggiorna solo l\'occorrenza non ancora lavorata. Se una serie è rimasta indietro, ogni "Fatto" recupera ',
              )}
              <B>{t("un'occorrenza per volta")}</B>
              {t(
                ": un canone fermo a maggio si riallinea con tre clic. Arrivata nel futuro, ricompletarla nella stessa giornata non sposta più niente — così un doppio clic non salta un ciclo.",
              )}
            </li>
            <li>
              <B>{t("Sequenze")}</B>
              {t(": nel dettaglio task puoi indicare il task ")}
              <B>{t("propedeutico")}</B>
              {t(" (da fare prima) e il task ")}
              <B>{t("successivo")}</B>
              {t(
                " (da fare dopo). La sequenza non blocca: se lavori fuori ordine ti viene chiesta conferma.",
              )}
            </li>
            <li>
              <B>{t("Supervisore")}</B>
              {t(": chi supervisiona un task riceve notifiche su cambi di stato e commenti.")}
            </li>
            <li>
              {t("Nei commenti puoi ")}
              <B>{t("menzionare")}</B>
              {t(" un collega con @nome: riceverà una notifica.")}
            </li>
            <li>
              {t("Il pannello di dettaglio ")}
              <B>{t("salva mentre scrivi")}</B>
              {t(
                ": titolo e descrizione partono da soli poco dopo che ti fermi, e quello che hai scritto non si perde nemmeno se chiudi cliccando fuori. Nei campi di testo ",
              )}
              <B>{t("Invio")}</B>
              {t(" salva e conferma, ")}
              <B>{t("Esc")}</B>
              {t(" annulla quello che stavi scrivendo (senza chiudere il pannello).")}
            </li>
            <li>
              {t("Chiudendo dopo una modifica puoi scegliere ")}
              <B>{t("Torna com'era")}</B>
              {t(" per riportare il task allo stato in cui l'hai aperto.")}
            </li>
            <li>
              {t("Gli allegati si ")}
              <B>{t("leggono a schermo")}</B>
              {t(
                ": clicca il nome (o l'icona con l'occhio) e PDF, Word e immagini si aprono in un pannello, senza scaricarli. La freccia accanto salva comunque il file sul computer.",
              )}
            </li>
          </UL>
        </>
      );
    },
  },
  {
    id: "offerte",
    title: "Offerte e CRM",
    icon: HandCoins,
    visible: (f) => f.deals,
    Content: () => {
      const { t } = useTranslation();
      return (
        <>
          <P>
            {t("La pipeline commerciale: viste ")}
            <B>{t("Kanban")}</B>
            {t(" (per fase, con totale e valore pesato per probabilità), ")}
            <B>{t("Tabella")}</B>
            {t(" e ")}
            <B>{t("Forecast")}</B>.
          </P>
          <UL>
            <li>
              {t("Portando un'offerta in una fase ")}
              <B>{t("vinta")}</B>
              {t(
                " nasce automaticamente un task nello Scadenzario con lo stesso titolo, la stessa descrizione e gli stessi allegati, scadenza a oggi: il commerciale ne resta supervisore e l'assegnatario è l'amministrativo di riferimento configurato sul commerciale in ",
              )}
              <B>{t("Utenti")}</B>
              {t('. Lo stato di partenza (es. "Fatture da emettere") si sceglie in ')}
              <B>{t("Stati")}</B>.
            </li>
            <li>
              {t("Spostando un'offerta in ")}
              <B>{t('"Persa"')}</B>
              {t(" ti viene chiesto il motivo: alimenta le analisi future.")}
            </li>
            <li>
              {t("In ")}
              <B>{t("Contatti → Aziende")}</B>
              {t(" ogni scheda cliente conta contatti, ")}
              <B>{t("offerte")}</B>
              {t(" e")} <B>{t("progetti")}</B>
              {t(
                ": i due numeri con la freccina si cliccano e aprono la lista di pertinenza già filtrata su quel cliente. Da lì il filtro è tuo, come gli altri: lo cambi o lo togli quando vuoi. I progetti contati sono quelli che puoi vedere.",
              )}
            </li>
            <li>
              <B>{t("Forecast")}</B>
              {t(": raggruppa per mese di chiusura — quella ")}
              <B>{t("effettiva")}</B>
              {t(" per le trattative concluse, quella prevista per le altre. Una ")}
              <B>{t("vinta")}</B>
              {t(" conta per intero, una ")}
              <B>{t("persa")}</B>
              {t(
                ' resta fuori dai totali (viene contata a parte: "3 offerte · 1 persa"). Il totale in testa è la previsione dal mese corrente in poi; i mesi già passati si riducono a etichette in alto, cliccabili per riaprirli, con accanto il consuntivo dell\'anno.',
              )}
            </li>
            <li>
              {t("In ")}
              <B>{t("Tabella")}</B>
              {t(": sotto l'intestazione ")}
              <B>{t("Valore")}</B>
              {t(
                " c'è la somma (Σ) di quello che stai guardando — filtri compresi e su tutte le pagine. La colonna ",
              )}
              <B>{t("Chiusura")}</B>
              {t(
                " mostra la data avvenuta per le concluse (in nero) e quella prevista per le altre; la probabilità delle concluse legge 100% o 0%, con quella dichiarata nel suggerimento.",
              )}
            </li>
            <ConModulo modulo="area-investitori">
              <li>
                {t("Nel pannello dell'offerta la spunta ")}
                <B>{t('"Visibile ai monitor vendite"')}</B>
                {t(" la condivide con chi ha quel ruolo (vedi Permessi). Un'icona a ")}
                <B>{t("occhiali")}</B>
                {t(" segnala negli elenchi le offerte condivise.")}
              </li>
            </ConModulo>
            <li>
              {t("In ")}
              <B>{t("Contatti")}</B>
              {t(
                " gestisci aziende e persone (note datate, offerte collegate, import CSV da Google Contacts). Nei form offerta puoi creare azienda e contatto al volo col bottone +.",
              )}
            </li>
          </UL>
        </>
      );
    },
  },
  {
    id: "progetti",
    title: "Progetti",
    icon: FolderKanban,
    Content: () => {
      const { t } = useTranslation();
      return (
        <>
          <P>
            {t("Ogni progetto ha membri con ruolo ")}
            <B>{t("Manager")}</B>
            {t(" (gestisce membri e impostazioni),")} <B>{t("Editor")}</B>
            {t(" (crea e modifica task) o ")}
            <B>{t("Visualizzatore")}</B>
            {t(
              " (sola lettura e commenti). Chi non è membro non vede il progetto — a meno che il suo gruppo abbia la visibilità",
            )}{" "}
            <B>{t("Progetti")}</B>
            {t(
              " (sola lettura = osservatore di tutti i progetti; completo = può lavorarne i task).",
            )}
          </P>
          <UL>
            <li>
              {t("I task possono avere ")}
              <B>{t("subtask")}</B>
              {t(
                " (un solo livello): un task padre si considera completo quando tutti i subtask sono chiusi — chiuderlo prima richiede conferma.",
              )}
            </li>
            <li>{t("La barra di avanzamento mostra task chiusi / totali.")}</li>
            <li>
              {t("L'ordine ")}
              <B>{t("Consigliato")}</B>
              {t(
                ' risponde a "da dove riprendo": prima i progetti dove hai una scadenza entro tre giorni (o già passata), poi quelli su cui ',
              )}
              <B>{t("stai lavorando")}</B>
              {t(
                " — ci hai messo ore, scritto o modificato qualcosa negli ultimi sette giorni — poi quelli dove hai del lavoro tuo, infine il resto. La card dice perché sta lì. Se trascini una card l'ordine diventa il tuo e resta: ",
              )}
              <B>{t("Ordine automatico")}</B>
              {t(" rimette quello consigliato.")}
            </li>
            <li>
              {t("La spunta ")}
              <B>{t("Mostra chiusi")}</B>
              {t(
                ", accanto al selettore Elenco/Kanban, vale per entrambe le viste. Se il progetto ha task in categorie diverse (di norma sono tutti di sviluppo) compare anche una tendina per scegliere quale bacheca vedere: le colonne del kanban sono gli stati di una categoria alla volta.",
              )}
            </li>
          </UL>
        </>
      );
    },
  },
  {
    id: "ticket",
    title: "Ticket di supporto",
    icon: LifeBuoy,
    visible: (f) => f.tickets,
    Content: () => {
      const { t } = useTranslation();
      return (
        <>
          <P>
            {t("I clienti con accesso ")}
            <B>{t("Portale")}</B>
            {t(
              " aprono qui i loro ticket (anche convertiti dal loro osTicket, col numero di origine nel campo riferimento). Un ticket nuovo ",
            )}
            <B>{t("nasce come task del progetto")}</B>
            {t(
              " indicato e si lavora dal suo pannello — stati di sviluppo, subtask, allegati, chat —: dall'elenco lo apri proprio lì. Le azioni rapide in riga (stato, priorità, presa in carico) restano per i ",
            )}
            <B>{t("ticket storici")}</B>
            {t(
              "; il cliente vede e commenta solo il proprio, senza toccare il resto del progetto.",
            )}
          </P>
          <UL>
            <li>
              {t("Il cliente riceve una notifica a ogni ")}
              <B>{t("cambio di stato")}</B>
              {t(" e a ogni ")}
              <B>{t("risposta")}</B>
              {t("; tu ricevi notifica dei nuovi ticket e dei messaggi del cliente.")}
            </li>
            <li>{t("Gli allegati (file o link) si possono aggiungere da entrambe le parti.")}</li>
            <li>
              {t("Gli utenti Portale si creano da ")}
              <B>{t("Utenti")}</B>
              {t(' con ruolo "Portale (cliente)" e l\'azienda di appartenenza.')}
            </li>
          </UL>
        </>
      );
    },
  },
  {
    id: "timesheet",
    title: "Timesheet",
    icon: Hourglass,
    Content: () => {
      const { t } = useTranslation();
      return (
        <>
          <P>
            {t(
              "Griglia mensile giorni × task: clicca una cella e scrivi le ore, anche con i decimi — 4, 4,5 o 4.2 vanno bene tutti (max 24h al giorno). Aggiungi una riga cercando tra i task che puoi vedere. Da telefono usi la vista per singolo giorno.",
            )}
          </P>
          <UL>
            <li>
              {t("La tendina propone prima ")}
              <B>{t("i tuoi task")}</B>
              {t(
                " (assegnati o di cui sei supervisore) in ordine alfabetico; appena scrivi, la ricerca si allarga a tutto quello che puoi vedere.",
              )}
            </li>
            <li>
              {t("Una riga aggiunta ")}
              <B>{t("resta lì anche senza ore")}</B>
              {t(
                ", per il mese in cui l'hai messa: puoi prepararti la griglia con i task su cui devi lavorare. Il cestino a fine riga la toglie.",
              )}
            </li>
            <li>
              {t("L'intestazione dei giorni e la riga dei ")}
              <B>{t("totali")}</B>
              {t(
                " restano visibili mentre scorri, e i totali contano anche le ore che stai scrivendo: una giornata oltre le 8 ore è in arancione, una impossibile (oltre 24) in rosso.",
              )}
            </li>
            <ConModulo
              modulo="timesheet"
              altrimenti={
                <li>
                  <B>{t("Riepiloghi")}</B>
                  {t(
                    ': li vedono i manager — admin, permesso "Timesheet team" (pagina Utenti), manager di progetto — per progetti e per persone, del mese o della settimana. La ',
                  )}
                  <B>{t("tendina delle persone")}</B>
                  {t(
                    " compare a chi può sfogliare il timesheet altrui e propone solo chi si può davvero guardare: per un manager, i membri dei suoi progetti. Selezionandone più d'uno vedi il calendario aggregato (sola lettura).",
                  )}
                </li>
              }
            >
              <li>
                <B>{t("Riepiloghi")}</B>
                {t(
                  ': le tue ore sempre; i supervisori vedono le ore sui task supervisionati, i manager quelle dei propri progetti; il permesso per-utente "Timesheet team" (pagina Utenti) apre tutto. La ',
                )}
                <B>{t("tendina delle persone")}</B>
                {t(
                  " compare a chi può sfogliare il timesheet altrui — admin, permesso dedicato, manager di progetto — e propone solo chi si può davvero guardare: per un manager, i membri dei suoi progetti. Selezionandone più d'uno vedi il calendario aggregato (sola lettura). Export CSV.",
                )}
              </li>
            </ConModulo>
            <li>
              {t("Il riepilogo ")}
              <B>{t("per task")}</B>
              {t(
                " mostra sotto ogni titolo il progetto a cui appartiene: due task possono chiamarsi allo stesso modo in progetti diversi e restano righe distinte.",
              )}
            </li>
            <li>
              {t("L'admin può ")}
              <B>{t("chiudere il mese")}</B>
              {t(": le ore diventano non modificabili (🔒).")}
            </li>
          </UL>
        </>
      );
    },
  },
  {
    id: "contatti-notifiche",
    title: "Notifiche e ricerca",
    icon: Contact,
    Content: () => {
      const { t } = useTranslation();
      return (
        <>
          <UL>
            <li>
              {t("La ")}
              <B>{t("campanella")}</B>
              {t(
                " mostra le notifiche in tempo reale: assegnazioni, menzioni, commenti, cambi di stato supervisionati, offerte chiuse, riepilogo scadenze. Dall'ingranaggio scegli quali ricevere.",
              )}
            </li>
            <li>
              {t("Le notifiche arrivano ")}
              <B>{t("anche per email")}</B>
              {t(
                ", se l'amministratore ha configurato la posta: stesso testo della campanella, con il logo aziendale e un pulsante che apre direttamente il task, l'offerta o il ticket di cui parlano. Dalla pagina ",
              )}
              <B>{t("Email")}</B>{" "}
              {t(
                "(area amministratore) si regolano indirizzo pubblico, riga di apertura e chiusura, e si può mandare un ",
              )}
              <B>{t("messaggio di prova")}</B>
              {t(" a sé stessi.")}
            </li>
            <li>
              <B>{t("Ogni notifica si clicca")}</B>
              {t(
                " e porta dove serve: apre il task, l'offerta o il ticket di cui parla; il riepilogo scadenze — che riguarda più task insieme — apre l'agenda. Vale anche dal riquadro \"Notifiche recenti\" della tua giornata.",
              )}
            </li>
            <li>
              {t("La ")}
              <B>{t("ricerca globale")}</B>
              {t(
                " (Ctrl+K) trova task, offerte, contatti e aziende — nel rispetto di ciò che puoi vedere.",
              )}
            </li>
          </UL>
        </>
      );
    },
  },
  {
    id: "permessi",
    title: "Permessi e visibilità",
    icon: ShieldCheck,
    Content: () => {
      const { t } = useTranslation();
      return (
        <>
          <P>
            <ConModulo
              modulo="ticket"
              altrimenti={t(
                "Ogni modulo (Scadenzario, Offerte, Progetti, Persone) ha una visibilità per gruppo su tre livelli: ",
              )}
            >
              {t(
                "Ogni modulo (Scadenzario, Offerte, Progetti, Ticket, Persone) ha una visibilità per gruppo su tre livelli: ",
              )}
            </ConModulo>
            <B>{t("Niente")}</B>, <B>{t("Sola lettura")}</B>
            {t(" (consulti senza modificare) e")} <B>{t("Completo")}</B>
            {t(". Le sole ")}
            <B>{t("Offerte")}</B>
            {t(" hanno un quarto livello,")} <B>{t("Giornate (sviluppo)")}</B>
            {t(
              ": chi ce l'ha vede l'elenco in sola consultazione, con gli importi tradotti in giornate di lavoro (500 € = una giornata), senza contatti, allegati, dettaglio né Kanban e Forecast. Serve a chi sviluppa per sapere quanto lavoro sta arrivando.",
            )}
          </P>
          <ConModulo modulo={["ticket", "area-investitori"]}>
            <P>
              {t("Fuori dall'azienda ci sono due ruoli con un'area propria: ")}
              <B>{t("Portale")}</B>
              {t(" (i clienti, che vedono solo i propri ticket) e ")}
              <B>{t("Monitor vendite")}</B>
              {t(
                ', in sola lettura sulle offerte contrassegnate "visibile ai monitor vendite" — titolo, azienda, importo, probabilità, fase, commerciale, cronologia, documenti e previsione, con la quota di quanto vedono rispetto al mese. I documenti li ',
              )}
              <B>{t("leggono a schermo senza scaricarli")}</B>
              {t(" e possono scrivere nella chat dell'offerta.")}
            </P>
          </ConModulo>
          <P>{t("Due regole valgono sempre, in ogni area:")}</P>
          <UL>
            <li>
              {t("Un task ")}
              <B>{t("assegnato a te")}</B>
              {t(
                " lo vedi e lo lavori comunque, anche senza accesso al modulo: se un'amministrativa ti assegna una scadenza, la trovi, la esegui e ne cambi lo stato. Chi ti supervisiona riceve le notifiche.",
              )}
            </li>
            <li>
              {t("Se sei ")}
              <B>{t("supervisore o creatore")}</B>
              {t(" di un task lo leggi sempre; il supervisore non lo modifica (segue e basta).")}
            </li>
            <li>
              {t("Il ")}
              <B>{t("manager di un gruppo")}</B>
              {t(
                " (contrassegno ★ in Gruppi) legge le attività dei membri del suo gruppo in ogni area, gestisce i membri del gruppo e configura stati e tipi di attività.",
              )}
            </li>
          </UL>
        </>
      );
    },
  },
  {
    id: "scorciatoie",
    title: "Scorciatoie da tastiera",
    icon: Keyboard,
    Content: () => {
      const { t } = useTranslation();
      return (
        <UL>
          <li>
            <B>Ctrl + K</B>
            {t(
              ": ricerca globale — cerca davvero ovunque: titoli e descrizioni di task, offerte e ticket, progetti, ricorrenze, ",
            )}
            <B>{t("messaggi delle chat")}</B>
            {t(
              ", nomi degli allegati e titoli dei link, contatti e aziende. Vedi solo ciò che i tuoi permessi ti fanno vedere; un messaggio o un allegato trovato apre il task che lo contiene.",
            )}
          </li>
          <li>
            <B>{t("Esc")}</B>
            {t(
              ": chiude dialog e pannelli; dentro un campo di testo annulla prima quello che stavi scrivendo",
            )}
          </li>
          <li>
            <B>{t("Invio")}</B>
            {t(
              ": conferma il campo di testo su cui stai scrivendo (nelle descrizioni, che vanno a capo, serve ",
            )}
            <B>{t("Ctrl + Invio")}</B>
            {t(")")}
          </li>
          <li>
            <B>?</B>
            {t(": elenco scorciatoie")}
          </li>
          <li>
            <B>n</B>
            {t(": nuovo task, da qualunque pagina")}
          </li>
          <li>
            {t("Cambio vista, una lettera per vista: ")}
            <B>A / R / T / K</B>
            {t(" nello Scadenzario,")} <B>T / K / F</B>
            {t(" nelle Offerte, ")}
            <B>E / K</B>
            {t(" dentro un progetto. La lettera è scritta nel suggerimento di ogni bottone.")}
          </li>
          <li>
            <B>Tab / Shift+Tab</B>
            {t(": naviga i campi nelle finestre modali")}
          </li>
          <li>
            {t("Nella griglia del Timesheet, i gesti di un foglio di calcolo: ")}
            <B>{t("frecce")}</B>
            {t(" per spostarsi fra le caselle, una ")}
            <B>{t("cifra")}</B>
            {t(" per iniziare a scrivere (o ")}
            <B>{t("Invio / F2")}</B>
            {t("), ")}
            <B>{t("Invio")}</B>
            {t(" conferma e scende, ")}
            <B>Tab</B>
            {t(" conferma e va a destra, ")}
            <B>Esc</B>
            {t(" rimette il valore di prima, ")}
            <B>{t("Canc")}</B>
            {t(" svuota la casella.")}
          </li>
        </UL>
      );
    },
  },
  {
    id: "admin",
    title: "Amministrazione",
    icon: ShieldCheck,
    visible: (f) => f.admin,
    Content: () => {
      const { t } = useTranslation();
      return (
        <UL>
          <li>
            <B>{t("Utenti")}</B>
            <ConModulo
              modulo="ticket"
              altrimenti={t(
                ': creazione, ruoli (Admin / Membro), reset password, disattivazione (chiude le sessioni attive), amministrativo di riferimento per la fatturazione e permesso "Timesheet team".',
              )}
            >
              {t(
                ': creazione, ruoli (Admin / Membro / Portale cliente / Monitor vendite), reset password, disattivazione (chiude le sessioni attive), amministrativo di riferimento per la fatturazione e permesso "Timesheet team".',
              )}
            </ConModulo>
          </li>
          <li>
            <B>{t("Gruppi")}</B>
            {t(": appartenenze, nomina dei ")}
            <B>{t("manager")}</B>
            <ConModulo
              modulo="ticket"
              altrimenti={t(
                " (★) e visibilità dei moduli (Niente / Sola lettura / Completo) per Scadenzario, Offerte, Progetti e Persone — più",
              )}
            >
              {t(
                " (★) e visibilità dei moduli (Niente / Sola lettura / Completo) per Scadenzario, Offerte, Progetti, Ticket e Persone — più",
              )}{" "}
            </ConModulo>
            <B>{t("Giornate (sviluppo)")}</B>
            {t(" sulle sole Offerte.")}
          </li>
          <li>
            <B>{t("Stati task")}</B>
            {t(
              ' (aperta anche ai manager di gruppo): nomi, colori, ordine e flag — chiuso, "Interrompe ricorrenza" (es. Annullato), task assegnati, offerta vinta — più la gestione dei ',
            )}
            <B>{t("tipi di attività")}</B>
            {". "}
            {t("Accanto al titolo di ogni area c'è l'icona della ")}
            <B>{t("fusione")}</B>
            {t(
              ": sceglie uno stato di partenza e uno di arrivo e sposta al secondo tutti i task del primo — serve quando due stati fanno la stessa cosa. Prima di scrivere dice quanti record cambieranno e cosa comporta (task nel cestino, task che si chiuderanno o riapriranno, ricorrenze e fasi che seguono il riferimento), poi chiede conferma due volte perché non si torna indietro. Ogni task ne conserva una riga nello storico. Al termine lo stato di partenza viene eliminato — è rimasto vuoto — e i suoi contrassegni passano allo stato di arrivo. ",
            )}
            <B>{t("Fasi pipeline")}</B>
            {t(
              ": fasi, vinta/persa e stato/ assegnatario del task generato dalla fase vinta (ha la precedenza sul fallback globale).",
            )}
          </li>
          <li>
            <B>{t("Password")}</B>
            {t(": non vengono mai salvate, nemmeno cifrate. Di ognuna resta solo un'impronta ")}
            <B>argon2id</B>
            {t(
              " con un sale casuale diverso per ogni utente, che non si può ripercorrere all'indietro: chi amministra può reimpostare una password, non leggerla. Volendo si aggiunge un ",
            )}
            <B>{t("pepe")}</B>
            {t(
              ", un segreto tenuto fuori dal database (vedi PASSWORD_PEPPER_FILE): chi rubasse il solo file dei dati non potrebbe usarlo.",
            )}
          </li>
          <li>
            <B>{t("Password provvisoria")}</B>
            {t(
              ": reimpostando la password di un utente gliene si assegna una provvisoria. Parte per email con l'indirizzo a cui entrare, tutte le sue sessioni si chiudono e al primo accesso deve sceglierne una sua — fino ad allora l'applicazione resta chiusa. Se la posta non è configurata la finestra lo dice, e la password va comunicata a voce.",
            )}
          </li>
          <li>
            <B>{t("Sistema")}</B>
            {t(": conteggi del database e sua dimensione, ")}
            <B>{t("backup manuale")}</B>
            {t(" in zip (database + allegati) e ")}
            <B>{t("versioni")}</B>
            {t(" di quello che sta girando davvero — applicazione, Node, SQLite e ")}
            <B>{t("tutte")}</B>
            {t(
              " le librerie di server e frontend, lette dalle dipendenze effettive (non da un elenco scritto a mano, che invecchia). Utile quando si segnala un problema.",
            )}
          </li>
          <li>
            <B>{t("Cestino")}</B>
            {t(
              ": tutto ciò che viene eliminato (task con i loro subtask, progetti, offerte, ticket, aziende, contatti) resta recuperabile per 30 giorni, poi viene rimosso definitivamente.",
            )}
          </li>
        </UL>
      );
    },
  },
];

/**
 * The release notes this edition shows (08/10/2026): all of them in the
 * commercial edition; in the community edition the builds from the first one
 * released in two editions, without the commercial lines.
 */
function noteDellEdizione(): ReleaseNote[] {
  // The commercial edition is the one with the commercial modules: tickets are a proxy.
  if (edizione.moduli.has("ticket")) return RELEASE_NOTES;
  const [maggiore = 0, minore = 0, build = 0] = PRIMA_VERSIONE_COMMUNITY.split(".").map(Number);
  return RELEASE_NOTES.filter((note) => {
    const [a = 0, b = 0, c = 0] = note.version.split(".").map(Number);
    return a > maggiore || (a === maggiore && (b > minore || (b === minore && c >= build)));
  })
    .map((note) => ({
      ...note,
      items: note.items.filter((item) => typeof item === "string" || !item.commerciale),
    }))
    .filter((note) => note.items.length > 0);
}

/**
 * Cosa è cambiato, build per build. In inglese e non tradotto: sono note brevi,
 * e mantenerle in cinque lingue vorrebbe dire non mantenerle (vedi
 * `release-notes.ts`, dove si aggiunge una voce a ogni deploy).
 */
function ReleaseNotes() {
  const { i18n } = useTranslation();
  const dateFmt = new Intl.DateTimeFormat(localeTag(i18n.language), {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });
  return (
    <div className="flex flex-col gap-3 text-sm">
      {noteDellEdizione().map((note) => (
        <div key={note.version} className="flex flex-col gap-1">
          <p className="flex items-baseline gap-2">
            <span className="font-semibold">{note.version}</span>
            <span className="text-xs text-muted-foreground">
              {dateFmt.format(new Date(`${note.date}T12:00:00Z`))}
            </span>
            {note.version === APP_VERSION && (
              <span className="rounded border px-1.5 py-0.5 text-[11px] text-muted-foreground">
                installed
              </span>
            )}
          </p>
          <ul className="ml-4 list-disc space-y-1 text-muted-foreground">
            {note.items.map((item) => (
              <li key={testoDellaVoce(item)}>{testoDellaVoce(item)}</li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}

export function HelpPage() {
  const { t } = useTranslation();
  const user = useCurrentUser();
  const [openId, setOpenId] = useState<string | null>("home");
  const flags = {
    deals: user.canSeeDeals,
    adminTasks: user.canSeeAdminTasks,
    tickets: user.canSeeTickets,
    admin: user.role === UserRole.ADMIN,
  };

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="text-sm text-muted-foreground">
          {t("Guida rapida ai moduli di KeelOps. Le sezioni mostrate rispettano i tuoi permessi.")}
        </p>
        <span className="flex items-center gap-1.5 rounded-md border px-2 py-0.5 text-xs text-muted-foreground">
          <KeelopsMark className="size-3.5" />
          KeelOps {APP_VERSION}
        </span>
      </div>
      {SECTIONS.filter((section) => !section.visible || section.visible(flags)).map((section) => {
        const isOpen = openId === section.id;
        const Icon = section.icon;
        const Content = section.Content;
        return (
          <section key={section.id} className="rounded-lg border bg-card">
            <button
              className="flex w-full items-center gap-2.5 px-4 py-3 text-left"
              onClick={() => setOpenId(isOpen ? null : section.id)}
              aria-expanded={isOpen}
            >
              <Icon className="size-4 shrink-0 text-muted-foreground" />
              <span className="flex-1 font-semibold">{t(section.title)}</span>
              {isOpen ? (
                <ChevronDown className="size-4 text-muted-foreground" />
              ) : (
                <ChevronRight className="size-4 text-muted-foreground" />
              )}
            </button>
            {isOpen && (
              <div className="flex flex-col gap-2 px-4 pb-4">
                <Content />
              </div>
            )}
          </section>
        );
      })}
    </div>
  );
}
