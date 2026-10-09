import { noteRecordChanged } from "../realtime/record-changes";

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
      payload: payload === undefined ? null : JSON.stringify(payload),
    },
  });
}
