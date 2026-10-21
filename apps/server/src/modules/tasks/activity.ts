// Copyright (c) 2026 Jugaad s.r.l.
// SPDX-License-Identifier: AGPL-3.0-only

import { noteRecordChanged } from "../realtime/record-changes";
import { canaleCorrente } from "../../lib/canale";

// Tipo strutturale: accetta sia la transazione del client esteso (soft delete)
// sia quella del client raw.
interface ActivityTx {
  activityLog: {
    create(args: {
      data: { taskId: string; userId: string; action: string; payload: string | null };
    }): Promise<unknown>;
  };
}

export async function logActivity(
  tx: ActivityTx,
  taskId: string,
  userId: string,
  action: string,
  payload?: unknown,
): Promise<void> {
  // Ogni modifica di un task passa di qui: è il posto giusto per annotare che
  // chi ha quel record davanti va avvisato. Si annota e basta — l'avviso parte
  // a risposta conclusa, quando la transazione ha fatto commit davvero.
  noteRecordChanged(taskId, userId);
  await tx.activityLog.create({
    data: {
      taskId,
      userId,
      action,
      payload: conIlCanale(payload),
    },
  });
}

/**
 * Il payload da salvare, con il canale se la modifica arriva da un plugin
 * (`lib/canale.ts`): `via` accanto agli altri campi, e la persona resta quella
 * di `userId`. Lo legge `toActivityDto`, che lo porta fuori come campo suo.
 */
export function conIlCanale(payload: unknown): string | null {
  const via = canaleCorrente();
  if (!via) return payload === undefined ? null : JSON.stringify(payload);
  if (payload === undefined || payload === null) return JSON.stringify({ via });
  if (typeof payload === "object" && !Array.isArray(payload)) {
    return JSON.stringify({ ...(payload as Record<string, unknown>), via });
  }
  return JSON.stringify({ valore: payload, via });
}
