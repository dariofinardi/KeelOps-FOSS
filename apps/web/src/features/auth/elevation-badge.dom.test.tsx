// Copyright (c) 2026 Jugaad s.r.l.
// SPDX-License-Identifier: AGPL-3.0-only

import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { AdminElevationBadge } from "./AdminElevation";

/**
 * **Il badge non lascia cadere i privilegi per sbaglio.**
 *
 * "Admin 24′" si legge come uno stato, e invece è il comando che rientra: il
 * 26/08/2026 un clic di troppo ha chiuso l'elevazione senza dire niente, e da
 * lì in poi la pagina Utenti rispondeva 403 mentre il badge continuava a
 * mostrare i minuti che restavano (ricostruito dai log del server).
 */
const stepDown = vi.fn();
const utente = { role: "ADMIN", adminUntil: new Date(Date.now() + 24 * 60_000).toISOString() };
let risposta = true;

vi.mock("./useAuth", () => ({
  useCurrentUser: () => utente,
  useAdminElevation: () => ({ stepDown: { mutate: stepDown, isPending: false } }),
  useElevationCountdown: () => 24,
}));
vi.mock("@/components/ui/toast", () => ({ useToast: () => vi.fn() }));
vi.mock("@/components/ui/confirm", () => ({
  useConfirm: () => () => Promise.resolve(risposta),
}));

describe("badge dei privilegi di amministratore", () => {
  it("mostra i minuti che restano", () => {
    render(<AdminElevationBadge />);
    expect(screen.getByText("24′")).toBeInTheDocument();
  });

  it("cliccandolo chiede conferma, e confermando si rientra", async () => {
    stepDown.mockClear();
    risposta = true;
    render(<AdminElevationBadge />);
    fireEvent.click(screen.getByRole("button"));
    await waitFor(() => expect(stepDown).toHaveBeenCalledOnce());
  });

  it("rinunciando NON si rientra: i privilegi restano", async () => {
    stepDown.mockClear();
    risposta = false;
    render(<AdminElevationBadge />);
    fireEvent.click(screen.getByRole("button"));
    // il tempo di risolvere la promessa della conferma
    await new Promise((risolvi) => setTimeout(risolvi, 0));
    expect(stepDown).not.toHaveBeenCalled();
  });
});
