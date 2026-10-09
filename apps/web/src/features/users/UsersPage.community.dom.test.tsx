// Copyright (c) 2026 Jugaad s.r.l.

import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { UserRole, type User } from "@kancrm/shared";
import { CurrentUserContext } from "@/features/auth/useAuth";
import { UsersPage } from "./UsersPage";

/**
 * **The Users page of the community edition** (08/10/2026): no portal or
 * sales monitor role to choose, no ticket projects, no hours per week or
 * calendar aliases (they belong to the commercial timesheet); the "sees
 * everyone's hours" switch stays, because the timesheet grid is core.
 */
vi.mock("@/edition/rotte", () => ({ edizione: { moduli: new Set<string>() } }));

const membro: User = {
  id: "u1",
  email: "mario@azienda.test",
  name: "Mario Membro",
  role: UserRole.MEMBER,
  authProvider: "LOCAL",
  isActive: true,
  isSystem: false,
  billingAssignee: null,
  canViewAllTimesheets: false,
  salesMonitorAllDeals: false,
  weeklyHours: 40,
  calendarAliases: null,
  createdAt: new Date().toISOString(),
  lastLoginAt: null,
  lastSeenAt: null,
  failedPasswordAttempts: 0,
  lockedUntil: null,
  groups: [],
  ticketProjects: [],
  companyId: null,
};

vi.mock("./useUsers", () => ({
  useUsers: () => ({ data: [membro], isLoading: false }),
  useAssignableProjects: () => ({ data: [] }),
  useCreateUser: () => ({ mutate: vi.fn(), isPending: false }),
  useUpdateUser: () => ({ mutate: vi.fn(), mutateAsync: vi.fn(), isPending: false }),
  useDeleteUser: () => ({ mutate: vi.fn(), isPending: false }),
  useDeletionImpact: () => ({ data: null, isLoading: false }),
  useResetPassword: () => ({ mutate: vi.fn(), isPending: false }),
  useUnlockUser: () => ({ mutate: vi.fn(), isPending: false }),
}));
vi.mock("@/features/groups/useGroups", () => ({ useGroups: () => ({ data: [] }) }));
vi.mock("@/features/crm/useCrm", () => ({
  useResolveCompany: () => ({ mutate: vi.fn(), mutateAsync: vi.fn(), isPending: false }),
}));
vi.mock("@/features/crm/CompanyCombobox", () => ({ CompanyCombobox: () => null }));

const admin = {
  id: "admin",
  name: "Ada",
  role: UserRole.ADMIN,
  isGroupManager: true,
} as unknown as React.ContextType<typeof CurrentUserContext>;

describe("Users page, community edition", () => {
  it("offers the core roles only, and the core columns", () => {
    render(
      <CurrentUserContext.Provider value={admin}>
        <UsersPage />
      </CurrentUserContext.Provider>,
    );
    // the role select is the one that offers ADMIN
    const selettore = screen
      .getAllByRole("combobox")
      .find((el) => el.querySelector(`option[value="${UserRole.ADMIN}"]`))!;
    const ruoli = [...selettore.querySelectorAll("option")].map((o) => o.value);
    expect(ruoli).toEqual([UserRole.ADMIN, UserRole.MEMBER]);
    expect(screen.getByText("Gruppi")).toBeInTheDocument();
    expect(screen.queryByText("Gruppi e ticket")).toBeNull();
    for (const colonna of ["Ore/sett.", "Sul calendario"]) {
      expect(screen.queryByText(colonna), colonna).toBeNull();
    }
    expect(screen.getByText("Timesheet team")).toBeInTheDocument();
  });
});
