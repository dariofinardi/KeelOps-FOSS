import { rmSync } from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prepareTestDb } from "./support/test-db";
import { importsScenario, multipart, xlsxBuffer } from "./support/imports-scenario";

const { tempDir } = prepareTestDb("imports");
process.env.BACKUPS_DIR = path.join(tempDir, "backups");

const { parseIcs } = await import("../src/modules/imports/ical");
const { moduliAttivi } = await import("../src/edition/registry");

let ctx: Awaited<ReturnType<typeof importsScenario>>;
let app: typeof ctx.app;
let prisma: typeof ctx.prisma;
let adminCookie: string;
let memberCookie: string;

beforeAll(async () => {
  ctx = await importsScenario();
  ({ app, prisma, adminCookie, memberCookie } = ctx);
});

afterAll(async () => {
  await app.close();
  await prisma.$disconnect();
  rmSync(tempDir, { recursive: true, force: true });
});

describe("profilo personale", () => {
  it("updates preferences and returns them in /me", async () => {
    const updated = await app.inject({
      method: "PUT",
      url: "/api/profile",
      headers: { cookie: memberCookie },
      payload: { nickName: "Mia", accentColor: "#7c3aed", currency: "USD", locale: "en" },
    });
    expect(updated.statusCode).toBe(200);
    expect(updated.json().nickName).toBe("Mia");

    const me = await app.inject({
      method: "GET",
      url: "/api/auth/me",
      headers: { cookie: memberCookie },
    });
    expect(me.json().accentColor).toBe("#7c3aed");
    expect(me.json().currency).toBe("USD");
    expect(me.json().locale).toBe("en");
  });
});

