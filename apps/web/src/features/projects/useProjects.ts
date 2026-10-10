// Copyright (c) 2026 Jugaad s.r.l.
// SPDX-License-Identifier: AGPL-3.0-only

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  CreateProjectInput,
  ProjectListItem,
  UpdateProjectInput,
  UpdateProjectMembersInput,
} from "@kancrm/shared";
import { useInternalLists } from "@/features/auth/useAuth";
import { api } from "@/lib/api";

/**
 * Elenco dei progetti, con la ricerca fatta dal server: per nome e — con
 * `searchTasks` — anche nei titoli dei task, che il client non ha in mano.
 */
export function useProjects(search: { q?: string; searchTasks?: boolean } = {}) {
  const q = search.q?.trim() ?? "";
  const searchTasks = Boolean(search.searchTasks && q);
  const params = new URLSearchParams();
  if (q) params.set("q", q);
  if (searchTasks) params.set("searchTasks", "true");
  const query = params.toString();
  const enabled = useInternalLists();
  return useQuery({
    queryKey: ["projects", q, searchTasks],
    queryFn: () => api<ProjectListItem[]>(`/api/projects${query ? `?${query}` : ""}`),
    enabled,
    // Cambiando la ricerca l'elenco precedente resta a schermo finché arriva il
    // nuovo: senza, la pagina sfarfalla a ogni lettera.
    placeholderData: (previous) => previous,
  });
}

export function useProjectDetail(id: string | null) {
  return useQuery({
    queryKey: ["project", id],
    queryFn: () => api<ProjectListItem>(`/api/projects/${id}`),
    enabled: id !== null,
  });
}

function useInvalidateProjects() {
  const queryClient = useQueryClient();
  return (id?: string) => {
    void queryClient.invalidateQueries({ queryKey: ["projects"] });
    void queryClient.invalidateQueries({ queryKey: ["tasks"] });
    if (id) void queryClient.invalidateQueries({ queryKey: ["project", id] });
  };
}

export function useCreateProject() {
  const invalidate = useInvalidateProjects();
  return useMutation({
    mutationFn: (input: CreateProjectInput) =>
      api<ProjectListItem>("/api/projects", { method: "POST", body: input }),
    onSuccess: () => invalidate(),
  });
}

export function useUpdateProject() {
  const invalidate = useInvalidateProjects();
  return useMutation({
    mutationFn: ({ id, ...input }: UpdateProjectInput & { id: string }) =>
      api<ProjectListItem>(`/api/projects/${id}`, { method: "PATCH", body: input }),
    onSuccess: (_data, variables) => invalidate(variables.id),
  });
}

export function useDeleteProject() {
  const invalidate = useInvalidateProjects();
  return useMutation({
    mutationFn: (id: string) => api<void>(`/api/projects/${id}`, { method: "DELETE" }),
    onSuccess: () => invalidate(),
  });
}

export function useUpdateProjectMembers() {
  const invalidate = useInvalidateProjects();
  return useMutation({
    mutationFn: ({ id, ...input }: UpdateProjectMembersInput & { id: string }) =>
      api<ProjectListItem>(`/api/projects/${id}/members`, { method: "PUT", body: input }),
    onSuccess: (_data, variables) => invalidate(variables.id),
  });
}

/** Ordine manuale dei progetti nella vista dell'utente (array di projectId). */
export function useProjectOrder() {
  return useQuery({
    queryKey: ["project-order"],
    queryFn: async () => (await api<{ order: string[] }>("/api/profile/project-order")).order,
  });
}

export function useSetProjectOrder() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (order: string[]) =>
      api<{ order: string[] }>("/api/profile/project-order", { method: "PUT", body: { order } }),
    // Ottimistico: l'ordine si aggiorna subito, senza attendere il round-trip.
    onMutate: (order) => {
      queryClient.setQueryData(["project-order"], order);
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: ["project-order"] }),
  });
}
