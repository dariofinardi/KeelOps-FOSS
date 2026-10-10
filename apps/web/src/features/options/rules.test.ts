// Copyright (c) 2026 Jugaad s.r.l.
// SPDX-License-Identifier: AGPL-3.0-only

import { describe, expect, it } from "vitest";
import { ProjectRole, UserRole, VisibilityScope, type ProjectListItem } from "@kancrm/shared";
import {
  canAssignOthers,
  editableProjects,
  projectMembersOf,
  taskKindOf,
  userScopeFor,
  type CurrentUserLike,
} from "./rules";

const user = (over: Partial<CurrentUserLike> = {}): CurrentUserLike => ({
  id: "u1",
  role: UserRole.MEMBER,
  canSeeAdminTasks: true,
  canEditDeals: true,
  ...over,
});

const project = (id: string, myRole: ProjectRole | null, isArchived = false): ProjectListItem =>
  ({ id, name: id, myRole, isArchived, members: [] }) as unknown as ProjectListItem;

describe("perimetro delle persone", () => {
  it("le offerte si intestano solo a chi può lavorarle", () => {
    // Il server rifiuta un'offerta intestata a chi non ha accesso completo:
    // proporre quei nomi darebbe un errore al salvataggio.
    expect(userScopeFor("DEAL")).toBe(VisibilityScope.DEALS);
  });

  it("altrove la tendina resta aperta: il lavoro segue la persona", () => {
    // Chi riceve un task lo vede e lo lavora in qualunque area, anche senza i
    // permessi di quel modulo: restringere qui nasconderebbe colleghi validi.
    for (const module of ["ADMIN", "PROJECT", "TICKET", "BOARD"] as const) {
      expect(userScopeFor(module)).toBeUndefined();
    }
  });
});

describe("canAssignOthers", () => {
  it("nella bacheca personale il lavoro resta proprio, in quella condivisa no", () => {
    expect(canAssignOthers({ module: "BOARD" }, user())).toBe(false);
    expect(canAssignOthers({ module: "BOARD", sharedBoard: true }, user())).toBe(true);
  });

  it("nei progetti e nei ticket si assegna ai colleghi", () => {
    expect(canAssignOthers({ module: "PROJECT" }, user({ canSeeAdminTasks: false }))).toBe(true);
    expect(canAssignOthers({ module: "TICKET" }, user({ canSeeAdminTasks: false }))).toBe(true);
  });

  it("nello scadenzario serve vederlo; l'admin può sempre", () => {
    expect(canAssignOthers({ module: "ADMIN" }, user({ canSeeAdminTasks: false }))).toBe(false);
    expect(canAssignOthers({ module: "ADMIN" }, user({ canSeeAdminTasks: true }))).toBe(true);
    expect(
      canAssignOthers({ module: "ADMIN" }, user({ canSeeAdminTasks: false, role: UserRole.ADMIN })),
    ).toBe(true);
  });

  it("le offerte le intesta chi può modificarle", () => {
    expect(canAssignOthers({ module: "DEAL" }, user({ canEditDeals: false }))).toBe(false);
  });
});

describe("progetti proponibili", () => {
  const projects = [
    project("gestito", ProjectRole.MANAGER),
    project("scrivibile", ProjectRole.EDITOR),
    project("osservato", ProjectRole.VIEWER),
    project("estraneo", null),
  ];

  it("solo dove si può davvero scrivere", () => {
    // Un progetto in sola lettura in tendina è una scelta che il server rifiuta.
    expect(editableProjects(projects, user()).map((p) => p.id)).toEqual(["gestito", "scrivibile"]);
  });

  it("l'admin li vede tutti", () => {
    expect(editableProjects(projects, user({ role: UserRole.ADMIN }))).toHaveLength(4);
  });

  it("mai un progetto archiviato, nemmeno all'admin che lo gestisce", () => {
    // Archiviato = non ci si lavora più: un task creato lì dentro sparirebbe
    // dagli elenchi di tutti (perimetro delle Bacheche) appena salvato.
    const chiuso = [project("archiviato", ProjectRole.MANAGER, true)];
    expect(editableProjects(chiuso, user())).toEqual([]);
    expect(editableProjects(chiuso, user({ role: UserRole.ADMIN }))).toEqual([]);
  });
});

describe("membri del progetto", () => {
  it("senza progetto scelto non c'è nessuna squadra da mettere in cima", () => {
    expect(projectMembersOf([], null)).toBeUndefined();
  });

  it("la bacheca personale usa gli stati dello scadenzario", () => {
    expect(taskKindOf("BOARD")).toBe("ADMIN");
    expect(taskKindOf("PROJECT")).toBe("PROJECT");
  });
});
