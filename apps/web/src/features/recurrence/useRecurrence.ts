// Copyright (c) 2026 Jugaad s.r.l.
// SPDX-License-Identifier: AGPL-3.0-only

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  CreateRecurrenceTemplateInput,
  PreviewRecurrenceResult,
  RecurrenceTemplate,
  UpdateRecurrenceTemplateInput,
} from "@kancrm/shared";
import { api } from "@/lib/api";

export function useRecurrenceTemplates() {
  return useQuery({
    queryKey: ["recurrence-templates"],
    queryFn: () => api<RecurrenceTemplate[]>("/api/recurrence-templates"),
  });
}

export function useRecurrencePreview(rrule: string | null, dtstart: string) {
  return useQuery({
    queryKey: ["recurrence-preview", rrule, dtstart],
    queryFn: () =>
      api<PreviewRecurrenceResult>("/api/recurrence-templates/preview", {
        method: "POST",
        body: { rrule, dtstart, count: 5 },
      }),
    enabled: rrule !== null && dtstart.length === 10,
    retry: false,
    staleTime: 60_000,
  });
}

function useInvalidateRecurrence() {
  const queryClient = useQueryClient();
  return () => {
    void queryClient.invalidateQueries({ queryKey: ["recurrence-templates"] });
    void queryClient.invalidateQueries({ queryKey: ["tasks"] });
  };
}

export function useCreateTemplate() {
  const invalidate = useInvalidateRecurrence();
  return useMutation({
    mutationFn: (input: CreateRecurrenceTemplateInput) =>
      api<RecurrenceTemplate>("/api/recurrence-templates", { method: "POST", body: input }),
    onSuccess: invalidate,
  });
}

export function useUpdateTemplate() {
  const invalidate = useInvalidateRecurrence();
  return useMutation({
    mutationFn: ({ id, ...input }: UpdateRecurrenceTemplateInput & { id: string }) =>
      api<RecurrenceTemplate>(`/api/recurrence-templates/${id}`, {
        method: "PATCH",
        body: input,
      }),
    onSuccess: invalidate,
  });
}

export function useDeleteTemplate() {
  const invalidate = useInvalidateRecurrence();
  return useMutation({
    mutationFn: ({ id, deleteFuture }: { id: string; deleteFuture: boolean }) =>
      api<void>(`/api/recurrence-templates/${id}?deleteFuture=${deleteFuture}`, {
        method: "DELETE",
      }),
    onSuccess: invalidate,
  });
}

export function useAddTemplateLink() {
  const invalidate = useInvalidateRecurrence();
  return useMutation({
    mutationFn: ({ id, name, url }: { id: string; name: string; url: string }) =>
      api<RecurrenceTemplate>(`/api/recurrence-templates/${id}/attachments/link`, {
        method: "POST",
        body: { name, url },
      }),
    onSuccess: invalidate,
  });
}

export function useDeleteTemplateAttachment() {
  const invalidate = useInvalidateRecurrence();
  return useMutation({
    mutationFn: ({ id, attachmentId }: { id: string; attachmentId: string }) =>
      api<void>(`/api/recurrence-templates/${id}/attachments/${attachmentId}`, {
        method: "DELETE",
      }),
    onSuccess: invalidate,
  });
}
