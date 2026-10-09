import { afterEach, describe, expect, it } from "vitest";
import { cancelJob, enqueue, listJobs, resetQueue } from "../src/modules/jobs/llm-queue";

/**
 * La coda dei lavori del modello locale — note di rilascio e letture di
 * allegati, insieme perché il vincolo è lo stesso. Quello che deve reggere: **una alla volta**
 * (Ollama serve una richiesta per volta, e cinque in parallelo sono solo cinque
 * note lente), e un **annullamento che arriva davvero** — in fila subito, in
 * esecuzione passando per `removing`, perché fingere che sia istantaneo fa
 * sembrare rotto un pulsante che funziona.
 */

const richiesta = (userName = "Dora Dev", userId = "u1") => ({
  kind: "release-note" as const,
  userId,
  userName,
  title: "Orione",
  subtitle: "Rilasciato · 2026-08-17",
  href: "/progetti/p1",
});

/** Un lavoro che si può tenere fermo e sbloccare a comando. */
function lavoroControllabile() {
  let sblocca: () => void = () => undefined;
  const partito = { value: false, generating: false };
  const bloccato = new Promise<void>((resolve) => {
    sblocca = resolve;
  });
  return {
    partito,
    sblocca: () => sblocca(),
    run: async (signal: AbortSignal, onGenerating: () => void) => {
      partito.value = true;
      onGenerating();
      partito.generating = true;
      await bloccato;
      if (signal.aborted) throw new Error("annullato");
    },
  };
}

const attendi = () => new Promise((r) => setTimeout(r, 10));

afterEach(() => resetQueue());

describe("coda dei lavori del modello", () => {
  it("ne esegue una alla volta: la seconda resta in fila", async () => {
    const primo = lavoroControllabile();
    const secondo = lavoroControllabile();
    enqueue(richiesta(), primo.run);
    enqueue(richiesta(), secondo.run);
    await attendi();

    expect(primo.partito.value).toBe(true);
    // Ollama serve una richiesta per volta: farne partire due qui non
    // accorcerebbe niente, le metterebbe solo in coda dove non si vedono.
    expect(secondo.partito.value).toBe(false);
    expect(listJobs().map((j: { state: string }) => j.state)).toEqual(["generating", "queue"]);

    primo.sblocca();
    await attendi();
    expect(secondo.partito.value).toBe(true);
  });

  it("il pannello dice tutto quello che serve a riconoscere una richiesta", async () => {
    enqueue(richiesta("Dario Ferri", "u9"), lavoroControllabile().run);
    await attendi();
    const [job] = listJobs();
    expect(job).toMatchObject({
      kind: "release-note",
      userName: "Dario Ferri",
      title: "Orione",
      subtitle: "Rilasciato · 2026-08-17",
    });
    expect(Date.parse(job!.requestedAt)).toBeGreaterThan(0);
  });

  it("una in fila si toglie subito", async () => {
    const primo = lavoroControllabile();
    enqueue(richiesta(), primo.run);
    const inFila = enqueue(richiesta(), lavoroControllabile().run);
    await attendi();

    expect(cancelJob(inFila.id, { userId: "u1", isAdmin: false })).toBe(true);
    expect(listJobs().map((j) => j.id)).not.toContain(inFila.id);
    primo.sblocca();
  });

  it("una in esecuzione passa per «removing», poi risulta annullata", async () => {
    const lavoro = lavoroControllabile();
    const job = enqueue(richiesta(), lavoro.run);
    await attendi();
    expect(listJobs()[0]!.state).toBe("generating");

    expect(cancelJob(job.id, { userId: "u1", isAdmin: false })).toBe(true);
    // Fra "ferma" e "fermato" c'è un momento, e il pannello lo dice.
    expect(listJobs()[0]!.state).toBe("removing");

    lavoro.sblocca();
    await attendi();
    expect(listJobs()[0]!.state).toBe("cancelled");
  });

  it("non si ferma il lavoro di un altro, ma l'admin sì", async () => {
    const job = enqueue(richiesta("Dora", "u1"), lavoroControllabile().run);
    await attendi();
    expect(cancelJob(job.id, { userId: "altro", isAdmin: false })).toBe(false);
    expect(cancelJob(job.id, { userId: "altro", isAdmin: true })).toBe(true);
  });

  it("ognuno vede le proprie, e il fallimento resta in elenco", async () => {
    const mio = enqueue(richiesta("Dora", "u1"), async () => {
      throw new Error("guasto");
    });
    enqueue(richiesta("Altro", "u2"), lavoroControllabile().run);
    await attendi();

    expect(listJobs({ userId: "u1" }).map((j) => j.id)).toEqual([mio.id]);
    // Un guasto non sparisce: serve a capire perché la nota non è arrivata.
    expect(listJobs({ userId: "u1" })[0]!.state).toBe("failed");
  });
});
