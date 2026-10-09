import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { ConfirmProvider } from "@/components/ui/confirm";
import { isDirtyForm, useKeepOrRevert, useSaveOrDiscard } from "./unsaved-changes";

function KeepOrRevertHarness({
  changed,
  ...spies
}: { changed: string[] } & Record<string, unknown>) {
  const keepOrRevert = useKeepOrRevert();
  return (
    <button
      type="button"
      onClick={() =>
        keepOrRevert({
          changed,
          what: "il task",
          onKeep: spies.onKeep as () => void,
          onRevert: spies.onRevert as () => void,
        })
      }
    >
      chiudi
    </button>
  );
}

function SaveOrDiscardHarness(props: {
  isDirty: boolean;
  canSave: boolean;
  onSave: () => void;
  onDiscard: () => void;
}) {
  const saveOrDiscard = useSaveOrDiscard();
  return (
    <button type="button" onClick={() => saveOrDiscard(props)}>
      chiudi
    </button>
  );
}

const withConfirm = (node: React.ReactNode) => render(<ConfirmProvider>{node}</ConfirmProvider>);
const close = () => fireEvent.click(screen.getByRole("button", { name: "chiudi" }));
const click = (name: string) => fireEvent.click(screen.getByRole("button", { name }));

describe("useKeepOrRevert (pannelli che salvano campo per campo)", () => {
  it("senza modifiche chiude e basta, senza infastidire", () => {
    const onKeep = vi.fn();
    const onRevert = vi.fn();
    withConfirm(<KeepOrRevertHarness changed={[]} onKeep={onKeep} onRevert={onRevert} />);
    close();
    expect(onKeep).toHaveBeenCalledOnce();
    expect(onRevert).not.toHaveBeenCalled();
    expect(screen.queryByText(/Mantenere le modifiche/)).not.toBeInTheDocument();
  });

  it("elenca cosa è cambiato e lascia scegliere", async () => {
    const onKeep = vi.fn();
    const onRevert = vi.fn();
    withConfirm(
      <KeepOrRevertHarness changed={["Stato", "Scadenza"]} onKeep={onKeep} onRevert={onRevert} />,
    );
    close();
    expect(await screen.findByText(/Hai modificato: Stato, Scadenza/)).toBeInTheDocument();
    click("Torna com'era");
    await waitFor(() => expect(onRevert).toHaveBeenCalledOnce());
    expect(onKeep).not.toHaveBeenCalled();
  });

  it("uscire dalla domanda (✕/Esc) tiene le modifiche: l'opzione sicura", async () => {
    const onKeep = vi.fn();
    const onRevert = vi.fn();
    withConfirm(<KeepOrRevertHarness changed={["Titolo"]} onKeep={onKeep} onRevert={onRevert} />);
    close();
    await screen.findByText(/Hai modificato: Titolo/);
    click("Chiudi");
    await waitFor(() => expect(onKeep).toHaveBeenCalledOnce());
    expect(onRevert).not.toHaveBeenCalled();
  });
});

describe("useSaveOrDiscard (moduli che salvano alla conferma)", () => {
  it("senza modifiche chiude e basta", () => {
    const onSave = vi.fn();
    const onDiscard = vi.fn();
    withConfirm(
      <SaveOrDiscardHarness isDirty={false} canSave onSave={onSave} onDiscard={onDiscard} />,
    );
    close();
    expect(onDiscard).toHaveBeenCalledOnce();
    expect(onSave).not.toHaveBeenCalled();
  });

  it("con modifiche salvabili offre di salvare", async () => {
    const onSave = vi.fn();
    const onDiscard = vi.fn();
    withConfirm(<SaveOrDiscardHarness isDirty canSave onSave={onSave} onDiscard={onDiscard} />);
    close();
    expect(await screen.findByText(/Salvare le modifiche/)).toBeInTheDocument();
    click("Salva e chiudi");
    await waitFor(() => expect(onSave).toHaveBeenCalledOnce());
  });

  it("se il modulo non è completo non promette un salvataggio impossibile", async () => {
    // Titolo vuoto: "Salva" fallirebbe. L'alternativa vera è tornare a scrivere.
    const onSave = vi.fn();
    const onDiscard = vi.fn();
    withConfirm(
      <SaveOrDiscardHarness isDirty canSave={false} onSave={onSave} onDiscard={onDiscard} />,
    );
    close();
    expect(await screen.findByText(/non è ancora completo/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Salva e chiudi" })).not.toBeInTheDocument();
    click("Chiudi e scarta");
    await waitFor(() => expect(onDiscard).toHaveBeenCalledOnce());
    expect(onSave).not.toHaveBeenCalled();
  });
});

describe("isDirtyForm", () => {
  it("confronta ogni campo col valore di partenza", () => {
    expect(
      isDirtyForm([
        ["", ""],
        [null, null],
      ]),
    ).toBe(false);
    expect(isDirtyForm([["Ciao", ""]])).toBe(true);
    expect(
      isDirtyForm([
        ["uguale", "uguale"],
        ["x", "y"],
      ]),
    ).toBe(true);
  });
});
