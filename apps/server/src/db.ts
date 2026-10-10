// Copyright (c) 2026 Jugaad s.r.l.
// SPDX-License-Identifier: AGPL-3.0-only

import path from "node:path";
import type { PrismaClient as PrismaClientSqlite } from "./generated/prisma/client";
import { PrismaBetterSQLite3 } from "@prisma/adapter-better-sqlite3";
import { sanitizeWriteData } from "./modules/rich-text/write-guard";

// Driver adapter better-sqlite3 + queryCompiler: nessun engine nativo Prisma
// (richiesto su Windows ARM64). Il path è ancorato a questo file, non alla cwd.
export const databasePath =
  process.env.DATABASE_PATH ?? path.resolve(import.meta.dirname, "../../../data/app.db");

/**
 * **Su quale motore gira questa installazione.**
 *
 * SQLite è la produzione di oggi e resta il valore di sempre: si passa a
 * MariaDB solo dichiarandolo (`DB_ENGINE=mariadb` più le variabili
 * `MARIA_DB_*`), così nessuna installazione cambia motore per sbaglio.
 *
 * Il client e l'adapter si caricano **solo quando servono**: quello per MySQL
 * nasce da uno schema suo (`prisma/mariadb`) e vive in una cartella generata,
 * che non sta in git — un import statico romperebbe la build a chiunque non
 * l'abbia generato, e cioè a tutti finché la migrazione non è decisa.
 */
export const motore = process.env.DB_ENGINE === "mariadb" ? "mariadb" : "sqlite";

const configMariaDb = () => ({
  host: process.env.MARIA_DB_HOST ?? "127.0.0.1",
  port: Number(process.env.MARIA_DB_PORT ?? 3306),
  user: process.env.MARIA_DB_USER,
  password: process.env.MARIA_DB_PASS,
  database: process.env.MARIA_DB_NAME,
});

async function creaClient(): Promise<PrismaClientSqlite> {
  if (motore === "mariadb") {
    const [{ PrismaMariaDb }, { PrismaClient }] = await Promise.all([
      import("@prisma/adapter-mariadb"),
      import("./generated/prisma-mariadb/client"),
    ]);
    const adapter = new PrismaMariaDb(configMariaDb());
    // I due client nascono dallo **stesso** schema: la forma è identica, cambia
    // il dialetto che compilano. Il tipo dichiarato resta quello di SQLite,
    // che è la produzione — il giorno dello switch si invertono i due rami.
    return new PrismaClient({ adapter }) as unknown as PrismaClientSqlite;
  }
  const { PrismaClient } = await import("./generated/prisma/client");
  return new PrismaClient({ adapter: new PrismaBetterSQLite3({ url: `file:${databasePath}` }) });
}

const client = await creaClient();

/**
 * **Una connessione che non può scrivere**, per le letture dei plugin su
 * MariaDB: ogni sessione del suo pool nasce con `SET SESSION TRANSACTION READ
 * ONLY`, e da lì in poi è il motore a rifiutare INSERT, UPDATE, DELETE e DDL
 * (errore 1792), qualunque testo arrivi. Su SQLite non serve: il file si apre
 * in sola lettura da sé (`keelops-sdk/database.mjs`). Nasce alla prima
 * richiesta, con poche connessioni: le letture dei plugin sono brevi.
 */
let solaLettura: Promise<Pick<PrismaClientSqlite, "$queryRawUnsafe">> | null = null;
export function connessioneSolaLettura(): Promise<Pick<PrismaClientSqlite, "$queryRawUnsafe">> {
  if (motore !== "mariadb") {
    return Promise.reject(new Error("su SQLite i plugin aprono il file in sola lettura da sé"));
  }
  solaLettura ??= (async () => {
    const [{ PrismaMariaDb }, { PrismaClient }] = await Promise.all([
      import("@prisma/adapter-mariadb"),
      import("./generated/prisma-mariadb/client"),
    ]);
    const adapter = new PrismaMariaDb({
      ...configMariaDb(),
      connectionLimit: 3,
      initSql: "SET SESSION TRANSACTION READ ONLY",
    });
    return new PrismaClient({ adapter }) as unknown as PrismaClientSqlite;
  })();
  return solaLettura;
}