describe("template e import Excel", () => {
  it("serves xlsx templates for every type", async () => {
    for (const type of ["tasks", "deals", "contacts", "companies"]) {
      const response = await app.inject({
        method: "GET",
        url: `/api/imports/template/${type}`,
        headers: { cookie: memberCookie },
      });
      expect(response.statusCode, type).toBe(200);
      expect(response.headers["content-type"]).toContain("spreadsheetml");
      expect(response.rawPayload.subarray(0, 2).toString()).toBe("PK");
    }
  });

  it("imports companies, skipping duplicates and example rows", async () => {
    const buffer = await xlsxBuffer(
      ["Ragione sociale", "Partita IVA", "Città", "Note"],
      [
        ["Esempio - ACME S.r.l.", "", "", ""],
        ["Import Uno S.p.A.", "IT111", "Roma", ""],
        ["Import Due S.r.l.", "", "Napoli", "nota"],
        ["Import Uno S.p.A.", "IT111", "Roma", ""],
      ],
    );
    const { payload, contentType } = multipart(buffer, "aziende.xlsx", "application/xlsx");
    const response = await app.inject({
      method: "POST",
      url: "/api/imports/companies",
      headers: { cookie: memberCookie, "content-type": contentType },
      payload,
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ imported: 2, skipped: 1 });
    expect(await prisma.company.count()).toBe(2);
  });

  it("imports tasks resolving status, assignee email and italian dates", async () => {
    const buffer = await xlsxBuffer(
      ["Titolo", "Descrizione", "Scadenza", "Stato", "Assegnatario (email)"],
      [["Task importato", "da excel", "15/09/2026", "Da assegnare", "member@test.local"]],
    );
    const { payload, contentType } = multipart(buffer, "task.xlsx", "application/xlsx");
    const response = await app.inject({
      method: "POST",
      url: "/api/imports/tasks",
      headers: { cookie: memberCookie, "content-type": contentType },
      payload,
    });
    expect(response.json().imported).toBe(1);

    const task = await prisma.task.findFirst({
      where: { title: "Task importato" },
      include: { assignee: true },
    });
    expect(task?.dueDate?.toISOString().slice(0, 10)).toBe("2026-09-15");
    expect(task?.assignee?.email).toBe("member@test.local");
  });

  it("imports tasks with activity type (created), link and assignee by name", async () => {
    const buffer = await xlsxBuffer(
      ["Titolo", "Scadenza", "Stato", "Tipo attività", "Assegnatario (nome o email)", "Link"],
      [
        [
          "Fattura ACME",
          "01/10/2026",
          "Da lavorare",
          "Emissione fattura",
          "Mia Member",
          "Preventivo - https://drive.google.com/x",
        ],
      ],
    );
    const { payload, contentType } = multipart(buffer, "task.xlsx", "application/xlsx");
    const response = await app.inject({
      method: "POST",
      url: "/api/imports/tasks",
      headers: { cookie: memberCookie, "content-type": contentType },
      payload,
    });
    expect(response.json().imported).toBe(1);

    const task = await prisma.task.findFirst({
      where: { title: "Fattura ACME" },
      include: {
        activityType: true,
        assignee: true,
        attachments: { include: { attachment: true } },
      },
    });
    // Tipo attività creato al volo (categoria Amministrative).
    expect(task?.activityType?.name).toBe("Emissione fattura");
    expect(task?.activityType?.category).toBe("ADMIN");
    // Assegnatario risolto per nome.
    expect(task?.assignee?.name).toBe("Mia Member");
    // Stato Monday mappato.
    // Link diventa allegato con titolo "Preventivo".
    expect(task?.attachments[0]?.attachment.type).toBe("LINK");
    expect(task?.attachments[0]?.attachment.name).toBe("Preventivo");
    expect(task?.attachments[0]?.attachment.url).toBe("https://drive.google.com/x");
  });

  it("owner selection: only enabled users; import assigns ownership; dev rejected", async () => {
    const member = await prisma.user.findUniqueOrThrow({ where: { email: "member@test.local" } });
    const dev = await prisma.user.findUniqueOrThrow({ where: { email: "dev@test.local" } });

    // Elenco proprietari abilitati per i task: include admin e member, non il dev.
    const owners = await app.inject({
      method: "GET",
      url: "/api/imports/owners/tasks",
      headers: { cookie: adminCookie },
    });
    const ownerIds = owners.json().map((u: { id: string }) => u.id);
    expect(ownerIds).toContain(member.id);
    expect(ownerIds).not.toContain(dev.id);

    // Import con proprietario = member: il task risulta creato dal member.
    const buffer = await xlsxBuffer(["Titolo"], [["Task del proprietario"]]);
    const { payload, contentType } = multipart(buffer, "t.xlsx", "application/xlsx");
    const ok = await app.inject({
      method: "POST",
      url: `/api/imports/tasks?ownerId=${member.id}`,
      headers: { cookie: adminCookie, "content-type": contentType },
      payload,
    });
    expect(ok.json().imported).toBe(1);
    const task = await prisma.task.findFirst({ where: { title: "Task del proprietario" } });
    expect(task?.creatorId).toBe(member.id);

    // Import con proprietario non abilitato (dev) → errore.
    const buffer2 = await xlsxBuffer(["Titolo"], [["Task vietato"]]);
    const mp2 = multipart(buffer2, "t.xlsx", "application/xlsx");
    const bad = await app.inject({
      method: "POST",
      url: `/api/imports/tasks?ownerId=${dev.id}`,
      headers: { cookie: adminCookie, "content-type": mp2.contentType },
      payload: mp2.payload,
    });
    expect(bad.statusCode).toBe(400);
  });

  it("re-importing the same rows skips duplicates (tasks and recurrences)", async () => {
    const rows: string[][] = [
      ["Dedup singolo", "15/11/2026", "Emissione fattura", ""],
      ["Dedup ricorrente", "16/11/2026", "Scadenze fiscali", "Mensile"],
    ];
    const doImport = async () => {
      const buffer = await xlsxBuffer(["Titolo", "Scadenza", "Tipo attività", "Frequenza"], rows);
      const { payload, contentType } = multipart(buffer, "t.xlsx", "application/xlsx");
      return app.inject({
        method: "POST",
        url: "/api/imports/tasks",
        headers: { cookie: memberCookie, "content-type": contentType },
        payload,
      });
    };

    const first = await doImport();
    expect(first.json().imported).toBe(2);

    // Seconda importazione identica: entrambe le righe saltate.
    const second = await doImport();
    expect(second.json().imported).toBe(0);
    expect(second.json().skipped).toBe(2);

    // Un solo task singolo e una sola ricorrenza in totale.
    expect(await prisma.task.count({ where: { title: "Dedup singolo" } })).toBe(1);
    expect(await prisma.recurrenceTemplate.count({ where: { title: "Dedup ricorrente" } })).toBe(1);
  });

  it("imports a recurring task as a recurrence template with materialized occurrences", async () => {
    const buffer = await xlsxBuffer(
      ["Titolo", "Scadenza", "Tipo attività", "Frequenza"],
      [["Versamento IVA import", "16/01/2026", "Scadenze fiscali", "Mensile"]],
    );
    const { payload, contentType } = multipart(buffer, "task.xlsx", "application/xlsx");
    const response = await app.inject({
      method: "POST",
      url: "/api/imports/tasks",
      headers: { cookie: memberCookie, "content-type": contentType },
      payload,
    });
    expect(response.json().imported).toBe(1);

    const template = await prisma.recurrenceTemplate.findFirst({
      where: { title: "Versamento IVA import" },
      include: { activityType: true, tasks: true },
    });
    expect(template?.rrule).toBe("FREQ=MONTHLY;BYMONTHDAY=16");
    expect(template?.activityType?.name).toBe("Scadenze fiscali");
    // Sono state materializzate delle occorrenze (task collegati al template).
    expect(template!.tasks.length).toBeGreaterThan(0);
    expect(template!.tasks[0]?.activityTypeId).toBe(template!.activityTypeId);
  });

  it("imports deals creating company and contact on the fly", async () => {
    const buffer = await xlsxBuffer(
      ["Titolo", "Fase", "Azienda", "Contatto", "Valore", "Probabilità"],
      [["Offerta importata", "Trattativa", "Nuova Azienda Import", "Carlo Verdi", "12.500", "70"]],
    );
    const { payload, contentType } = multipart(buffer, "offerte.xlsx", "application/xlsx");
    const response = await app.inject({
      method: "POST",
      url: "/api/imports/deals",
      headers: { cookie: memberCookie, "content-type": contentType },
      payload,
    });
    expect(response.json().imported).toBe(1);

    const deal = await prisma.task.findFirst({
      where: { title: "Offerta importata" },
      include: { company: true, contact: true, dealStage: true },
    });
    expect(deal?.company?.name).toBe("Nuova Azienda Import");
    expect(deal?.contact?.lastName).toBe("Verdi");
    expect(deal?.dealValue).toBe(12.5 * 1000);
    expect(deal?.probability).toBe(70);
  });

  it("reports row errors without aborting the whole import", async () => {
    const buffer = await xlsxBuffer(
      ["Nome", "Cognome", "Email"],
      [
        ["Solo", "", ""],
        ["Ok", "Rossi", "ok.rossi@test.example"],
      ],
    );
    const { payload, contentType } = multipart(buffer, "contatti.xlsx", "application/xlsx");
    const response = await app.inject({
      method: "POST",
      url: "/api/imports/contacts",
      headers: { cookie: memberCookie, "content-type": contentType },
      payload,
    });
    expect(response.json().imported).toBe(1);
    expect(response.json().errors).toHaveLength(1);
    expect(response.json().errors[0].message).toContain("obbligatori");
  });
});

