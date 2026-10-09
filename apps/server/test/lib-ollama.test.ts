import { afterEach, describe, expect, it, vi } from "vitest";
import { ollamaChat } from "../src/lib/ollama";

/** Una risposta di Ollama come la manda davvero. */
const risposta = (content: string) => ({
  ok: true,
  json: async () => ({ message: { content } }),
});

afterEach(() => vi.unstubAllGlobals());

describe("l'unica porta verso Ollama (lib/ollama)", () => {
  it("monta la chiamata come i tre moduli la montavano: /api/chat, temperatura zero", async () => {
    const fetchFinto = vi.fn().mockResolvedValue(risposta('{"ok":true}'));
    vi.stubGlobal("fetch", fetchFinto);

    const esito = await ollamaChat({
      url: "http://ollama.local",
      model: "assenze",
      system: "istruzioni",
      user: "Manu SW",
      schema: { type: "object" },
      numPredict: 32,
      numGpu: 0,
      keepAlive: "5m",
      timeoutMs: 1000,
    });
    expect(esito).toBe('{"ok":true}');

    const [url, opzioni] = fetchFinto.mock.calls[0]!;
    expect(url).toBe("http://ollama.local/api/chat");
    const corpo = JSON.parse((opzioni as { body: string }).body);
    expect(corpo.options.temperature).toBe(0);
    expect(corpo.options.num_gpu).toBe(0);
    expect(corpo.think).toBe(false);
    expect(corpo.keep_alive).toBe("5m");
    expect(corpo.messages).toHaveLength(2);
  });

  it("qualunque guasto è null: Ollama spento, HTTP storto, tempo scaduto", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("connessione rifiutata")));
    expect(
      await ollamaChat({ url: "http://x", model: "m", system: "s", user: "u", numPredict: 8, timeoutMs: 50 }),
    ).toBeNull();

    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false }));
    expect(
      await ollamaChat({ url: "http://x", model: "m", system: "s", user: "u", numPredict: 8, timeoutMs: 50 }),
    ).toBeNull();
  });

  it("senza indirizzo o senza modello non chiama nessuno", async () => {
    const fetchFinto = vi.fn();
    vi.stubGlobal("fetch", fetchFinto);
    expect(
      await ollamaChat({ url: "http://x", model: "", system: "s", user: "u", numPredict: 8, timeoutMs: 50 }),
    ).toBeNull();
    expect(fetchFinto).not.toHaveBeenCalled();
  });
});

describe("il preflight del modello (ollamaModelStatus)", () => {
  it("distingue spento, assente, caricato — e dice DOVE sta girando", async () => {
    const { ollamaModelStatus } = await import("../src/lib/ollama");

    // istanza spenta
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("rifiutata")));
    expect((await ollamaModelStatus({ url: "http://x", model: "m" })).raggiungibile).toBe(false);

    // istanza accesa, modello non installato
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ models: [{ name: "altro:latest" }] }),
    }));
    const assente = await ollamaModelStatus({ url: "http://x", model: "m" });
    expect(assente).toMatchObject({ raggiungibile: true, presente: false });

    // installato e caricato quasi tutto in RAM: è il caso dei 486 secondi
    const fetchFinto = vi.fn().mockImplementation(async (url: string) =>
      url.endsWith("/api/tags")
        ? { ok: true, json: async () => ({ models: [{ name: "qwen:latest" }] }) }
        : { ok: true, json: async () => ({ models: [{ name: "qwen:latest", size: 19_000, size_vram: 600 }] }) },
    );
    vi.stubGlobal("fetch", fetchFinto);
    const inRam = await ollamaModelStatus({ url: "http://x", model: "qwen" });
    expect(inRam).toMatchObject({ presente: true, caricato: true, inVram: 600, dimensione: 19_000 });
  });
});
