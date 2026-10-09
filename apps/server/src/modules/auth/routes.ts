import type { FastifyInstance, FastifyRequest } from "fastify";
import { randomUUID } from "node:crypto";
import path from "node:path";
import {
  type AuthProviders,
  UserRole,
  VisibilityAccess,
  VisibilityScope,
  changePasswordSchema,
  confirmPasswordResetInput,
  loginSchema,
  requestLoginCodeInput,
  requestPasswordResetInput,
  verifyLoginCodeInput,
  updateProfileSchema,
} from "@kancrm/shared";
import { allowedAttachmentExtensions } from "@kancrm/shared";
import { extraAttachmentExtensions } from "../attachments/extensions";
import { config } from "../../config";
import { prisma } from "../../db";
import { badRequest, forbidden, notFound, unauthorized } from "../../lib/http-errors";
import {
  requireAuthUser,
  requireUser,
  opzioniCookieSessione,
  sessionCookieOptions,
  toCurrentUser,
} from "../../plugins/auth";
import { canElevate, effectiveUser, elevationExpiry } from "./elevation";
import { haModulo, moduliAttivi } from "../../edition/registry";
import { canSeeDevMetrics } from "../dev-metrics/service";
import {
  accessForScope,
  canSeeScope,
  canViewTeamTimesheet,
  hasDealsDaysLens,
  isAnyManager,
  isGroupManager,
  manageableCategories,
} from "../visibility/service";
import { sanitizeFilename } from "../attachments/storage";
import { attachmentStore } from "../attachments/store";
import type { User } from "../../generated/prisma/client";
import { checkPassword, hashPassword, verifyPassword } from "./password";
import { assertNotLocked, clearPasswordLock, registerFailedPassword } from "./lockout";
import { perUtente } from "../../lib/rate-limit";
import {
  consumeResetChallenge,
  createOtpChallenge,
  createResetChallenge,
  inCooldown,
  verifyOtpChallenge,
} from "./challenges";
import { sendLoginCodeEmail, sendPasswordResetLinkEmail } from "../mail/service";

const AVATAR_DIR = "_avatars";
/** La chiave dell'avatar nel magazzino allegati (vedi attachments/store). */
const avatarKey = (filename: string) => `${AVATAR_DIR}/${filename}`;
const AVATAR_URL_PREFIX = "/api/avatars/";
const AVATAR_EXTS: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
};

/** Nome del file avatar salvato per un URL "/api/avatars/<file>" (null se non è un avatar). */
function avatarFileOf(avatarUrl: string | null): string | null {
  return avatarUrl?.startsWith(AVATAR_URL_PREFIX)
    ? avatarUrl.slice(AVATAR_URL_PREFIX.length)
    : null;
}

/**
 * DTO utente corrente con i flag di visibilità dei moduli.
 *
 * Riceve l'utente **vero** (com'è in banca dati) e applica qui la maschera
 * dell'elevazione: i permessi si calcolano sul ruolo EFFICACE — un admin non
 * elevato vede quello che gli concedono i suoi gruppi, come un collega — ma il
 * DTO dice anche che potrebbe elevarsi, o il pulsante sparirebbe.
 */
