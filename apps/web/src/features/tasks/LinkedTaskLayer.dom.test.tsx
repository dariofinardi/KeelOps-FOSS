// Copyright (c) 2026 Jugaad s.r.l.
// SPDX-License-Identifier: AGPL-3.0-only

import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { LinkedTaskLayer } from "./LinkedTaskLayer";
import { useOpenLinkedTask } from "./linked-task-context";

/**
 * Offerta → task collegato (21/10/2026): il task si apre **sopra** l'offerta,
 * con «← Offerta …» accanto al titolo; tornare toglie solo lo strato di sopra.
 */
vi.mock("./TaskDetailDrawer", () => ({
  TaskDetailDrawer: ({
    taskId,
    indietro,
  }: {
    taskId: string | null;
    indietro?: { etichetta: string; onClick: () => void } | null;
  }) =>
    taskId ? (
      <div role="dialog">
        {indietro && <button onClick={indietro.onClick}>← {indietro.etichetta}</button>}
        <h2>task {taskId}</h2>
      </div>
    ) : null,
}));
vi.mock("@/edition/slots", () => ({ slot: {} }));

function PannelloOfferta() {
  const apri = useOpenLinkedTask();
  return (
    <section>
      <h1>offerta</h1>
      <button onClick={() => apri("t1")}>Richiamare il cliente</button>
    </section>
  );
}

afterEach(cleanup);

describe("il task collegato si apre sopra l'offerta", () => {
  it("con il ritorno all'offerta, che resta sotto e ricompare sola", () => {
    render(
      <LinkedTaskLayer origine="Offerta «Rinnovo»">
        <PannelloOfferta />
      </LinkedTaskLayer>,
    );
    fireEvent.click(screen.getByText("Richiamare il cliente"));
    expect(screen.getByText("task t1")).toBeTruthy();
    // l'offerta non si è chiusa: è ancora lì sotto
    expect(screen.getByText("offerta")).toBeTruthy();
    fireEvent.click(screen.getByText("← Offerta «Rinnovo»"));
    expect(screen.queryByText("task t1")).toBeNull();
    expect(screen.getByText("offerta")).toBeTruthy();
  });
});
