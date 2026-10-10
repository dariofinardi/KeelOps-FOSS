// Copyright (c) 2026 Jugaad s.r.l.
// SPDX-License-Identifier: AGPL-3.0-only

import { prisma } from "../../db";
import type { MaintenanceState } from "@kancrm/shared";

/**
 * Modalità manutenzione: KeelOps "offline" per tutti tranne gli amministratori.
 *
 * Lo stato vive in `AppSetting` (chiave `maintenance`), quindi sopravvive ai
 * riavvii — che è esattamente ciò che serve a un deploy: si accende prima di
 * toccare la produzione, il servizio riparte con la manutenzione ancora attiva,
 * e si spegne solo quando la verifica di salute è passata. Lo stesso stato lo
 * può scrivere `scripts/maintenance.ts` a servizio SPENTO, perché il deploy non
 * dipenda dall'API di un processo che sta riavviando.
 *
 * La lettura è cacheata per qualche secondo: il cancello sta su OGNI richiesta
 * e non deve costare una query l'una; chi scrive (API o script) invalida — e
 * la scrittura fuori processo si vede comunque entro il TTL.
 */
const KEY = "maintenance";
const TTL_MS = 3_000;

let cache: { state: MaintenanceState; readAt: number } | null = null;

const OFF: MaintenanceState = { active: false, message: null, since: null };

export function invalidateMaintenanceCache(): void {
  cache = null;
}

export async function maintenanceState(): Promise<MaintenanceState> {
  if (cache && Date.now() - cache.readAt < TTL_MS) return cache.state;
  const row = await prisma.appSetting.findUnique({ where: { key: KEY } });
  let state = OFF;
  if (row) {
    try {
      const parsed = JSON.parse(row.value) as Partial<MaintenanceState>;
      state = {
        active: parsed.active === true,
        message: typeof parsed.message === "string" && parsed.message ? parsed.message : null,
        since: typeof parsed.since === "string" ? parsed.since : null,
      };
    } catch {
      // valore illeggibile = manutenzione spenta: mai chiudere fuori tutti per un JSON rotto
      state = OFF;
    }
  }
  cache = { state, readAt: Date.now() };
  return state;
}

export async function setMaintenance(active: boolean, message?: string): Promise<MaintenanceState> {
  const state: MaintenanceState = {
    active,
    message: active && message ? message : null,
    since: active ? new Date().toISOString() : null,
  };
  await prisma.appSetting.upsert({
    where: { key: KEY },
    create: { key: KEY, value: JSON.stringify(state) },
    update: { value: JSON.stringify(state) },
  });
  invalidateMaintenanceCache();
  return state;
}
