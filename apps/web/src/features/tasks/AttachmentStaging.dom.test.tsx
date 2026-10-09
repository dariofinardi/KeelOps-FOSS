import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { useAttachmentStaging } from "./AttachmentStaging";

/**
 * La zona di rilascio: qui interessa che si **veda** quando il file le sta
 * sopra. Il bordo era quello predefinito, indistinguibile da qualunque altra
 * scatola della pagina, e la zona si trovava solo leggendo la scritta
 * (20/08/2026). Lo stile vive in una classe CSS perché i punti che la usano
 * sono tre e devono comportarsi allo stesso modo.
 */
// The Drive picker off: it would ask the server for the providers.
vi.mock("@/edition/slots", async (importOriginal) => {
  const vero = await importOriginal<typeof import("@/edition/slots")>();
  return { ...vero, slot: { ...vero.slot, useSelettoreDrive: undefined } };
});
vi.mock("@/components/ui/toast", () => ({ useToast: () => vi.fn() }));

function Banco() {
  const staging = useAttachmentStaging();
  return <>{staging.node}</>;
}

const zona = () => document.querySelector(".dropzone") as HTMLElement;

describe("la zona di rilascio dei file", () => {
  it("porta la classe condivisa, invece di uno stile riscritto ogni volta", () => {
    render(<Banco />);
    expect(zona()).not.toBeNull();
    expect(zona().className).not.toContain("dropzone-attiva");
  });

  it("si accende quando il file è sopra, e si spegne quando esce", () => {
    render(<Banco />);
    fireEvent.dragEnter(zona(), { dataTransfer: { types: ["Files"] } });
    expect(zona().className).toContain("dropzone-attiva");
    expect(screen.getByText("Rilascia i file")).toBeInTheDocument();

    fireEvent.dragLeave(zona(), { relatedTarget: document.body });
    expect(zona().className).not.toContain("dropzone-attiva");
  });

  it("trascinare del testo non la accende: non c'è niente da rilasciare", () => {
    render(<Banco />);
    fireEvent.dragEnter(zona(), { dataTransfer: { types: ["text/plain"] } });
    expect(zona().className).not.toContain("dropzone-attiva");
  });
});
