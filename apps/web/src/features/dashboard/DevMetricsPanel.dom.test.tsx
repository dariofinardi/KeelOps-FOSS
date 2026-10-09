import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import type { DevMetrics } from "@kancrm/shared";
import { DevMetricsPanel } from "./DevMetricsPanel";

/**
 * Il pannello **L'andamento** mostra numeri riferiti a delle persone: qui si
 * prova che dica anche **cosa non sta contando** e che l'elenco per persona
 * resti riservato a chi guida l'area. Un numero senza il suo margine di errore
 * viene creduto, e questi si leggono in riunione.
 */

const data = (over: Partial<DevMetrics> = {}): DevMetrics => ({
  from: "2026-07-27",
  to: "2026-08-18",
  weeks: [{ week: "2026-08-17", entrati: 11, usciti: 2 }],
  team: {
    aperti: 349,
    chiusi: 51,
    storico: 104,
    coda: [{ id: "s1", name: "Da fare", color: "#94a3b8", count: 182 }],
    tempi: { presaInCarico: 0.1, lavorazione: 0.9, totale: 2, campione: 29, natiChiusi: 22 },
    taglia: { medianaOre: 1.5, q25: 1, q75: 2.5, conOre: 41, totali: 51 },
    orePerProgetto: [
      { project: "Atlante", hours: 133 },
      { project: null, hours: 31.4 },
    ],
    oreSenzaCliente: 207.4,
    nonAssegnati: 113,
    nonAssegnatiDaFare: 85,
    fuoriSquadra: 0,
    ...over.team,
  },
  me: {
    aperti: 20,
    chiusi: 11,
    natiChiusi: 1,
    tempi: { presaInCarico: 0.1, lavorazione: 1, totale: 1.1, campione: 10, natiChiusi: 1 },
    taglia: { medianaOre: 2, q25: 1, q75: 3, conOre: 8, totali: 11 },
    ore: 53.6,
    copertura: { compilati: 11, lavorati: 17, percento: 65 },
    ...over.me,
  },
  wip: over.wip ?? null,
  people: over.people ?? null,
  ...over,
});

// I dati arrivano da una query: al pannello interessa solo come li racconta.
vi.mock("@tanstack/react-query", () => ({
  useQuery: () => ({ data: (globalThis as { __metrics?: DevMetrics }).__metrics }),
}));

const renderWith = (metrics: DevMetrics) => {
  (globalThis as { __metrics?: DevMetrics }).__metrics = metrics;
  // Con un router attorno: l'avviso sui limiti porta al progetto, e un `Link`
  // fuori dal router non renderizza affatto.
  return render(
    <MemoryRouter>
      <DevMetricsPanel />
    </MemoryRouter>,
  );
};

