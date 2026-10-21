// Copyright (c) 2026 Jugaad s.r.l.
// SPDX-License-Identifier: AGPL-3.0-only

import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import type { Activity } from "@kancrm/shared";
import { ActivitySection } from "./TaskTimeline";

/**
 * **Chi e da dove** (21/10/2026): una modifica che un assistente ha fatto a
 * nome di una persona si legge «Maria Rossi via MCP»; una fatta
 * dall'applicazione resta com'era.
 */
const voce = (via: string | null): Activity => ({
  id: via ?? "app",
  action: "contact_changed",
  payload: { from: null, to: "Giulia Neri" },
  createdAt: "2026-10-21T10:00:00.000Z",
  user: { id: "u1", name: "Maria Rossi" } as Activity["user"],
  via,
});

afterEach(cleanup);

describe("la cronologia dice il canale", () => {
  it("«via MCP» accanto alla persona, solo dove c'è", () => {
    render(<ActivitySection activities={[voce("MCP"), voce(null)]} />);
    const righe = screen.getAllByRole("listitem").map((li) => li.textContent ?? "");
    expect(righe[0]).toMatch(/^Maria Rossi via MCP /);
    expect(righe[0]).toContain("Giulia Neri");
    expect(righe[1]).not.toContain("via");
  });
});
