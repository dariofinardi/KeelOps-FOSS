import { ActivityCategory, TaskKind, UserRole } from "@kancrm/shared";

/**
 * Un'offerta in trattativa che un amministratore sposta in fase vinta, via
 * HTTP: lo scenario comune ai test del passaggio a vinta nelle due edizioni.
 * Restituisce la risposta e i task di fatturazione nati.
 */
export async function vinciUnOfferta(): Promise<{
  status: number;
  analysisState: unknown;
  analysisNotice: unknown;
  taskDiFatturazione: number;
}> {
  const { prisma } = await import("../../src/db");
  const { buildApp } = await import("../../src/app");
  const { hashPassword } = await import("../../src/modules/auth/password");
  await prisma.user.create({
    data: {
      email: "admin-vinta@test.local",
      name: "Admin",
      role: UserRole.ADMIN,
      adminUntil: new Date("2099-01-01"),
      passwordHash: await hashPassword("admin1234"),
    },
  });
  const trattativa = await prisma.dealStage.create({
    data: { name: "Trattativa (prova)", color: "#888", order: 98 },
  });
  const vinta = await prisma.dealStage.create({
    data: { name: "Vinta (prova)", color: "#0a0", order: 99, isWon: true },
  });
  const statoDeal = await prisma.taskStatus.findFirstOrThrow({
    where: { category: ActivityCategory.SALES },
  });
  const admin = await prisma.user.findUniqueOrThrow({ where: { email: "admin-vinta@test.local" } });
  const offerta = await prisma.task.create({
    data: {
      kind: TaskKind.DEAL,
      title: "Licenze annuali",
      statusId: statoDeal.id,
      creatorId: admin.id,
      assigneeId: admin.id,
      dealStageId: trattativa.id,
      dealValue: 1000,
    },
  });
  const app = await buildApp();
  const login = await app.inject({
    method: "POST",
    url: "/api/auth/login",
    payload: { email: "admin-vinta@test.local", password: "admin1234" },
  });
  const cookie = login.headers["set-cookie"]!.toString().split(";")[0]!;
  const risposta = await app.inject({
    method: "PATCH",
    url: `/api/deals/${offerta.id}`,
    headers: { cookie },
    payload: { stageId: vinta.id },
  });
  await app.close();
  const corpo = risposta.json() as { analysisState?: unknown; analysisNotice?: unknown };
  return {
    status: risposta.statusCode,
    analysisState: corpo.analysisState,
    analysisNotice: corpo.analysisNotice,
    taskDiFatturazione: await prisma.task.count({
      where: { kind: TaskKind.ADMIN, sourceDealId: offerta.id },
    }),
  };
}
