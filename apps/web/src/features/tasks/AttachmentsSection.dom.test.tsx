// Copyright (c) 2026 Jugaad s.r.l.
// SPDX-License-Identifier: AGPL-3.0-only

import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import type { TaskDetail } from "@kancrm/shared";
import { CurrentUserContext } from "@/features/auth/useAuth";
import { AttachmentsSection } from "./AttachmentsSection";

/**
 * **Un allegato arrivato con un messaggio non si toglie da qui.**
 *
 * Il cestino lo toglierebbe a chi l'ha mandato — e lascerebbe in chat una frase
 * che parla di un documento che non c'è più — mentre il messaggio lo cancella
 * solo il suo autore (o un amministratore). Al posto del cestino c'è la strada
 * per arrivare al messaggio. Il no definitivo è del server, che risponde 409:
 * qui si prova che il comando non venga nemmeno offerto.
 */
const elimina = vi.fn();
/** I plugin montati: vuoto di norma, uno sull'ancora `deal` nel test del bottone «Modifica». */
const plugins = vi.hoisted(() => ({
  lista: [] as Array<{ nome: string; voce: string; anchors: Record<string, boolean> }>,
}));
vi.mock("@/features/plugins/usePlugins", () => ({
  usePlugins: () => ({ data: plugins.lista }),
}));
vi.mock("./useTasks", () => ({
  useAddLinkAttachment: () => ({ mutate: vi.fn(), isPending: false }),
  useUploadAttachment: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useDeleteAttachment: () => ({ mutate: elimina, isPending: false }),
  useOpenAttachment: () => vi.fn(),
}));
vi.mock("@/features/attachments/useAttachmentReader", () => ({
  useAttachmentReader: () => ({ open: vi.fn(), panel: null }),
}));
// The Drive picker off: it would ask the server for the providers.
vi.mock("@/edition/slots", async (importOriginal) => {
  const vero = await importOriginal<typeof import("@/edition/slots")>();
  return { ...vero, slot: { ...vero.slot, useSelettoreDrive: undefined } };
});

const allegato = (id: string, name: string, commentId: string | null) => ({
  id,
  type: "FILE",
  name,
  url: null,
  mimeType: "image/png",
  size: 41_000,
  createdAt: "2026-09-04T15:37:00.000Z",
  uploadedBy: { id: "u1", name: "Dario Ferri" },
  commentId,
});

const task = {
  id: "t1",
  attachments: [allegato("a1", "Screenshot.png", null), allegato("a2", "Moneta-Trump.png", "c9")],
} as unknown as TaskDetail;

const mostra = () =>
  render(
    <CurrentUserContext.Provider value={{ id: "u1", name: "Io", role: "ADMIN" } as never}>
      <AttachmentsSection task={task} />
    </CurrentUserContext.Provider>,
  );

describe("allegati arrivati da un messaggio", () => {
  it("non offrono il cestino, offrono la via per il messaggio", () => {
    mostra();
    // Quello caricato dalla sezione si toglie come sempre: uno solo dei due.
    expect(screen.getAllByTitle("Rimuovi")).toHaveLength(1);
    expect(screen.getAllByLabelText("Vai al messaggio con cui è arrivato")).toHaveLength(1);
  });

  it("si distinguono dagli altri prima di leggere il nome", () => {
    mostra();
    const riga = (nome: string) => screen.getByText(nome).closest("li")!;
    expect(riga("Moneta-Trump.png").className).toContain("border-dashed");
    expect(riga("Screenshot.png").className).not.toContain("border-dashed");
  });
});

/**
 * **«Word» è del plugin, non del core.** Il bottone in coda a Drive, Link
 * e File compare solo su un'offerta, per chi la può modificare, e solo se un
 * plugin dichiara l'ancora `deal`: senza plugin la riga è quella di sempre.
 */
describe("il bottone «Word» dell'offerta", () => {
  const offerta = (canEdit: boolean, kind = "DEAL") =>
    ({ ...task, id: "d1", kind, canEdit }) as unknown as TaskDetail;
  const mostraOfferta = (t: TaskDetail) =>
    render(
      <CurrentUserContext.Provider value={{ id: "u1", name: "Io", role: "ADMIN" } as never}>
        <AttachmentsSection task={t} />
      </CurrentUserContext.Provider>,
    );
  afterEach(() => {
    plugins.lista = [];
  });

  it("non c'è senza un plugin sull'ancora deal", () => {
    mostraOfferta(offerta(true));
    expect(screen.queryByRole("button", { name: "Word" })).toBeNull();
  });

  it("c'è sull'offerta modificabile, e apre il plugin con l'offerta", () => {
    plugins.lista = [{ nome: "QuoteDOCX", voce: "Documenti offerta", anchors: { deal: true } }];
    const assign = vi.fn();
    vi.stubGlobal("location", { ...window.location, assign });
    mostraOfferta(offerta(true));
    screen.getByRole("button", { name: "Word" }).click();
    expect(assign).toHaveBeenCalledWith("/estensioni/QuoteDOCX?offerta=d1");
    vi.unstubAllGlobals();
  });

  it("non c'è in sola lettura, né su un task che non è un'offerta", () => {
    plugins.lista = [{ nome: "QuoteDOCX", voce: "Documenti offerta", anchors: { deal: true } }];
    const { unmount } = mostraOfferta(offerta(false));
    expect(screen.queryByRole("button", { name: "Word" })).toBeNull();
    unmount();
    mostraOfferta(offerta(true, "ADMIN"));
    expect(screen.queryByRole("button", { name: "Word" })).toBeNull();
  });
});