/**
 * Client SENZA filtro soft-delete: da usare solo dove i record eliminati servono
 * davvero (cestino, ripristino, purge, controlli di idempotenza).
 *
 * Porta comunque la ripulitura del testo arricchito: le descrizioni si scrivono
 * con un editor che accetta l'incolla da mezzo mondo, e l'unico posto dove il
 * controllo non si può dimenticare è la strada per il database.
 */
export const prismaRaw = client.$extends({
  query: {
    $allModels: {
      create({ model, args, query }) {
        args.data = sanitizeWriteData(model, args.data);
        return query(args);
      },
      createMany({ model, args, query }) {
        args.data = sanitizeWriteData(model, args.data);
        return query(args);
      },
      update({ model, args, query }) {
        args.data = sanitizeWriteData(model, args.data);
        return query(args);
      },
      updateMany({ model, args, query }) {
        args.data = sanitizeWriteData(model, args.data);
        return query(args);
      },
      upsert({ model, args, query }) {
        args.create = sanitizeWriteData(model, args.create);
        args.update = sanitizeWriteData(model, args.update);
        return query(args);
      },
    },
  },
});

/**
 * Il client dentro una transazione. Va ricavato da `prismaRaw` e non preso da
 * `Prisma.TransactionClient`: quello descrive il client senza estensioni, e da
 * quando la ripulitura del testo vive qui i due tipi non coincidono più.
 */
export type TxClient = Parameters<Parameters<typeof prismaRaw.$transaction>[0]>[0];

// Modelli con soft delete (campo deletedAt).
const SOFT_DELETE_MODELS = new Set(["Task", "Project", "Company", "Contact"]);

function mentionsDeletedAt(where: unknown): boolean {
  return (
    typeof where === "object" &&
    where !== null &&
    Object.prototype.hasOwnProperty.call(where, "deletedAt")
  );
}

/**
 * Client di default: esclude automaticamente i record soft-deleted da findMany,
 * findFirst, count, findUnique, groupBy e aggregate dei modelli interessati. Una
 * query che specifica esplicitamente `deletedAt` nel where bypassa il filtro.
 */
export const prisma = prismaRaw.$extends({
  query: {
    $allModels: {
      findMany({ model, args, query }) {
        if (SOFT_DELETE_MODELS.has(model) && !mentionsDeletedAt(args.where)) {
          args.where = { ...args.where, deletedAt: null } as typeof args.where;
        }
        return query(args);
      },
      findFirst({ model, args, query }) {
        if (SOFT_DELETE_MODELS.has(model) && !mentionsDeletedAt(args.where)) {
          args.where = { ...args.where, deletedAt: null } as typeof args.where;
        }
        return query(args);
      },
      count({ model, args, query }) {
        if (SOFT_DELETE_MODELS.has(model) && !mentionsDeletedAt(args.where)) {
          args.where = { ...args.where, deletedAt: null } as typeof args.where;
        }
        return query(args);
      },
      // Conteggi e medie: senza il filtro, un elemento nel cestino continuerebbe
      // a comparire nei raggruppamenti e a spostare le medie.
      groupBy({ model, args, query }) {
        if (SOFT_DELETE_MODELS.has(model) && !mentionsDeletedAt(args.where)) {
          args.where = { ...args.where, deletedAt: null } as typeof args.where;
        }
        return query(args);
      },
      aggregate({ model, args, query }) {
        if (SOFT_DELETE_MODELS.has(model) && !mentionsDeletedAt(args.where)) {
          args.where = { ...args.where, deletedAt: null } as typeof args.where;
        }
        return query(args);
      },
      async findUnique({ model, args, query }) {
        const result = await query(args);
        if (
          SOFT_DELETE_MODELS.has(model) &&
          result &&
          (result as { deletedAt?: Date | null }).deletedAt
        ) {
          return null;
        }
        return result;
      },
    },
  },
});

/**
 * Messa a punto della connessione. Su SQLite i `PRAGMA`: WAL persiste sul file,
 * gli altri valgono per connessione. Su MariaDB non c'è niente da dire — i
 * valori equivalenti stanno nella configurazione del server — e mandare un
 * `PRAGMA` là in mezzo sarebbe solo un errore di sintassi all'avvio.
 */
export async function initDb(): Promise<void> {
  if (motore !== "sqlite") return;
  await prisma.$queryRawUnsafe("PRAGMA journal_mode=WAL;");
  await prisma.$queryRawUnsafe("PRAGMA synchronous=NORMAL;");
  await prisma.$queryRawUnsafe("PRAGMA foreign_keys=ON;");
}
