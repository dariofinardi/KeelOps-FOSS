// Copyright (c) 2026 Jugaad s.r.l.
// SPDX-License-Identifier: AGPL-3.0-only

import { useTranslation } from "react-i18next";
import { ProjectRole, type UserRef } from "@kancrm/shared";
import { Combobox } from "@/components/ui/combobox";

/**
 * Scelta della persona per assegnatario e supervisore, uguale in tutti i
 * dialoghi e pannelli dei task.
 *
 * **Si scrive per cercare** (22/08/2026): gli elenchi di persone crescono, e
 * scorrere una tendina lunga per trovare un nome che si sa già è tempo perso.
 *
 * Con i membri di un progetto l'ordine porta informazione: prima chi ci lavora,
 * con il proprio ruolo accanto al nome, poi tutti gli altri. Per questo la combo
 * non riordina — l'alfabetico mescolerebbe le due cose. Gli esterni restano
 * scegliibili (un task assegnato si vede e si lavora anche da fuori l'area), ma
 * è chiaro chi è della squadra senza aprire la gestione membri.
 */

/** Simbolo ed etichetta del ruolo, uguali a quelli del dialogo "Membri". */
export const PROJECT_ROLE_BADGE: Record<string, { icon: string; label: string }> = {
  [ProjectRole.MANAGER]: { icon: "★", label: "Manager" },
  [ProjectRole.EDITOR]: { icon: "✎", label: "Editor" },
  [ProjectRole.VIEWER]: { icon: "👁", label: "Visualizzatore" },
};

export interface ProjectMemberRef {
  userId: string;
  role: string;
}

export interface GroupedUsers {
  /** Membri del progetto, con il ruolo da mostrare accanto al nome. */
  members: Array<{ user: UserRef; role: string }>;
  /** Tutti gli altri, in fondo alla tendina. */
  others: UserRef[];
}

export function groupUsersByMembership(
  users: UserRef[] | undefined,
  members: ProjectMemberRef[] | undefined,
): GroupedUsers {
  const all = users ?? [];
  if (!members || members.length === 0) return { members: [], others: all };
  const roleOf = new Map(members.map((m) => [m.userId, m.role]));
  return {
    // Si mantiene l'ordine dell'elenco utenti (alfabetico), non quello dei membri.
    members: all.filter((u) => roleOf.has(u.id)).map((u) => ({ user: u, role: roleOf.get(u.id)! })),
    others: all.filter((u) => !roleOf.has(u.id)),
  };
}

/** Etichetta dell'opzione: "★ Marta Manager · Manager". */
export function memberOptionLabel(name: string, role: string): string {
  const badge = PROJECT_ROLE_BADGE[role];
  return badge ? `${badge.icon} ${name} · ${badge.label}` : name;
}

export function UserSelect({
  id,
  value,
  onChange,
  users,
  projectMembers,
  title,
}: {
  id?: string;
  value: string;
  onChange: (value: string) => void;
  users: UserRef[] | undefined;
  /** Membri del progetto del task: mostrati in cima, con il loro ruolo. */
  projectMembers?: ProjectMemberRef[];
  title?: string;
}) {
  const { t } = useTranslation();
  const { members, others } = groupUsersByMembership(users, projectMembers);
  // L'elenco già ordinato: i membri col loro ruolo, poi gli altri in alfabetico
  // (l'ordine arriva così dal server). La combo non tocca questa scelta.
  const voci = [
    ...members.map(({ user, role }) => ({
      id: user.id,
      label: memberOptionLabel(user.name, role),
    })),
    ...others.map((user) => ({ id: user.id, label: user.name })),
  ];

  return (
    <Combobox
      id={id}
      value={value || null}
      onChange={(scelto) => onChange(scelto ?? "")}
      items={voci}
      ordina={false}
      emptyLabel={t("Nessuno")}
      placeholder={title ?? t("Cerca una persona…")}
    />
  );
}
