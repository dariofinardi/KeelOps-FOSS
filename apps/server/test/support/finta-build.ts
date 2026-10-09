import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";

/**
 * **La build del frontend, finta e restituita.** Alcune prove hanno bisogno
 * di un `index.html` in `apps/server/public` — la modalità manutenzione, la
 * cache degli statici — e se lo scrivevano da sole, sopra quello vero: dopo
 * un `pnpm check` la build serviva 31 byte e gli e2e, che quella build la
 * usano, morivano sulla pagina di accesso senza dire perché (06/09/2026).
 *
 * Qui il file che c'era si mette da parte e torna al suo posto alla fine; se
 * non c'era, alla fine non c'è.
 */
export function fingiBuild(publicDir: string, contenuto = "<!doctype html><title>x</title>"): () => void {
  const index = path.join(publicDir, "index.html");
  const prima = existsSync(index) ? readFileSync(index) : null;
  mkdirSync(publicDir, { recursive: true });
  writeFileSync(index, contenuto);
  return () => {
    if (prima) writeFileSync(index, prima);
    else rmSync(index, { force: true });
  };
}
