// Copyright (c) 2026 Jugaad s.r.l.
// SPDX-License-Identifier: AGPL-3.0-only

import { useQuery } from "@tanstack/react-query";
import type { Branding } from "@kancrm/shared";
import { api } from "@/lib/api";

/** Branding aziendale (logo + palette attiva), condiviso da tutti gli utenti. */
export function useBranding() {
  return useQuery({
    queryKey: ["branding"],
    queryFn: () => api<Branding>("/api/branding"),
    staleTime: 60_000,
  });
}
