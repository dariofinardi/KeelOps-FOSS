import { describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import * as XLSX from "xlsx";
import { AttachmentViewer } from "./AttachmentViewer";

/**
 * I lettori dei formati testuali, provati **sul percorso vero**: il componente
 * scarica con `fetch` e disegna, e qui si guarda cosa finisce nel DOM — non
 * quale ramo è stato scelto.
 *
 * Onestà su cosa questo copre: jsdom non è un browser, e il guasto che ha fatto
 * cambiare libreria (exceljs serve ai browser un bundle UMD e si rompeva con
 * "Cannot read properties of undefined (reading 'sheets')", 18/08/2026) qui non
 * si sarebbe comunque visto, perché sotto vitest exceljs risolveva l'entry di
 * node. Il motivo per cui il rischio non c'è più è un altro: SheetJS carica lo
 * **stesso file** in node e nel browser, quindi ciò che passa qui è ciò che
 * gira là.
 */

/** Un vero .xlsx, costruito in memoria: nessun file di supporto da tenere. */
function xlsxDiProva(): ArrayBuffer {
  const foglio = XLSX.utils.aoa_to_sheet([
    ["Articolo", "Prezzo"],
    ["Vite M4", "0,12"],
    ["<script>alert(1)</script>", "9,99"],
  ]);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, foglio, "Listino");
  return XLSX.write(wb, { type: "array", bookType: "xlsx" }) as ArrayBuffer;
}

/**
 * Ogni attesa qui sta dietro un import dinamico (SheetJS, marked,
 * highlight.js): il limite predefinito di un secondo non lascia margine, e su
 * una macchina carica questi test hanno già fermato un deploy per un ritardo
 * che non riguardava il codice. Qui si guarda **cosa finisce nel DOM**, non
 * quanto ci mette.
 */
const ATTESA = { timeout: 15000 };

const serve = (dati: ArrayBuffer | string) => {
  const buffer = typeof dati === "string" ? new TextEncoder().encode(dati).buffer : dati;
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({ ok: true, arrayBuffer: async () => buffer } as Response),
  );
};

describe("lettore interno", () => {
  it("un foglio di calcolo diventa una tabella leggibile", async () => {
    serve(xlsxDiProva());
    render(<AttachmentViewer url="/x" name="Articoli.xlsx" mimeType={null} />);

    // Il nome del foglio e le celle, non un errore.
    await waitFor(() => expect(screen.getByText("Listino")).toBeInTheDocument(), ATTESA);
    expect(screen.getByText("Articolo")).toBeInTheDocument();
    expect(screen.getByText("Vite M4")).toBeInTheDocument();
    // La prima riga è intestazione.
    expect(screen.getByText("Articolo").tagName).toBe("TH");
    // Il contenuto è testo di qualcun altro: resta testo.
    const cella = screen.getByText("<script>alert(1)</script>");
    expect(cella.querySelector("script")).toBeNull();
  });

  it("un foglio enorme non si apre: si scarica, e il parser non lo tocca", async () => {
    // Sopra il limite l'anteprima non parsa niente: sono le prime duecento
    // righe che si mostrano, ma per arrivarci il parser mastica tutto il file —
    // e un file costruito apposta userebbe proprio quello (01/09/2026).
    serve(new ArrayBuffer(6 * 1024 * 1024));
    render(<AttachmentViewer url="/x" name="Listone.xlsx" mimeType={null} />);
    await waitFor(
      () => expect(screen.getByText(/troppo grande|too large/i)).toBeInTheDocument(),
      ATTESA,
    );
    // Nessuna tabella disegnata: il file non è nemmeno stato letto.
    expect(document.querySelector("table")).toBeNull();
  });

  it("il testo semplice si legge senza librerie", async () => {
    serve("prima riga\nseconda riga");
    render(<AttachmentViewer url="/x" name="note.txt" mimeType="text/plain" />);
    await waitFor(() => expect(screen.getByText(/prima riga/)).toBeInTheDocument(), ATTESA);
  });

  it("il markdown butta l'HTML grezzo e neutralizza i link non web", async () => {
    serve(
      "# Titolo\n\n<img src=x onerror=alert(1)>\n\n[cattivo](javascript:alert(1)) e [buono](https://example.com)",
    );
    const { container } = render(<AttachmentViewer url="/x" name="README.md" mimeType={null} />);
    await waitFor(() => expect(screen.getByText("Titolo")).toBeInTheDocument(), ATTESA);
    // L'HTML dentro il documento non si onora in un'anteprima.
    expect(container.querySelector("img")).toBeNull();
    const link = container.querySelectorAll("a");
    expect(link).toHaveLength(1);
    expect(link[0]!.getAttribute("href")).toBe("https://example.com");
    expect(link[0]!.getAttribute("rel")).toContain("noopener");
    // Quello con javascript: è diventato testo.
    expect(screen.getByText(/cattivo/)).toBeInTheDocument();
  });

  it("il codice esce colorato, con il linguaggio preso dall'estensione", async () => {
    serve("const saluto = 'ciao';\n");
    const { container } = render(<AttachmentViewer url="/x" name="saluto.ts" mimeType={null} />);
    await waitFor(() => expect(container.querySelector("code.hljs")).not.toBeNull(), ATTESA);
    expect(container.querySelector("code")!.className).toContain("language-typescript");
    // I token colorati esistono: è il segno che l'evidenziatore ha lavorato.
    expect(container.querySelectorAll(".hljs-keyword, .hljs-string").length).toBeGreaterThan(0);
  });

  it("un'estensione sconosciuta non è un errore: testo senza colori", async () => {
    serve("qualcosa di ignoto");
    const { container } = render(
      <AttachmentViewer url="/x" name="appunti.xyz" mimeType="text/plain" />,
    );
    await waitFor(() => expect(screen.getByText(/qualcosa di ignoto/)).toBeInTheDocument(), ATTESA);
    expect(container.querySelector("code.hljs")).toBeNull();
  });
});
