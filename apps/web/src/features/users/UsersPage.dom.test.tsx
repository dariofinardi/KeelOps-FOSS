import { describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { UserRole, type User } from "@kancrm/shared";
import { CurrentUserContext } from "@/features/auth/useAuth";
import { UsersPage } from "./UsersPage";
import { edizione } from "@/edition/rotte";

/**
 * **L'area customer care è la stessa pagina, con un altro perimetro.**
 *
 * Qui si prova quello che si vede: niente selettore del ruolo, niente
 * eliminazione, e le colonne che per un cliente sarebbero una fila di trattini
 * non ci sono. Il recinto vero però sta sul server — `users-customer-care.test.ts`
 * prova che una PATCH costruita a mano viene rifiutata lo stesso.
 */
const cliente = (over: Partial<User> = {}): User => ({
  id: "u1",
  email: "clara@cliente.test",
  name: "Clara Cliente",
  role: UserRole.PORTAL,
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
  ticketProjects: [{ id: "p1", name: "Portale ACME" }],
  companyId: "c1",
  ...over,
});

let utenti: User[] = [cliente()];

const { sblocca, aggiorna } = vi.hoisted(() => ({ sblocca: vi.fn(), aggiorna: vi.fn() }));
vi.mock("./useUsers", () => ({
  useUsers: () => ({ data: utenti, isLoading: false }),
  useAssignableProjects: () => ({ data: [{ id: "p1", name: "Portale ACME", company: "ACME" }] }),
  useCreateUser: () => ({ mutate: vi.fn(), isPending: false }),
  useUpdateUser: () => ({ mutate: aggiorna, mutateAsync: vi.fn(), isPending: false }),
  useDeleteUser: () => ({ mutate: vi.fn(), isPending: false }),
  useDeletionImpact: () => ({ data: null, isLoading: false }),
  useResetPassword: () => ({ mutate: vi.fn(), isPending: false }),
  useUnlockUser: () => ({ mutate: sblocca, isPending: false }),
}));
vi.mock("@/features/groups/useGroups", () => ({ useGroups: () => ({ data: [] }) }));
// Il campo azienda del nuovo cliente trova o crea al salvataggio: qui non si salva.
vi.mock("@/features/crm/useCrm", () => ({
  useResolveCompany: () => ({ mutate: vi.fn(), mutateAsync: vi.fn(), isPending: false }),
}));
vi.mock("@/features/crm/CompanyCombobox", () => ({
  CompanyCombobox: () => <div data-testid="azienda" />,
}));

const admin = {
  id: "admin",
  name: "Ada",
  role: UserRole.ADMIN,
  isGroupManager: true,
} as unknown as React.ContextType<typeof CurrentUserContext>;

const mostra = (perimetro: "tutti" | "portale") =>
  render(
    <CurrentUserContext.Provider value={admin}>
      <UsersPage perimetro={perimetro} />
    </CurrentUserContext.Provider>,
  );

describe("la pagina utenti nei due perimetri", () => {
  it("nell'area customer care il ruolo non si sceglie e non si elimina", () => {
    mostra("portale");
    expect(screen.getByText("Portale (cliente)")).toBeInTheDocument();
    // niente tendina del ruolo: qui vivono solo clienti
    expect(screen.queryByRole("combobox")).toBeNull();
    expect(screen.queryByTitle("Elimina definitivamente")).toBeNull();
    // ma la password si reimposta e il cliente si disattiva: è il mestiere
    expect(screen.getByTitle("Reimposta password")).toBeInTheDocument();
    expect(screen.getByTitle("Disattiva")).toBeInTheDocument();
    // e l'azienda si sceglie, perché senza il portale è vuoto
    expect(screen.getByTestId("azienda")).toBeInTheDocument();
  });

  it("le colonne che per un cliente sarebbero trattini non ci sono", () => {
    mostra("portale");
    for (const colonna of ["Amministrativo", "Ore/sett.", "Sul calendario", "Timesheet team"]) {
      expect(screen.queryByText(colonna), colonna).toBeNull();
    }
  });

  it("nella pagina Utenti invece c'è tutto", () => {
    mostra("tutti");
    expect(screen.getByRole("combobox")).toBeInTheDocument();
    expect(screen.getByTitle("Elimina definitivamente")).toBeInTheDocument();
    // The contract hours are the yardstick of the commercial timesheet's productivity.
    if (edizione.moduli.has("timesheet")) expect(screen.getByText("Ore/sett.")).toBeInTheDocument();
    else expect(screen.queryByText("Ore/sett.")).toBeNull();
  });

  it("chi è chiuso dal freno sulle password lo si vede, e il lucchetto lo riapre", () => {
    const prima = utenti;
    utenti = [
      cliente({
        failedPasswordAttempts: 4,
        lockedUntil: new Date(Date.now() + 10 * 60_000).toISOString(),
      }),
    ];
    try {
      mostra("tutti");
      expect(screen.getByText(/^Bloccato fino alle/)).toBeInTheDocument();
      fireEvent.click(screen.getByTitle("Azzera il freno sui tentativi"));
      expect(sblocca).toHaveBeenCalledWith("u1");
    } finally {
      utenti = prima;
    }
  });
});

describe("il portale investitori", () => {
  it("a un monitor vendite l'admin apre tutte le offerte, con una casella che lo dice", () => {
    utenti = [
      cliente({
        id: "m1",
        name: "Fondo Alfa",
        role: UserRole.SALES_MONITOR,
        companyId: null,
        ticketProjects: [],
      }),
    ];
    mostra("tutti");
    const casella = screen.getByRole("checkbox", { name: "Tutte le offerte" });
    expect(casella).not.toBeChecked();
    fireEvent.click(casella);
    expect(aggiorna).toHaveBeenCalledWith({ id: "m1", salesMonitorAllDeals: true });
    utenti = [cliente()];
  });
});
