// Copyright (c) 2026 Jugaad s.r.l.
// SPDX-License-Identifier: AGPL-3.0-only

import { rmSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { UserRole } from "@kancrm/shared";
import { prepareTestDb } from "./support/test-db";

/**
 * **Google Analytics, solo nella demo** (18/09/2026): la pagina riceve
 * l'identificativo e mai il segreto; il server manda a GA gli endpoint chiamati
 * — il modello della rotta, non l'indirizzo con gli id — solo per chi ha
 * acconsentito alle statistiche e ha il cookie di GA. Senza DEMO non esiste.
 */
const { tempDir } = prepareTestDb("analytics-demo");
process.env.DEMO = "true";
process.env.GA_MEASUREMENT_ID = "G-PROVA123";
process.env.GA_API_SECRET = "segreto-mp";

const { buildApp } = await import("../src/app");
const { prisma } = await import("../src/db");
const { hashPassword } = await import("../src/modules/auth/password");
const { SESSION_COOKIE } = await import("../src/modules/auth/session");
const { leggiConfigAnalytics } = await import("../src/config");
const { CONSENSO_COOKIE, VERSIONE_INFORMATIVA, scriviSceltaCookie } =
  await import("@kancrm/shared");
/** Il cookie della scelta condivisa con il sito, come lo scrivono sito e demo. */
const scelta = (s: boolean, v = VERSIONE_INFORMATIVA) =>
  scriviSceltaCookie({ id: "c-prova", v, s, m: false, t: "2026-09-18T10:00:00.000Z" });
const { clientIdDaCookie, eventoPerRichiesta, sessionIdDaCookie, svuotaCoda } =
  await import("../src/modules/analytics/ga");

type App = Awaited<ReturnType<typeof buildApp>>;
let app: App;
let sessione = "";
const inviati: Array<{
  url: string;
  corpo: {
    client_id: string;
    events: Array<{ params: Record<string, unknown> }>;
    user_properties?: unknown;
  };
}> = [];

beforeAll(async () => {
  // Nessuna richiesta vera verso Google: si guarda cosa partirebbe.
  vi.stubGlobal("fetch", async (url: string, init: { body: string }) => {
    inviati.push({ url, corpo: JSON.parse(init.body) });
    return new Response(null, { status: 204 });
  });
  await prisma.user.create({
    data: {
      email: "sales@keelcrm.demo",
      name: "Commerciale",
      role: UserRole.MEMBER,
      passwordHash: await hashPassword("demo-1234"),
    },
  });
  app = await buildApp();
  const login = await app.inject({
    method: "POST",
    url: "/api/auth/login",
    payload: { email: "sales@keelcrm.demo", password: "demo-1234" },
  });
  sessione = `${SESSION_COOKIE}=${login.cookies.find((c) => c.name === SESSION_COOKIE)!.value}`;
});

afterAll(async () => {
  vi.unstubAllGlobals();
  await app.close();
  await prisma.$disconnect();
  rmSync(tempDir, { recursive: true, force: true });
});

describe("i cookie di GA", () => {
  it("client_id e sessione, nelle forme che gtag scrive", () => {
    expect(clientIdDaCookie("GA1.1.1234567890.1726650000")).toBe("1234567890.1726650000");
    expect(clientIdDaCookie("rotto")).toBeNull();
    expect(sessionIdDaCookie("GS1.1.1726650000.3.1.1726650100.0.0.0")).toBe("1726650000");
    expect(sessionIdDaCookie("GS2.1.s1726650000$o3$g1$t1726650100$j60$l0$h0")).toBe("1726650000");
  });
});

describe("quali richieste diventano un evento", () => {
  const base = {
    url: "/api/tasks/cm123abc",
    rotta: "/api/tasks/:id",
    metodo: "GET",
    stato: 200,
    durataMs: 12.6,
    measurementId: "G-PROVA123",
    cookies: {
      [CONSENSO_COOKIE]: scelta(true),
      _ga: "GA1.1.111.222",
      _ga_PROVA123: "GS2.1.s1726650000$o1$g1",
    },
  };

  it("il modello della rotta, non l'indirizzo: nessun id di record parte verso Google", () => {
    expect(eventoPerRichiesta(base)).toEqual({
      clientId: "111.222",
      evento: {
        name: "api_request",
        params: {
          endpoint: "/api/tasks/:id",
          method: "GET",
          status_code: 200,
          duration_ms: 13,
          session_id: "1726650000",
          engagement_time_msec: 1,
        },
      },
    });
  });

  it("senza consenso, senza cookie di GA, fuori dall'API o sul canale delle notifiche: niente", () => {
    expect(
      eventoPerRichiesta({
        ...base,
        cookies: { ...base.cookies, [CONSENSO_COOKIE]: scelta(false) },
      }),
    ).toBeNull();
    // Un sì dato su un'informativa più vecchia non vale più.
    expect(
      eventoPerRichiesta({
        ...base,
        cookies: { ...base.cookies, [CONSENSO_COOKIE]: scelta(true, "2026-09-12") },
      }),
    ).toBeNull();
    expect(
      eventoPerRichiesta({ ...base, cookies: { [CONSENSO_COOKIE]: scelta(true) } }),
    ).toBeNull();
    expect(eventoPerRichiesta({ ...base, url: "/assets/app.js", rotta: undefined })).toBeNull();
    expect(
      eventoPerRichiesta({
        ...base,
        url: "/api/notifications/stream",
        rotta: "/api/notifications/stream",
      }),
    ).toBeNull();
  });
});

describe("nella demo", () => {
  it("la pagina riceve l'identificativo, mai il segreto", async () => {
    const providers = await app.inject({ method: "GET", url: "/api/auth/providers" });
    expect(providers.json().demo.analytics).toEqual({ measurementId: "G-PROVA123" });
    expect(providers.body).not.toContain("segreto-mp");
  });

  it("chi ha acconsentito: l'endpoint arriva a GA, con il ruolo e senza email", async () => {
    inviati.length = 0;
    const cookieGa = `${CONSENSO_COOKIE}=${scelta(true)}; _ga=GA1.1.111.222`;
    await app.inject({
      method: "GET",
      url: "/api/tasks/non-esiste",
      headers: { cookie: `${sessione}; ${cookieGa}` },
    });
    await svuotaCoda();
    expect(inviati).toHaveLength(1);
    expect(inviati[0]!.url).toContain("measurement_id=G-PROVA123");
    expect(inviati[0]!.corpo.client_id).toBe("111.222");
    expect(inviati[0]!.corpo.events[0]!.params).toMatchObject({
      endpoint: "/api/tasks/:id",
      method: "GET",
      status_code: 404,
    });
    expect(inviati[0]!.corpo.user_properties).toEqual({ user_role: { value: "MEMBER" } });
    expect(JSON.stringify(inviati[0]!.corpo)).not.toContain("keelcrm.demo");
    expect(JSON.stringify(inviati[0]!.corpo)).not.toContain("non-esiste");
  });

  it("chi non ha acconsentito non parte", async () => {
    inviati.length = 0;
    await app.inject({
      method: "GET",
      url: "/api/tasks/non-esiste",
      headers: { cookie: `${sessione}; _ga=GA1.1.111.222` },
    });
    await svuotaCoda();
    expect(inviati).toHaveLength(0);
  });
});

describe("in produzione", () => {
  it("senza DEMO, GA non esiste anche con identificativo e segreto scritti", () => {
    expect(leggiConfigAnalytics(false, "G-PROVA123", "segreto")).toBeNull();
    expect(leggiConfigAnalytics(true, "", "segreto")).toBeNull();
    expect(leggiConfigAnalytics(true, "G-PROVA123", "")).toEqual({
      measurementId: "G-PROVA123",
      apiSecret: null,
    });
  });
});
