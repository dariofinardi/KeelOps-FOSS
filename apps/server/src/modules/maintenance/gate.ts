import type { FastifyInstance } from "fastify";
import { UserRole } from "@kancrm/shared";
import { SESSION_COOKIE, findSessionUser } from "../auth/session";
import { SERVER_LOCALES, localeFromRequest, localeOfUser } from "../../i18n";
import { maintenanceState } from "./service";
import { renderMaintenancePage } from "./page";

/**
 * Il cancello della manutenzione. Va registrato DOPO l'auth (per le /api il
 * ruolo efficace è già sulla richiesta) e PRIMA dei plugin, così vale anche
 * per loro.
 *
 * Chi passa sempre: la salute, lo stato della manutenzione (lo interroga la
 * pagina di cortesia per accorgersi del ritorno online), tutta l'area
 * /api/auth — perché un amministratore deve poter ENTRARE ed elevarsi mentre
 * il resto è chiuso — e chiunque abbia il ruolo VERO di amministratore, elevato
 * o no: il modello sudo declassa gli admin a MEMBER nell'uso quotidiano, ma
 * chiudere fuori proprio chi può riaprire sarebbe un lucchetto senza chiave.
 *
 * Tutti gli altri: 503 — JSON per le API (il client web si ricarica e trova la
 * pagina), pagina di cortesia localizzata per il resto.
 */
function pageLocale(request: Parameters<typeof localeFromRequest>[0]): string {
  const fromHeader = localeFromRequest(request);
  if (String(request.headers["x-locale"] ?? "")) return fromHeader;
  for (const part of String(request.headers["accept-language"] ?? "").split(",")) {
    const tag = part.trim().slice(0, 2).toLowerCase();
    if ((SERVER_LOCALES as readonly string[]).includes(tag)) return tag;
  }
  return fromHeader;
}

export function registerMaintenanceGate(app: FastifyInstance): void {
  app.addHook("onRequest", async (request, reply) => {
    const url = request.raw.url ?? "";
    if (
      url.startsWith("/api/health") ||
      url.startsWith("/api/maintenance") ||
      url.startsWith("/api/auth/")
    ) {
      return;
    }
    const state = await maintenanceState();
    if (!state.active) return;

    // /api: l'auth è già passata; authUser porta il ruolo vero, pre-elevazione
    if (request.authUser?.role === UserRole.ADMIN) return;

    if (!url.startsWith("/api")) {
      // pagine e asset: la sessione va letta qui, l'auth globale copre solo /api
      const token = request.cookies?.[SESSION_COOKIE];
      const user = token ? await findSessionUser(token) : null;
      if (user?.role === UserRole.ADMIN) return;
      // un browser sulla pagina di cortesia non manda X-Locale: qui, e solo
      // qui, conta l'Accept-Language — è l'unico segnale che ha un anonimo
      const locale = user ? localeOfUser(user) : pageLocale(request);
      await reply
        .code(503)
        .header("content-type", "text/html; charset=utf-8")
        .header("retry-after", "120")
        .send(renderMaintenancePage(locale, state.message));
      return reply;
    }

    await reply
      .code(503)
      .header("retry-after", "120")
      .send({ maintenance: true, message: state.message });
    return reply;
  });
}
