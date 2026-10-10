// Copyright (c) 2026 Jugaad s.r.l.
// SPDX-License-Identifier: AGPL-3.0-only

import ExcelJS from "exceljs";
import type { ImportType } from "@kancrm/shared";
import { intestazioniDeiDialetti, rigaDaScartare } from "./dialects-core";

interface TemplateColumn {
  header: string;
  width: number;
  example: string;
}

const TEMPLATES: Record<ImportType, { sheet: string; columns: TemplateColumn[] }> = {
  tasks: {
    sheet: "Task",
    columns: [
      { header: "Titolo", width: 40, example: "Esempio - Versamento F24" },
      { header: "Descrizione", width: 50, example: "Testo libero (opzionale)" },
      { header: "Scadenza", width: 14, example: "15/09/2026" },
      // Nessun nome preciso: gli stati li configura ogni azienda. Vuoto = stato
      // iniziale della categoria; "fatto" e "non rinnova più" sono riconosciuti.
      { header: "Stato", width: 18, example: "(vuoto = da lavorare)" },
      { header: "Tipo attività", width: 24, example: "Scadenza fiscale" },
      { header: "Assegnatario (nome o email)", width: 30, example: "Anna Bianchi" },
      { header: "Supervisore (nome o email)", width: 30, example: "" },
      { header: "Frequenza", width: 16, example: "" },
      { header: "Link", width: 40, example: "https://drive.google.com/…" },
    ],
  },
  deals: {
    sheet: "Offerte",
    columns: [
      { header: "Titolo", width: 40, example: "Esempio - Fornitura gestionale" },
      { header: "Fase", width: 20, example: "Trattativa" },
      { header: "Azienda", width: 30, example: "ACME S.r.l." },
      { header: "Contatto", width: 26, example: "Paolo Rossi" },
      { header: "Valore", width: 12, example: "25000" },
      { header: "Probabilità", width: 12, example: "60" },
      { header: "Chiusura prevista", width: 16, example: "15/12/2026" },
      { header: "Commerciale (email)", width: 28, example: "" },
      { header: "Descrizione", width: 50, example: "" },
    ],
  },
  contacts: {
    sheet: "Contatti",
    columns: [
      { header: "Nome", width: 20, example: "Esempio - Paolo" },
      { header: "Cognome", width: 20, example: "Rossi" },
      { header: "Email", width: 30, example: "paolo.rossi@acme.example" },
      { header: "Telefono", width: 20, example: "+39 02 1234567" },
      { header: "Ruolo", width: 24, example: "Direttore acquisti" },
      { header: "Azienda", width: 30, example: "ACME S.r.l." },
    ],
  },
  companies: {
    sheet: "Aziende",
    columns: [
      { header: "Ragione sociale", width: 34, example: "Esempio - ACME S.r.l." },
      { header: "Partita IVA", width: 18, example: "IT01234567890" },
      { header: "Città", width: 20, example: "Milano" },
      { header: "Note", width: 50, example: "" },
    ],
  },
};

const INSTRUCTIONS = [
  "Istruzioni:",
  "- Compila una riga per ogni elemento da importare (sotto la riga di intestazione).",
  '- ELIMINA la riga di esempio (le righe che iniziano con "Esempio" vengono ignorate).',
  "- Le date sono in formato GG/MM/AAAA (o formato data di Excel).",
  "- Stato / Fase / Azienda / Contatto: se il valore non esiste viene creato o usato il default.",
  '- Assegnatario/Supervisore/Commerciale: nome completo (es. "Anna Bianchi") o email di un utente esistente.',
  "- Tipo attività (Task): se non esiste viene creato nella categoria Amministrative.",
  '- Link (Task): un URL; con "Titolo - URL" il testo prima del trattino diventa il titolo.',
  "- Frequenza (Task): se valorizzata (Settimanale, Quindicinale, Mensile, Bimestrale,",
  "  Trimestrale, Semestrale, Annuale) il task diventa RICORRENTE a partire dalla Scadenza;",
  "  altrimenti è un task singolo.",
  "- Reimportare è sicuro: un task/ricorrenza con gli stessi dati (titolo, scadenza, tipo,",
  "  assegnatario…) già presente viene SALTATO, non duplicato.",
  "- I duplicati (stessa email contatto, stessa ragione sociale) vengono saltati.",
];

/** Genera il template .xlsx per il tipo richiesto. */
export async function buildTemplate(type: ImportType): Promise<Buffer> {
  const definition = TEMPLATES[type];
  const workbook = new ExcelJS.Workbook();

  const sheet = workbook.addWorksheet(definition.sheet);
  sheet.columns = definition.columns.map((column) => ({
    header: column.header,
    width: column.width,
  }));
  sheet.getRow(1).font = { bold: true };
  sheet.addRow(definition.columns.map((column) => column.example));
  sheet.getRow(2).font = { italic: true, color: { argb: "FF888888" } };

  const help = workbook.addWorksheet("Istruzioni");
  help.getColumn(1).width = 100;
  for (const line of INSTRUCTIONS) help.addRow([line]);
  help.getRow(1).font = { bold: true };

  return Buffer.from(await workbook.xlsx.writeBuffer());
}

