// Copyright (c) 2026 Jugaad s.r.l.
// SPDX-License-Identifier: AGPL-3.0-only

import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { ConfirmProvider, useConfirm, type ConfirmOptions } from "./confirm";

/** Bottone che apre la conferma e riporta l'esito al chiamante. */
function Trigger({
  options,
  onAnswer,
}: {
  options: ConfirmOptions;
  onAnswer: (value: boolean) => void;
}) {
  const confirm = useConfirm();
  return <button onClick={() => void confirm(options).then(onAnswer)}>apri</button>;
}

function setup(options: ConfirmOptions) {
  const onAnswer = vi.fn();
  render(
    <ConfirmProvider>
      <Trigger options={options} onAnswer={onAnswer} />
    </ConfirmProvider>,
  );
  fireEvent.click(screen.getByText("apri"));
  return onAnswer;
}

const KEEP_OPTIONS: ConfirmOptions = {
  title: "Mantenere le modifiche?",
  confirmLabel: "Mantieni le modifiche",
  cancelLabel: "Scarta le modifiche",
  cancelTone: "danger",
  dismissValue: true,
};

describe("ConfirmProvider", () => {
  it("il bottone principale mantiene", async () => {
    const onAnswer = setup(KEEP_OPTIONS);
    fireEvent.click(screen.getByText("Mantieni le modifiche"));
    await waitFor(() => expect(onAnswer).toHaveBeenCalledWith(true));
  });

  it("il bottone secondario scarta", async () => {
    const onAnswer = setup(KEEP_OPTIONS);
    fireEvent.click(screen.getByText("Scarta le modifiche"));
    await waitFor(() => expect(onAnswer).toHaveBeenCalledWith(false));
  });

  it("uscire con Esc non esegue l'azione distruttiva quando dismissValue è true", async () => {
    // Senza dismissValue, invertire i bottoni renderebbe Esc equivalente a
    // "Scarta": premerlo per errore farebbe perdere il lavoro.
    const onAnswer = setup(KEEP_OPTIONS);
    fireEvent.keyDown(document, { key: "Escape" });
    await waitFor(() => expect(onAnswer).toHaveBeenCalledWith(true));
  });

  it("senza dismissValue l'uscita resta un annullamento (comportamento storico)", async () => {
    const onAnswer = setup({ title: "Eliminare?", confirmLabel: "Elimina", tone: "danger" });
    fireEvent.keyDown(document, { key: "Escape" });
    await waitFor(() => expect(onAnswer).toHaveBeenCalledWith(false));
  });

  it("il bottone di sinistra è marcato come pericoloso solo se richiesto", () => {
    setup(KEEP_OPTIONS);
    expect(screen.getByText("Scarta le modifiche").className).toContain("text-destructive");
  });
});
