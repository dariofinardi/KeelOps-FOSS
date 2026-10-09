import type { FastifyInstance, FastifyRequest } from "fastify";
import cookie from "@fastify/cookie";
import { ActivityCategory, UserRole, type CurrentUser } from "@kancrm/shared";
import type { User } from "../generated/prisma/client";
import { config } from "../config";
import { forbidden, unauthorized } from "../lib/http-errors";
import { prisma } from "../db";
import { rifiutoPerRuolo } from "../edition/roles";
import { canElevate, effectiveUser, isElevated } from "../modules/auth/elevation";
import { shouldRefreshLastSeen } from "../modules/auth/last-seen";
import { SESSION_COOKIE, findSessionUser } from "../modules/auth/session";
import { isPubblica, type RegolaPubblica } from "./plugin-public";

declare module "fastify" {
  interface FastifyRequest {
    /**
     * L'utente con il ruolo **efficace**: un admin che non si è elevato è un
     * MEMBER (vedi modules/auth/elevation). È questo che leggono permessi,
     * perimetri e DTO — nessun'altra parte dell'applicazione deve occuparsi
     * dell'elevazione.
     */
    currentUser: User | null;
    /** L'utente com'è in banca dati (ruolo vero): serve SOLO a chi decide
     *  sull'elevazione e al DTO, che deve dire "puoi elevarti". */
    authUser: User | null;
  }
  interface FastifyContextConfig {
    /** Route raggiungibile senza sessione (login, health). */
    public?: boolean;
    /** Rotta di un plugin: il suo nome e i percorsi che ha dichiarato pubblici. */
    plugin?: { name: string; pubblici: RegolaPubblica[] };
  }
}

/**
 * Le uniche rotte raggiungibili con una password provvisoria: sapere chi si è,
 * cambiarla, uscire, e il marchio della pagina (logo e titolo, altrimenti la
 * schermata di cambio password comparirebbe spoglia).
 */
const PASSWORD_CHANGE_ALLOWED = [
  "/api/auth/me",
  "/api/auth/change-password",
  "/api/auth/logout",
  "/api/branding",
];

function passwordChangeAllowed(url: string): boolean {
  const path = url.split("?")[0] ?? url;
  return PASSWORD_CHANGE_ALLOWED.some((prefix) => path.startsWith(prefix));
}

export const sessionCookieOptions = {
  httpOnly: true,
  sameSite: "lax",
  secure: !config.isDev,
  path: "/",
} as const;

/** Dove il browser tiene la scelta sui cookie: `1` accettati, `0` solo necessari. */
export const CONSENT_COOKIE = "kancrm_consenso";

/**
 * Le opzioni del cookie di sessione.
 *
 * **In un'installazione normale non cambia niente**: il cookie dura quanto la
 * sessione in banca dati, come è sempre stato, e a nessuno viene chiesto il
 * permesso per niente. Un gestionale interno non è un sito pubblico: chi entra
 * ha un contratto di lavoro, non un banner.
 *
 * **Nella dimostrazione**, che è pubblica e la vede gente che non ci ha mai
 * messo piede, si chiede — e si chiede la sola cosa che ha senso chiedere. Il
 * cookie che ti fa entrare è strettamente necessario: senza, l'applicazione
 * non si usa, e domandarne il permesso sarebbe una finta. Quello che il
 * permesso lo richiede davvero è **restare connessi**, perché una scadenza di
 * giorni sopravvive alla finestra del browser e non è più «il tempo della
 * sessione». Quindi: senza consenso il cookie non ha scadenza e muore
 * chiudendo il browser — si entra lo stesso, si esce prima.
 */
export function opzioniCookieSessione(
  request: FastifyRequest,
  expiresAt: Date,
): typeof sessionCookieOptions & { expires?: Date } {
  if (config.demo === null) return { ...sessionCookieOptions, expires: expiresAt };
  const accettati = request.cookies[CONSENT_COOKIE] === "1";
  return accettati ? { ...sessionCookieOptions, expires: expiresAt } : { ...sessionCookieOptions };
}

