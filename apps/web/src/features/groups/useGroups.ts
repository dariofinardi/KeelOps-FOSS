// Copyright (c) 2026 Jugaad s.r.l.
// SPDX-License-Identifier: AGPL-3.0-only

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ActivityCategory, Group } from "@kancrm/shared";
import { api } from "@/lib/api";

export function useGroups() {
  return useQuery({
    queryKey: ["groups"],
    queryFn: () => api<Group[]>("/api/groups"),
  });
}

function useInvalidateGroups() {
  const queryClient = useQueryClient();
  return () => {
    void queryClient.invalidateQueries({ queryKey: ["groups"] });
    void queryClient.invalidateQueries({ queryKey: ["users"] });
  };
}

export function useCreateGroup() {
  const invalidate = useInvalidateGroups();
  return useMutation({
    mutationFn: (name: string) => api<Group>("/api/groups", { method: "POST", body: { name } }),
    onSuccess: invalidate,
  });
}

export function useRenameGroup() {
  const invalidate = useInvalidateGroups();
  return useMutation({
    mutationFn: ({ id, name }: { id: string; name: string }) =>
      api<Group>(`/api/groups/${id}`, { method: "PATCH", body: { name } }),
    onSuccess: invalidate,
  });
}

/**
 * L'area di lavoro che il gruppo governa: chi ne è manager legge i task di
 * quell'area (di chiunque) e ne configura stati e tipi. Cambiandola cambia
 * cosa vedono le persone, quindi si rilegge anche `me` e gli elenchi.
 */
export function useSetGroupArea() {
  const invalidate = useInvalidateGroups();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, managedArea }: { id: string; managedArea: ActivityCategory | null }) =>
      api<Group>(`/api/groups/${id}`, { method: "PATCH", body: { managedArea } }),
    onSuccess: () => {
      invalidate();
      void queryClient.invalidateQueries({ queryKey: ["me"] });
      void queryClient.invalidateQueries({ queryKey: ["tasks"] });
    },
  });
}

export function useDeleteGroup() {
  const invalidate = useInvalidateGroups();
  return useMutation({
    mutationFn: (id: string) => api<void>(`/api/groups/${id}`, { method: "DELETE" }),
    onSuccess: invalidate,
  });
}

export function useUpdateGroupMembers() {
  const invalidate = useInvalidateGroups();
  return useMutation({
    mutationFn: ({
      id,
      userIds,
      managerIds,
    }: {
      id: string;
      userIds: string[];
      managerIds?: string[];
    }) =>
      api<Group>(`/api/groups/${id}/members`, {
        method: "PUT",
        body: { userIds, ...(managerIds !== undefined ? { managerIds } : {}) },
      }),
    onSuccess: invalidate,
  });
}
