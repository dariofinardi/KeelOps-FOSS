import { rmSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prepareTestDb } from "./support/test-db";
import { NotificationType, TaskKind, UserRole } from "@kancrm/shared";

/**
 * **Un riepilogo al giorno, anche a giri sovrapposti.** Il controllo «c'è già
 * una riga di oggi?» seguito dalla scrittura lasciava passare due giri
 * concorrenti (V8 di PLAN_OPTIMIZE): qui i due giri partono insieme, e la
 * chiave di unicità ne fa passare uno. Il giorno dopo, la chiave è un'altra e
 * il riepilogo riparte.
 */
const { tempDir } = prepareTestDb("notify-dedup");

const { prisma } = await import("../src/db");
const { notify, sendDueDigests, chiaveGiornaliera } =
  await import("../src/modules/notifications/service");

let userId: string;
/**
 * «Oggi» e «domani» si contano **dal giorno vero**, non da due date scritte a
 * mano. Erano fisse (7 e 8 settembre 2026) e il test ha smesso di passare da
 * solo la notte in cui l'orologio le ha superate: `giaAvvisatoOggi` guarda il
 * `createdAt` delle righe, che lo scrive il database con l'ora vera, e quelle
 * righe finivano dentro alla finestra del «domani» finto. Un test che scade
 * come uno yogurt è peggio di un test che manca: passa per mesi e poi ferma un
 * deploy per un motivo che non c'entra niente con il codice.
 */
const alleSette = (giorniAvanti: number): Date => {
  const d = new Date();
  d.setUTCHours(7, 0, 0, 0);
  d.setUTCDate(d.getUTCDate() + giorniAvanti);
  return d;
};
const OGGI = alleSette(0);
const DOMANI = alleSette(1);

beforeAll(async () => {
  userId = (
    await prisma.user.create({
      data: { email: "dina@x.local", name: "Dina Digest", role: UserRole.MEMBER },
    })
  ).id;
  const status = await prisma.taskStatus.findFirstOrThrow({ where: { isClosed: false } });
  await prisma.task.create({
    data: {
      title: "Scade oggi",
      kind: TaskKind.ADMIN,
      creatorId: userId,
      assigneeId: userId,
      statusId: status.id,
      // mezzanotte UTC di oggi: la convenzione delle date-only del modello
      dueDate: (() => {
        const d = new Date();
        d.setUTCHours(0, 0, 0, 0);
        return d;
      })(),
    },
  });
});

afterAll(async () => {
  await prisma.$disconnect();
  rmSync(tempDir, { recursive: true, force: true });
});

const righe = (type: string) => prisma.notification.count({ where: { userId, type } });

describe("la chiave di unicità", () => {
  it("due notify con la stessa chiave, insieme: una sola riga, e una sola dice di averla creata", async () => {
    const chiave = chiaveGiornaliera(NotificationType.MENTION, userId, OGGI);
    const esiti = await Promise.all([
      notify(
        userId,
        null,
        NotificationType.MENTION,
        { message: () => "uno" },
        { dedupKey: chiave },
      ),
      notify(
        userId,
        null,
        NotificationType.MENTION,
        { message: () => "due" },
        { dedupKey: chiave },
      ),
    ]);
    expect(esiti.filter(Boolean)).toHaveLength(1);
    expect(await righe(NotificationType.MENTION)).toBe(1);
  });

  it("senza chiave gli avvisi si ripetono, come prima", async () => {
    await notify(userId, null, NotificationType.TASK_COMMENT, { message: () => "a" });
    await notify(userId, null, NotificationType.TASK_COMMENT, { message: () => "b" });
    expect(await righe(NotificationType.TASK_COMMENT)).toBe(2);
  });
});

describe("il riepilogo delle scadenze", () => {
  it("due giri sovrapposti mandano un riepilogo solo", async () => {
    const [a, b] = await Promise.all([sendDueDigests(OGGI), sendDueDigests(OGGI)]);
    expect(a + b).toBe(1);
    expect(await righe(NotificationType.DUE_DIGEST)).toBe(1);
  });

  it("un terzo giro nello stesso giorno non manda niente", async () => {
    expect(await sendDueDigests(OGGI)).toBe(0);
    expect(await righe(NotificationType.DUE_DIGEST)).toBe(1);
  });

  it("il giorno dopo riparte", async () => {
    expect(await sendDueDigests(DOMANI)).toBe(1);
    expect(await righe(NotificationType.DUE_DIGEST)).toBe(2);
  });

  it("una riga di oggi senza chiave — scritta prima di questa versione — vale come già mandato", async () => {
    const DOPODOMANI = alleSette(2);
    await prisma.notification.create({
      data: {
        userId,
        type: NotificationType.DUE_DIGEST,
        payload: "{}",
        // due ore prima del giro di dopodomani, cioè dentro alla sua giornata
        createdAt: new Date(alleSette(2).getTime() - 2 * 60 * 60 * 1000),
      },
    });
    expect(await sendDueDigests(DOPODOMANI)).toBe(0);
    expect(await righe(NotificationType.DUE_DIGEST)).toBe(3);
  });
});
