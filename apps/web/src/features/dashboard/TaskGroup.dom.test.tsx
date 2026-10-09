import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { TaskKind, type DeadlineSection, type TaskListItem } from "@kancrm/shared";
import { TaskGroup, listaDaPreferenza } from "./TaskGroup";

// La pastiglia «Personali» chiede i plugin al server: qui non ce ne sono.
vi.mock("@/features/plugins/PluginPanel", () => ({
  PluginPanel: () => <div>cornice del plugin</div>,
}));

const task = (title: string): TaskListItem =>
  ({
    id: title,
    title,
    kind: TaskKind.PROJECT,
    status: { id: "s1", name: "Da fare", color: "#888", isClosed: false },
    dueDate: null,
    project: { id: "p1", name: "Agente Netico" },
    company: null,
  }) as unknown as TaskListItem;

const section: DeadlineSection = {
  mine: [task("Consegna beta"), task("Attivare i canali ical")],
  supervised: [task("Rivedere il preventivo")],
} as unknown as DeadlineSection;

const renderGroup = (props: Partial<Parameters<typeof TaskGroup>[0]> = {}) =>
  render(
    <MemoryRouter>
      <TaskGroup
        title="Senza scadenza"
        icon={null}
        section={section}
        id="none"
        lista="mine"
        onLista={vi.fn()}
        collapsed={false}
        onCollapsed={vi.fn()}
        emptyText=""
        onOpen={vi.fn()}
        onContext={vi.fn()}
        {...props}
      />
    </MemoryRouter>,
  );

describe("riquadro della giornata", () => {
  it("aperto mostra i task, con la maniglia a sinistra e il bottone per chiudere a destra", () => {
    renderGroup();
    expect(screen.getByText("Consegna beta")).toBeTruthy();
    expect(screen.getByLabelText("Sposta il riquadro")).toBeTruthy();
    expect(screen.getByTitle("Chiudi la sezione")).toBeTruthy();
  });

  it("chiuso mostra solo la barra, contatori compresi", () => {
    // "Senza scadenza" è lungo per costruzione: chiuso si vede che c'è e
    // quanto, senza che seppellisca la giornata di oggi.
    renderGroup({ collapsed: true });
    expect(screen.queryByText("Consegna beta")).toBeNull();
    expect(screen.getByText("Miei (2)")).toBeTruthy();
    expect(screen.getByText("Supervisionati (1)")).toBeTruthy();
  });

  it("si apre e si chiude dal bottone in fondo alla barra", () => {
    const onCollapsed = vi.fn();
    renderGroup({ collapsed: true, onCollapsed });
    fireEvent.click(screen.getByTitle("Apri la sezione"));
    expect(onCollapsed).toHaveBeenCalledWith(false);
  });

  it("aperto, sa richiudersi", () => {
    const onCollapsed = vi.fn();
    renderGroup({ collapsed: false, onCollapsed });
    expect(screen.getByText("Consegna beta")).toBeTruthy();
    fireEvent.click(screen.getByTitle("Chiudi la sezione"));
    expect(onCollapsed).toHaveBeenCalledWith(true);
  });

  it("i contatori restano il filtro tra i due elenchi", () => {
    renderGroup();
    expect(screen.getByText("Consegna beta")).toBeTruthy();
    renderGroup({ lista: "supervised", onLista: vi.fn() });
    expect(screen.getByText("Rivedere il preventivo")).toBeTruthy();
  });

  it("la terza pastiglia «Personali» c'è solo se un plugin porta card nel gruppo, e apre la sua cornice", () => {
    renderGroup();
    expect(screen.queryByText(/Personali/)).toBeNull();
    // e nemmeno con il plugin ma senza card qui: un contatore a zero non si mostra
    renderGroup({ gruppo: "none", personali: 0 });
    expect(screen.queryByText(/Personali/)).toBeNull();
    const onLista = vi.fn();
    renderGroup({ gruppo: "none", personali: 3, onLista });
    fireEvent.click(screen.getByText("Personali (3)"));
    expect(onLista).toHaveBeenCalledWith("personal");
  });

  it("con «Personali» scelta si vede la cornice del plugin al posto dell'elenco", () => {
    renderGroup({ gruppo: "none", personali: 2, lista: "personal" });
    expect(screen.getByText("cornice del plugin")).toBeTruthy();
    expect(screen.queryByText("Consegna beta")).toBeNull();
  });

  it("una preferenza «personali» senza più il plugin torna ai miei; quelle vecchie (booleano) si leggono", () => {
    renderGroup({ lista: "personal" });
    expect(screen.getByText("Consegna beta")).toBeTruthy();
    expect(listaDaPreferenza(true)).toBe("supervised");
    expect(listaDaPreferenza(false)).toBe("mine");
    expect(listaDaPreferenza("personal")).toBe("personal");
  });
});
