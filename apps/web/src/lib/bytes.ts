// Copyright (c) 2026 Jugaad s.r.l.
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Dimensione di un file leggibile: KB sotto il mega, MB sotto il giga, GB
 * sopra. Unico punto: la scriveva la pagina Sistema e la riscriveva l'elenco
 * allegati.
 *
 * Il gradino dei GB serve allo spazio occupato dal magazzino: un archivio che
 * cresce prima o poi supera il migliaio di MB, e "3374.2 MB" è un numero che
 * si deve dividere a mente per capirlo.
 */
export function formatBytes(bytes: number): string {
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}