describe("import iCal", () => {
  it("parses VEVENT and VTODO with folding and escaping", () => {
    const ics = [
      "BEGIN:VCALENDAR",
      "BEGIN:VEVENT",
      "SUMMARY:Riunione con il commercialista\\, sede",
      "DESCRIPTION:Prima riga\\nSeconda ri",
      " ga continuata",
      "DTSTART;VALUE=DATE:20260920",
      "END:VEVENT",
      "BEGIN:VTODO",
      "SUMMARY:Preparare documenti",
      "DUE:20260925T120000Z",
      "END:VTODO",
      "END:VCALENDAR",
    ].join("\r\n");
    const items = parseIcs(ics);
    expect(items).toHaveLength(2);
    expect(items[0]!.title).toBe("Riunione con il commercialista, sede");
    expect(items[0]!.description).toBe("Prima riga\nSeconda riga continuata");
    expect(items[0]!.date?.toISOString().slice(0, 10)).toBe("2026-09-20");
    expect(items[1]!.date?.toISOString().slice(0, 10)).toBe("2026-09-25");
  });

  it("imports ics as tasks assigned to the importer, with dedup", async () => {
    const ics = [
      "BEGIN:VCALENDAR",
      "BEGIN:VEVENT",
      "SUMMARY:Evento da calendario",
      "DTSTART:20261001",
      "END:VEVENT",
      "END:VCALENDAR",
    ].join("\r\n");
    const { payload, contentType } = multipart(Buffer.from(ics), "calendario.ics", "text/calendar");
    const first = await app.inject({
      method: "POST",
      url: "/api/imports/ical",
      headers: { cookie: memberCookie, "content-type": contentType },
      payload,
    });
    expect(first.json().imported).toBe(1);

    const again = await app.inject({
      method: "POST",
      url: "/api/imports/ical",
      headers: { cookie: memberCookie, "content-type": contentType },
      payload,
    });
    expect(again.json().skipped).toBe(1);

    const task = await prisma.task.findFirst({
      where: { title: "Evento da calendario" },
      include: { assignee: true },
    });
    expect(task?.assignee?.email).toBe("member@test.local");
  });
});

describe("export solo admin", () => {
  it("blocks members from every export endpoint", async () => {
    // The timesheet export is commercial: the community has no such route.
    const timesheet = moduliAttivi().some((m) => m.nome === "timesheet");
    for (const url of [
      "/api/tasks/export",
      "/api/deals/export",
      ...(timesheet ? ["/api/timesheet/export?month=2026-07"] : []),
    ]) {
      const denied = await app.inject({ method: "GET", url, headers: { cookie: memberCookie } });
      expect(denied.statusCode, url).toBe(403);
      const allowed = await app.inject({ method: "GET", url, headers: { cookie: adminCookie } });
      expect(allowed.statusCode, url).toBe(200);
    }
  });
});

