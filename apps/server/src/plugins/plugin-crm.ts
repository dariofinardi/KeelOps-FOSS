// Copyright (c) 2026 Jugaad s.r.l.
// SPDX-License-Identifier: AGPL-3.0-only

import { TaskKind, resolveCompanySchema, updateTaskSchema } from "@kancrm/shared";
import { prisma } from "../db";
import { config } from "../config";
import type { User } from "../generated/prisma/client";
import { badRequest } from "../lib/http-errors";
import { conCanale } from "../lib/canale";
import { effectiveUser } from "../modules/auth/elevation";
import { aggiornaOffertaPer, creaOffertaPer } from "../modules/deals/routes";
import { aggiornaAziendaPer, aggiornaContattoPer, creaContattoPer } from "../modules/crm/routes";
import { trovaOCreaAzienda } from "../modules/crm/company-by-name";
import { applyTaskUpdate } from "../modules/tasks/update-service";

/**
 * **Offerte, clienti, referenti e task, prestati ai plugin per scrivere**
 * (21/10/2026, per il connettore MCP: un assistente valuta l'esito di una call
 * e carica l'offerta, il cliente nuovo, la persona di riferimento).
 *
 * Come `plugin-tasks.ts`: il plugin non scrive mai nelle tabelle del core, il
 * core lo fa per lui **con le funzioni delle sue pagine** — `creaOffertaPer`,
 * `aggiornaOffertaPer`, `creaContattoPer`… — quindi valgono le stesse regole:
 * chi può (l'utente **efficace**, con l'elevazione applicata come nel resto
 * dell'applicazione), le fasi e le loro chiusure, gli stati, le notifiche, la
 * cronologia campo per campo. I dati arrivano grezzi e li valida il core con
 * gli schemi condivisi: un id che non esiste è un rifiuto con la sua frase.
 *
 * Ogni scrittura gira dentro il **canale** del plugin (`lib/canale.ts`): la
 * cronologia dice «Maria Rossi via MCP».
 */

async function utenteEfficace(userId: string): Promise<User> {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user || !user.isActive) throw new Error("utente non valido");
  return effectiveUser(user);
}

function nonInDemo(): void {
  if (config.demo) throw new Error("Nella dimostrazione non si scrive dai plugin.");
}

/** Esegue `fn` per conto di `userId`, nel canale del plugin. */
function perConto<T>(canale: string, userId: string, fn: (user: User) => Promise<T>): Promise<T> {
  nonInDemo();
  return conCanale(canale, async () => fn(await utenteEfficace(userId)));
}

/** `ctx.offerte` (permesso `deals:write`): creare e modificare un'offerta. */
export function portaOfferte(canale: string) {
  return {
    /** Come il pulsante «Nuova offerta»: `createDealSchema`. Torna il dettaglio. */
    crea: (userId: string, input: unknown) =>
      perConto(canale, userId, (user) => creaOffertaPer(user, input)),
    /**
     * Come il pannello dell'offerta: `updateDealSchema`, solo i campi passati
     * (fase, valore, probabilità, chiusura prevista, cliente, referente,
     * motivo della perdita, visibilità ai monitor vendite, assegnatario…).
     */
    aggiorna: (userId: string, dealId: string, input: unknown) =>
      perConto(canale, userId, (user) => aggiornaOffertaPer(user, dealId, input)),
  };
}

/** `ctx.crm` (permesso `contacts:write`): aziende e persone di riferimento. */
export function portaCrm(canale: string) {
  return {
    /**
     * **Trova o crea** un'azienda per nome, come la tendina dei moduli: se ce
     * n'è già una con lo stesso nome — anche scritto diverso, «Jugaad srl» per
     * «Jugaad» — torna quella, con `created: false`. Il doppione non nasce.
     */
    azienda: (userId: string, input: unknown) =>
      perConto(canale, userId, async () => {
        const dati = resolveCompanySchema.parse(input);
        const azienda = await trovaOCreaAzienda(dati.name, dati);
        return { id: azienda.id, name: azienda.name, created: azienda.creata };
      }),
    aggiornaAzienda: (userId: string, companyId: string, input: unknown) =>
      perConto(canale, userId, (user) => aggiornaAziendaPer(user, companyId, input)),
    creaContatto: (userId: string, input: unknown) =>
      perConto(canale, userId, (user) => creaContattoPer(user, input)),
    aggiornaContatto: (userId: string, contactId: string, input: unknown) =>
      perConto(canale, userId, (user) => aggiornaContattoPer(user, contactId, input)),
  };
}

/**
 * `ctx.tasks.update` (permesso `tasks:write`): la modifica di un task con il
 * servizio del pannello (`applyTaskUpdate`: stati, sequenze, notifiche,
 * cronologia). Un'offerta no: ha i suoi campi e le sue regole, si modifica con
 * `ctx.offerte.aggiorna`.
 */
export function aggiornaTaskPerPlugin(canale: string) {
  return (userId: string, taskId: string, input: unknown) =>
    perConto(canale, userId, async (user) => {
      const task = await prisma.task.findUnique({ where: { id: taskId }, select: { kind: true } });
      if (task?.kind === TaskKind.DEAL) {
        throw badRequest("Un'offerta si modifica con i campi dell'offerta, non come task");
      }
      return applyTaskUpdate(user, taskId, updateTaskSchema.parse(input));
    });
}
