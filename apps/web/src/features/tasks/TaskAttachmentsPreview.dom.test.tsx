// Copyright (c) 2026 Jugaad s.r.l.
// SPDX-License-Identifier: AGPL-3.0-only

import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import type { Attachment } from "@kancrm/shared";
import { TaskAttachmentsPreview } from "./TaskAttachmentsPreview";

const openAttachment = vi.fn();
const readAttachment = vi.fn();
let attachments: Attachment[] = [];
let loading = false;

vi.mock("./useTasks", () => ({
  useTaskDetail: () => ({ data: { attachments }, isLoading: loading }),
  useOpenAttachment: () => openAttachment,
}));

// Il lettore interno è lo stesso dei monitor vendite: qui interessa solo che
// venga chiamato con l'allegato giusto.
vi.mock("@/features/attachments/useAttachmentReader", () => ({
  useAttachmentReader: () => ({ open: readAttachment, panel: null }),
}));

const attachment = (over: Partial<Attachment>): Attachment =>
  ({
    id: "a1",
    type: "FILE",
    name: "Preventivo.pdf",
    url: null,
    mimeType: null,
    size: null,
    createdAt: "",
    uploadedBy: { id: "u1", name: "Dario" },
    ...over,
  }) as Attachment;

describe("TaskAttachmentsPreview", () => {
  it("un link non espone l'URL: passa dal server, e non apre il task", () => {
    // Niente <a href>: l'apertura passa sempre dall'endpoint, così domani può
    // portare a un visualizzatore invece che al link grezzo.
    const link = attachment({
      id: "l1",
      type: "LINK",
      name: "Contratto su Drive",
      url: "https://drive/x",
    });
    attachments = [link];
    const onRowClick = vi.fn();
    render(
      <div onClick={onRowClick}>
        <TaskAttachmentsPreview taskId="t1" />
      </div>,
    );
    expect(screen.queryByRole("link")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Contratto su Drive" }));
    expect(readAttachment).toHaveBeenCalledWith(link.id);
    // Il clic non deve risalire alla riga: aprirebbe anche il dettaglio del task.
    expect(onRowClick).not.toHaveBeenCalled();
  });

  it("un file passa dalla stessa funzione del link", () => {
    const file = attachment({ id: "f1", name: "Preventivo.pdf" });
    attachments = [file];
    render(<TaskAttachmentsPreview taskId="t1" />);
    fireEvent.click(screen.getByRole("button", { name: "Preventivo.pdf" }));
    expect(readAttachment).toHaveBeenCalledWith(file.id);
  });

  it("leggere e scaricare sono due pulsanti distinti, e il nome legge", () => {
    // Il collega segnalava di doversi scaricare l'allegato per guardarlo: PDF,
    // Word e immagini si aprono a schermo (occhio), il download resta a fianco.
    attachments = [
      attachment({ id: "f1", name: "Preventivo.pdf", mimeType: "application/pdf" }),
      attachment({ id: "f2", name: "Screenshot.png", mimeType: "image/png" }),
      attachment({ id: "f3", name: "Verbale.docx", mimeType: null }),
      attachment({ id: "f4", name: "Sorgenti.zip", mimeType: "application/zip" }),
    ];
    render(<TaskAttachmentsPreview taskId="t1" />);
    for (const nome of ["Preventivo.pdf", "Screenshot.png", "Verbale.docx"]) {
      expect(screen.getByRole("button", { name: `Leggi ${nome}` })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: `Scarica ${nome}` })).toBeInTheDocument();
    }
    // Un formato che il lettore non disegna ha solo il download.
    expect(screen.queryByRole("button", { name: "Leggi Sorgenti.zip" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Scarica Sorgenti.zip" })).toBeInTheDocument();

    // Il clic sul nome è la lettura; la freccia scarica.
    fireEvent.click(screen.getByRole("button", { name: "Preventivo.pdf" }));
    expect(readAttachment).toHaveBeenCalledWith("f1");
    fireEvent.click(screen.getByRole("button", { name: "Scarica Preventivo.pdf" }));
    expect(openAttachment).toHaveBeenCalledWith(attachments[0]);
  });

  it("mentre carica lo dice, e senza allegati non occupa spazio", () => {
    loading = true;
    const { unmount } = render(<TaskAttachmentsPreview taskId="t1" />);
    expect(screen.getByText("Carico…")).toBeInTheDocument();
    unmount();

    loading = false;
    attachments = [];
    const { container } = render(<TaskAttachmentsPreview taskId="t1" />);
    expect(container).toBeEmptyDOMElement();
  });
});
