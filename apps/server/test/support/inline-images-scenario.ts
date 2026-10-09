// Copyright (c) 2026 Jugaad s.r.l.

import { expect } from "vitest";
import { UserRole } from "@kancrm/shared";

/**
 * The inline images tests' setup (inline-images, core, and
 * commercial/inline-images-ticket), split out on 08/10/2026: two admins, a
 * project, an open administrative status, and the helper that pastes an image.
 */

/** Un PNG vero, minimo: il server guarda il tipo dichiarato, il disco i byte. */
export const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);

export function multipart(name: string, type: string, content: Buffer) {
  const boundary = "----kancrminline";
  const head = Buffer.from(
    `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${name}"\r\n` +
      `Content-Type: ${type}\r\n\r\n`,
  );
  const tail = Buffer.from(`\r\n--${boundary}--\r\n`);
  return {
    body: Buffer.concat([head, content, tail]),
    headers: { "content-type": `multipart/form-data; boundary=${boundary}` },
  };
}

export async function inlineImagesScenario() {
  const { buildApp } = await import("../../src/app");
  const { prisma } = await import("../../src/db");
  const { hashPassword } = await import("../../src/modules/auth/password");
  const { SESSION_COOKIE } = await import("../../src/modules/auth/session");

  const autore = await prisma.user.create({
    data: {
      email: "autore@test.local",
      name: "Aldo Autore",
      role: UserRole.ADMIN,
      adminUntil: new Date("2099-01-01"),
      locale: "it",
      passwordHash: await hashPassword("autore1234"),
    },
  });
  await prisma.user.create({
    data: {
      email: "collega@test.local",
      name: "Clara Collega",
      role: UserRole.ADMIN,
      adminUntil: new Date("2099-01-01"),
      locale: "it",
      passwordHash: await hashPassword("collega1234"),
    },
  });
  const project = await prisma.project.create({
    data: { name: "Progetto figure", members: { create: { userId: autore.id, role: "MANAGER" } } },
  });
  const statusId = (
    await prisma.taskStatus.findFirstOrThrow({
      where: { category: "ADMIN", isClosed: false },
      orderBy: { order: "asc" },
    })
  ).id;

  const app = await buildApp();
  const loginCookie = async (email: string, password: string) => {
    const response = await app.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: { email, password },
    });
    return `${SESSION_COOKIE}=${response.cookies.find((c) => c.name === SESSION_COOKIE)!.value}`;
  };

  /** Incolla una figura in attesa e restituisce il suo indirizzo provvisorio. */
  const incolla = async (cookie: string, type = "image/png", content = PNG): Promise<string> => {
    const { body, headers } = multipart("schermata.png", type, content);
    const response = await app.inject({
      method: "POST",
      url: "/api/inline-images",
      headers: { ...headers, cookie },
      payload: body,
    });
    expect(response.statusCode).toBe(201);
    return response.json().url as string;
  };

  return {
    app,
    prisma,
    projectId: project.id,
    statusId,
    autoreCookie: await loginCookie("autore@test.local", "autore1234"),
    collegaCookie: await loginCookie("collega@test.local", "collega1234"),
    incolla,
  };
}
