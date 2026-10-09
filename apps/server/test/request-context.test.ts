import { describe, expect, it } from "vitest";
import { cached, runWithRequestContext } from "../src/lib/request-context";

describe("cache per-richiesta (C2)", () => {
  it("memoizza dentro lo stesso contesto, anche con chiamate concorrenti", async () => {
    let calls = 0;
    const compute = async () => {
      calls += 1;
      return 42;
    };
    await runWithRequestContext(async () => {
      const [a, b] = await Promise.all([cached("k", compute), cached("k", compute)]);
      expect(a).toBe(42);
      expect(b).toBe(42);
    });
    expect(calls).toBe(1);
  });

  it("contesti di richiesta diversi non condividono la cache", async () => {
    let calls = 0;
    const compute = async () => {
      calls += 1;
      return calls;
    };
    await runWithRequestContext(() => cached("k", compute));
    await runWithRequestContext(() => cached("k", compute));
    expect(calls).toBe(2);
  });

  it("senza contesto (cron/avvio) esegue senza memoizzare", async () => {
    let calls = 0;
    const compute = async () => {
      calls += 1;
      return 1;
    };
    await cached("k", compute);
    await cached("k", compute);
    expect(calls).toBe(2);
  });
});
