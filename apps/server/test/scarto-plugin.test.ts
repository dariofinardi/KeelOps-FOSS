import { describe, expect, it } from "vitest";
import { senzaDropDegliIndiciImpliciti, senzaTabelleDeiPlugin } from "../scripts/mariadb/scarto";

/**
 * Il differ di Prisma, confrontando il database con lo schema del core, vuole
 * buttare via le tabelle dei plugin. Il filtro toglie quei blocchi — chiavi
 * esterne comprese — e lascia il resto com'è.
 */
const USCITA = `-- DropForeignKey
ALTER TABLE \`plugin_personale_task\` DROP FOREIGN KEY \`plugin_personale_task_ibfk_1\`;

-- AlterTable
ALTER TABLE \`Notification\` ADD COLUMN \`dedupKey\` VARCHAR(191) NULL;

-- DropTable
DROP TABLE \`plugin_personale_config\`;

-- CreateIndex
CREATE UNIQUE INDEX \`Notification_dedupKey_key\` ON \`Notification\`(\`dedupKey\`);`;

describe("senzaTabelleDeiPlugin", () => {
  it("toglie DROP e chiavi esterne delle tabelle plugin_*, tiene il resto", () => {
    const sql = senzaTabelleDeiPlugin(USCITA);
    expect(sql).not.toMatch(/plugin_personale/);
    expect(sql).toContain("ADD COLUMN `dedupKey`");
    expect(sql).toContain("CREATE UNIQUE INDEX `Notification_dedupKey_key`");
    expect(sql.split(/\n\s*\n/)).toHaveLength(2);
  });

  it("se restano solo blocchi di plugin, è una migrazione vuota", () => {
    expect(senzaTabelleDeiPlugin("-- DropTable\nDROP TABLE `plugin_x_y`;")).toMatch(
      /^-- This is an empty migration\.$/,
    );
  });

  it("una migrazione senza plugin passa intatta", () => {
    const sql = "-- AlterTable\nALTER TABLE `User` ADD COLUMN `x` INTEGER NULL;";
    expect(senzaTabelleDeiPlugin(sql)).toBe(sql);
  });
});

describe("senzaDropDegliIndiciImpliciti", () => {
  it("tiene la CREATE e toglie il DROP dell'indice _fkey, che MariaDB toglie da sé", () => {
    const sql = [
      "-- RedefineIndex",
      "CREATE INDEX `Comment_authorId_idx` ON `Comment`(`authorId`);",
      "DROP INDEX `Comment_authorId_fkey` ON `Comment`;",
      "",
      "-- DropIndex",
      "DROP INDEX `Task_vecchio_idx` ON `Task`;",
    ].join("\n");
    const esito = senzaDropDegliIndiciImpliciti(sql);
    expect(esito).toContain("CREATE INDEX `Comment_authorId_idx`");
    expect(esito).not.toContain("_fkey");
    expect(esito).toContain("DROP INDEX `Task_vecchio_idx`"); // un DROP voluto resta
    expect(esito).not.toContain("RedefineIndex");
  });
});
