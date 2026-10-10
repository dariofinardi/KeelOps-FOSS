// Copyright (c) 2026 Jugaad s.r.l.
// SPDX-License-Identifier: AGPL-3.0-only

import { beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { TaskDetail } from "@kancrm/shared";
import { CurrentUserContext } from "@/features/auth/useAuth";
import { CommentsSection } from "./TaskTimeline";
import { vaiAlMessaggio } from "./message-focus";

/**
 * La chat si scrive con la tastiera, dall'inizio alla fine: `@` apre l'elenco
 * dei colleghi, le frecce scelgono, Invio conferma, Esc rinuncia — e **Esc si
 * ferma lì**, senza chiudere anche il pannello dietro con dentro il messaggio a
 * metà. Il messaggio si manda con Invio e si va a capo con Shift+Invio.
 */

const mutate = vi.fn();
/** I messaggi che la chat mostra: li riempie il singolo test. */
const messaggi: unknown[] = [];

const caricaAllegato = vi.fn(async ({ file }: { file: File }) => ({ id: `a-${file.name}` }));
vi.mock("@/features/attachments/useAttachmentReader", () => ({
  useAttachmentReader: () => ({ open: vi.fn(), panel: null }),
}));
vi.mock("./useTasks", () => ({
  useAddComment: () => ({ mutate, isPending: false }),
  useUploadAttachment: () => ({ mutateAsync: caricaAllegato, isPending: false }),
  useDeleteComment: () => ({ mutate: vi.fn() }),
  useTaskComments: () => ({ data: { pages: [{ items: messaggi }] }, hasNextPage: false }),
  useTaskActivities: () => ({ data: [] }),
  useUserOptions: () => ({
    data: [
      { id: "u1", name: "Giacomo Verdi" },
      { id: "u2", name: "Vera Verdi" },
      { id: "u3", name: "Dario Ferri" },
    ],
  }),
}));
vi.mock("@/features/meetings/useMeetings", () => ({ useMeetings: () => ({ data: [] }) }));
// La chat del portale chiede al server chi si può citare: qui la sorgente non
// interessa, interessa che l'elenco interno resti quello del ruolo.
vi.mock("@/features/tickets/useTickets", () => ({ useTicketPeople: () => ({ data: [] }) }));

const task = { id: "t1", commentCount: 0, kind: "ADMIN" } as unknown as TaskDetail;

/** Una richiesta: il cliente che l'ha aperta è il creatore del task. */
const ticket = {
  id: "t1",
  commentCount: 0,
  kind: "PROJECT",
  createdViaTicket: true,
  creator: { id: "cli", name: "Sandro Casiraghi" },
  openedByClient: true,
} as unknown as TaskDetail;

/**
 * Una richiesta aperta da un COLLEGA: l'area ticket la usano anche gli interni
 * (un commerciale che segnala il problema del suo cliente). Fuori non c'è
 * nessuno a cui scrivere, quindi `@user` non deve comparire.
 */
const richiestaInterna = {
  id: "t1",
  commentCount: 0,
  kind: "PROJECT",
  createdViaTicket: true,
  creator: { id: "col", name: "Emanuele Bassi" },
  openedByClient: false,
} as unknown as TaskDetail;

const setup = (which: TaskDetail = task) => {
  render(
    <CurrentUserContext.Provider value={{ id: "me", name: "Io", role: "MEMBER" } as never}>
      <CommentsSection task={which} />
    </CurrentUserContext.Provider>,
  );
  const field = screen.getByPlaceholderText(/Scrivi un commento/);
  const write = (value: string) => fireEvent.change(field, { target: { value } });
  return { field, write };
};

describe("chat: menzioni da tastiera e a capo", () => {
  beforeEach(() => mutate.mockClear());

  it("scrivendo @ compare l'elenco delle persone, con la parola chiave @secret sempre in cima", () => {
    const { write } = setup();
    write("@");
    // le persone citabili, e "@secret" — che non è una persona: cifra il messaggio
    expect(screen.getAllByRole("option")).toHaveLength(4);
    const chiave = screen.getAllByRole("option")[0]!;
    expect(chiave).toHaveTextContent("@secret");
    // si distingue dalle persone: grassetto e colore d'accento (31/08/2026)
    expect(chiave.className).toMatch(/font-semibold/);
    expect(chiave.className).toMatch(/text-primary/);
    // "@secret" da solo non dice cosa fa a chi lo incontra la prima volta:
    // accanto c'è la riga che lo spiega (02/09/2026).
    expect(chiave).toHaveTextContent("il testo viene cifrato");

    // la parola chiave non si filtra: resta anche quando il testo non le somiglia
    write("@ver");
    const voci = screen.getAllByRole("option");
    expect(voci[0]).toHaveTextContent("@secret");
    expect(voci.slice(1).map((o) => o.textContent)).toEqual(["Giacomo Verdi", "Vera Verdi"]);
  });

  it("le frecce scelgono e Invio conferma, senza mandare il messaggio", () => {
    const { field, write } = setup();
    write("@ver");
    // in cima c'è @secret; la prima persona è la seconda voce
    expect(screen.getAllByRole("option")[0]).toHaveAttribute("aria-selected", "true");

    fireEvent.keyDown(field, { key: "ArrowDown" });
    expect(screen.getAllByRole("option")[1]).toHaveAttribute("aria-selected", "true");
    fireEvent.keyDown(field, { key: "ArrowDown" });
    expect(screen.getAllByRole("option")[2]).toHaveAttribute("aria-selected", "true");
    fireEvent.keyDown(field, { key: "ArrowUp" });
    expect(screen.getAllByRole("option")[1]).toHaveAttribute("aria-selected", "true");

    fireEvent.keyDown(field, { key: "Enter" });
    expect((field as HTMLTextAreaElement).value).toBe("@Giacomo Verdi ");
    // Invio ha scelto la persona: il commento non è partito.
    expect(mutate).not.toHaveBeenCalled();
    expect(screen.queryAllByRole("option")).toHaveLength(0);
  });

  it("Esc chiude l'elenco e NON arriva al pannello dietro", () => {
    const { field, write } = setup();
    write("@ver");
    const escape = fireEvent.keyDown(field, { key: "Escape" });
    expect(screen.queryAllByRole("option")).toHaveLength(0);
    // Non propagato: la pila di useEscapeToClose ascolta su window, e senza
    // fermarlo lo stesso Esc chiudeva anche il pannello di dettaglio.
    expect(escape).toBe(false);
  });

  it("Invio manda il messaggio quando l'elenco non c'è", () => {
    const { field, write } = setup();
    write("ci penso io");
    fireEvent.keyDown(field, { key: "Enter" });
    expect(mutate).toHaveBeenCalledWith(
      expect.objectContaining({ taskId: "t1", body: "ci penso io" }),
      expect.anything(),
    );
  });

  it("su una richiesta il cliente si può citare, e sta in cima", () => {
    // L'elenco utenti esclude i ruoli esterni (a un cliente non si assegna un
    // task), ma nella chat di una richiesta è la persona con cui si parla: non
    // trovarlo faceva pensare che non gli arrivasse niente (18/08/2026).
    const { write } = setup(ticket);
    write("@");
    // Dopo le parole chiave, che stanno sempre per prime: su una richiesta di
    // un cliente sono tre — «@secret», «@user», che manda il messaggio al
    // cliente, e «@reserved», che invece glielo tiene nascosto.
    const voci = screen.getAllByRole("option");
    expect(voci[0]).toHaveTextContent("@secret");
    expect(voci[1]).toHaveTextContent("@user");
    expect(voci[1]).toHaveTextContent("manda il messaggio al cliente");
    expect(voci[2]).toHaveTextContent("@reserved");
    expect(voci[2]).toHaveTextContent("il cliente non lo vede");
    expect(voci[3]).toHaveTextContent("Sandro Casiraghi");
  });

  it("@reserved non si offre dove fuori non legge nessuno, né al cliente stesso", () => {
    // Un task normale e una richiesta aperta da un collega: la chat è già fra colleghi.
    for (const quale of [task, richiestaInterna]) {
      const { write } = setup(quale);
      write("@");
      expect(
        screen
          .getAllByRole("option")
          .map((v) => v.textContent)
          .join(" "),
      ).not.toContain("@reserved");
      cleanup();
    }
  });

  it("al cliente dal portale nessuna parola chiave: né @reserved né @secret", () => {
    // @reserved: nascondersi il proprio messaggio non ha senso. @secret: dal
    // 16/09/2026 i cifrati al portale non arrivano, e un cliente non manda un
    // testo che poi non potrebbe rileggere.
    render(
      <CurrentUserContext.Provider value={{ id: "cli", name: "Sandro", role: "PORTAL" } as never}>
        <CommentsSection task={ticket} />
      </CurrentUserContext.Provider>,
    );
    fireEvent.change(screen.getByPlaceholderText(/Scrivi un commento/), { target: { value: "@" } });
    const voci = screen
      .queryAllByRole("option")
      .map((v) => v.textContent)
      .join(" ");
    expect(voci).not.toContain("@reserved");
    expect(voci).not.toContain("@secret");
  });

  it("su un'offerta condivisa con i monitor vendite @reserved c'è", () => {
    const offertaCondivisa = {
      id: "d1",
      commentCount: 0,
      kind: "DEAL",
      openedByClient: false,
      visibleToSalesMonitors: true,
    } as unknown as TaskDetail;
    const { write } = setup(offertaCondivisa);
    write("@");
    expect(
      screen
        .getAllByRole("option")
        .map((v) => v.textContent)
        .join(" "),
    ).toContain("@reserved");
  });

  it("su una richiesta aperta da un COLLEGA @user non compare: fuori non c'è nessuno", () => {
    const { write } = setup(richiestaInterna);
    write("@");
    const voci = screen.getAllByRole("option");
    expect(voci[0]).toHaveTextContent("@secret");
    expect(voci.map((v) => v.textContent).join(" ")).not.toContain("@user");
  });

  it("su un task che non nasce da una richiesta @user non compare: non c'è cliente", () => {
    const { write } = setup();
    write("@");
    const voci = screen.getAllByRole("option");
    expect(voci[0]).toHaveTextContent("@secret");
    expect(voci.map((v) => v.textContent).join(" ")).not.toContain("@user");
  });

  it("su un task normale il creatore non entra nell'elenco delle menzioni", () => {
    const { write } = setup();
    write("@");
    expect(screen.getAllByRole("option").map((o) => o.textContent)).not.toContain(
      "Sandro Casiraghi",
    );
  });

  it("Shift+Invio non manda: è l'a capo", () => {
    const { field, write } = setup();
    write("prima riga");
    fireEvent.keyDown(field, { key: "Enter", shiftKey: true });
    expect(mutate).not.toHaveBeenCalled();
  });
});

/**
 * **Il comando sparisce, la prova resta.** `@user` non compare nel testo
 * salvato: senza una marcatura, riaprendo la chat non ci sarebbe modo di sapere
 * se al cliente è stato scritto — ed è la domanda per cui la funzione esiste
 * (02/09/2026).
 */
describe("i messaggi mandati al cliente si riconoscono", () => {
  const messaggio = (id: string, body: string, sentToClient: boolean, reserved = false) => ({
    id,
    body,
    secret: false,
    reserved,
    sentToClient,
    createdAt: "2026-09-03T10:00:00.000Z",
    author: { id: "op", name: "Olga Operatrice" },
    meeting: null,
  });

  beforeEach(() => {
    messaggi.length = 0;
  });

  it("il messaggio mandato al cliente lo dichiara", () => {
    messaggi.push(messaggio("c1", "Abbiamo risolto.", true));
    setup(ticket);
    expect(screen.getByText("inviato al cliente")).toBeInTheDocument();
  });

  it("quello interno no: è la differenza che si vuole vedere", () => {
    messaggi.push(messaggio("c1", "Ne parlo con Giacomo.", false));
    setup(ticket);
    expect(screen.queryByText("inviato al cliente")).toBeNull();
  });

  it("il messaggio riservato agli interni lo dichiara", () => {
    messaggi.push(messaggio("c1", "Chiedo a Giacomo il log.", false, true));
    setup(ticket);
    expect(screen.getByText("solo interni")).toBeInTheDocument();
    // E nessuno lo confonde con uno mandato al cliente.
    expect(screen.queryByText("inviato al cliente")).toBeNull();
  });

  it("al cliente la marcatura non si mostra: a lui è arrivato, lo sa", () => {
    messaggi.push(messaggio("c1", "Abbiamo risolto.", true));
    render(
      <CurrentUserContext.Provider value={{ id: "cli", name: "Sandro", role: "PORTAL" } as never}>
        <CommentsSection task={ticket} />
      </CurrentUserContext.Provider>,
    );
    expect(screen.queryByText("inviato al cliente")).toBeNull();
  });
});

/**
 * **Una richiesta la gestisce una persona alla volta.** Mentre un collega ci
 * sta rispondendo, la casella qui non si disegna: due risposte scritte insieme
 * arrivano al cliente come due voci che si contraddicono. Al suo posto c'è
 * scritto chi sta rispondendo — l'attesa si sopporta se si sa di cosa è fatta.
 */
describe("chat di una richiesta presa in carico da un collega", () => {
  it("al posto della casella dice chi sta rispondendo", () => {
    render(
      <CurrentUserContext.Provider value={{ id: "me", name: "Io", role: "MEMBER" } as never}>
        <CommentsSection task={ticket} bloccataDa="Dario Ferri" />
      </CurrentUserContext.Provider>,
    );
    expect(screen.queryByPlaceholderText(/Scrivi un commento/)).toBeNull();
    expect(screen.getByText(/Dario Ferri sta rispondendo/)).toBeTruthy();
  });

  it("offre di prendere la richiesta comunque, lì dove manca la casella", () => {
    // Il collega che l'ha presa ed è andato in riunione non deve tenere tutti
    // ad aspettare la scadenza (25/09/2026): la conferma la chiede il pannello.
    const prendi = vi.fn();
    render(
      <CurrentUserContext.Provider value={{ id: "me", name: "Io", role: "MEMBER" } as never}>
        <CommentsSection task={ticket} bloccataDa="Dario Ferri" onPrendiComunque={prendi} />
      </CurrentUserContext.Provider>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Prendi comunque" }));
    expect(prendi).toHaveBeenCalledTimes(1);
  });

  it("libera, la casella c'è", () => {
    render(
      <CurrentUserContext.Provider value={{ id: "me", name: "Io", role: "MEMBER" } as never}>
        <CommentsSection task={ticket} bloccataDa={null} />
      </CurrentUserContext.Provider>,
    );
    expect(screen.getByPlaceholderText(/Scrivi un commento/)).toBeTruthy();
  });
});

/**
 * **Il file si allega dalla barra del messaggio.**
 *
 * È lì che si sta guardando quando viene in mente di mandarne uno, e il gesto è
 * quello di sempre: trascinarcelo sopra, o la graffetta. I file salgono al
 * momento dell'invio — prima diventano allegati del task, poi il messaggio dice
 * con quali è arrivato — così un messaggio che non si manda non lascia dietro
 * documenti che nessuno ha chiesto (04/09/2026).
 */
describe("allegare un file al messaggio", () => {
  beforeEach(() => {
    mutate.mockClear();
    caricaAllegato.mockClear();
  });

  const trascina = (nome: string) => {
    const file = new File(["contenuto"], nome, { type: "application/pdf" });
    const barra = screen.getByPlaceholderText(/Scrivi un commento/).closest("form")!;
    fireEvent.drop(barra, { dataTransfer: { files: [file], types: ["Files"] } });
  };

  it("il file trascinato aspetta accanto al campo, e si può togliere", () => {
    setup();
    trascina("preventivo.pdf");
    expect(screen.getByText("preventivo.pdf")).toBeTruthy();

    fireEvent.click(screen.getByLabelText("Togli preventivo.pdf"));
    expect(screen.queryByText("preventivo.pdf")).toBeNull();
    // Niente è partito: si allega mandando, non trascinando.
    expect(caricaAllegato).not.toHaveBeenCalled();
  });

  it("inviando, il file sale e il messaggio dice con quale è arrivato", async () => {
    const { write } = setup();
    trascina("verbale.pdf");
    write("ecco il verbale");
    fireEvent.submit(screen.getByPlaceholderText(/Scrivi un commento/).closest("form")!);

    await waitFor(() => expect(mutate).toHaveBeenCalled());
    expect(caricaAllegato).toHaveBeenCalledTimes(1);
    expect(mutate.mock.calls[0]![0]).toMatchObject({
      body: "ecco il verbale",
      attachmentIds: ["a-verbale.pdf"],
    });
  });

  it("un allegato da solo si può mandare: «ecco il file» è un messaggio", async () => {
    setup();
    trascina("contratto.pdf");
    fireEvent.submit(screen.getByPlaceholderText(/Scrivi un commento/).closest("form")!);

    await waitFor(() => expect(mutate).toHaveBeenCalled());
    expect(mutate.mock.calls[0]![0]).toMatchObject({
      body: "",
      attachmentIds: ["a-contratto.pdf"],
    });
  });
});

/**
 * **Dall'allegato alla frase che lo accompagnava.**
 *
 * Nella sezione Allegati un documento arrivato per chat porta un comando che
 * dice «vai al messaggio»: qui si prova la metà che ascolta — la conversazione
 * si porta su quel messaggio e lo accende, perché arrivare in mezzo a venti
 * righe uguali senza sapere quale sia quella cercata non è arrivare.
 */
describe("saltare al messaggio di un allegato", () => {
  it("il messaggio chiesto si accende", async () => {
    messaggi.length = 0;
    messaggi.push(
      {
        id: "c1",
        body: "ciapa l'allegato!",
        author: { id: "u1", name: "Dario Ferri" },
        createdAt: "2026-09-04T15:37:00.000Z",
        meeting: null,
        attachments: [],
      },
      {
        id: "c2",
        body: "un altro messaggio",
        author: { id: "u1", name: "Dario Ferri" },
        createdAt: "2026-09-04T15:38:00.000Z",
        meeting: null,
        attachments: [],
      },
    );
    setup();
    const riga = () => document.getElementById("messaggio-c1")!;
    expect(riga().className).not.toContain("ring-primary");

    vaiAlMessaggio("c1");
    await waitFor(() => expect(riga().className).toContain("ring-primary"));
    // e l'altro no: si accende quello cercato, non la conversazione intera
    expect(document.getElementById("messaggio-c2")!.className).not.toContain("ring-primary");
  });
});
