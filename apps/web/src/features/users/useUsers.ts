import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  CreateUserInput,
  ResetPasswordResult,
  UpdateUserInput,
  User,
  UserDeletionImpact,
} from "@kancrm/shared";
import { api } from "@/lib/api";

/**
 * Il perimetro dell'area: **tutti** gli utenti (pagina Utenti, amministratore)
 * oppure i soli clienti del **portale** (area customer care, aperta anche ai
 * manager di gruppo). È lo stesso elenco visto da due finestre — a filtrare è
 * comunque il server, che non si fida del parametro.
 */
export type PerimetroUtenti = "tutti" | "portale";

export function useUsers(perimetro: PerimetroUtenti = "tutti", enabled = true) {
  return useQuery({
    queryKey: ["users", perimetro],
    queryFn: () =>
      api<User[]>(perimetro === "portale" ? "/api/users?perimetro=portale" : "/api/users"),
    enabled,
  });
}

/**
 * I progetti che si possono assegnare a un cliente: **tutti**, non solo quelli
 * che chi sta guardando vedrebbe altrove.
 *
 * Assegnare un progetto è il gesto che permette al cliente di aprirci i ticket:
 * il manager delle vendite non conosce i progetti di sviluppo e deve comunque
 * poter abilitare un cliente su uno di essi (02/09/2026). Perciò questa lista
 * NON è `useProjects`, che è filtrata dalla visibilità — e non va sostituita
 * con quella «per coerenza»: la differenza è il motivo per cui esiste.
 */
export function useAssignableProjects() {
  return useQuery({
    queryKey: ["assignable-projects"],
    queryFn: () =>
      api<Array<{ id: string; name: string; company: string | null }>>(
        "/api/users/project-options",
      ),
  });
}

export function useCreateUser() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateUserInput) =>
      api<User>("/api/users", { method: "POST", body: input }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["users"] });
      void queryClient.invalidateQueries({ queryKey: ["groups"] });
    },
  });
}

export function useUpdateUser() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...input }: UpdateUserInput & { id: string }) =>
      api<User>(`/api/users/${id}`, { method: "PATCH", body: input }),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ["users"] }),
  });
}

/** Azzera il freno sui tentativi di password (vedi «Utenti»): la persona rientra subito. */
export function useUnlockUser() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api<void>(`/api/users/${id}/unlock`, { method: "POST" }),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ["users"] }),
  });
}

/** Dati collegati all'utente: caricati solo quando il dialogo di eliminazione è aperto. */
export function useDeletionImpact(userId: string | null) {
  return useQuery({
    queryKey: ["user-deletion-impact", userId],
    queryFn: () => api<UserDeletionImpact>(`/api/users/${userId}/deletion-impact`),
    enabled: userId !== null,
  });
}

export function useDeleteUser() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, transferTo }: { id: string; transferTo?: string | null }) =>
      api<void>(
        `/api/users/${id}${transferTo ? `?transferTo=${encodeURIComponent(transferTo)}` : ""}`,
        { method: "DELETE" },
      ),
    // L'utente eliminato compariva ovunque (liste, assegnatari, timesheet,
    // storico): si ricaricano tutte le query attive, non solo quella utenti.
    onSuccess: () => void queryClient.invalidateQueries(),
  });
}

export function useResetPassword() {
  return useMutation({
    mutationFn: ({ id, password }: { id: string; password: string }) =>
      api<ResetPasswordResult>(`/api/users/${id}/reset-password`, {
        method: "POST",
        body: { password },
      }),
  });
}