export interface ParsedRow {
  rowNumber: number;
  values: Record<string, string>;
  dateValues: Record<string, Date | null>;
}

/**
 * Una cella ExcelJS come testo, qualunque forma abbia: formula (il risultato),
 * rich text (concatenato), hyperlink (l'indirizzo), data (ISO), scalare
 * (ripulito ai bordi). Era in due copie — questa e quella dell'import degli
 * update Monday — divergenti di un caso a testa: questa non sapeva gli
 * hyperlink, l'altra non ripuliva. Ora è una, col meglio di entrambe.
 */
export function cellToString(value: ExcelJS.CellValue): string {
  if (value === null || value === undefined) return "";
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "object") {
    const objectValue = value as {
      result?: unknown;
      text?: unknown;
      richText?: unknown;
      hyperlink?: unknown;
    };
    if (objectValue.result !== undefined) return String(objectValue.result);
    if (typeof objectValue.text === "string") return objectValue.text;
    if (Array.isArray(objectValue.richText)) {
      return (objectValue.richText as Array<{ text: string }>).map((r) => r.text).join("");
    }
    if (typeof objectValue.hyperlink === "string") return objectValue.hyperlink;
    return "";
  }
  return String(value).trim();
}

/** GG/MM/AAAA, AAAA-MM-GG o Date di Excel → Date a mezzanotte UTC. */
export function parseDateValue(value: ExcelJS.CellValue): Date | null {
  if (value instanceof Date) {
    return new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate()));
  }
  const text = cellToString(value).trim();
  if (!text) return null;
  const italian = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(text);
  if (italian) {
    return new Date(Date.UTC(Number(italian[3]), Number(italian[2]) - 1, Number(italian[1])));
  }
  const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(text);
  if (iso) {
    return new Date(Date.UTC(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3])));
  }
  return null;
}

// Intestazioni riconosciute del tracciato KeelOps; quelle degli export di altri
// strumenti le aggiungono i dialetti (dialects.ts).
const KNOWN_HEADERS = new Set([
  "titolo",
  "nome",
  "descrizione",
  "scadenza",
  "stato",
  "tipo attività",
  "assegnatario (nome o email)",
  "assegnatario (email)",
  "supervisore (nome o email)",
  "supervisore (email)",
  "frequenza",
  "link",
  "fase",
  "azienda",
  "contatto",
  "ragione sociale",
]);

function normalizeHeader(raw: string): string {
  return raw.trim().toLowerCase();
}

/**
 * Legge il file xlsx e restituisce le righe come mappa intestazione → valore.
 * La riga di intestazione viene individuata anche se non è la prima (gli export
 * Monday hanno titolo/descrizione sopra). Righe vuote, di esempio, di gruppo e
 * intestazioni ripetute vengono scartate.
 */
export async function parseWorkbook(buffer: Buffer): Promise<ParsedRow[]> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer as unknown as ArrayBuffer);
  const sheet = workbook.worksheets[0];
  if (!sheet) return [];
  const conosciute = new Set([...KNOWN_HEADERS, ...intestazioniDeiDialetti()]);
  const isKnownHeader = (text: string) => conosciute.has(text);

  // Riga di intestazione = quella con più colonne riconosciute (≥1) tra le prime 15.
  // Copre sia il tracciato KeelOps (intestazioni in riga 1) sia gli export Monday
  // (titolo/descrizione/gruppo sopra, intestazioni più in basso).
  let headerRowNumber = 0;
  let bestMatches = 0;
  const headers: string[] = [];
  for (let r = 1; r <= Math.min(sheet.rowCount, 15); r++) {
    const candidate: string[] = [];
    let matches = 0;
    sheet.getRow(r).eachCell((cell, col) => {
      const norm = normalizeHeader(cellToString(cell.value));
      candidate[col] = norm;
      if (conosciute.has(norm)) matches += 1;
    });
    if (matches > bestMatches) {
      bestMatches = matches;
      headerRowNumber = r;
      headers.length = 0;
      candidate.forEach((h, col) => (headers[col] = h));
    }
  }
  if (headerRowNumber === 0) return [];

  const rows: ParsedRow[] = [];
  sheet.eachRow((row, rowNumber) => {
    if (rowNumber <= headerRowNumber) return;
    const values: Record<string, string> = {};
    const dateValues: Record<string, Date | null> = {};
    let filledCount = 0;
    row.eachCell({ includeEmpty: false }, (cell, col) => {
      const header = headers[col];
      if (!header) return;
      const text = cellToString(cell.value).trim();
      values[header] = text;
      dateValues[header] = parseDateValue(cell.value);
      if (text !== "") filledCount += 1;
    });
    if (filledCount === 0) return;
    // Riga di esempio: il primo valore non vuoto inizia con "Esempio".
    const firstValue = Object.values(values).find((v) => v !== "") ?? "";
    if (firstValue.toLowerCase().startsWith("esempio")) return;
    // Righe che non sono dati per qualche dialetto (gruppi, intestazioni ripetute).
    if (rigaDaScartare({ values, filledCount, bestMatches, isKnownHeader })) return;
    rows.push({ rowNumber, values, dateValues });
  });
  return rows;
}
