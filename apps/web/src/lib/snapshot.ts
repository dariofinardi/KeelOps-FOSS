/**
 * Fotografia di un record all'apertura di un pannello, per poterlo riportare
 * com'era alla chiusura.
 *
 * Serve ai pannelli che salvano campo per campo (dettaglio task, offerta,
 * ticket): comodi da usare, ma senza una via d'uscita se ci si è sbagliati.
 * Erano tre file quasi identici — stesso elenco di campi, stesse etichette,
 * stesso confronto — e ogni nuovo modulo ne avrebbe aggiunto un quarto. Qui c'è
 * il meccanismo; ogni modulo dichiara solo *quali* campi fotografa.
 */

export interface SnapshotField<TRecord, TValue> {
  /** Nome del campo in italiano: serve a dire all'utente cosa ha modificato. */
  label: string;
  read: (record: TRecord) => TValue;
  /** Confronto su misura (per gli elenchi); di norma basta l'uguaglianza. */
  equals?: (a: TValue, b: TValue) => boolean;
}

export type SnapshotSpec<TRecord, TSnapshot> = {
  [K in keyof TSnapshot]: SnapshotField<TRecord, TSnapshot[K]>;
};

/** Uguaglianza di default: elemento per elemento sugli elenchi, `===` sul resto. */
function sameValue(a: unknown, b: unknown): boolean {
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length && a.every((value, index) => value === b[index]);
  }
  return a === b;
}

export interface Snapshotter<TRecord, TSnapshot> {
  /** Scatta la fotografia del record com'è adesso. */
  take(record: TRecord): TSnapshot;
  /** Etichette dei campi cambiati da quella fotografia (vuoto = nulla da salvare). */
  changed(snapshot: TSnapshot, record: TRecord): string[];
}

export function createSnapshot<TRecord, TSnapshot extends object>(
  spec: SnapshotSpec<TRecord, TSnapshot>,
): Snapshotter<TRecord, TSnapshot> {
  const keys = Object.keys(spec) as Array<keyof TSnapshot>;
  return {
    take(record) {
      const snapshot = {} as TSnapshot;
      for (const key of keys) snapshot[key] = spec[key].read(record);
      return snapshot;
    },
    changed(snapshot, record) {
      return keys
        .filter((key) => {
          const field = spec[key];
          const current = field.read(record);
          return !(field.equals ?? sameValue)(snapshot[key], current);
        })
        .map((key) => spec[key].label);
    },
  };
}
