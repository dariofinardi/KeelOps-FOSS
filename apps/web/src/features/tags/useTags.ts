import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { CreateTagInput, Tag } from "@kancrm/shared";
import { useInternalLists } from "@/features/auth/useAuth";
import { api } from "@/lib/api";

export function useTags() {
  const enabled = useInternalLists();
  return useQuery({
    queryKey: ["tags"],
    queryFn: () => api<Tag[]>("/api/tags"),
    staleTime: 60_000,
    enabled,
  });
}

export function useCreateTag() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateTagInput) => api<Tag>("/api/tags", { method: "POST", body: input }),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ["tags"] }),
  });
}
