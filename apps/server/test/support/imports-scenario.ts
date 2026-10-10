// Copyright (c) 2026 Jugaad s.r.l.
// SPDX-License-Identifier: AGPL-3.0-only

import ExcelJS from "exceljs";
import { UserRole } from "@kancrm/shared";

/**
 * The import tests' setup (imports-profile, core, and
 * commercial/imports-monday), split out on 08/10/2026: an admin, a member who
 * sees administrative tasks, deals and contacts, a developer who sees nothing,
 * one deal stage.
 */
export async function xlsxBuffer(headers: string[], rows: string[][]): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("Import");
  sheet.addRow(headers);
  for (const row of rows) sheet.addRow(row);
  return Buffer.from(await workbook.xlsx.writeBuffer());
}

export function multipart(buffer: Buffer, filename: string, contentType: string) {
  const boundary = "----kancrmimport";
  const payload = Buffer.concat([
    Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\nContent-Type: ${contentType}\r\n\r\n`,
    ),
    buffer,
    Buffer.from(`\r\n--${boundary}--\r\n`),
  ]);
  return { payload, contentType: `multipart/form-data; boundary=${boundary}` };
}

export async function importsScenario() {
  const { buildApp } = await import("../../src/app");
  const { prisma } = await import("../../src/db");
  const { hashPassword } = await import("../../src/modules/auth/password");
  const { SESSION_COOKIE } = await import("../../src/modules/auth/session");

  const everyone = await prisma.group.create({ data: { name: "Tutti" } });
  await prisma.visibilitySetting.createMany({
    data: [
      { scope: "ADMIN_TASKS", groupId: everyone.id },
      { scope: "DEALS", groupId: everyone.id },
      { scope: "CONTACTS", groupId: everyone.id },
    ],
  });
  await prisma.user.create({
    data: {
      email: "admin@test.local",
      name: "Admin",
      role: UserRole.ADMIN,
      adminUntil: new Date("2099-01-01"), // fixture: admin elevato (vedi auth/elevation)
      passwordHash: await hashPassword("admin1234"),
    },
  });
  await prisma.user.create({
    data: {
      email: "member@test.local",
      name: "Mia Member",
      role: UserRole.MEMBER,
      passwordHash: await hashPassword("member1234"),
      groups: { create: { groupId: everyone.id } },
    },
  });
  // Sviluppatore senza scope: non abilitato come proprietario dei task.
  await prisma.user.create({
    data: {
      email: "dev@test.local",
      name: "Dino Dev",
      role: UserRole.MEMBER,
      passwordHash: await hashPassword("dev12345"),
    },
  });
  // Gli stati arrivano dalle migrazioni: qui basta che esistano quelli GENERAL.
  await prisma.dealStage.create({
    data: { name: "Trattativa", color: "#f59e0b", order: 0 },
  });

  const app = await buildApp();
  const loginCookie = async (email: string, password: string) => {
    const response = await app.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: { email, password },
    });
    return `${SESSION_COOKIE}=${response.cookies.find((c) => c.name === SESSION_COOKIE)!.value}`;
  };
  return {
    app,
    prisma,
    adminCookie: await loginCookie("admin@test.local", "admin1234"),
    memberCookie: await loginCookie("member@test.local", "member1234"),
  };
}
