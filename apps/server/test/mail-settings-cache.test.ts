import { rmSync } from "node:fs";
import { afterAll, describe, expect, it } from "vitest";
import { prepareTestDb } from "./support/test-db";

/** O2: le impostazioni della posta si leggono una volta, e si rileggono quando cambiano. */
const { tempDir } = prepareTestDb("mail-settings-cache");
const { prisma } = await import("../src/db");
const { readMailSettings, writeMailSettings, invalidateMailSettingsCache } =
  await import("../src/modules/mail/settings");

afterAll(async () => {
  await prisma.$disconnect();
  rmSync(tempDir, { recursive: true, force: true });
});

describe("la cache delle impostazioni", () => {
  it("una scrittura dal modulo si vede subito; una da fuori dopo l'invalidazione", async () => {
    invalidateMailSettingsCache();
    await writeMailSettings({ intro: "Prima" });
    expect((await readMailSettings()).intro).toBe("Prima");
    await writeMailSettings({ intro: "Seconda" });
    expect((await readMailSettings()).intro).toBe("Seconda");
    // scritta alle spalle del modulo: la cache non lo sa
    await prisma.appSetting.update({ where: { key: "mail.intro" }, data: { value: "Terza" } });
    expect((await readMailSettings()).intro).toBe("Seconda");
    invalidateMailSettingsCache();
    expect((await readMailSettings()).intro).toBe("Terza");
  });
});