describe("avatar immagine", () => {
  // PNG 1x1 trasparente.
  const png = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
    "base64",
  );

  it("carica, serve e rimuove l'avatar; rifiuta i non-immagine", async () => {
    const { payload, contentType } = multipart(png, "me.png", "image/png");
    const up = await app.inject({
      method: "POST",
      url: "/api/profile/avatar",
      headers: { cookie: adminCookie, "content-type": contentType },
      payload,
    });
    expect(up.statusCode).toBe(200);
    const url = up.json().avatarUrl as string;
    expect(url).toMatch(/^\/api\/avatars\//);

    const img = await app.inject({ method: "GET", url, headers: { cookie: adminCookie } });
    expect(img.statusCode).toBe(200);
    expect(img.headers["content-type"]).toContain("image/png");
    expect(img.rawPayload.length).toBe(png.length);

    // Un file non-immagine viene rifiutato.
    const bad = multipart(Buffer.from("ciao"), "x.txt", "text/plain");
    const badRes = await app.inject({
      method: "POST",
      url: "/api/profile/avatar",
      headers: { cookie: adminCookie, "content-type": bad.contentType },
      payload: bad.payload,
    });
    expect(badRes.statusCode).toBe(400);

    const del = await app.inject({
      method: "DELETE",
      url: "/api/profile/avatar",
      headers: { cookie: adminCookie },
    });
    expect(del.statusCode).toBe(200);
    expect(del.json().avatarUrl).toBeNull();
  });
});

describe("branding aziendale", () => {
  const png = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
    "base64",
  );

  it("legge il default, cambia tema (solo admin), carica/serve/rimuove il logo", async () => {
    // Default: nessun logo, tema Jugaad.
    const def = await app.inject({
      method: "GET",
      url: "/api/branding",
      headers: { cookie: memberCookie },
    });
    expect(def.statusCode).toBe(200);
    expect(def.json()).toMatchObject({ logoUrl: null, title: null, companyTheme: "jugaad" });

    // Un membro non può cambiare il tema aziendale.
    const forbidden = await app.inject({
      method: "PUT",
      url: "/api/branding",
      headers: { cookie: memberCookie },
      payload: { companyTheme: "radaee" },
    });
    expect(forbidden.statusCode).toBe(403);

    // L'admin sì.
    const set = await app.inject({
      method: "PUT",
      url: "/api/branding",
      headers: { cookie: adminCookie },
      payload: { companyTheme: "radaee" },
    });
    expect(set.statusCode).toBe(200);
    expect(set.json().companyTheme).toBe("radaee");

    // Upload logo (admin), poi il membro lo vede servito.
    const { payload, contentType } = multipart(png, "logo.png", "image/png");
    const up = await app.inject({
      method: "POST",
      url: "/api/branding/logo",
      headers: { cookie: adminCookie, "content-type": contentType },
      payload,
    });
    expect(up.statusCode).toBe(200);
    expect(up.json().logoUrl).toMatch(/^\/api\/branding\/logo/);

    const served = await app.inject({
      method: "GET",
      url: "/api/branding/logo",
      headers: { cookie: memberCookie },
    });
    expect(served.statusCode).toBe(200);
    expect(served.headers["content-type"]).toContain("image/png");

    const del = await app.inject({
      method: "DELETE",
      url: "/api/branding/logo",
      headers: { cookie: adminCookie },
    });
    expect(del.statusCode).toBe(200);
    expect(del.json().logoUrl).toBeNull();
  });

  it("titolo: l'admin lo imposta e lo azzera (svuotandolo torna null)", async () => {
    // Un membro non può cambiarlo.
    const forbidden = await app.inject({
      method: "PUT",
      url: "/api/branding",
      headers: { cookie: memberCookie },
      payload: { title: "Acme" },
    });
    expect(forbidden.statusCode).toBe(403);

    // L'admin lo imposta: viene restituito e letto da tutti.
    const set = await app.inject({
      method: "PUT",
      url: "/api/branding",
      headers: { cookie: adminCookie },
      payload: { title: "  Acme CRM  " },
    });
    expect(set.statusCode).toBe(200);
    expect(set.json().title).toBe("Acme CRM"); // trim

    const read = await app.inject({
      method: "GET",
      url: "/api/branding",
      headers: { cookie: memberCookie },
    });
    expect(read.json().title).toBe("Acme CRM");

    // Stringa vuota → azzera (torna al default "KeelOps").
    const clear = await app.inject({
      method: "PUT",
      url: "/api/branding",
      headers: { cookie: adminCookie },
      payload: { title: "" },
    });
    expect(clear.statusCode).toBe(200);
    expect(clear.json().title).toBeNull();
  });
});
