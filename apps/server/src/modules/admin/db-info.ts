import { stat } from "node:fs/promises";
import { databasePath, motore, prisma } from "../../db";
import { dimensioneDatabaseSql, doveViveIlDatabase, versioneMotore } from "../../lib/dialetto";

/**
 * **Su cosa gira questa installazione.** La domanda sembra banale finché non
 * esistono due motori: allora «sto guardando SQLite o MariaDB?» diventa la prima
 * cosa da sapere prima di credere a qualunque altro numero della pagina — e
 * durante una migrazione è anche il modo di accorgersi che un ambiente è
 * rimasto indietro.
 *
 * Un punto solo perché il numero della dimensione e l'etichetta del motore
 * finiscono in due posti della stessa risposta (il riquadro Database e l'elenco
 * delle versioni), e due strade divergerebbero.
 */
export interface InfoDatabase {
  /** Quello che decide tutto il resto: `sqlite` o `mariadb`. */
  motore: typeof motore;
  /** Come si chiama per chi legge: «SQLite», «MariaDB». */
  etichetta: string;
  versione: string | null;
  /** Il file, oppure host, porta e nome del database. Mai le credenziali. */
  dove: string;
  dimensioneBytes: number;
}

export async function infoDatabase(): Promise<InfoDatabase> {
  const { sql, etichetta } = versioneMotore();
  const versione = await prisma
    .$queryRawUnsafe<Array<{ version: string }>>(sql)
    .then((righe) => righe[0]?.version ?? null)
    .catch(() => null);

  const sqlDimensione = dimensioneDatabaseSql();
  const dimensioneBytes = sqlDimensione
    ? await prisma
        .$queryRawUnsafe<Array<{ bytes: unknown }>>(sqlDimensione)
        // MySQL somma in DECIMAL, e Prisma lo consegna come stringa o BigInt:
        // `Number` li accetta entrambi, e un valore inatteso diventa 0 invece
        // di un NaN che la pagina mostrerebbe come «NaN B».
        .then((righe) => Number(righe[0]?.bytes ?? 0) || 0)
        .catch(() => 0)
    : await stat(databasePath)
        .then((info) => info.size)
        .catch(() => 0);

  return { motore, etichetta, versione, dove: doveViveIlDatabase(), dimensioneBytes };
}
