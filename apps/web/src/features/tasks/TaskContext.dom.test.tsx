import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import type { TaskListItem } from "@kancrm/shared";
import { CompanyChip, ContactChip, ContextLine, TaskContext } from "./TaskContext";

// Il progetto sulla riga ha la freccia che lo apre (navigazione): serve un
// Router, come nella vera applicazione.
const show = (node: React.ReactNode) => render(<MemoryRouter>{node}</MemoryRouter>);

const task = (over: Partial<TaskListItem>): TaskListItem =>
  ({
    kind: "ADMIN",
    company: null,
    project: null,
    relatedProject: null,
    ...over,
  }) as TaskListItem;

describe("TaskContext", () => {
  it("mostra il cliente dell'offerta e il progetto", () => {
    show(
      <TaskContext
        task={task({
          company: { id: "c1", name: "Coopselios" },
          project: { id: "p1", name: "Agente Netico" },
        })}
      />,
    );
    expect(screen.getByText("Coopselios")).toBeInTheDocument();
    expect(screen.getByText("Agente Netico")).toBeInTheDocument();
  });

  it("senza progetto proprio ripiega su quello di riferimento", () => {
    // Ticket e occorrenze ricorrenti a contratto: il progetto c'è, ma come
    // riferimento, non come appartenenza.
    show(<TaskContext task={task({ relatedProject: { id: "p2", name: "Contratto Vimar" } })} />);
    expect(screen.getByText("Contratto Vimar")).toBeInTheDocument();
  });

  it("il progetto di appartenenza vince su quello di riferimento", () => {
    show(
      <TaskContext
        task={task({
          project: { id: "p1", name: "Appartenenza" },
          relatedProject: { id: "p2", name: "Riferimento" },
        })}
      />,
    );
    expect(screen.getByText("Appartenenza")).toBeInTheDocument();
    expect(screen.queryByText("Riferimento")).not.toBeInTheDocument();
  });

  it("la natura si mostra anche senza cliente né progetto", () => {
    // Prima la riga spariva del tutto: ora il simbolo del modulo c'è sempre,
    // perché è l'informazione che distingue le righe negli elenchi misti.
    show(<TaskContext task={task({})} />);
    expect(screen.getByText("Scadenzario")).toBeInTheDocument();
  });

  it("una natura sconosciuta e nessun contesto non occupano spazio", () => {
    const { container } = show(<TaskContext task={task({ kind: "QUALCOSA_DI_NUOVO" as never })} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("un task amministrativo si riconosce dal calendario", () => {
    // Negli elenchi trasversali la natura del task va detta: "Versamento F24"
    // e "Fix crash" si somigliano finché non si legge il simbolo.
    show(<TaskContext task={task({ kind: "ADMIN" })} />);
    expect(screen.getByText("Scadenzario")).toBeInTheDocument();
  });

  it("un task di sviluppo porta un segno solo: </> con il nome del progetto", () => {
    show(
      <TaskContext task={task({ kind: "PROJECT", project: { id: "p1", name: "Atlante PDF" } })} />,
    );
    expect(screen.getByText("Atlante PDF")).toBeInTheDocument();
    // Niente etichetta "Sviluppo" ridondante accanto al nome.
    expect(screen.queryByText("Sviluppo")).not.toBeInTheDocument();
  });

  it("una scadenza legata a un contratto mostra natura E progetto di riferimento", () => {
    show(
      <TaskContext
        task={task({ kind: "ADMIN", relatedProject: { id: "p2", name: "Contratto Vimar" } })}
      />,
    );
    expect(screen.getByText("Scadenzario")).toBeInTheDocument();
    expect(screen.getByText("Contratto Vimar")).toBeInTheDocument();
  });

  it("dentro un modulo il simbolo si spegne, i campi restano", () => {
    // Sulle card del kanban dello scadenzario ripetere "Scadenzario" su ogni
    // card sarebbe rumore: resta l'azienda, che è l'informazione.
    show(
      <TaskContext
        task={task({ kind: "ADMIN", company: { id: "c1", name: "Coopselios" } })}
        showModule={false}
      />,
    );
    expect(screen.getByText("Coopselios")).toBeInTheDocument();
    expect(screen.queryByText("Scadenzario")).not.toBeInTheDocument();
  });
});

describe("la riga sotto il titolo di un'offerta", () => {
  it("porta azienda e interlocutore con lo stesso stile dei task", () => {
    show(
      <ContextLine>
        <CompanyChip name="Quetzalcoatl SpA" />
        <ContactChip name="Quinto Quetzal" />
      </ContextLine>,
    );
    expect(screen.getByTitle("Cliente: Quetzalcoatl SpA")).toHaveTextContent("Quetzalcoatl SpA");
    expect(screen.getByTitle("Interlocutore: Quinto Quetzal")).toHaveTextContent("Quinto Quetzal");
  });
});