export async function currentUserDto(real: User) {
  const user = effectiveUser(real);
  const isPortal = user.role === UserRole.PORTAL;
  const dealsAccess = isPortal ? null : await accessForScope(user, VisibilityScope.DEALS);
  const estensioni = await Promise.all(
    moduliAttivi().map(async (modulo) => (await modulo.utenteCorrente?.(user)) ?? {}),
  );
  return toCurrentUser(
    user,
    real,
    {
      canSeeDeals: dealsAccess !== null,
      canSeeAdminTasks: !isPortal && (await canSeeScope(user, VisibilityScope.ADMIN_TASKS)),
      canSeeContacts: !isPortal && (await canSeeScope(user, VisibilityScope.CONTACTS)),
      isManager: !isPortal && (await isAnyManager(user)),
      canEditDeals: dealsAccess === VisibilityAccess.FULL,
      // Gruppi con le Offerte in "Giornate" (gli sviluppatori): elenco in sola
      // consultazione, importi tradotti in giornate.
      dealsDaysView: dealsAccess === null && (await hasDealsDaysLens(user)),
      canViewTeamTimesheet: !isPortal && (await canViewTeamTimesheet(user)),
    canSeeDevMetrics: await canSeeDevMetrics(user),
      isGroupManager: !isPortal && (await isGroupManager(user)),
      manageableCategories: isPortal ? [] : [...(await manageableCategories(user))],
      // Un cliente del portale ha un elenco chiuso — quello di casa più le
      // estensioni configurate; un interno allega quello che vuole, e l'elenco
      // vuoto dice proprio quello.
      attachmentExtensions: isPortal
        ? allowedAttachmentExtensions(await extraAttachmentExtensions())
        : [],
    },
    estensioni,
  );
}
import { SESSION_COOKIE, createSession, deleteOtherUserSessions, deleteSession } from "./session";

/**
 * **Anti brute-force sul login**, tarato su chi sbaglia in buona fede.
 *
 * Contava per **indirizzo IP**, e su una rete aziendale l'IP è uno solo: bastava
 * che una persona provasse due account con la password sbagliata perché tutto
 * l'ufficio si trovasse chiuso fuori per un quarto d'ora — successo il
 * 03/09/2026, provando l'accesso di un cliente appena creato. Un limite che
 * punisce i colleghi di chi ha sbagliato non protegge, intralcia.
 *
 * Ora la chiave è **IP + indirizzo di chi tenta**: chi martella un account non
 * blocca gli altri, e chi prova mille account da un IP lo fa comunque un
 * account per volta. La finestra scende a cinque minuti, che è il tempo in cui
 * si ritrova una password, non quello in cui si smette di lavorare.
 *
 * `preHandler` e non `onRequest`: la chiave ha bisogno del corpo della
 * richiesta, che prima non è ancora stato letto.
 */
const LOGIN_RATE_LIMIT = {
  max: Number(process.env.LOGIN_RATE_LIMIT_MAX ?? 10),
  timeWindow: "5 minutes",
  hook: "preHandler" as const,
  keyGenerator: (request: FastifyRequest): string => {
    const corpo = request.body as { email?: unknown } | undefined;
    const email = typeof corpo?.email === "string" ? corpo.email.trim().toLowerCase() : "";
    return `${request.ip}|${email}`;
  },
} as const;

