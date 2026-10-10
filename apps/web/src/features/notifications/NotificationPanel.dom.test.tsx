// Copyright (c) 2026 Jugaad s.r.l.
// SPDX-License-Identifier: AGPL-3.0-only

import { beforeEach, describe, expect, it, vi } from "vitest";
import { useState } from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import type { NotificationDto } from "@kancrm/shared";
import { NotificationPanel } from "./NotificationBell";

const notifica: NotificationDto = {
  id: "n1",
  type: "mention",
  text: 'Giacomo Verdi ti ha menzionato in "Parametri per SMTP"',
  taskId: "t1",
  taskKind: "PROJECT",
  readAt: null,
  createdAt: "2026-08-06T16:55:00.000Z",
};

/** Una seconda notizia sullo STESSO task, più vecchia: si accorpa alla prima. */
const precedente: NotificationDto = {
  ...notifica,
  id: "n0",
  text: 'La tua richiesta "Parametri per SMTP" è passata a: In sviluppo',
  createdAt: "2026-08-06T09:00:00.000Z",
};

const markRead = vi.fn();
let elenco: NotificationDto[] = [notifica];
/** Le preferenze che il pannello mostra: le riempie il singolo test. */
let preferenze: {
  items: Array<{ type: string; enabled: boolean; email: boolean }>;
  emailDigest: boolean;
  emailDigestMinutes: number;
} = { items: [], emailDigest: false, emailDigestMinutes: 15 };
const cambiaPreferenza = vi.fn();
const aggrega = vi.fn();
vi.mock("./useNotifications", () => ({
  useNotifications: () => ({ data: { notifications: elenco, unreadCount: elenco.length } }),
  useMarkRead: () => ({ mutate: markRead }),
  useMarkAllRead: () => ({ mutate: vi.fn(), isPending: false }),
  useNotificationStream: () => undefined,
  useNotificationPreferences: () => ({ data: preferenze }),
  useUpdatePreference: () => ({ mutate: cambiaPreferenza, isPending: false }),
  useUpdateEmailDigest: () => ({ mutate: aggrega, isPending: false }),
}));

/**
 * Riproduce la forma che aveva rotto il clic: il contenitore si chiude — e
 * quindi smonta il pannello — nello stesso gesto con cui si apre il record.
 */
function ContenitoreCheSiChiude({ onOpenRecord }: { onOpenRecord: (n: NotificationDto) => void }) {
  const [aperto, setAperto] = useState(true);
  return (
    <>
      {aperto && (
        <NotificationPanel
          onOpenRecord={(n) => {
            setAperto(false);
            onOpenRecord(n);
          }}
        />
      )}
      <span data-testid="stato">{aperto ? "aperto" : "chiuso"}</span>
    </>
  );
}

describe("pannello notifiche", () => {
  beforeEach(() => {
    markRead.mockClear();
    elenco = [notifica];
  });

  it("cliccando una notifica chiede a chi lo contiene di aprire il record", () => {
    // Il pannello non deve aprire il record da sé: chiudendosi si porterebbe via
    // il drawer appena creato, e il clic non porterebbe da nessuna parte.
    const onOpenRecord = vi.fn();
    render(<ContenitoreCheSiChiude onOpenRecord={onOpenRecord} />);

    fireEvent.click(screen.getByText(/ti ha menzionato/));
    expect(onOpenRecord).toHaveBeenCalledExactlyOnceWith(notifica);
    // Il contenitore si è chiuso: chi apre il record deve vivere fuori di qui.
    expect(screen.getByTestId("stato")).toHaveTextContent("chiuso");
  });

  it("una notifica non letta si segna letta al clic", () => {
    render(<NotificationPanel onOpenRecord={vi.fn()} />);
    fireEvent.click(screen.getByText(/ti ha menzionato/));
    expect(markRead).toHaveBeenCalledWith(["n1"]);
  });

  it("si segna letta SENZA aprire il record", () => {
    // Prima l'unico modo era aprirla e finire su un record che non interessa.
    const onOpenRecord = vi.fn();
    render(<NotificationPanel onOpenRecord={onOpenRecord} />);
    fireEvent.click(screen.getByRole("button", { name: "Segna come letta" }));
    expect(markRead).toHaveBeenCalledWith(["n1"]);
    expect(onOpenRecord).not.toHaveBeenCalled();
  });

  it("due notizie sullo stesso task sono una riga sola: l'ultima", () => {
    elenco = [notifica, precedente];
    render(<NotificationPanel onOpenRecord={vi.fn()} />);
    expect(screen.getByText(/ti ha menzionato/)).toBeInTheDocument();
    expect(screen.queryByText(/è passata a: In sviluppo/)).not.toBeInTheDocument();
    // la riga dichiara quante ne vale, e leggerla le legge tutte
    expect(screen.getByText("2 aggiornamenti")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Segna come letta" }));
    expect(markRead).toHaveBeenCalledWith(["n1", "n0"]);
  });
});

/**
 * **Campanella ed email si scelgono separatamente.** Un interruttore solo
 * costringeva a smettere di sapere per ricevere meno posta: le due caselle sono
 * indipendenti, e muoverne una non tocca l'altra (04/09/2026).
 */
describe("preferenze: una casella per canale", () => {
  beforeEach(() => {
    cambiaPreferenza.mockClear();
    preferenze = {
      items: [{ type: "task_assigned", enabled: true, email: false }],
      emailDigest: false,
      emailDigestMinutes: 15,
    };
    render(<NotificationPanel onOpenRecord={vi.fn()} />);
    fireEvent.click(screen.getByTitle("Preferenze notifiche"));
  });

  it("mostra lo stato dei due canali, uno acceso e uno spento", () => {
    expect(screen.getByLabelText("Task assegnato a me — In app")).toHaveProperty("checked", true);
    expect(screen.getByLabelText("Task assegnato a me — Email")).toHaveProperty("checked", false);
  });

  it("riaccendendo l'email non si dice niente dell'altro canale", () => {
    fireEvent.click(screen.getByLabelText("Task assegnato a me — Email"));
    expect(cambiaPreferenza).toHaveBeenCalledWith({ type: "task_assigned", email: true });
  });

  /**
   * L'alternativa a spegnere: invece di rinunciare all'avviso, riceverne uno
   * solo ogni tanto. È l'unica scelta del pannello che non è per tipo, perché
   * il problema che risolve è il numero di email, non quali siano.
   */
  it("l'aggregazione delle email si accende dal pannello", () => {
    fireEvent.click(screen.getByText("Aggrega le email"));
    expect(aggrega).toHaveBeenCalledWith({ emailDigest: true });
  });
});
