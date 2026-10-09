import { afterEach, describe, expect, it, vi } from "vitest";
import { watchStaleBuild } from "./stale-build";

const preloadError = () => {
  const event = new Event("vite:preloadError", { cancelable: true });
  window.dispatchEvent(event);
  return event;
};

let stop: (() => void) | null = null;

afterEach(() => {
  stop?.();
  stop = null;
  sessionStorage.clear();
});

describe("pagina rimasta indietro rispetto al rilascio", () => {
  it("ricarica quando un pezzo della build non si carica più", () => {
    const reload = vi.fn();
    stop = watchStaleBuild(reload);
    const event = preloadError();
    expect(reload).toHaveBeenCalledTimes(1);
    // L'errore non deve anche finire in console come guasto non gestito.
    expect(event.defaultPrevented).toBe(true);
  });

  it("ricarica una volta sola: se non è il rilascio, non si entra in ciclo", () => {
    // Rete assente o server giù: ricaricare all'infinito non aiuterebbe nessuno.
    const reload = vi.fn();
    stop = watchStaleBuild(reload);
    preloadError();
    preloadError();
    preloadError();
    expect(reload).toHaveBeenCalledTimes(1);
  });
});

describe("il foglio di stile che non c'è più", () => {
  afterEach(() => sessionStorage.clear());

  /** Un `<link>` che fallisce: l'errore non bolle, arriva in cattura. */
  const linkRotto = (rel: string) => {
    const link = document.createElement("link");
    link.rel = rel;
    document.head.append(link);
    link.dispatchEvent(new Event("error", { bubbles: false, cancelable: true }));
    link.remove();
  };

  it("una pagina vecchia si ricarica anche se a mancare è solo il CSS", () => {
    // Senza chunk nuovi da caricare non arriva nessun `preloadError`: la
    // pagina resta in piedi senza forma e nessuno la rimette a posto
    // (20/08/2026).
    const reload = vi.fn();
    const stop = watchStaleBuild(reload);
    linkRotto("stylesheet");
    expect(reload).toHaveBeenCalledTimes(1);
    stop();
  });

  it("un altro tipo di link che fallisce non ricarica niente", () => {
    // Un'icona o un preconnect che non rispondono non dicono che la build è
    // vecchia: ricaricare per quelli sarebbe un giro a vuoto.
    const reload = vi.fn();
    const stop = watchStaleBuild(reload);
    linkRotto("icon");
    expect(reload).not.toHaveBeenCalled();
    stop();
  });

  it("si ricarica una volta sola, come per i chunk", () => {
    const reload = vi.fn();
    const stop = watchStaleBuild(reload);
    linkRotto("stylesheet");
    linkRotto("stylesheet");
    expect(reload).toHaveBeenCalledTimes(1);
    stop();
  });
});
