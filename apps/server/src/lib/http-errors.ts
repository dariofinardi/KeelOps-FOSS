export type ErrorParams = Record<string, string | number>;

interface HttpError extends Error {
  statusCode: number;
  code: string;
  /** La frase italiana come CHIAVE di traduzione (con eventuali `{{segnaposto}}`). */
  i18nKey: string;
  /** I valori dei segnaposto: dati (titoli, nomi, numeri) o parole traducibili. */
  i18nParams?: ErrorParams;
}

/** Riempie i `{{segnaposto}}`: serve al `.message` italiano (log, e fallback). */
function fill(template: string, params?: ErrorParams): string {
  if (!params) return template;
  return template.replace(/\{\{(\w+)\}\}/g, (_, key: string) =>
    params[key] != null ? String(params[key]) : `{{${key}}}`,
  );
}

/**
 * Un errore HTTP il cui messaggio è una **chiave di traduzione**: `message` è la
 * frase italiana (con `{{segnaposto}}` per i valori variabili), e il gestore
 * degli errori la traduce nella lingua di chi ha fatto la richiesta. Il
 * `.message` dell'`Error` resta l'italiano già riempito, per i log.
 */
function httpError(
  statusCode: number,
  code: string,
  message: string,
  params?: ErrorParams,
): HttpError {
  const error = new Error(fill(message, params)) as HttpError;
  error.statusCode = statusCode;
  error.code = code;
  error.i18nKey = message;
  error.i18nParams = params;
  return error;
}

export const badRequest = (message: string, params?: ErrorParams) =>
  httpError(400, "BAD_REQUEST", message, params);
export const unauthorized = (message = "Autenticazione richiesta", params?: ErrorParams) =>
  httpError(401, "UNAUTHORIZED", message, params);
export const forbidden = (message = "Operazione non consentita", params?: ErrorParams) =>
  httpError(403, "FORBIDDEN", message, params);
export const notFound = (message = "Risorsa non trovata", params?: ErrorParams) =>
  httpError(404, "NOT_FOUND", message, params);
/** 423: l'account è chiuso per un po' dopo troppe password sbagliate. */
export const locked = (message: string, params?: ErrorParams) =>
  httpError(423, "LOCKED", message, params);
export const conflict = (message: string, code = "CONFLICT", params?: ErrorParams) =>
  httpError(409, code, message, params);
/**
 * La richiesta è ben formata ma **non si può portare a termine**: il caso tipico
 * è un riferimento che non corrisponde a niente. Distinguerlo da un 400 (dati
 * malformati) e da un 401 (chi chiama non è autenticato) serve a chi integra:
 * l'API delle integrazioni la usa per dire "quell'indirizzo non è di nessuno".
 */
export const unprocessable = (message: string, code: string, params?: ErrorParams) =>
  httpError(422, code, message, params);