export async function registerAuth(app: FastifyInstance): Promise<void> {
  await app.register(cookie);
  app.decorateRequest("currentUser", null);
  app.decorateRequest("authUser", null);

  // Guard globale: tutte le route /api richiedono sessione, salvo config.public.
  // Vale anche per le rotte dei plugin (`/plugins/<nome>/…`), salvo i percorsi
  // che il manifesto dichiara pubblici: prima ogni plugin si difendeva da sé,
  // e la prossima rotta scritta senza controllo sarebbe stata aperta a tutti
  // senza che un test lo dicesse (V2 di PLAN_OPTIMIZE, 05/09/2026).
  app.addHook("onRequest", async (request) => {
    const plugin = request.routeOptions?.config?.plugin;
    if (!request.url.startsWith("/api") && !plugin) return;
    if (request.routeOptions?.config?.public) return;
    if (plugin) {
      const path = request.url.split("?")[0] ?? request.url;
      const interno = path.slice(`/plugins/${plugin.name}`.length) || "/";
      if (isPubblica(plugin.pubblici, request.method, interno)) return;
    }

    const token = request.cookies[SESSION_COOKIE];
    const user = token ? await findSessionUser(token) : null;
    if (!user) throw unauthorized();
    // UNICO punto in cui l'elevazione conta: da qui in poi il ruolo è quello
    // efficace, e un'elevazione scaduta è già rientrata da sé.
    request.authUser = user;
    request.currentUser = effectiveUser(user);

    // Ultima attività, scritta con parsimonia (vedi last-seen): dice chi usa
    // davvero l'applicazione, che è un'altra cosa da chi ha fatto l'accesso —
    // una sessione dura giorni. Non blocca la richiesta e non la fa fallire.
    if (shouldRefreshLastSeen(user.lastSeenAt, new Date())) {
      void prisma.user
        .update({ where: { id: user.id }, data: { lastSeenAt: new Date() } })
        .catch(() => undefined);
    }

    // Password provvisoria (l'ha reimpostata un amministratore e viaggiata per
    // email): la sessione esiste solo per cambiarla. Il browser lo sa già dal
    // DTO e mostra la schermata dedicata, ma il controllo vive **qui**: una
    // password spedita per posta non deve aprire l'applicazione a nessuno che
    // sappia parlare con le API direttamente.
    if (user.mustChangePassword && !passwordChangeAllowed(request.url)) {
      throw forbidden("Imposta una nuova password per continuare");
    }

    // I ruoli che non sono del nucleo (clienti del portale, monitor vendite)
    // entrano solo nei percorsi che il loro modulo dichiara; un ruolo che
    // nessun modulo dichiara non entra (vedi edition/roles.ts).
    const rifiuto = rifiutoPerRuolo(
      user.role,
      request.method,
      request.url.split("?")[0] ?? request.url,
    );
    if (rifiuto) throw forbidden(rifiuto);
  });
}

/** L'utente com'è in banca dati (ruolo vero), per le sole rotte dell'elevazione. */
export function requireAuthUser(request: FastifyRequest): User {
  if (!request.authUser) throw unauthorized();
  return request.authUser;
}

/** Utente della richiesta (non-null oltre il guard). */
export function requireUser(request: FastifyRequest): User {
  if (!request.currentUser) throw unauthorized();
  return request.currentUser;
}

export function requireAdmin(request: FastifyRequest): User {
  const user = requireUser(request);
  if (user.role !== UserRole.ADMIN) {
    throw forbidden("Riservato agli amministratori");
  }
  return user;
}

/**
 * I permessi che il DTO porta al browser. Un oggetto e non una fila di
 * booleani: erano undici argomenti posizionali dello stesso tipo, e scambiarne
 * due di posto avrebbe dato a qualcuno il modulo di qualcun altro senza che il
 * compilatore battesse ciglio.
 */
export interface CurrentUserPermissions {
  canSeeDeals: boolean;
  canSeeAdminTasks: boolean;
  canSeeContacts: boolean;
  isManager: boolean;
  canEditDeals: boolean;
  dealsDaysView: boolean;
  /** Sees other people's hours (the timesheet grid is core since 08/10/2026). */
  canViewTeamTimesheet: boolean;
  /** Sees «L'andamento» (core since 08/10/2026). */
  canSeeDevMetrics: boolean;
  isGroupManager: boolean;
  manageableCategories: ActivityCategory[];
  /** Estensioni ammesse: elenco chiuso per i clienti del portale, vuoto agli interni. */
  attachmentExtensions: string[];
}

export function toCurrentUser(
  user: User,
  /** Ruolo vero (per l'elevazione): l'utente com'è in banca dati. */
  real: { role: string; adminUntil: Date | null },
  permissions: CurrentUserPermissions,
  /**
   * I campi dei moduli dell'edizione (ticket, ore, monitor vendite): ognuno
   * sovrascrive il suo `false`, che resta al suo posto nel JSON.
   */
  estensioni: ReadonlyArray<Partial<CurrentUser>> = [],
): CurrentUser {
  const {
    canSeeDeals,
    canSeeAdminTasks,
    canSeeContacts,
    isManager,
    canEditDeals,
    dealsDaysView,
    canViewTeamTimesheet,
    canSeeDevMetrics,
    isGroupManager,
    manageableCategories,
    attachmentExtensions,
  } = permissions;
  const dto: CurrentUser = {
    id: user.id,
    email: user.email,
    name: user.name,
    role: user.role as CurrentUser["role"],
    canSeeDeals,
    canEditDeals,
    dealsDaysView,
    canSeeAdminTasks,
    canSeeTickets: false,
    canManageTickets: false,
    canSeeContacts,
    canSeeDevMetrics,
    isManager,
    nickName: user.nickName,
    accentColor: user.accentColor,
    currency: user.currency,
    locale: user.locale,
    theme: user.theme,
    avatarUrl: user.avatarUrl,
    attachmentExtensions,
    canElevate: canElevate(real),
    adminUntil: isElevated(real) ? real.adminUntil!.toISOString() : null,
    mustChangePassword: user.mustChangePassword,
    canViewTeamTimesheet,
    // il ruolo qui è già quello EFFICACE: un admin non elevato passa dal flag
    canViewAllTimesheets: user.canViewAllTimesheets || user.role === UserRole.ADMIN,
    salesMonitorAllDeals: false,
    isGroupManager,
    manageableCategories,
    // Globale, non della persona: la porta il DTO perché è il solo posto che
    // ogni schermata ha già, senza aggiungere una richiesta.
    demoMode: config.demo !== null,
  };
  return Object.assign(dto, ...estensioni);
}
