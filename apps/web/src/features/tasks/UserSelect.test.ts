// Copyright (c) 2026 Jugaad s.r.l.
// SPDX-License-Identifier: AGPL-3.0-only

import { describe, expect, it } from "vitest";
import { ProjectRole, type UserRef } from "@kancrm/shared";
import { groupUsersByMembership, memberOptionLabel } from "./UserSelect";

const USERS: UserRef[] = [
  { id: "u1", name: "Anna" },
  { id: "u2", name: "Bruno" },
  { id: "u3", name: "Carla" },
];

describe("groupUsersByMembership", () => {
  it("mette in cima la squadra con il ruolo e in fondo i non membri", () => {
    const { members, others } = groupUsersByMembership(USERS, [
      { userId: "u3", role: ProjectRole.VIEWER },
      { userId: "u1", role: ProjectRole.MANAGER },
    ]);
    // Ordine dell'elenco utenti (alfabetico), non quello dei membri.
    expect(members.map((m) => [m.user.name, m.role])).toEqual([
      ["Anna", ProjectRole.MANAGER],
      ["Carla", ProjectRole.VIEWER],
    ]);
    expect(others.map((u) => u.name)).toEqual(["Bruno"]);
  });

  it("senza progetto resta un elenco unico, senza gruppi", () => {
    expect(groupUsersByMembership(USERS, undefined)).toEqual({ members: [], others: USERS });
    expect(groupUsersByMembership(USERS, [])).toEqual({ members: [], others: USERS });
  });

  it("un membro non selezionabile non crea un gruppo vuoto in cima", () => {
    // Es. utente disattivato: non è tra le opzioni, quindi non va mostrato.
    const { members, others } = groupUsersByMembership(USERS, [
      { userId: "disattivato", role: ProjectRole.EDITOR },
    ]);
    expect(members).toEqual([]);
    expect(others.map((u) => u.name)).toEqual(["Anna", "Bruno", "Carla"]);
  });

  it("regge l'elenco non ancora caricato", () => {
    expect(
      groupUsersByMembership(undefined, [{ userId: "u1", role: ProjectRole.MANAGER }]),
    ).toEqual({ members: [], others: [] });
  });
});

describe("memberOptionLabel", () => {
  it("mostra simbolo e ruolo accanto al nome", () => {
    expect(memberOptionLabel("Marta", ProjectRole.MANAGER)).toBe("★ Marta · Manager");
    expect(memberOptionLabel("Dario", ProjectRole.EDITOR)).toBe("✎ Dario · Editor");
    expect(memberOptionLabel("Vito", ProjectRole.VIEWER)).toBe("👁 Vito · Visualizzatore");
  });

  it("con un ruolo sconosciuto resta il solo nome", () => {
    expect(memberOptionLabel("Anna", "ALTRO")).toBe("Anna");
  });
});
