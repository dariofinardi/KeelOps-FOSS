import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { PushPrompt } from "./PushPrompt";

const push = {
  pushSupported: vi.fn(() => true),
  getPushSubscription: vi.fn(async () => null as unknown),
  enablePush: vi.fn(async () => undefined),
};
vi.mock("@/lib/push", () => ({
  pushSupported: () => push.pushSupported(),
  getPushSubscription: () => push.getPushSubscription(),
  enablePush: () => push.enablePush(),
  disablePush: vi.fn(),
}));
vi.mock("@/components/ui/toast", () => ({ useToast: () => vi.fn() }));

/** Il permesso del browser: "default" = non ancora chiesto a nessuno. */
const permesso = (value: NotificationPermission) => {
  vi.stubGlobal("Notification", { permission: value });
};

const chiedi = () => render(<PushPrompt delayMs={0} />);
const domanda = () => screen.findByText(/Vuoi essere avvisato/);

beforeEach(() => {
  localStorage.clear();
  permesso("default");
  push.pushSupported.mockReturnValue(true);
  push.getPushSubscription.mockResolvedValue(null);
});

afterEach(() => {
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

describe("la domanda sulle notifiche", () => {
  it("si presenta alla prima apertura", async () => {
    chiedi();
    expect(await domanda()).toBeTruthy();
  });

  it("un sì le accende, e non si chiede più", async () => {
    const { unmount } = chiedi();
    fireEvent.click(await screen.findByText("Sì, avvisami"));
    await waitFor(() => expect(push.enablePush).toHaveBeenCalled());
    unmount();

    chiedi();
    await waitFor(() => expect(screen.queryByText(/Vuoi essere avvisato/)).toBeNull());
  });

  it("un no resta un no: non si insiste al prossimo accesso", async () => {
    const { unmount } = chiedi();
    fireEvent.click(await screen.findByText("No, grazie"));
    await waitFor(() => expect(screen.queryByText(/Vuoi essere avvisato/)).toBeNull());
    expect(push.enablePush).not.toHaveBeenCalled();
    unmount();

    chiedi();
    await waitFor(() => expect(screen.queryByText(/Vuoi essere avvisato/)).toBeNull());
  });

  it("sparisce al clic, senza aspettare il browser", async () => {
    // Il difetto vero: Edge può mettere la richiesta di permesso in una
    // campanella nella barra degli indirizzi, e la promessa resta appesa finché
    // non ci si preme. La scheda non deve stare a guardare.
    let sblocca: () => void = () => undefined;
    push.enablePush.mockImplementationOnce(
      () => new Promise<undefined>((resolve) => (sblocca = () => resolve(undefined))),
    );
    chiedi();
    fireEvent.click(await screen.findByText("Sì, avvisami"));
    await waitFor(() => expect(screen.queryByText(/Vuoi essere avvisato/)).toBeNull());
    sblocca();
  });

  it("se qualcosa va storto la domanda sparisce lo stesso", async () => {
    // Il difetto segnalato: premuto "sì", i pulsanti si sbiadivano e la scheda
    // restava lì. Un clic senza risposta è il modo peggiore di fallire.
    push.enablePush.mockRejectedValueOnce(new Error("Il browser non ha attivato il servizio"));
    chiedi();
    fireEvent.click(await screen.findByText("Sì, avvisami"));
    await waitFor(() => expect(screen.queryByText(/Vuoi essere avvisato/)).toBeNull());
  });

  it("un guasto non è un rifiuto: alla prossima apertura si richiede", async () => {
    push.enablePush.mockRejectedValueOnce(new Error("guasto"));
    const { unmount } = chiedi();
    fireEvent.click(await screen.findByText("Sì, avvisami"));
    await waitFor(() => expect(screen.queryByText(/Vuoi essere avvisato/)).toBeNull());
    unmount();

    chiedi();
    expect(await domanda()).toBeTruthy();
  });

  it("se il browser ha già deciso, non si chiede niente", async () => {
    // Il permesso del browser si chiede una volta sola: davanti a un "blocca"
    // già dato, insistere non riaprirebbe nulla.
    permesso("denied");
    chiedi();
    await waitFor(() => expect(screen.queryByText(/Vuoi essere avvisato/)).toBeNull());
  });

  it("chi le ha già attive non se le sente riproporre", async () => {
    push.getPushSubscription.mockResolvedValue({ endpoint: "https://push.esempio/1" });
    chiedi();
    await waitFor(() => expect(screen.queryByText(/Vuoi essere avvisato/)).toBeNull());
  });

  it("dove il browser non le sa fare, nessuna domanda", async () => {
    push.pushSupported.mockReturnValue(false);
    chiedi();
    await waitFor(() => expect(screen.queryByText(/Vuoi essere avvisato/)).toBeNull());
  });
});
