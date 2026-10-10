// Copyright (c) 2026 Jugaad s.r.l.
// SPDX-License-Identifier: AGPL-3.0-only

import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { PushToggle } from "./PushToggle";

const push = {
  pushSupported: vi.fn(() => true),
  getPushSubscription: vi.fn(async () => null as unknown),
  enablePush: vi.fn(async () => undefined),
  disablePush: vi.fn(async () => undefined),
  pushBlockedByBrowser: vi.fn(() => false),
};
vi.mock("@/lib/push", () => ({
  pushSupported: () => push.pushSupported(),
  getPushSubscription: () => push.getPushSubscription(),
  enablePush: () => push.enablePush(),
  disablePush: () => push.disablePush(),
  pushBlockedByBrowser: () => push.pushBlockedByBrowser(),
  PUSH_UNBLOCK_HINT: "Le notifiche sono bloccate fuori da KeelOps.",
}));
vi.mock("@/components/ui/toast", () => ({ useToast: () => vi.fn() }));

afterEach(() => {
  push.pushSupported.mockReturnValue(true);
  push.getPushSubscription.mockResolvedValue(null);
  push.pushBlockedByBrowser.mockReturnValue(false);
  vi.clearAllMocks();
});

describe("interruttore delle notifiche del browser", () => {
  it("spente: la campanella è sbarrata e premendo si accendono", async () => {
    render(<PushToggle />);
    const bottone = await screen.findByLabelText("Accendi le notifiche del browser");
    fireEvent.click(bottone);
    await waitFor(() => expect(push.enablePush).toHaveBeenCalled());
    expect(await screen.findByLabelText("Spegni le notifiche del browser")).toBeTruthy();
  });

  it("accese: premendo si spengono su questo dispositivo", async () => {
    push.getPushSubscription.mockResolvedValue({ endpoint: "https://push.esempio/1" });
    render(<PushToggle />);
    fireEvent.click(await screen.findByLabelText("Spegni le notifiche del browser"));
    await waitFor(() => expect(push.disablePush).toHaveBeenCalled());
  });

  it("bloccate dal browser: non si riprova, si dice dove si sbloccano", async () => {
    // Riprovare produrrebbe lo stesso rifiuto istantaneo: l'unica cosa che può
    // funzionare è cambiare un'impostazione fuori da qui.
    push.pushBlockedByBrowser.mockReturnValue(true);
    render(<PushToggle />);
    fireEvent.click(await screen.findByLabelText("Accendi le notifiche del browser"));
    await waitFor(() => expect(push.enablePush).not.toHaveBeenCalled());
  });

  it("dove il browser non le sa fare, non c'è nessun interruttore", async () => {
    // Un pulsante che acceso non fa niente e spento sembra una scelta è peggio
    // della sua assenza.
    push.pushSupported.mockReturnValue(false);
    const { container } = render(<PushToggle />);
    await waitFor(() => expect(container.textContent).toBe(""));
    expect(push.getPushSubscription).not.toHaveBeenCalled();
  });
});
