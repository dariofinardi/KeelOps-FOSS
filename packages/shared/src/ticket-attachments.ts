// Copyright (c) 2026 Jugaad s.r.l.
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Che cosa si può allegare a una **richiesta di supporto**: PDF, archivi ZIP,
 * documenti Word, immagini e — dal 18/08/2026 — **video e audio**: la
 * registrazione dello schermo che mostra il difetto *è* la segnalazione, e
 * girarla per email perché il campo non la accettava era il modo più lento di
 * dire la stessa cosa.
 *
 * La regola sta qui, condivisa, perché deve valere in tre posti che altrimenti
 * divergerebbero: l'attributo `accept` del selettore di file (che *suggerisce*),
 * il controllo prima dell'invio (che *spiega*) e il controllo del server (che
 * *decide*). Il primo si aggira, il secondo si salta: l'unico che conta è il
 * terzo, e legge questa stessa lista.
 *
 * Si guarda **l'estensione**, non solo il tipo MIME: quello lo dichiara il
 * browser (o il client dell'integrazione) e su ZIP e DOCX è notoriamente ballerino
 * — `application/octet-stream`, `application/x-zip-compressed`, vuoto. Il nome
 * del file invece arriva sempre.
 *
 * Fuori di proposito: **SVG**. È un'immagine per modo di dire — è un documento
 * che può contenere script, e il visualizzatore serve le immagini _inline_.
 */

/**
 * **La lista si allunga senza un rilascio.** I formati di casa cambiano con i
 * prodotti — `.padmu` e `.padmu2` sono i documenti di PadMu, e un cliente che
 * segnala un difetto allega il documento che lo mostra — e ogni volta serviva
 * toccare questo file e pubblicare. Le estensioni **in più** si configurano
 * dalla pagina Sistema e arrivano qui come parametro: la lista di sotto resta
 * il minimo che vale comunque, anche a configurazione vuota o irraggiungibile.
 */

/** Estensioni ammesse, minuscole e col punto. */
export const TICKET_ATTACHMENT_EXTENSIONS = [
  ".pdf",
  ".zip",
  ".doc",
  ".docx",
  // Tabelle: l'integrazione amministrativa allega l'estratto delle voci da
  // fatturare (31/08/2026); i clienti, dal portale, il foglio Excel con i
  // dati che riproducono il difetto (14/09/2026).
  ".csv",
  ".xls",
  ".xlsx",
  // Testo semplice: il log di un'applicazione, l'estratto di una console, un
  // elenco copiato. Chi segnala dal Microsoft Store allega il log dell'app
  // (19/09/2026), e finora andava rinominato in .zip per passare.
  ".txt",
  ".log",
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".webp",
  ".bmp",
  ".heic",
  ".heif",
  // Registrazioni: schermo, voce, memo. Formati che browser e telefoni
  // producono da soli, senza chiedere niente a chi segnala.
  ".mp4",
  ".m4v",
  ".mov",
  ".webm",
  ".mkv",
  ".mp3",
  ".m4a",
  ".wav",
  ".ogg",
  // Documenti dei nostri prodotti: chi segnala un difetto di PadMu allega il
  // file che lo mostra, e mandarlo per email era il modo più lento di dirlo.
  ".padmu",
  ".padmu2",
] as const;

/**
 * Normalizza quello che si scrive in configurazione: «padmu, .PADMU2  zip» →
 * `[".padmu", ".padmu2", ".zip"]`. Chi lo compila non deve ricordarsi il punto
 * né la minuscola.
 */
export function parseExtraExtensions(value: string | null | undefined): string[] {
  return (value ?? "")
    .split(/[\s,;]+/)
    .map((pezzo) => pezzo.trim().toLowerCase())
    .filter((pezzo) => pezzo !== "" && pezzo !== ".")
    .map((pezzo) => (pezzo.startsWith(".") ? pezzo : `.${pezzo}`))
    .filter((pezzo) => /^\.[a-z0-9]{1,12}$/.test(pezzo));
}

/** Le estensioni che valgono davvero: quelle di casa più quelle configurate. */
export function allowedAttachmentExtensions(extra: readonly string[] = []): string[] {
  return [...new Set([...TICKET_ATTACHMENT_EXTENSIONS, ...extra])];
}

/** Valore dell'attributo `accept` di `<input type="file">`. */
export const TICKET_ATTACHMENT_ACCEPT = TICKET_ATTACHMENT_EXTENSIONS.join(",");

/** Lo stesso, con le estensioni configurate in più. */
export function attachmentAccept(extra: readonly string[] = []): string {
  return allowedAttachmentExtensions(extra).join(",");
}

/**
 * Elenco leggibile per i messaggi all'utente. **Dev'essere vero**: dire "PDF,
 * ZIP, Word, immagini, video e audio" mentre un `.padmu` passa lascia un
 * cliente a credere che non possa allegarlo, e a mandarlo per email.
 */
export const TICKET_ATTACHMENT_LABEL =
  "PDF, ZIP, Word, Excel, CSV, testo, immagini, video, audio e documenti PadMu";

/** L'estensione del nome, in minuscolo e col punto (stringa vuota se non c'è). */
export function extensionOf(filename: string): string {
  const dot = filename.lastIndexOf(".");
  return dot > 0 ? filename.slice(dot).toLowerCase() : "";
}

/**
 * Il file rientra in un elenco di estensioni? È la forma che serve al browser,
 * che l'elenco valido se lo trova già pronto nell'utente e non deve rifarne il
 * conto — un secondo conto è una seconda verità.
 */
export function matchesExtensions(filename: string, extensions: readonly string[]): boolean {
  return extensions.includes(extensionOf(filename));
}

/** Il file si può allegare a una richiesta di supporto? */
export function isAllowedTicketAttachment(
  filename: string,
  extra: readonly string[] = [],
): boolean {
  return allowedAttachmentExtensions(extra).includes(extensionOf(filename));
}

/**
 * Il primo file non ammesso di un elenco, o `null` se vanno tutti bene: serve a
 * dire *quale* è il problema invece di un "formato non valido" che lascia a
 * indovinare quale dei sei file allegati sia quello sbagliato.
 */
export function firstRejectedAttachment(
  filenames: string[],
  extra: readonly string[] = [],
): string | null {
  return filenames.find((name) => !isAllowedTicketAttachment(name, extra)) ?? null;
}

/**
 * L'elenco a parole per i messaggi. Le estensioni configurate si aggiungono in
 * coda com'è scritto: un cliente a cui si dice "PDF, ZIP, Word, immagini, video
 * e audio" mentre il suo `.padmu` viene rifiutato legge una bugia.
 */
export function attachmentLabel(extra: readonly string[] = []): string {
  if (extra.length === 0) return TICKET_ATTACHMENT_LABEL;
  return `${TICKET_ATTACHMENT_LABEL}, ${extra.join(", ")}`;
}

/**
 * Cosa c'è **in più** in un elenco valido rispetto a quelle di casa, già pronto
 * da appendere a un messaggio: «, .dwg, .step». Il browser riceve l'elenco
 * completo e non gli extra, e rifarne il conto due volte darebbe due verità.
 */
export function extraDelleAmmesse(ammesse: readonly string[]): string {
  const extra = ammesse.filter(
    (estensione) => !(TICKET_ATTACHMENT_EXTENSIONS as readonly string[]).includes(estensione),
  );
  return extra.length === 0 ? "" : `, ${extra.join(", ")}`;
}

/**
 * Il tipo MIME che ci si aspetta per ogni estensione di casa. Serve alla
 * documentazione e a chi integra (`GET /api/integrations/attachment-formats`):
 * la decisione resta sull'estensione, perché il MIME lo dichiara il client e
 * sbaglia spesso; qui sta il valore *corretto* da mandare.
 */
export const TICKET_ATTACHMENT_MIME_TYPES: Record<
  (typeof TICKET_ATTACHMENT_EXTENSIONS)[number],
  string
> = {
  ".pdf": "application/pdf",
  ".zip": "application/zip",
  ".doc": "application/msword",
  ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ".csv": "text/csv",
  ".xls": "application/vnd.ms-excel",
  ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ".txt": "text/plain",
  ".log": "text/plain",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".bmp": "image/bmp",
  ".heic": "image/heic",
  ".heif": "image/heif",
  ".mp4": "video/mp4",
  ".m4v": "video/x-m4v",
  ".mov": "video/quicktime",
  ".webm": "video/webm",
  ".mkv": "video/x-matroska",
  ".mp3": "audio/mpeg",
  ".m4a": "audio/mp4",
  ".wav": "audio/wav",
  ".ogg": "audio/ogg",
  ".padmu": "application/octet-stream",
  ".padmu2": "application/octet-stream",
};
