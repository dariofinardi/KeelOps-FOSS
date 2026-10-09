// Copyright (c) 2026 Jugaad s.r.l.

import { TaskKind, UserRole } from "@kancrm/shared";

/**
 * The deals of the "next step" tests (deal-next-step, core, and
 * commercial/deal-next-step-monitor), split out on 08/10/2026: an admin, a
 * negotiation and a won stage, six deals with their steps. Dates are relative
 * to today in the company time zone: the tests do not age.
 */
export const PW = "password-di-prova-1";

export async function dealNextStepScenario() {
  const { buildApp } = await import("../../src/app");
  const { prisma } = await import("../../src/db");
  const { hashPassword } = await import("../../src/modules/auth/password");
  const { SESSION_COOKIE } = await import("../../src/modules/auth/session");
  const { dayInRome } = await import("../../src/lib/date");
  const giorno = (delta: number) => {
    const base = new Date(`${dayInRome()}T00:00:00.000Z`);
    base.setUTCDate(base.getUTCDate() + delta);
    return base;
  };
  const offerte: Record<string, string> = {};
  const hash = await hashPassword(PW);
  const admin = await prisma.user.create({
    data: {
      email: "admin@test.local",
      name: "Ada Admin",
      role: UserRole.ADMIN,
      adminUntil: new Date("2099-01-01"),
      passwordHash: hash,
    },
  });
  const trattativa = await prisma.dealStage.create({
    data: { name: "Trattativa", color: "#f59e0b", order: 0 },
  });
  const vinta = await prisma.dealStage.create({
    data: { name: "Vinta", color: "#16a34a", order: 1, isWon: true },
  });
  const statoOfferta = await prisma.taskStatus.findFirstOrThrow({ where: { category: "SALES" } });
  const aperto = await prisma.taskStatus.findFirstOrThrow({
    where: { category: "ADMIN", isClosed: false },
  });
  const chiuso = await prisma.taskStatus.findFirstOrThrow({ where: { isClosed: true } });

  const offerta = async (
    title: string,
    chiusura: number | null,
    extra: Record<string, unknown> = {},
  ) => {
    const creata = await prisma.task.create({
      data: {
        kind: TaskKind.DEAL,
        title,
        statusId: statoOfferta.id,
        dealStageId: trattativa.id,
        creatorId: admin.id,
        assigneeId: admin.id,
        expectedCloseDate: chiusura === null ? null : giorno(chiusura),
        ...extra,
      },
    });
    offerte[title] = creata.id;
    return creata.id;
  };
  const passo = (
    dealId: string,
    title: string,
    scadenza: number | null,
    extra: Record<string, unknown> = {},
  ) =>
    prisma.task.create({
      data: {
        kind: TaskKind.ADMIN,
        title,
        statusId: aperto.id,
        creatorId: admin.id,
        assigneeId: admin.id,
        relatedDealId: dealId,
        dueDate: scadenza === null ? null : giorno(scadenza),
        ...extra,
      },
    });

  // Ferma: nessun passo. Il task chiuso e quello nel cestino non contano.
  const senza = await offerta("Senza passo", 30);
  await passo(senza, "Già fatto", -5, { statusId: chiuso.id });
  await passo(senza, "Cestinato", 5, { deletedAt: new Date() });
  // Ferma: il passo più vicino è scaduto (e ce n'è un altro dopo).
  const scaduto = await offerta("Passo scaduto", 30);
  await passo(scaduto, "Richiamare il cliente", -3);
  await passo(scaduto, "Mandare il preventivo", 10);
  // Ferma: la chiusura prevista è passata, anche se il passo è in programma.
  const chiusuraPassata = await offerta("Chiusura passata", -2);
  await passo(chiusuraPassata, "Sollecito firma", 4);
  // In moto: passo in programma, chiusura futura.
  const inMoto = await offerta("In moto", 40, { visibleToSalesMonitors: true });
  await passo(inMoto, "Demo con l'ufficio acquisti — margine minimo 15%", 2);
  // In moto: il passo c'è ma senza data.
  const senzaData = await offerta("Passo senza data", 40);
  await passo(senzaData, "Da pianificare", null);
  // Conclusa: mai ferma, anche senza passo e con la data passata.
  await offerta("Vinta senza passo", -30, { dealStageId: vinta.id, closedAt: giorno(-30) });

  const app = await buildApp();
  const login = async (email: string) => {
    const res = await app.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: { email, password: PW },
    });
    return `${SESSION_COOKIE}=${res.cookies.find((c) => c.name === SESSION_COOKIE)!.value}`;
  };
  const adminCookie = await login("admin@test.local");
  return { app, prisma, hash, login, adminCookie, offerte };
}
