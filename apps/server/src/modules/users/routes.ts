import type { FastifyInstance } from "fastify";
import { isUniqueViolation } from "../../lib/prisma-errors";
import { z } from "zod";
import {
  EXTERNAL_ROLES,
  isExternalRole,
  ActivityCategory,
  UserRole,
  ProjectRole,
  VisibilityAccess,
  VisibilityScope,
  createUserSchema,
  resetPasswordSchema,
  updateUserSchema,
  type ResetPasswordResult,
  type User as UserDto,
} from "@kancrm/shared";
import { prisma } from "../../db";
import { badRequest, conflict, notFound } from "../../lib/http-errors";
import { requireAdmin, requireUser } from "../../plugins/auth";
import {
  assertAziendaDelCliente,
  assertNelPerimetro,
  assertSoloCampiConsentiti,
  perimetroUtenti,
  progettiAssegnabili,
} from "./access";
import { hashPassword } from "../auth/password";
import { clearPasswordLock } from "../auth/lockout";
import { deleteAllUserSessions } from "../auth/session";
import { sendPasswordResetEmail } from "../mail/service";
import { accessForScope, usersManagingCategory } from "../visibility/service";
import { deleteUser, userDeletionImpact } from "./deletion";
import { ruoloPrevisto } from "../../edition/roles";

const userInclude = {
  groups: { include: { group: true } },
  billingAssignee: { select: { id: true, name: true } },
  ticketProjects: { include: { project: { select: { id: true, name: true } } } },
} as const;

type UserWithGroups = Awaited<
  ReturnType<typeof prisma.user.findMany<{ include: typeof userInclude }>>
>[number];

function toUserDto(user: UserWithGroups): UserDto {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    role: user.role as UserDto["role"],
    authProvider: user.authProvider as UserDto["authProvider"],
    isActive: user.isActive,
    isSystem: user.isSystem,
    billingAssignee: user.billingAssignee,
    canViewAllTimesheets: user.canViewAllTimesheets,
    salesMonitorAllDeals: user.salesMonitorAllDeals,
    weeklyHours: user.weeklyHours,
    calendarAliases: user.calendarAliases,
    createdAt: user.createdAt.toISOString(),
    lastLoginAt: user.lastLoginAt?.toISOString() ?? null,
    lastSeenAt: user.lastSeenAt?.toISOString() ?? null,
    failedPasswordAttempts: user.failedPasswordAttempts,
    lockedUntil:
      user.passwordLockedUntil && user.passwordLockedUntil > new Date()
        ? user.passwordLockedUntil.toISOString()
        : null,
    groups: user.groups
      .map((membership) => ({ id: membership.group.id, name: membership.group.name }))
      .sort((a, b) => a.name.localeCompare(b.name)),
    ticketProjects: user.ticketProjects
      .map((access) => ({ id: access.project.id, name: access.project.name }))
      .sort((a, b) => a.name.localeCompare(b.name)),
    companyId: user.companyId,
  };
}

/**
 * A role this edition serves (08/10/2026): the portal and sales monitor roles
 * come with their modules. Without this, a hand-written request could create on
 * a community core a user who then cannot log in.
 */
function assertRuoloDellEdizione(ruolo: string): void {
  if (!ruoloPrevisto(ruolo)) throw badRequest("Questo ruolo non è previsto in questa edizione");
}

