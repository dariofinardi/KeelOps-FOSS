import i18n from "@/lib/i18n";

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public code?: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

/**
 * **Un 403 dice che i permessi sono cambiati sotto i piedi.**
 *
 * Succede tutte le volte che l'elevazione ad amministratore scade con la
 * pagina aperta: l'interfaccia continua a offrire comandi che il server non
 * concede più, e il primo clic finisce in un rifiuto senza spiegazione
 * (26/08/2026, aggiungendo uno stato all'Area tecnica). Chi registra qui viene
 * avvisato e rilegge l'utente, così i comandi che non valgono più spariscono.
 *
 * Non si registra l'utente stesso: rileggerlo dopo il suo 403 sarebbe un giro
 * in tondo.
 */
let suRifiuto: (() => void) | null = null;
export function onForbidden(handler: (() => void) | null): void {
  suRifiuto = handler;
}

interface ApiOptions {
  method?: "GET" | "POST" | "PATCH" | "PUT" | "DELETE";
  body?: unknown;
}

/**
 * La lingua ATTIVA nell'interfaccia, mandata a ogni richiesta: il server la usa
 * per tradurre i messaggi d'errore nella lingua che l'utente sta davvero
 * vedendo — che con la preferenza "automatica" la sa solo il browser.
 */
function localeHeader(): Record<string, string> {
  return { "X-Locale": i18n.language };
}

export async function api<T>(path: string, options: ApiOptions = {}): Promise<T> {
  const response = await fetch(path, {
    method: options.method ?? "GET",
    headers: {
      ...localeHeader(),
      ...(options.body !== undefined ? { "Content-Type": "application/json" } : {}),
    },
    body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
    credentials: "same-origin",
  });
  return readResponse<T>(response, path);
}

/**
 * Caricamento di un file. Sta qui e non nei singoli moduli perché il messaggio
 * d'errore del server è l'unica cosa che dice all'utente **perché** il file non
 * è passato ("troppo grande", "tipo non ammesso"): era riscritto in cinque
 * punti, e bastava una copia distratta per far comparire "Errore 400".
 */
export async function apiUpload<T>(
  path: string,
  file: File,
  field = "file",
  /**
   * Campi che viaggiano con il file. Vanno **prima** del file: il server legge
   * il modulo in ordine, e un campo dopo il file lo troverebbe troppo tardi.
   */
  fields: Record<string, string> = {},
): Promise<T> {
  const form = new FormData();
  for (const [name, value] of Object.entries(fields)) form.append(name, value);
  form.append(field, file);
  const response = await fetch(path, {
    method: "POST",
    headers: localeHeader(),
    body: form,
    credentials: "same-origin",
  });
  return readResponse<T>(response, path);
}

/** Risposta del server: o il contenuto, o l'errore che il server ha scritto. */
async function readResponse<T>(response: Response, path = ""): Promise<T> {
  if (response.status === 204) return undefined as T;

  const data: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const body = data && typeof data === "object" ? (data as Record<string, unknown>) : null;
    if (response.status === 503 && body?.maintenance === true) {
      // KeelOps è stato messo in manutenzione mentre l'app era aperta: la
      // ricarica porta alla pagina di cortesia (che poi rientra da sola).
      // Un solo reload: se anche la ricarica trovasse l'app, niente cicli.
      if (!sessionStorage.getItem("kancrm-maintenance-reload")) {
        sessionStorage.setItem("kancrm-maintenance-reload", "1");
        window.location.reload();
      }
    } else {
      sessionStorage.removeItem("kancrm-maintenance-reload");
    }
    if (response.status === 403 && !path.startsWith("/api/auth/me")) suRifiuto?.();
    const message = typeof body?.message === "string" ? body.message : `Errore ${response.status}`;
    const code = typeof body?.error === "string" ? body.error : undefined;
    throw new ApiError(response.status, message, code);
  }
  return data as T;
}
