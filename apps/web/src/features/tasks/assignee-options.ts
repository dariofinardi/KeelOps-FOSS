// Copyright (c) 2026 Jugaad s.r.l.
// SPDX-License-Identifier: AGPL-3.0-only

export interface AssigneeFacet {
  id: string;
  name: string;
  count: number;
}

export interface AssigneeOption {
  value: string;
  /** Chiave i18n o nome proprio; `isMe` dice quale. */
  label: string;
  count: number | null;
  isMe: boolean;
}

/**
 * **La tendina dell'assegnatario, nell'ordine in cui la si legge** (richiesta
 * del 05/09/2026): prima «I miei task», poi «Tutti gli assegnatari», poi gli
 * altri in ordine alfabetico. Le persone sono quelle del facet del server —
 * cioè solo chi ha task che chi guarda può aprire, col loro numero (regola
 * 12) — e «I miei task» compare solo se fra loro ci sono io: un contatore a
 * zero non si mostra (regola 11).
 */
export function assigneeOptions(
  assignees: AssigneeFacet[] | undefined,
  currentUserId: string,
): AssigneeOption[] {
  const tutti = { value: "", label: "Tutti gli assegnatari", count: null, isMe: false };
  if (!assignees) return [tutti];
  const io = assignees.find((a) => a.id === currentUserId);
  const altri = assignees
    .filter((a) => a.id !== currentUserId)
    .sort((a, b) => a.name.localeCompare(b.name, "it"))
    .map((a) => ({ value: a.id, label: a.name, count: a.count, isMe: false }));
  return [
    ...(io ? [{ value: io.id, label: "I miei task", count: io.count, isMe: true }] : []),
    tutti,
    ...altri,
  ];
}
