/**
 * **«Portami al messaggio con cui è arrivato questo allegato.»**
 *
 * La richiesta parte dalla sezione Allegati e deve arrivare alla chat, che sta
 * in un altro angolo dello stesso pannello e non è sua parente: nessuna delle
 * due può passare l'informazione all'altra senza far attraversare uno stato a
 * mezzo pannello: chi apre il task, la scheda dell'offerta, la richiesta.
 *
 * Un annuncio in mezzo, quindi, come per gli aggiornamenti in tempo reale
 * (`realtime/pending-changes`): chi vuole andare da qualche parte lo dice, chi
 * sa come portarcisi ascolta. Chi non ascolta non succede niente — un pannello
 * senza chat non deve rompersi perché qualcuno ha chiesto di saltare.
 */
type Ascoltatore = (commentId: string) => void;

const ascoltatori = new Set<Ascoltatore>();

/** Chiede di portare la conversazione su quel messaggio. */
export function vaiAlMessaggio(commentId: string): void {
  for (const ascoltatore of ascoltatori) ascoltatore(commentId);
}

/** La chat si mette in ascolto; la funzione restituita la toglie. */
export function ascoltaVaiAlMessaggio(ascoltatore: Ascoltatore): () => void {
  ascoltatori.add(ascoltatore);
  return () => {
    ascoltatori.delete(ascoltatore);
  };
}
