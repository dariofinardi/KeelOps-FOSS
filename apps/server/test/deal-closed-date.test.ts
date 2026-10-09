import { rmSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { TaskKind, UserRole } from "@kancrm/shared";
import { prepareTestDb } from "./support/test-db";

/**
 * **La data di chiusura di un'offerta, corretta dal super admin** (01/10/2026).
 * La scrive il passaggio in una fase vinta o persa; un'offerta registrata a
 * cose fatte risulta però chiusa il giorno dell'inserimento, e la previsione
 * la conta nel mese sbagliato. La corregge solo un amministratore elevato,
 * solo su un'offerta conclusa, e la correzione resta in cronologia.
 */
const { tempDir } = prepareTestDb("deal-closed-date");
const { buildApp } = await import("../src/app");
const { prisma } = await import("../src/db");
const { hashPassword } = await import("../src/modules/auth/password");
const { SESSION_COOKIE } = await import("../src/modules/auth/session");

type App = Awaited<ReturnType<typeof buildApp>>;
let app: App;
const PW = "password-di-prova-1";
const ids: Record<string, string> = {};
const cookies = new Map<string, string>();

async function cookie(email: string): Promise<string> {
  if (cookies.has(email)) return cookies.get(email)!;
  const res = await app.inject({
    method: "POST",
    url: "/api/auth/login",
    payload: { email, password: PW },
  });
  const header = `${SESSION_COOKIE}=${res.cookies.find((c) => c.name === SESSION_COOKIE)!.value}`;
  cookies.set(email, header);
  return header;
}
const patch = async (email: string, id: string, payload: object) =>
  app.inject({
    method: "PATCH",
    url: `/api/deals/${id}`,
    headers: { cookie: await cookie(email) },
    payload,
  });

beforeAll(async () => {
  const hash = await hashPassword(PW);
  const utente = (email: string, role: UserRole, elevato = false) =>
    prisma.user.create({
      data: {
        email,
        name: email.split("@")[0]!,
        role,
        passwordHash: hash,
        ...(elevato ? { adminUntil: new Date("2099-01-01") } : {}),
      },
    });
  ids.super = (await utente("super@x.local", UserRole.ADMIN, true)).id;
  ids.admin = (await utente("admin@x.local", UserRole.ADMIN)).id;
  ids.vendite = (await utente("vendite@x.local", UserRole.MEMBER)).id;
  const stato = await prisma.taskStatus.findFirstOrThrow({ where: { category: "SALES" } });
  ids.aperta = (
    await prisma.dealStage.create({ data: { name: "Trattativa", color: "#000", order: 0 } })
  ).id;
  ids.vinta = (
    await prisma.dealStage.create({ data: { name: "Vinta", color: "#000", order: 1, isWon: true } })
  ).id;
  const offerta = async (titolo: string, faseId: string, closedAt: Date | null) =>
    (
      await prisma.task.create({
        data: {
          kind: TaskKind.DEAL,
          title: titolo,
          statusId: stato.id,
          dealStageId: faseId,
          creatorId: ids.vendite!,
          assigneeId: ids.vendite!,
          dealValue: 1000,
          expectedCloseDate: new Date("2025-09-30T00:00:00.000Z"),
          closedAt,
        },
      })
    ).id;
  ids.smartocr = await offerta(
    "Atlante custom - SmartOCR",
    ids.vinta,
    new Date("2026-09-16T08:26:00.000Z"),
  );
  ids.inCorso = await offerta("Ancora in trattativa", ids.aperta, null);
  app = await buildApp();
});

afterAll(async () => {
  await app.close();
  await prisma.$disconnect();
  rmSync(tempDir, { recursive: true, force: true });
});

describe("la data di chiusura corretta a mano", () => {
  it("il super admin la corregge, a mezzogiorno UTC, e resta in cronologia", async () => {
    const res = await patch("super@x.local", ids.smartocr!, { closedAt: "2025-09-30" });
    expect(res.statusCode).toBe(200);
    const offerta = await prisma.task.findUniqueOrThrow({ where: { id: ids.smartocr } });
    expect(offerta.closedAt?.toISOString()).toBe("2025-09-30T12:00:00.000Z");
    const voce = await prisma.activityLog.findFirstOrThrow({
      where: { taskId: ids.smartocr, action: "closed_date_changed" },
    });
    expect(JSON.parse(voce.payload!)).toEqual({ from: "2026-09-16", to: "2025-09-30" });
  });

  it("il pannello la riceve come giorno, così il campo data la mostra", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/api/deals/${ids.smartocr}`,
      headers: { cookie: await cookie("super@x.local") },
    });
    expect(res.json().closedAt).toBe("2025-09-30");
  });

  it("un amministratore non elevato e il commerciale dell'offerta no", async () => {
    expect(
      (await patch("admin@x.local", ids.smartocr!, { closedAt: "2025-10-01" })).statusCode,
    ).toBe(403);
    expect(
      (await patch("vendite@x.local", ids.smartocr!, { closedAt: "2025-10-01" })).statusCode,
    ).toBe(403);
    const offerta = await prisma.task.findUniqueOrThrow({ where: { id: ids.smartocr } });
    expect(offerta.closedAt?.toISOString().slice(0, 10)).toBe("2025-09-30");
  });

  it("su un'offerta ancora aperta non c'è una data di chiusura da correggere", async () => {
    const res = await patch("super@x.local", ids.inCorso!, { closedAt: "2026-01-10" });
    expect(res.statusCode).toBe(400);
  });

  it("vinta e datata nella stessa modifica: vale la data indicata, non oggi", async () => {
    const res = await patch("super@x.local", ids.inCorso!, {
      stageId: ids.vinta,
      closedAt: "2026-03-31",
    });
    expect(res.statusCode).toBe(200);
    const offerta = await prisma.task.findUniqueOrThrow({ where: { id: ids.inCorso } });
    expect(offerta.closedAt?.toISOString()).toBe("2026-03-31T12:00:00.000Z");
  });
});