export function userRoutes(app: FastifyInstance): void {
  /**
   * Elenco minimale per i picker (assegnatario, supervisore, commerciale).
   *
   * Esclude sempre i clienti del portale e gli utenti di sistema: assegnare un
   * task o un'offerta a un cliente non ha senso e gli renderebbe visibili dati
   * interni. Con `?scope=DEALS` (o ADMIN_TASKS, CONTACTS, TICKETS) restringe a
   * chi ha accesso COMPLETO a quel modulo: chi lo vede in sola lettura non
   * potrebbe lavorare ciò che gli viene intestato.
   */
  app.get("/api/users/options", async (request) => {
    requireUser(request);
    const { scope, managersOf } = z
      .object({
        scope: z.nativeEnum(VisibilityScope).optional(),
        managersOf: z.nativeEnum(ActivityCategory).optional(),
      })
      .parse(request.query);

    // `?managersOf=DEV` = chi guida quel lavoro. Due sorgenti, unite: i manager
    // dei gruppi che hanno il modulo in accesso completo (chi governa l'area) e,
    // per lo sviluppo, chi è già manager di almeno un progetto. La seconda serve
    // perché i gruppi possono non essere ancora configurati, mentre i progetti
    // hanno i loro manager da sempre: senza, la tendina resterebbe vuota.
    if (managersOf) {
      const areaManagers = await usersManagingCategory(managersOf);
      const projectManagers =
        managersOf === ActivityCategory.DEV
          ? await prisma.user.findMany({
              where: {
                isActive: true,
                isSystem: false,
                role: { notIn: [...EXTERNAL_ROLES] },
                projectMemberships: { some: { role: ProjectRole.MANAGER } },
              },
              orderBy: { name: "asc" },
            })
          : [];
      const seen = new Set<string>();
      const leads = [];
      for (const user of [...areaManagers, ...projectManagers]) {
        if (seen.has(user.id)) continue;
        seen.add(user.id);
        leads.push({ id: user.id, name: user.name });
      }
      return leads.sort((a, b) => a.name.localeCompare(b.name));
    }

    const users = await prisma.user.findMany({
      where: { isActive: true, isSystem: false, role: { notIn: [...EXTERNAL_ROLES] } },
      orderBy: { name: "asc" },
    });
    const eligible = scope
      ? (
          await Promise.all(
            users.map(async (user) =>
              (await accessForScope(user, scope)) === VisibilityAccess.FULL ? user : null,
            ),
          )
        ).filter((user) => user !== null)
      : users;
    return eligible.map((user) => ({ id: user.id, name: user.name }));
  });

  /**
   * L'elenco, nel perimetro di chi guarda: tutti per l'amministratore, i soli
   * clienti del portale per il manager di gruppo che entra da customer care.
   * Il filtro **non** dipende dal parametro ricevuto: `?perimetro=portale` è
   * ciò che l'area chiede, ma a decidere è chi sei.
   */
  app.get("/api/users", async (request) => {
    const { perimetro } = await perimetroUtenti(request);
    const chiesto = (request.query as { perimetro?: string }).perimetro;
    const soloPortale = perimetro === "portale" || chiesto === "portale";
    const users = await prisma.user.findMany({
      where: soloPortale ? { role: UserRole.PORTAL } : {},
      include: userInclude,
      orderBy: { name: "asc" },
    });
    return users.map(toUserDto);
  });

  /**
   * I progetti assegnabili a un cliente: **tutti**, di proposito fuori dal
   * perimetro di visibilità. Il perché sta in `access.ts`.
   */
  app.get("/api/users/project-options", async (request) => {
    await perimetroUtenti(request);
    return progettiAssegnabili();
  });

  app.post("/api/users", async (request, reply) => {
    const { perimetro } = await perimetroUtenti(request);
    const input = createUserSchema.parse(request.body);
    // Dall'area customer care nascono clienti del portale, e nient'altro.
    assertNelPerimetro(perimetro, input.role);
    assertRuoloDellEdizione(input.role);
    if (perimetro === "portale" && input.groupIds.length > 0) {
      throw badRequest("Un utente del portale non appartiene a gruppi interni");
    }
    assertAziendaDelCliente(input.role, input.companyId);
    const passwordHash = await hashPassword(input.password);
    try {
      const user = await prisma.user.create({
        data: {
          email: input.email.toLowerCase().trim(),
          name: input.name,
          role: input.role,
          passwordHash,
          // Lingua "automatica": chi entra la prima volta vede l'app nella lingua
          // del proprio browser (inglese se non è tra quelle tradotte), finché
          // non ne sceglie una dal Profilo. Vedi resolveLanguage lato web.
          locale: "auto",
          companyId: input.companyId ?? null,
          groups: { create: input.groupIds.map((groupId) => ({ groupId })) },
        },
        include: userInclude,
      });
      return reply.status(201).send(toUserDto(user));
    } catch (error) {
      if (isUniqueViolation(error)) throw conflict("Esiste già un utente con questa email");
      throw error;
    }
  });

  app.patch("/api/users/:id", async (request) => {
    const { utente: admin, perimetro } = await perimetroUtenti(request);
    const { id } = request.params as { id: string };
    const input = updateUserSchema.parse(request.body);
    assertSoloCampiConsentiti(perimetro, input);
    if (input.role) assertRuoloDellEdizione(input.role);

    if (
      id === admin.id &&
      (input.isActive === false || (input.role && input.role !== admin.role))
    ) {
      throw badRequest("Non puoi disattivare o cambiare ruolo al tuo stesso account");
    }

    const existing = await prisma.user.findUnique({ where: { id } });
    if (!existing) throw notFound("Utente non trovato");
    if (existing.isSystem) throw badRequest("L'utente di sistema non è modificabile");
    assertNelPerimetro(perimetro, existing.role);
    // L'azienda si pretende quando la si sta toccando: chi cambia solo il nome
    // di un cliente che non ce l'ha non deve trovarsi la strada sbarrata.
    if (input.companyId !== undefined) {
      assertAziendaDelCliente(input.role ?? existing.role, input.companyId);
    }
    // L'amministrativo di riferimento dev'essere un interno attivo, e non sé stesso
    // (il task di un'offerta vinta finirebbe al commerciale che l'ha chiusa).
    if (input.billingAssigneeId) {
      if (input.billingAssigneeId === id) {
        throw badRequest("L'amministrativo di riferimento dev'essere un altro utente");
      }
      const target = await prisma.user.findUnique({ where: { id: input.billingAssigneeId } });
      if (!target || !target.isActive || target.isSystem || isExternalRole(target.role)) {
        throw badRequest("Amministrativo di riferimento non valido");
      }
    }

    // I progetti su cui si possono aprire richieste sono una tabella a parte:
    // si sostituiscono in blocco.
    const { ticketProjectIds, ...userFields } = input;
    const user = await prisma.$transaction(async (tx) => {
      const updated = await tx.user.update({ where: { id }, data: userFields });
      if (ticketProjectIds) {
        // Vale per i clienti del portale e per gli interni che aprono richieste
        // senza tenere il desk (12/08/2026). Restano fuori i monitor vendite,
        // che guardano e basta, e gli utenti di sistema, che non accedono.
        if (updated.role === UserRole.SALES_MONITOR || updated.isSystem) {
          throw badRequest("Questo utente non può aprire richieste di supporto");
        }
        await tx.ticketProjectAccess.deleteMany({ where: { userId: id } });
        await tx.ticketProjectAccess.createMany({
          data: ticketProjectIds.map((projectId) => ({ userId: id, projectId })),
        });
      }
      return tx.user.findUniqueOrThrow({ where: { id }, include: userInclude });
    });
    if (input.isActive === false) await deleteAllUserSessions(id);
    return toUserDto(user);
  });

  // Cosa comporta eliminare l'utente: la UI lo mostra e, se serve, chiede il
  // destinatario dei dati.
  app.get("/api/users/:id/deletion-impact", async (request) => {
    requireAdmin(request);
    const { id } = request.params as { id: string };
    const existing = await prisma.user.findUnique({ where: { id } });
    if (!existing) throw notFound("Utente non trovato");
    return userDeletionImpact(id);
  });

  // ?transferTo=<userId> trasferisce i dati collegati; senza dati non serve.
  app.delete("/api/users/:id", async (request, reply) => {
    const admin = requireAdmin(request);
    const { id } = request.params as { id: string };
    const { transferTo } = request.query as { transferTo?: string };
    await deleteUser(id, admin.id, transferTo ?? null);
    request.log.info({ userId: id, transferTo, by: admin.id }, "Utente eliminato");
    return reply.status(204).send();
  });

  /**
   * **Azzera il freno sui tentativi** (vedi auth/lockout.ts): la persona giusta
   * che ha sbagliato troppe volte rientra subito, senza una password nuova.
   * Stesso perimetro della reimpostazione.
   */
  app.post("/api/users/:id/unlock", async (request, reply) => {
    const { utente: admin, perimetro } = await perimetroUtenti(request);
    const { id } = request.params as { id: string };
    const existing = await prisma.user.findUnique({ where: { id } });
    if (!existing) throw notFound("Utente non trovato");
    assertNelPerimetro(perimetro, existing.role);
    await clearPasswordLock(id);
    request.log.info({ userId: id, by: admin.id }, "Freno sui tentativi azzerato");
    return reply.status(204).send();
  });

  /**
   * Reimpostazione della password da parte di un amministratore.
   *
   * Tre gesti che stanno insieme e non si separano: la password nuova è
   * **provvisoria** (`mustChangePassword`, l'utente ne sceglie una sua al primo
   * accesso), tutte le sessioni si chiudono, e le credenziali partono per email
   * a chi le deve usare — è l'unico canale verso una persona che in questo
   * momento non entra. La risposta dice **se l'email è partita**: a posta non
   * configurata l'admin deve consegnare la password a voce, e lo deve sapere
   * prima di chiudere la finestra.
   */
  app.post("/api/users/:id/reset-password", async (request) => {
    const { utente: admin, perimetro } = await perimetroUtenti(request);
    const { id } = request.params as { id: string };
    const input = resetPasswordSchema.parse(request.body);

    const existing = await prisma.user.findUnique({ where: { id } });
    if (!existing) throw notFound("Utente non trovato");
    assertNelPerimetro(perimetro, existing.role);

    await prisma.user.update({
      where: { id },
      data: { passwordHash: await hashPassword(input.password), mustChangePassword: true },
    });
    // Una password nuova in mano alla persona: il freno sui tentativi non ha più senso.
    await clearPasswordLock(id);
    await deleteAllUserSessions(id);
    request.log.info({ userId: id, by: admin.id }, "Password reimpostata");

    // L'invio non deve far fallire il reset, che è già avvenuto: se la posta
    // tace si risponde `emailSent: false` e la finestra lo dice.
    const emailSent = await sendPasswordResetEmail(existing, input.password);
    const result: ResetPasswordResult = { emailSent, email: existing.email };
    return result;
  });
}
