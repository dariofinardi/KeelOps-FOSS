/**
 * Ripulisce **una volta sola** le descrizioni già nel database.
 *
 * Il ripulitore dell'HTML (`modules/rich-text`) protegge la strada di
 * scrittura: da quando esiste, ogni PATCH, ogni create e ogni import passano di
 * lì. Ma le righe scritte **prima** — descrizioni del portale, task importati da
 * ClickUp o Excel — non ci sono mai passate, e ora `RichText` le disegna con
 * `dangerouslySetInnerHTML`. Una di quelle righe con dentro un `onerror` girerebbe
 * nella sessione di chi la apre.
 *
 * Questo script chiude quel buco sul passato: legge i tre campi descrittivi,
 * li fa passare dallo **stesso** ripulitore della strada di scrittura, e
 * riscrive solo ciò che cambia. È **idempotente** — rilanciarlo su un database
 * già pulito non tocca niente — quindi lo si può eseguire senza paura, e va
 * eseguito una volta su ogni installazione esistente (la demo nasce vuota, non
 * ne ha bisogno).
 *
 *   pnpm --filter @kancrm/server exec tsx prisma/sanitize-existing-descriptions.ts
 *   # anteprima, senza scrivere:
 *   DRY_RUN=1 pnpm --filter @kancrm/server exec tsx prisma/sanitize-existing-descriptions.ts
 */
import { copyFileSync, existsSync, mkdirSync } from "node:fs";
import path from "node:path";
import { databasePath, prismaRaw } from "../src/db";
import { sanitizeRichText } from "../src/modules/rich-text/sanitize";

/**
 * Copia il database **prima** di toccarlo. Una manipolazione di massa senza rete
 * è il modo più veloce di trasformare una bonifica in una perdita: se qualcosa
 * va storto, il file `pre-sanitize-<data>.db` accanto al database riporta tutto
 * com'era. È lo stesso gesto che `deploy.sh` fa prima delle migrazioni.
 */
function backupDatabase(): string {
  const dir = path.join(path.dirname(databasePath), "backups");
  mkdirSync(dir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[-:T]/g, "").slice(0, 14);
  const dest = path.join(dir, `pre-sanitize-${stamp}.db`);
  copyFileSync(databasePath, dest);
  return dest;
}

const DRY_RUN = process.env.DRY_RUN === "1";

interface Model {
  name: string;
  rows: () => Promise<Array<{ id: string; description: string | null }>>;
  save: (id: string, description: string) => Promise<unknown>;
}

/**
 * I modelli con un campo `description` che può contenere HTML dell'utente. Sono
 * gli stessi che il write-guard sorveglia (`RICH_TEXT_FIELDS` in
 * `modules/rich-text/write-guard.ts`): tenerli allineati è la regola.
 *
 * Si usa `prismaRaw`, il client **senza** il write-guard: qui la ripulitura la
 * facciamo noi in modo esplicito, e passare dal client esteso vorrebbe dire
 * ripulire due volte (innocuo, ma nasconde cosa sta succedendo).
 */
const MODELS: Model[] = [
  {
    name: "Task",
    rows: () =>
      prismaRaw.task.findMany({
        where: { description: { not: null } },
        select: { id: true, description: true },
      }),
    save: (id, description) => prismaRaw.task.update({ where: { id }, data: { description } }),
  },
  {
    name: "Project",
    rows: () =>
      prismaRaw.project.findMany({
        where: { description: { not: null } },
        select: { id: true, description: true },
      }),
    save: (id, description) => prismaRaw.project.update({ where: { id }, data: { description } }),
  },
  {
    name: "RecurrenceTemplate",
    rows: () =>
      prismaRaw.recurrenceTemplate.findMany({
        where: { description: { not: null } },
        select: { id: true, description: true },
      }),
    save: (id, description) =>
      prismaRaw.recurrenceTemplate.update({ where: { id }, data: { description } }),
  },
];

export async function sanitizeExistingDescriptions(
  dryRun = false,
  { backup = true }: { backup?: boolean } = {},
): Promise<{ scanned: number; changed: number; backupPath: string | null }> {
  // Copia di sicurezza prima di scrivere, mai in anteprima (non scrive niente).
  // I test la disattivano: girano su un database usa e getta.
  let backupPath: string | null = null;
  if (!dryRun && backup && existsSync(databasePath)) {
    backupPath = backupDatabase();
    console.log(`  Backup del database: ${backupPath}`);
  }
  let changed = 0;
  let scanned = 0;
  for (const model of MODELS) {
    for (const row of await model.rows()) {
      scanned += 1;
      const clean = sanitizeRichText(row.description ?? "");
      if (clean === row.description) continue;
      changed += 1;
      if (dryRun) console.log(`  ${model.name} ${row.id}: sarebbe ripulita`);
      else await model.save(row.id, clean);
    }
  }
  return { scanned, changed, backupPath };
}

async function main(): Promise<void> {
  const { scanned, changed } = await sanitizeExistingDescriptions(DRY_RUN);
  const verbo = DRY_RUN ? "da ripulire" : "ripulite";
  console.log(`\n  ${scanned} descrizioni esaminate, ${changed} ${verbo}.`);
  if (DRY_RUN && changed > 0) {
    console.log("  (DRY_RUN: niente scritto — rilancia senza per applicare)");
  }
}

// Eseguito come script, non quando importato dal test.
if (process.argv[1]?.endsWith("sanitize-existing-descriptions.ts")) {
  main()
    .catch((error) => {
      console.error(error);
      process.exit(1);
    })
    .finally(() => void prismaRaw.$disconnect());
}
