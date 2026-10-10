// Copyright (c) 2026 Jugaad s.r.l.
// SPDX-License-Identifier: AGPL-3.0-only

import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { TimesheetPage } from "./TimesheetPage";

/**
 * **The timesheet page in the two editions** (08/10/2026). Community: the
 * grid for everyone, the Summaries tab for managers only, none of the
 * commercial extras (Report, suggested hours). Commercial: as before.
 */
const edizione = { commerciale: true };
const utente = { current: {} as Record<string, unknown> };

vi.mock("@/edition/slot-pagine", () => {
  const Finto = (nome: string) => () => <div>{nome}</div>;
  return {
    get useOreSuggerite() {
      return edizione.commerciale ? () => ({ data: [] }) : undefined;
    },
    get RigheDalleAttivita() {
      return edizione.commerciale ? Finto("righe") : undefined;
    },
    get EsportazioniOre() {
      return edizione.commerciale ? Finto("esportazioni") : undefined;
    },
    get VistaReportOre() {
      return edizione.commerciale ? Finto("report") : undefined;
    },
    get ProduttivitaOre() {
      return edizione.commerciale ? Finto("produttivita") : undefined;
    },
  };
});
vi.mock("@/edition/rotte", () => ({
  edizione: {
    get moduli() {
      return new Set(edizione.commerciale ? ["ticket", "timesheet"] : []);
    },
  },
}));
vi.mock("@/features/auth/useAuth", () => ({ useCurrentUser: () => utente.current }));
vi.mock("@/features/plugins/PluginMenu", () => ({ PluginMenu: () => null }));
vi.mock("./TimesheetGrid", () => ({ TimesheetGrid: () => null, TimesheetDayView: () => null }));
vi.mock("./useTimesheet", () => ({
  useTimesheetPeriod: () => ({ data: { locked: false, filtered: false } }),
  useTimesheetUsers: () => ({ data: [] }),
}));
vi.mock("@/components/ui/confirm", () => ({ useConfirm: () => vi.fn() }));
vi.mock("@/components/ui/toast", () => ({ useToast: () => vi.fn() }));
vi.mock("@tanstack/react-query", () => ({
  useMutation: () => ({ mutate: vi.fn(), isPending: false }),
  useQueryClient: () => ({ invalidateQueries: vi.fn() }),
}));

const persona = (dati: Record<string, unknown>) => ({
  id: "u1",
  role: "MEMBER",
  canViewTeamTimesheet: false,
  canViewAllTimesheets: false,
  canElevate: false,
  ...dati,
});
const apri = () =>
  render(
    <MemoryRouter>
      <TimesheetPage />
    </MemoryRouter>,
  );
const titolo = (testo: string) => screen.queryByRole("button", { name: new RegExp(testo) });

describe("timesheet page, community edition", () => {
  beforeEach(() => {
    edizione.commerciale = false;
    localStorage.clear();
  });

  it("a member has the calendar only: no summaries, no report, no suggestions", () => {
    utente.current = persona({});
    apri();
    expect(titolo("Calendario")).toBeTruthy();
    expect(titolo("Riepiloghi")).toBeNull();
    expect(titolo("Report")).toBeNull();
    expect(screen.queryByTitle(/ore suggerite/)).toBeNull();
  });

  it("a manager also has the summaries, and the people picker", () => {
    utente.current = persona({ canViewTeamTimesheet: true, canViewAllTimesheets: true });
    apri();
    expect(titolo("Riepiloghi")).toBeTruthy();
    expect(titolo("Report")).toBeNull();
    expect(titolo("Il mio timesheet")).toBeTruthy();
  });
});

describe("timesheet page, commercial edition", () => {
  beforeEach(() => {
    edizione.commerciale = true;
    localStorage.clear();
  });

  it("a member has summaries and suggestions, as before", () => {
    utente.current = persona({});
    apri();
    expect(titolo("Riepiloghi")).toBeTruthy();
    expect(screen.getByTitle(/ore suggerite/)).toBeTruthy();
    expect(titolo("Report")).toBeNull();
  });

  it("whoever sees everyone's hours also has the Report", () => {
    utente.current = persona({ canViewTeamTimesheet: true, canViewAllTimesheets: true });
    apri();
    expect(titolo("Report")).toBeTruthy();
  });
});
