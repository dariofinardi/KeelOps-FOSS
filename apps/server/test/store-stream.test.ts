import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import { afterAll, describe, expect, it } from "vitest";
import { localStore } from "../src/modules/attachments/store";

/** O5: il magazzino scrive un flusso senza passare da un Buffer, e dice quanti byte. */
const root = mkdtempSync(path.join(os.tmpdir(), "keelops-store-"));
afterAll(() => rmSync(root, { recursive: true, force: true }));

describe("writeStream", () => {
  it("scrive il flusso nel file, crea le cartelle e conta i byte", async () => {
    const store = localStore(root);
    const n = await store.writeStream(
      "t1/a-b.txt",
      Readable.from([Buffer.from("ciao "), Buffer.from("mondo")]),
    );
    expect(n).toBe(10);
    expect(readFileSync(path.join(root, "t1", "a-b.txt"), "utf8")).toBe("ciao mondo");
    expect(await store.size("t1/a-b.txt")).toBe(10);
  });

  it("un flusso che si rompe non lascia una promessa mantenuta", async () => {
    const store = localStore(root);
    const rotto = new Readable({
      read() {
        this.destroy(new Error("connessione caduta"));
      },
    });
    await expect(store.writeStream("t1/rotto.txt", rotto)).rejects.toThrow(/connessione caduta/);
  });
});
