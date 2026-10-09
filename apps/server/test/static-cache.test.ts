import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prepareTestDb } from "./support/test-db";
import { fingiBuild } from "./support/finta-build";

const { tempDir } = prepareTestDb("static-cache");

/**
 * **Due politiche di cache, non una.**
 *
 * Il 20/08/2026 una scheda ha ripescato dalla cache l'`index.html` di un
 * rilascio precedente: nominava file spariti, il foglio di stile è tornato un
 * 404 in JSON e la pagina è rimasta a metà, con tre errori diversi in console e
 * una causa sola. L'index non si tiene mai; gli asset con l'impronta nel nome
 * si tengono un anno, perché cambiando contenuto cambia il nome.
 */
const { buildApp } = await import("../src/app");
type App = Awaited<ReturnType<typeof buildApp>>;

const publicDir = path.resolve(import.meta.dirname, "../public");
let app: App;
let ripristina: () => void = () => undefined;

beforeAll(async () => {
  // La build del frontend non c'è nei test: si finge, quel tanto che basta —
  // e quella vera, se c'è, torna al suo posto alla fine (support/finta-build).
  ripristina = fingiBuild(publicDir);
  mkdirSync(path.join(publicDir, "assets"), { recursive: true });
  writeFileSync(path.join(publicDir, "assets", "index-Ab12Cd34.css"), "body{}");
  app = await buildApp();
});

afterAll(async () => {
  await app.close();
  rmSync(path.join(publicDir, "assets", "index-Ab12Cd34.css"), { force: true });
  ripristina();
  rmSync(tempDir, { recursive: true, force: true });
});

const cache = async (url: string) =>
  (await app.inject({ method: "GET", url })).headers["cache-control"];

describe("la cache dei file statici", () => {
  it("l'index si richiede sempre: è quello che cambia a ogni rilascio", async () => {
    expect(await cache("/index.html")).toBe("no-cache");
  });

  it("un file con l'impronta nel nome si tiene un anno, e non si rivalida", async () => {
    // Cambiando contenuto cambia il nome: non c'è niente da chiedere.
    expect(await cache("/assets/index-Ab12Cd34.css")).toBe("public, max-age=31536000, immutable");
  });
});
