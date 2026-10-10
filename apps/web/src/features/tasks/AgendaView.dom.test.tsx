// Copyright (c) 2026 Jugaad s.r.l.
// SPDX-License-Identifier: AGPL-3.0-only

import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { TaskKind, type TaskListItem } from "@kancrm/shared";
import { CurrentUserContext } from "@/features/auth/useAuth";
import { AgendaView } from "./AgendaView";

const task = (title: string, dueDate: string | null): TaskListItem =>
  ({
    id: title,
    title,
    kind: TaskKind.ADMIN,
    status: { id: "s1", name: "Da lavorare assegnato", color: "#888", isClosed: false },
    dueDate,
    company: null,
    project: null,
    attachmentCount: 0,
    commentCount: 0,
  }) as unknown as TaskListItem;

/** Oggi è lunedì: "domani" cade nella settimana, "fra un mese" nei prossimi. */
const OGGI = "2026-08-03";
const DOMANI = "2026-08-04";
const FRA_UN_MESE = "2026-09-03";

const renderAgenda = () => {
  vi.setSystemTime(new Date(`${OGGI}T09:00:00Z`));
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <CurrentUserContext.Provider value={{ id: "u1", name: "Tester", role: "MEMBER" } as never}>
          <AgendaView
            tasks={[task("Riunione di domani", DOMANI), task("Rinnovo di settembre", FRA_UN_MESE)]}
            onOpen={vi.fn()}
          />
        </CurrentUserContext.Provider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
};

describe("gruppi dell'agenda", () => {
  beforeEach(() => localStorage.clear());

  it("la settimana si vede, i prossimi no: sono lunghi e non riguardano oggi", () => {
    renderAgenda();
    expect(screen.getByText("Riunione di domani")).toBeTruthy();
    expect(screen.queryByText("Rinnovo di settembre")).toBeNull();
  });

  it("da chiusa la barra dice quanti sono", () => {
    renderAgenda();
    expect(screen.getByText("Prossimi (1)")).toBeTruthy();
  });

  it("si apre dall'intestazione e la scelta si ricorda", () => {
    const { unmount } = renderAgenda();
    fireEvent.click(screen.getByText("Prossimi (1)"));
    expect(screen.getByText("Rinnovo di settembre")).toBeTruthy();

    // Riaperta la pagina, il gruppo è ancora aperto: è una scelta, non un caso.
    unmount();
    renderAgenda();
    expect(screen.getByText("Rinnovo di settembre")).toBeTruthy();
  });

  it("anche i gruppi di oggi si possono chiudere", () => {
    renderAgenda();
    fireEvent.click(screen.getByText("Questa settimana (1)"));
    expect(screen.queryByText("Riunione di domani")).toBeNull();
  });
});
