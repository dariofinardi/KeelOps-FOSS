// Copyright (c) 2026 Jugaad s.r.l.
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * **Quali percorsi di un plugin si raggiungono senza sessione.**
 *
 * Tutto ciò che sta sotto `/plugins/<nome>/` passa dalla guardia del core
 * (V2 di PLAN_OPTIMIZE, 05/09/2026): prima la guardia guardava solo `/api`, e
 * ogni plugin si difendeva da sé — finché tutti se ne ricordavano. Le
 * eccezioni le dichiara il manifesto, `pubblici`: un elenco di prefissi
 * relativi alla radice del plugin, con un metodo davanti se serve
 * (`"POST /"` per il protocollo MCP sulla radice, dove la stessa radice in GET
 * è la pagina di istruzioni per chi è dentro). Il percorso di `health` è
 * pubblico da sé: lo interroga chi sorveglia, non chi lavora.
 */
export interface RegolaPubblica {
  /** Null = qualunque metodo. */
  method: string | null;
  /** Prefisso del percorso, relativo alla radice del plugin; "/" = tutto. */
  prefix: string;
}

const FORMA = /^(?:([A-Z]+) )?(\/\S*)$/;

/** Legge `pubblici` (e `health`) dal manifesto; le voci malformate si scartano con un avviso. */
export function leggiPubblici(
  name: string,
  manifest: { pubblici?: unknown; health?: unknown },
  avvisa: (messaggio: string) => void,
): RegolaPubblica[] {
  const regole: RegolaPubblica[] = [];
  const voci = manifest.pubblici;
  if (voci !== undefined) {
    if (!Array.isArray(voci)) {
      avvisa(`plugin "${name}": pubblici dev'essere un elenco di percorsi, lo ignoro`);
    } else {
      for (const voce of voci) {
        const m = FORMA.exec(String(voce));
        if (!m) {
          avvisa(
            `plugin "${name}": pubblici ignora "${String(voce)}" (atteso "/percorso" o "METODO /percorso")`,
          );
          continue;
        }
        regole.push({ method: m[1] ?? null, prefix: m[2]! });
      }
    }
  }
  if (typeof manifest.health === "string" && manifest.health.startsWith("/")) {
    regole.push({ method: "GET", prefix: manifest.health });
  }
  return regole;
}

/** Il percorso (già senza `/plugins/<nome>`, senza query) è raggiungibile senza sessione? */
export function isPubblica(regole: RegolaPubblica[], method: string, path: string): boolean {
  return regole.some(
    (r) =>
      (r.method === null || r.method === method.toUpperCase()) &&
      (r.prefix === "/" ||
        path === r.prefix ||
        (r.prefix.endsWith("/") ? path.startsWith(r.prefix) : path.startsWith(`${r.prefix}/`))),
  );
}