export function authRoutes(app: FastifyInstance): void {
  app.post(
    "/api/auth/login",
    { config: { public: true, rateLimit: LOGIN_RATE_LIMIT } },
    async (request, reply) => {
      const { email, password } = loginSchema.parse(request.body);

      const user = await prisma.user.findUnique({ where: { email: email.toLowerCase().trim() } });
      if (!user || !user.isActive || !user.passwordHash) {
        request.log.warn({ email, ip: request.ip }, "Login fallito: utente non valido");
        throw unauthorized("Credenziali non valide");
      }
      // Il freno progressivo (vedi lockout.ts): chiuso, non si prova nemmeno.
      assertNotLocked(user);
      const check = await checkPassword(user.passwordHash, password);
      const valid = check.ok;
      if (!valid) {
        const freno = await registerFailedPassword(user.id);
        request.log.warn(
          { email, ip: request.ip, tentativi: freno.attempts, bloccatoFino: freno.lockedUntil },
          "Login fallito: password errata",
        );
        throw unauthorized("Credenziali non valide");
      }
      if (user.failedPasswordAttempts > 0 || user.passwordLockedUntil) {
        await clearPasswordLock(user.id);
      }

      // Hash scritto prima che il pepe fosse attivo: si riscrive adesso, che è
      // l'unico momento in cui la password in chiaro esiste. Nessuno deve
      // reimpostare niente, e al secondo accesso l'hash è già quello nuovo.
      if (check.needsUpgrade) {
        await prisma.user.update({
          where: { id: user.id },
          data: { passwordHash: await hashPassword(password) },
        });
        request.log.info({ userId: user.id }, "Hash della password riscritto con il pepe");
      }

      await prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });

      const { token, expiresAt } = await createSession(user.id);
      reply.setCookie(SESSION_COOKIE, token, opzioniCookieSessione(request, expiresAt));
      request.log.info({ userId: user.id, ip: request.ip }, "Login riuscito");
      return currentUserDto(user);
    },
  );

  /**
   * Reimpostazione password self-service. La risposta è SEMPRE la stessa,
   * esista o no l'utente: da fuori non si enumera nessuno. L'email parte solo
   * per utenti attivi con accesso locale (chi entra con Google una password
   * non ce l'ha: reimpostarla non sbloccherebbe niente).
   */
  app.post(
    "/api/auth/password-reset/request",
    { config: { public: true, rateLimit: LOGIN_RATE_LIMIT } },
    async (request) => {
      const { email } = requestPasswordResetInput.parse(request.body);
      const user = await prisma.user.findUnique({ where: { email: email.toLowerCase().trim() } });
      if (
        user &&
        user.isActive &&
        user.passwordHash &&
        !(await inCooldown(user.id, "RESET_PASSWORD"))
      ) {
        const token = await createResetChallenge(user);
        const base = config.publicUrl || "";
        const sent = await sendPasswordResetLinkEmail(
          { email: user.email, name: user.nickName || user.name, locale: user.locale },
          `${base}/reimposta-password?token=${encodeURIComponent(token)}`,
        );
        request.log.info({ userId: user.id, sent }, "Reset password richiesto");
      } else {
        request.log.info({ email }, "Reset password richiesto per indirizzo non eleggibile");
      }
      return { ok: true };
    },
  );

  app.post(
    "/api/auth/password-reset/confirm",
    { config: { public: true, rateLimit: LOGIN_RATE_LIMIT } },
    async (request, reply) => {
      const { token, password } = confirmPasswordResetInput.parse(request.body);
      const user = await consumeResetChallenge(token);
      if (!user) throw unauthorized("Collegamento scaduto o già usato: richiedine uno nuovo");
      await prisma.user.update({
        where: { id: user.id },
        data: { passwordHash: await hashPassword(password), mustChangePassword: false },
      });
      // la nuova password NON si somma alle chiavi esistenti: fuori tutte le sessioni
      await prisma.session.deleteMany({ where: { userId: user.id } });
      reply.clearCookie(SESSION_COOKIE, sessionCookieOptions);
      request.log.info({ userId: user.id }, "Password reimpostata via link email");
      return { ok: true };
    },
  );

  /**
   * Accesso con codice via email: la prova di possesso della casella vale
   * come credenziale, per chi entra con password come per chi entra con
   * Google. Stessa uniformità del reset: la richiesta risponde sempre uguale.
   */
  app.post(
    "/api/auth/otp/request",
    { config: { public: true, rateLimit: LOGIN_RATE_LIMIT } },
    async (request) => {
      const { email } = requestLoginCodeInput.parse(request.body);
      const user = await prisma.user.findUnique({ where: { email: email.toLowerCase().trim() } });
      if (user && user.isActive && !(await inCooldown(user.id, "EMAIL_OTP"))) {
        const code = await createOtpChallenge(user);
        const sent = await sendLoginCodeEmail(
          { email: user.email, name: user.nickName || user.name, locale: user.locale },
          code,
        );
        request.log.info({ userId: user.id, sent }, "Codice di accesso richiesto");
      } else {
        request.log.info({ email }, "Codice di accesso richiesto per indirizzo non eleggibile");
      }
      return { ok: true };
    },
  );

  app.post(
    "/api/auth/otp/verify",
    { config: { public: true, rateLimit: LOGIN_RATE_LIMIT } },
    async (request, reply) => {
      const { email, code } = verifyLoginCodeInput.parse(request.body);
      const user = await prisma.user.findUnique({ where: { email: email.toLowerCase().trim() } });
      if (!user || !user.isActive || !(await verifyOtpChallenge(user, code))) {
        request.log.warn({ email, ip: request.ip }, "Codice di accesso non valido");
        throw unauthorized("Codice non valido o scaduto");
      }
      await prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });
      const { token, expiresAt } = await createSession(user.id);
      reply.setCookie(SESSION_COOKIE, token, opzioniCookieSessione(request, expiresAt));
      request.log.info({ userId: user.id, ip: request.ip }, "Login riuscito con codice email");
      return currentUserDto(user);
    },
  );

  app.post("/api/auth/logout", async (request, reply) => {
    const token = request.cookies[SESSION_COOKIE];
    if (token) await deleteSession(token);
    reply.clearCookie(SESSION_COOKIE, sessionCookieOptions);
    return reply.status(204).send();
  });

  app.get("/api/auth/me", async (request) => {
    return currentUserDto(requireAuthUser(request));
  });

  /**
   * Privilegi di amministratore a richiesta (stile sudo, 11/08/2026): si
   * lavora da utente normale e ci si eleva solo quando serve — la pagina
   * Utenti, gli stati, il cestino. Scade da sé dopo mezz'ora.
   *
   * Il controllo guarda il ruolo VERO (`requireAuthUser`): `requireAdmin`
   * qui non servirebbe a niente, perché chi non è elevato risulta MEMBER.
   */
  app.post("/api/auth/elevate", async (request) => {
    const real = requireAuthUser(request);
    if (!canElevate(real)) throw forbidden("Riservato agli amministratori");
    const updated = await prisma.user.update({
      where: { id: real.id },
      data: { adminUntil: elevationExpiry() },
    });
    request.log.info({ userId: real.id }, "Privilegi di amministratore elevati");
    return currentUserDto(updated);
  });

  /** Rientro immediato: si torna a lavorare con gli occhi di un utente normale. */
  app.post("/api/auth/step-down", async (request) => {
    const real = requireAuthUser(request);
    const updated = await prisma.user.update({
      where: { id: real.id },
      data: { adminUntil: null },
    });
    return currentUserDto(updated);
  });

  // Provider disponibili, letti senza sessione dalla pagina di login e dagli
  // allegati (selettore Drive). Solo flag e valori pubblici: nessun segreto.
  app.get("/api/auth/providers", { config: { public: true } }, async () => {
    const g = config.oauth.google;
    // Google is the commercial `google` module: without it, nothing to offer.
    const google = haModulo("google");
    return {
      // le vie self-service via email esistono solo se il mailer è configurato
      email: { passwordReset: config.mail.enabled, otp: config.mail.enabled },
      google: {
        sso: google && g.enabled,
        picker: {
          enabled: google && g.picker.enabled,
          clientId: google ? g.clientId : "",
          apiKey: google ? g.picker.apiKey : "",
          appId: google ? g.picker.appId : "",
        },
      },
      // Solo dove è una demo: in produzione `config.demo` è null e la pagina
      // di accesso non ha nessun elenco da mostrare.
      demo: config.demo
        ? {
            ...config.demo,
            // Solo l'identificativo: il segreto del Measurement Protocol resta qui.
            analytics: config.analytics ? { measurementId: config.analytics.measurementId } : null,
          }
        : null,
    } satisfies AuthProviders;
  });

  // Preferenze personali: nickname, colore avatar, valuta, lingua.
  app.put("/api/profile", async (request) => {
    const user = requireUser(request);
    const input = updateProfileSchema.parse(request.body);
    const updated = await prisma.user.update({
      where: { id: user.id },
      data: {
        ...(input.nickName !== undefined ? { nickName: input.nickName } : {}),
        ...(input.accentColor !== undefined ? { accentColor: input.accentColor } : {}),
        ...(input.currency !== undefined ? { currency: input.currency } : {}),
        ...(input.locale !== undefined ? { locale: input.locale } : {}),
        ...(input.theme !== undefined ? { theme: input.theme } : {}),
      },
    });
    return currentUserDto(updated);
  });

  // Avatar immagine: caricamento, rimozione e servizio del file (su disco, come gli
  // allegati — nel DB va solo l'URL in User.avatarUrl).
  app.post("/api/profile/avatar", async (request) => {
    const user = requireUser(request);
    const file = await request.file();
    if (!file) throw badRequest("Nessun file ricevuto");
    const ext = path.extname(sanitizeFilename(file.filename)).toLowerCase();
    if (!file.mimetype.startsWith("image/") || !(ext in AVATAR_EXTS)) {
      throw badRequest("Serve un'immagine PNG, JPG, WEBP o GIF");
    }
    const buffer = await file.toBuffer(); // rispetta il limite di @fastify/multipart
    const filename = `${user.id}-${randomUUID()}${ext}`;
    await attachmentStore().write(avatarKey(filename), buffer);

    const previous = avatarFileOf(user.avatarUrl);
    const updated = await prisma.user.update({
      where: { id: user.id },
      data: { avatarUrl: `${AVATAR_URL_PREFIX}${filename}` },
    });
    // Rimuove il file precedente solo dopo aver salvato il nuovo riferimento.
    if (previous) {
      await attachmentStore().remove(avatarKey(previous));
    }
    return currentUserDto(updated);
  });

  app.delete("/api/profile/avatar", async (request) => {
    const user = requireUser(request);
    const previous = avatarFileOf(user.avatarUrl);
    const updated = await prisma.user.update({
      where: { id: user.id },
      data: { avatarUrl: null },
    });
    if (previous) {
      await attachmentStore().remove(avatarKey(previous));
    }
    return currentUserDto(updated);
  });

  // Servizio degli avatar: immagini mostrate agli utenti interni autenticati.
  app.get("/api/avatars/:file", async (request, reply) => {
    requireUser(request);
    const { file } = request.params as { file: string };
    const ext = path.extname(file).toLowerCase();
    const type = AVATAR_EXTS[ext];
    if (!type) throw notFound("Avatar non trovato");
    let key: string;
    try {
      // `safeKey` (dentro il magazzino) rifiuta le risalite: la chiave arriva
      // dall'indirizzo, quindi da fuori.
      key = avatarKey(file);
    } catch {
      throw notFound("Avatar non trovato");
    }
    const buffer = await attachmentStore()
      .read(key)
      .catch(() => null);
    if (!buffer) throw notFound("Avatar non trovato");
    return reply.type(type).header("Cache-Control", "private, max-age=300").send(buffer);
  });

  // Cambio password self-service: revoca tutte le altre sessioni. La password
  // attuale sbagliata conta come al login: stesso freno progressivo, più un
  // tetto per persona — da una sessione rubata era un oracolo senza limite.
  app.post(
    "/api/auth/change-password",
    { config: { rateLimit: perUtente(10, "15 minutes") } },
    async (request, reply) => {
      const user = requireUser(request);
      const input = changePasswordSchema.parse(request.body);
      assertNotLocked(user);
      if (!user.passwordHash || !(await verifyPassword(user.passwordHash, input.currentPassword))) {
        const freno = await registerFailedPassword(user.id);
        request.log.warn(
          { userId: user.id, ip: request.ip, tentativi: freno.attempts },
          "Cambio password fallito",
        );
        throw badRequest("La password attuale non è corretta");
      }
      if (user.failedPasswordAttempts > 0 || user.passwordLockedUntil) {
        await clearPasswordLock(user.id);
      }
      await prisma.user.update({
        where: { id: user.id },
        data: {
          passwordHash: await hashPassword(input.newPassword),
          // Se era una password provvisoria consegnata da un amministratore, ora
          // non lo è più: la persona ne ha scelta una sua e l'applicazione si
          // riapre. È l'unico punto in cui il segno si toglie.
          mustChangePassword: false,
        },
      });
      const token = request.cookies[SESSION_COOKIE];
      if (token) await deleteOtherUserSessions(user.id, token);
      request.log.info({ userId: user.id }, "Password cambiata");
      return reply.status(204).send();
    },
  );

  // Disconnette tutte le sessioni tranne quella corrente.
  app.post("/api/auth/logout-others", async (request, reply) => {
    const user = requireUser(request);
    const token = request.cookies[SESSION_COOKIE];
    if (token) await deleteOtherUserSessions(user.id, token);
    return reply.status(204).send();
  });
}
