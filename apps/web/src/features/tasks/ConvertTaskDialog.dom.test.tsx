// Copyright (c) 2026 Jugaad s.r.l.
// SPDX-License-Identifier: AGPL-3.0-only

import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import type { TaskDetail } from "@kancrm/shared";
import { ConvertTaskDialog } from "./ConvertTaskDialog";

const mutate = vi.fn();
const status = (id: string, name: string, category: string, order: number, isClosed = false) => ({
  id,
  name,
  category,
  order,
  isClosed,
  color: "#000",
  isWonTarget: false,
  isAssignedTarget: false,
  stopsRecurrence: false,
  isBillingMilestone: false,
});
const STATUSES = [
  status("a1", "Da assegnare", "ADMIN", 0),
  status("a2", "In esecuzione", "ADMIN", 1),
  status("a3", "Completato", "ADMIN", 2, true),
  status("d1", "Da fare", "DEV", 0),
  status("d2", "In sviluppo", "DEV", 1),
  status("d3", "Rilasciato", "DEV", 2, true),
];

vi.mock("./useTasks", () => ({
  useUpdateTask: () => ({ mutate, isPending: false }),
  useTaskStatuses: () => ({ data: STATUSES }),
}));
vi.mock("./activity-types", () => ({
  useActivityTypes: () => ({ data: [] }),
  ActivityTypeSelect: () => <div>tipo</div>,
}));
vi.mock("@/features/deals/DealCombobox", () => ({ DealCombobox: () => <div>offerta</div> }));
vi.mock("@/features/auth/useAuth", () => ({
  useCurrentUser: () => ({ id: "me", role: "ADMIN" }),
  useInternalLists: () => true,
}));
vi.mock("@/features/options/useOptions", () => ({
  useOptions: () => ({
    users: [
      { id: "u9", name: "Nove" },
      { id: "me", name: "Me" },
    ],
    projectMembers: [{ userId: "u9", role: "EDITOR" }],
    projects: [{ id: "p1", name: "Proj" }],
    statuses: STATUSES,
    activityTypeGroups: [],
    tags: [],
    canAssignOthers: true,
  }),
}));

// Un task di sviluppo, "In sviluppo" (2º aperto DEV), assegnato a Nove.
const task = {
  id: "t1",
  kind: "PROJECT",
  projectId: "p1",
  relatedDeal: null,
  status: STATUSES[4],
  activityType: null,
  assignee: { id: "u9", name: "Nove" },
} as unknown as TaskDetail;

describe("ConvertTaskDialog", () => {
  it("convertendo in amministrativo: chi converte diventa supervisore, stato rimappato, offerta staccata", () => {
    mutate.mockClear();
    render(<ConvertTaskDialog task={task} onClose={vi.fn()} />);

    // Passa da progetto ad amministrativo: cambia il mestiere DEV→ADMIN.
    fireEvent.click(screen.getByRole("button", { name: /Amministrativo/ }));
    fireEvent.click(screen.getByRole("button", { name: "Converti" }));

    expect(mutate).toHaveBeenCalledTimes(1);
    const payload = mutate.mock.calls[0]![0];
    // Chi converte (me) diventa supervisore; l'assegnatario si azzera cambiando
    // contesto; esce dal progetto e da ogni offerta; "In sviluppo" (2º aperto
    // DEV) → 2º aperto ADMIN = "In esecuzione".
    expect(payload).toMatchObject({
      id: "t1",
      projectId: null,
      relatedDealId: null,
      supervisorId: "me",
      assigneeId: null,
      statusId: "a2",
    });
  });

  it("sulla destinazione attuale, senza cambi, non si può confermare", () => {
    render(<ConvertTaskDialog task={task} onClose={vi.fn()} />);
    // Il task è già di progetto: "Converti" resta disattivato finché non cambia nulla.
    expect(screen.getByRole("button", { name: "Converti" })).toBeDisabled();
  });
});
