// Copyright (c) 2026 Jugaad s.r.l.
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Regole per mandare su HTTPS chi arriva in chiaro.
 *
 * In produzione il TLS è di nginx (porta 5443), che inoltra al processo Node in
 * HTTP sulla porta del backend. Quest'ultima è raggiungibile anche da fuori: chi
 * ci arriva vedrebbe l'applicazione senza contesto sicuro, dove diverse funzioni
 * del browser non funzionano. Va rimandato al sito sicuro — senza però toccare le
 * richieste che il proxy stesso inoltra, altrimenti si rimbalzano all'infinito.
 */

/** Indirizzi da cui parla il proxy (o il controllo di salute del deploy). */
function isLoopback(ip: string | undefined): boolean {
  if (!ip) return false;
  const address = ip.startsWith("::ffff:") ? ip.slice(7) : ip; // IPv4 mappato su IPv6
  return address === "127.0.0.1" || address === "::1" || address.startsWith("127.");
}

/** L'host della richiesta senza la porta (regge anche gli indirizzi IPv6). */
export function hostWithoutPort(host: string | undefined): string {
  if (!host) return "localhost";
  if (host.startsWith("[")) return host.slice(0, host.indexOf("]") + 1); // [::1]:5103
  const colon = host.lastIndexOf(":");
  return colon === -1 ? host : host.slice(0, colon);
}

export function shouldRedirectToHttps(
  headers: { "x-forwarded-proto"?: string | string[]; host?: string },
  ip: string | undefined,
): boolean {
  // Già servita in sicurezza dal proxy: la richiesta che ci arriva è in chiaro
  // solo nell'ultimo tratto, dentro la macchina.
  const proto = headers["x-forwarded-proto"];
  const forwarded = Array.isArray(proto) ? proto[0] : proto;
  if (forwarded?.split(",")[0]?.trim() === "https") return false;
  // Chiamate locali: il proxy verso il backend e il controllo di salute del deploy.
  if (isLoopback(ip)) return false;
  return true;
}
