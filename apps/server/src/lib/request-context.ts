import { AsyncLocalStorage } from "node:async_hooks";

/**
 * Contesto per-richiesta: una mappa memoizzata che vive per la durata di una
 * singola richiesta HTTP. Serve a non ripetere query identiche nello stesso giro
 * (es. `canSeeScope` chiamato in un ciclo, o i 4 scope di `/api/auth/me`). Fuori
 * da una richiesta (cron, avvio) lo store è assente e non si memoizza nulla.
 */
const storage = new AsyncLocalStorage<Map<string, unknown>>();

/** Esegue `fn` dentro un nuovo contesto di richiesta (con la sua mappa cache). */
export function runWithRequestContext<T>(fn: () => T): T {
  return storage.run(new Map(), fn);
}

/**
 * Memoizza `compute` sotto `key` per la richiesta corrente. Cachea la Promise,
 * così anche chiamate concorrenti (Promise.all) condividono un solo calcolo.
 * Senza contesto attivo esegue `compute` senza memoizzare.
 */
export function cached<T>(key: string, compute: () => Promise<T>): Promise<T> {
  const store = storage.getStore();
  if (!store) return compute();
  const existing = store.get(key);
  if (existing !== undefined) return existing as Promise<T>;
  const promise = compute();
  store.set(key, promise);
  return promise;
}

/**
 * Annota qualcosa da fare **dopo** la richiesta, non durante.
 *
 * Serve agli avvisi di modifica: chi tocca un record lo sa mentre è dentro una
 * transazione, ma annunciarlo lì sarebbe una bugia — la transazione può ancora
 * fallire, e i browser rinfrescherebbero per vedere il vecchio dato. Si annota
 * qui e si spedisce a risposta conclusa (vedi `onResponse` in `app.ts`), quando
 * il commit c'è stato per certo.
 *
 * Fuori da una richiesta (cron, avvio) non c'è niente da annotare: il valore si
 * perde, e va bene così — non c'è nessuno a cui rispondere.
 */
export function noteForRequest<T>(key: string, value: T): void {
  const store = storage.getStore();
  if (!store) return;
  const list = (store.get(key) as T[] | undefined) ?? [];
  list.push(value);
  store.set(key, list);
}

/** Ritira quanto annotato, svuotando: si spedisce una volta sola. */
export function takeNotes<T>(key: string): T[] {
  const store = storage.getStore();
  if (!store) return [];
  const list = (store.get(key) as T[] | undefined) ?? [];
  store.delete(key);
  return list;
}
