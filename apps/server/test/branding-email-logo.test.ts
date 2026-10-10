// Copyright (c) 2026 Jugaad s.r.l.
// SPDX-License-Identifier: AGPL-3.0-only

import { rmSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import sharp from "sharp";
import { prepareTestDb } from "./support/test-db";

const { tempDir } = prepareTestDb("emaillogo");

const { prisma } = await import("../src/db");
const { readBrandingLogoForEmail } = await import("../src/modules/branding/logo");
const { config } = await import("../src/config");

/** Un logo alto e trasparente, come quello vero: 322×512 con canale alpha. */
async function scriviLogo(filename: string, content: Buffer): Promise<void> {
  const dir = path.join(config.uploadsDir, "_branding");
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, filename), content);
  await prisma.appSetting.upsert({
    where: { key: "branding.logo" },
    update: { value: filename },
    create: { key: "branding.logo", value: filename },
  });
}

const trasparente = (formato: "webp" | "png") =>
  sharp({
    create: { width: 322, height: 512, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
  })
    [formato]()
    .toBuffer();

beforeAll(async () => {
  await scriviLogo("logo-prova.webp", await trasparente("webp"));
});

afterAll(async () => {
  await prisma.$disconnect();
  rmSync(tempDir, { recursive: true, force: true });
});

describe("il logo che parte nelle email", () => {
  it("è PNG anche se quello caricato è WEBP", async () => {
    // È il difetto del 07/08/2026: i programmi che l'alpha del WEBP non lo
    // gestiscono appiattivano l'immagine sul nero, e arrivava un rettangolo.
    const logo = await readBrandingLogoForEmail();
    expect(logo?.contentType).toBe("image/png");
    expect(logo?.content.subarray(1, 4).toString("ascii")).toBe("PNG");
  });

  it("conserva la trasparenza invece di appiattirla", async () => {
    const logo = await readBrandingLogoForEmail();
    expect((await sharp(logo!.content).metadata()).hasAlpha).toBe(true);
  });

  it("viaggia della misura giusta, non 512 pixel di altezza", async () => {
    // Il template lo disegna a 32 px: spedirne 512 vuol dire allegare a ogni
    // notifica un'immagine che nessuno vedrà mai a quella dimensione.
    const logo = await readBrandingLogoForEmail();
    const meta = await sharp(logo!.content).metadata();
    expect(meta.height).toBe(96);
  });

  it("un file illeggibile non blocca la notifica: parte senza immagine", async () => {
    await scriviLogo("logo-rotto.png", Buffer.from("non sono un'immagine"));
    expect(await readBrandingLogoForEmail()).toBeNull();
  });
});
