// Copyright (c) 2026 Jugaad s.r.l.
// SPDX-License-Identifier: AGPL-3.0-only

/** Parser CSV minimale: gestisce campi quotati, virgole/punti e virgola, CRLF. */
export function parseCsv(text: string): string[][] {
  const firstLine = text.slice(0, text.indexOf("\n"));
  const separator =
    (firstLine.match(/;/g)?.length ?? 0) > (firstLine.match(/,/g)?.length ?? 0) ? ";" : ",";

  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  for (let i = 0; i < text.length; i += 1) {
    const char = text[i]!;
    if (inQuotes) {
      if (char === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 1;
        } else {
          inQuotes = false;
        }
      } else {
        field += char;
      }
    } else if (char === '"') {
      inQuotes = true;
    } else if (char === separator) {
      row.push(field);
      field = "";
    } else if (char === "\n") {
      row.push(field.replace(/\r$/, ""));
      rows.push(row);
      row = [];
      field = "";
    } else {
      field += char;
    }
  }
  if (field !== "" || row.length > 0) {
    row.push(field.replace(/\r$/, ""));
    rows.push(row);
  }
  return rows.filter((r) => r.some((cell) => cell.trim() !== ""));
}

export interface ParsedContact {
  firstName: string;
  lastName: string;
  email: string | null;
  phone: string | null;
  companyName: string | null;
}

// Intestazioni riconosciute (export Google Contacts + varianti comuni/italiane).
const HEADER_ALIASES: Record<keyof Omit<ParsedContact, "companyName"> | "companyName", string[]> = {
  firstName: ["first name", "given name", "nome"],
  lastName: ["last name", "family name", "cognome"],
  email: ["e-mail 1 - value", "e-mail address", "email", "e-mail"],
  phone: ["phone 1 - value", "phone number", "telefono", "phone"],
  companyName: ["organization 1 - name", "organization name", "company", "azienda", "società"],
};

export function parseContactsCsv(text: string): ParsedContact[] {
  const rows = parseCsv(text);
  if (rows.length < 2) return [];
  const header = rows[0]!.map((cell) => cell.trim().toLowerCase());

  const columnOf = (aliases: string[]): number =>
    header.findIndex((name) => aliases.includes(name));
  const columns = {
    firstName: columnOf(HEADER_ALIASES.firstName),
    lastName: columnOf(HEADER_ALIASES.lastName),
    email: columnOf(HEADER_ALIASES.email),
    phone: columnOf(HEADER_ALIASES.phone),
    companyName: columnOf(HEADER_ALIASES.companyName),
  };

  const cell = (row: string[], index: number): string | null => {
    if (index < 0) return null;
    const value = row[index]?.trim() ?? "";
    return value === "" ? null : value;
  };

  const contacts: ParsedContact[] = [];
  for (const row of rows.slice(1)) {
    const firstName = cell(row, columns.firstName);
    const lastName = cell(row, columns.lastName);
    const email = cell(row, columns.email);
    if (!firstName && !lastName && !email) continue;
    contacts.push({
      firstName: firstName ?? "",
      lastName: lastName ?? (firstName ? "" : (email ?? "")),
      email,
      phone: cell(row, columns.phone),
      companyName: cell(row, columns.companyName),
    });
  }
  return contacts;
}
