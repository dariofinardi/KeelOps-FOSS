import type { DealDetail, UpdateDealInput } from "@kancrm/shared";
import { createSnapshot } from "@/lib/snapshot";

/**
 * Come per il dettaglio task (vedi tasks/task-snapshot): il pannello dell'offerta
 * salva ogni campo appena lo si modifica, quindi all'apertura se ne fotografa lo
 * stato e alla chiusura si può tornare indietro.
 *
 * Restano fuori le azioni che non sono "campi" e hanno già una conferma propria:
 * allegati, commenti, il motivo della perdita e le automazioni della fase vinta —
 * un task di fatturazione o un progetto già creati non si annullano chiudendo un
 * pannello.
 */
export interface DealSnapshot {
  title: string;
  description: string | null;
  stageId: string;
  companyId: string | null;
  contactId: string | null;
  assigneeId: string | null;
  dealValue: number | null;
  probability: number | null;
  expectedCloseDate: string | null;
  /**
   * Esposizione ai monitor vendite. Sta nella fotografia come gli altri campi:
   * è una modifica che si può volere annullare — anzi, è quella che più conta
   * poter rimettere a posto, perché apre l'offerta a un pubblico esterno.
   */
  visibleToSalesMonitors: boolean;
}

const snapshotter = createSnapshot<DealDetail, DealSnapshot>({
  title: { label: "Titolo", read: (d) => d.title },
  description: { label: "Descrizione", read: (d) => d.description },
  stageId: { label: "Fase", read: (d) => d.stage.id },
  companyId: { label: "Azienda", read: (d) => d.company?.id ?? null },
  contactId: { label: "Referente", read: (d) => d.contact?.id ?? null },
  assigneeId: { label: "Commerciale", read: (d) => d.assignee?.id ?? null },
  dealValue: { label: "Valore", read: (d) => d.dealValue },
  probability: { label: "Probabilità", read: (d) => d.probability },
  expectedCloseDate: { label: "Chiusura prevista", read: (d) => d.expectedCloseDate },
  visibleToSalesMonitors: {
    label: "Visibilità ai monitor vendite",
    read: (d) => d.visibleToSalesMonitors,
  },
});

export const snapshotOfDeal = snapshotter.take;

/** Nomi dei campi modificati rispetto alla fotografia (vuoto = nessuna modifica). */
export const changedDealFields = snapshotter.changed;

/**
 * Payload che riporta l'offerta alla fotografia.
 *
 * Non serve più spegnere niente: dal 21/08/2026 l'unica conseguenza della fase
 * vinta è la lettura dei documenti, che una seconda volta non riparte da sé.
 */
export function dealRestorePayload(snapshot: DealSnapshot): UpdateDealInput {
  return { ...snapshot };
}