describe("pannello dell'andamento", () => {
  it("dichiara lo storico importato invece di farlo sparire in silenzio", () => {
    // 104 record su 155 sono archivio caricato da ClickUp/osTicket: fuori dai
    // conti, ma detto — altrimenti i 51 sembrano un numero sbagliato.
    renderWith(data());
    expect(screen.getByText(/104 record di storico importato/)).toBeInTheDocument();
  });

  it("dice su quanti task sono calcolati i tempi, e cosa ne è rimasto fuori", () => {
    renderWith(data());
    expect(screen.getAllByText(/Mediane su 29 task/).length).toBeGreaterThan(0);
    expect(
      screen.getAllByText(/Esclusi 22 creati e chiusi nella stessa ora/).length,
    ).toBeGreaterThan(0);
  });

  it("le ore senza azienda collegata sono dichiarate come un buco, non come un dato", () => {
    renderWith(data());
    expect(screen.getByText(/non si può calcolare/)).toBeInTheDocument();
  });

  it("le barre hanno un'altezza vera e i numeri portano il colore della loro barra", () => {
    // Due difetti che alla vista si somigliavano (18/08/2026): `height: 60%`
    // dentro una colonna flex senza altezza definita non si risolve, e la
    // seconda barra leggeva `week.chiusi` mentre il dato si chiama `usciti`.
    // In entrambi i casi restavano due cifre grigie affiancate — "40 16" —
    // senza modo di sapere quale fosse quale.
    const { container } = renderWith(
      data({ weeks: [{ week: "2026-08-17", entrati: 11, usciti: 2 }] }),
    );
    const entrati = container.querySelector<HTMLElement>(".bg-sky-500:not(.rounded-sm)");
    const chiusi = container.querySelector<HTMLElement>(".bg-emerald-500:not(.rounded-sm)");
    expect(Number.parseInt(entrati!.style.height, 10)).toBeGreaterThan(0);
    // La barra più alta è quella col valore maggiore.
    expect(Number.parseInt(entrati!.style.height, 10)).toBeGreaterThan(
      Number.parseInt(chiusi!.style.height, 10),
    );
    // Il numero sta dentro la stessa colonna della sua barra e ne porta il
    // colore: è quello a dire quale delle due cifre è quale.
    expect(entrati!.parentElement).toHaveTextContent("11");
    expect(entrati!.parentElement!.querySelector("span")!.className).toContain("text-sky-600");
    expect(chiusi!.parentElement).toHaveTextContent("2");
    expect(chiusi!.parentElement!.querySelector("span")!.className).toContain("text-emerald-600");
  });

  it("l'elenco delle persone compare solo quando il server lo manda", () => {
    const { unmount } = renderWith(data());
    expect(screen.queryByText("Le persone")).not.toBeInTheDocument();
    unmount();

    renderWith(
      data({
        people: [
          {
            id: "u1",
            name: "Alex Bianchi",
            assegnati: 120,
            inRitardo: 0,
            daFare: 23,
            inCorso: 97,
            chiusi: 15,
            ore: 38.5,
            copertura: 35,
          },
        ],
      }),
    );
    expect(screen.getByText("Le persone")).toBeInTheDocument();
    expect(screen.getByText(/non è una classifica/)).toBeInTheDocument();
  });

  it("chi era in ferie non ha una percentuale, e non è colorato come un ritardo", () => {
    // Il denominatore sono i giorni lavorati: senza nemmeno uno, non c'è una
    // quota da dare. Uno zero direbbe che le vacanze sono un ritardo.
    renderWith(
      data({ me: { ...data().me, copertura: { compilati: 0, lavorati: 0, percento: null } } }),
    );
    expect(screen.getByText("Nessun giorno lavorato nel periodo.")).toBeInTheDocument();
    expect(screen.getByText("—")).toBeInTheDocument();
  });

  it("la copertura si legge sui giorni lavorati, e la pagina lo dice", () => {
    renderWith(data());
    expect(screen.getByText("11 giorni su 17 lavorati")).toBeInTheDocument();
  });

  it("le quote della coda sono percentuali del totale aperto, non della persona", () => {
    // 120 task su 349 aperti = 34%: la domanda è quanta parte della coda di
    // tutti tiene in mano, non come si divide il suo lavoro.
    renderWith(
      data({
        people: [
          {
            id: "u1",
            name: "Alex Bianchi",
            assegnati: 120,
            inRitardo: 0,
            daFare: 23,
            inCorso: 97,
            chiusi: 15,
            ore: 38.5,
            copertura: 35,
          },
        ],
      }),
    );
    expect(screen.getByText("34%")).toBeInTheDocument();
    expect(screen.getByText("7%")).toBeInTheDocument();
    expect(screen.getByText("28%")).toBeInTheDocument();
  });

  it("il lavoro di chi non è più in squadra si dichiara, invece di sparire", () => {
    // Un account spento con 15 task aperti non è carico di nessuno, ma non è
    // nemmeno lavoro finito: senza la riga, quindici task da riassegnare
    // uscivano dalla pagina senza che nessuno se ne accorgesse.
    renderWith(
      data({
        team: { ...data().team, fuoriSquadra: 15 },
        people: [
          {
            id: "u1",
            name: "Alex Bianchi",
            assegnati: 120,
            inRitardo: 0,
            daFare: 23,
            inCorso: 97,
            chiusi: 15,
            ore: 38.5,
            copertura: 35,
          },
        ],
      }),
    );
    expect(
      screen.getByText(/15 task aperti sono intestati a persone non più in squadra/),
    ).toBeInTheDocument();
  });

  /**
   * L'avviso sui limiti nomina delle persone: come la tabella per persona, lo
   * legge chi guida l'area. E quando non c'è niente da segnalare **lo dice**:
   * una sezione che sparisce non si distingue da una che non è stata
   * calcolata.
   */
  it("i limiti in sofferenza distinguono chi è oltre da chi è al limite", () => {
    renderWith(
      data({
        wip: [
          {
            projectId: "p1",
            projectName: "Orione - Bug/Fixing",
            statusId: "s2",
            statusName: "In sviluppo",
            userId: "u1",
            userName: "Alex Bianchi",
            count: 7,
            limit: 4,
            level: "oltre",
          },
          {
            projectId: "p2",
            projectName: "Atlante",
            statusId: "s2",
            statusName: "In sviluppo",
            userId: "u2",
            userName: "Emanuele Bassi",
            count: 4,
            limit: 4,
            level: "attenzione",
          },
        ],
      }),
    );
    expect(screen.getByText("Troppe cose aperte insieme")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Orione - Bug/Fixing" })).toHaveAttribute(
      "href",
      "/progetti/p1",
    );
    // Il conteggio porta il colore del suo livello: chi è oltre in rosso, chi è
    // al limite in ambra. Senza, due righe uguali direbbero la stessa cosa.
    expect(screen.getByText("7").className).toContain("text-destructive");
    expect(screen.getByText("4", { selector: "td.text-amber-600" })).toBeInTheDocument();
    expect(
      screen.getByText(/non quelli che supervisiona né quelli che ha creato/),
    ).toBeInTheDocument();
  });

  it("quando i carichi sono nei limiti lo dice, invece di sparire", () => {
    renderWith(data({ wip: [] }));
    expect(screen.getByText(/Nessun limite di lavoro in corso superato/)).toBeInTheDocument();
  });

  it("a chi non guida l'area i limiti degli altri non compaiono", () => {
    renderWith(data({ wip: null }));
    expect(screen.queryByText("Troppe cose aperte insieme")).not.toBeInTheDocument();
  });

  it("il lavoro di nessuno chiude la tabella: senza, le quote non tornano", () => {
    // 113 su 349 senza assegnatario sono la voce più grossa della coda.
    renderWith(
      data({
        people: [
          {
            id: "u1",
            name: "Alex Bianchi",
            assegnati: 120,
            inRitardo: 0,
            daFare: 23,
            inCorso: 97,
            chiusi: 15,
            ore: 38.5,
            copertura: 35,
          },
        ],
      }),
    );
    expect(screen.getByText("Non assegnati")).toBeInTheDocument();
    expect(screen.getByText("113")).toBeInTheDocument();
    expect(screen.getByText("32%")).toBeInTheDocument();
  });

  it("shows each person's overdue tasks, in amber when there are any", () => {
    renderWith(
      data({
        people: [
          {
            id: "u1",
            name: "Alex Bianchi",
            assegnati: 5,
            inRitardo: 7,
            daFare: 1,
            inCorso: 4,
            chiusi: 3,
            ore: 10,
            copertura: 90,
          },
        ],
      }),
    );
    expect(screen.getByText("In ritardo")).toBeInTheDocument();
    const riga = screen.getByText("Alex Bianchi").closest("tr")!;
    const cella = [...riga.querySelectorAll("td")].find((td) => td.textContent === "7")!;
    expect(cella.className).toContain("text-amber-600");
  });
});
