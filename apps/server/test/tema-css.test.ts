import { rmSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { UserRole } from "@kancrm/shared";
import { prepareTestDb } from "./support/test-db";

/**
 * **I colori che il core serve ai plugin** (07/09/2026): la stessa sorgente
 * dell'applicazione, già risolta per il tema di chi la chiede. Una pagina di
 * plugin non eredita il foglio di stile dell'applicazione — vive in un altro
 * documento — e prima seguiva il sistema operativo invece della scelta della
 * persona.
 */
const { tempDir } = prepareTestDb("tema-css");

const { buildApp } = await import("../src/app");
const { prisma } = await import("../src/db");
const { hashPassword } = await import("../src/modules/auth/password");
const { temaCss } = await import("../src/modules/theme/routes");

let app: Awaited<ReturnType<typeof buildApp>>;
const cookie: Record<string, string> = {};

beforeAll(async () => {
  app = await buildApp();
  const passwordHash = await hashPassword("giusta-1234");
  for (const [chi, theme] of [
    ["chiara", "light"],
    ["scura", "dark"],
    ["automatica", "auto"],
  ] as const) {
    await prisma.user.create({
      data: { email: `${chi}@x.local`, name: chi, role: UserRole.MEMBER, passwordHash, theme },
    });
    const accesso = await app.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: { email: `${chi}@x.local`, password: "giusta-1234" },
    });
    cookie[chi] = accesso.headers["set-cookie"]!.toString().split(";")[0]!;
  }
});

afterAll(async () => {
  await app.close();
  await prisma.$disconnect();
  rmSync(tempDir, { recursive: true, force: true });
});

const css = async (chi?: string) =>
  app.inject({
    method: "GET",
    url: "/api/tema.css",
    ...(chi ? { headers: { cookie: cookie[chi]! } } : {}),
  });

describe("/api/tema.css", () => {
  it("porta i valori dell'applicazione, non una tavolozza a parte", async () => {
    const risposta = await css("chiara");
    expect(risposta.statusCode).toBe(200);
    expect(risposta.headers["content-type"]).toContain("text/css");
    // gli stessi token del foglio dell'applicazione (packages/shared/src/tema.css)
    expect(risposta.body).toContain("--background: oklch(1 0 0)");
    expect(risposta.body).toContain("--radius: 0.625rem");
    expect(risposta.body).toContain("--tema: light");
  });

  it("chi ha scelto chiaro non riceve la faccia scura dal sistema", async () => {
    const corpo = (await css("chiara")).body;
    expect(corpo).not.toContain("prefers-color-scheme");
    // ma la pagina può comunque dichiararsi scura (lo fa lo script dell'SDK)
    expect(corpo).toContain('[data-tema="dark"]');
  });

  it("chi ha scelto scuro la riceve sempre, sistema o no", async () => {
    const corpo = (await css("scura")).body;
    expect(corpo).toContain(':root:not([data-tema="light"])');
    expect(corpo).not.toContain("prefers-color-scheme");
    expect(corpo).toContain("html { color-scheme: dark; }");
  });

  it("chi ha scelto automatico segue il sistema, come l'applicazione", async () => {
    const corpo = (await css("automatica")).body;
    expect(corpo).toContain("@media (prefers-color-scheme: dark)");
    expect(corpo).toContain("html { color-scheme: light dark; }");
  });

  it("senza sessione risponde lo stesso, in automatico: è aperta, sono colori", async () => {
    const risposta = await css();
    expect(risposta.statusCode).toBe(200);
    expect(risposta.body).toContain("@media (prefers-color-scheme: dark)");
  });

  it("il tema aziendale porta il suo accento", async () => {
    const corpo = temaCss("company", "jugaad");
    expect(corpo).toContain("#7c3aed");
    expect(temaCss("company", "radaee")).toContain("#2563eb");
    // un nome che non esiste non rompe niente: resta la base
    expect(temaCss("company", "inventato")).not.toContain("#7c3aed");
  });
});
