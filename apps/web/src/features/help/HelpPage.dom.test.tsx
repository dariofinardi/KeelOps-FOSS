// Copyright (c) 2026 Jugaad s.r.l.
// SPDX-License-Identifier: AGPL-3.0-only

import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { HelpPage } from "./HelpPage";
import { RELEASE_NOTES } from "./release-notes";

/**
 * **The guide in the two editions** (08/10/2026): the commercial passages
 * appear with their modules, the community gets its own wording, and the
 * release notes of the community start with the first build released in two
 * editions, without the commercial lines.
 */
const edizione = { commerciale: true };
vi.mock("@/edition/rotte", () => ({
  edizione: {
    get moduli() {
      return new Set(edizione.commerciale ? ["ticket", "timesheet", "area-investitori"] : []);
    },
  },
}));
vi.mock("@/features/auth/useAuth", () => ({
  useCurrentUser: () => ({
    role: "ADMIN",
    canSeeDeals: true,
    canSeeAdminTasks: true,
    canSeeTickets: false,
  }),
}));

const apri = (titolo: string) => fireEvent.click(screen.getByRole("button", { name: titolo }));

describe("help page", () => {
  beforeEach(() => localStorage.clear());

  it("community: release notes from the first two-edition build, without commercial lines", () => {
    edizione.commerciale = false;
    render(<HelpPage />);
    apri("Release notes (English only)");
    expect(screen.getByText(/follow the month or week lens/)).toBeInTheDocument();
    expect(screen.queryByText(/analysis of a won deal/)).toBeNull();
    expect(screen.queryByText("0.12.67")).toBeNull();
  });

  it("community: the timesheet summaries are for managers, without CSV", () => {
    edizione.commerciale = false;
    render(<HelpPage />);
    apri("Timesheet");
    expect(screen.getByText(/li vedono i manager/)).toBeInTheDocument();
    expect(screen.queryByText(/Export CSV/)).toBeNull();
  });

  /**
   * The exported community tree carries only its own notes (the export trims
   * the history): there the commercial guide has nothing to show.
   */
  const storiaCompleta = RELEASE_NOTES.some((nota) => nota.version === "0.12.67");

  it.skipIf(!storiaCompleta)(
    "commercial: every note and the full timesheet text, as before",
    () => {
      edizione.commerciale = true;
      render(<HelpPage />);
      apri("Release notes (English only)");
      expect(screen.getByText(/analysis of a won deal/)).toBeInTheDocument();
      expect(screen.getByText("0.12.67")).toBeInTheDocument();
      apri("Timesheet");
      expect(screen.getByText(/Export CSV/)).toBeInTheDocument();
    },
  );
});
