// Copyright (c) 2026 Jugaad s.r.l.
// SPDX-License-Identifier: AGPL-3.0-only

import { useQuery } from "@tanstack/react-query";
import type { PluginUiEntry } from "@kancrm/shared";
import { api } from "@/lib/api";

export type { PluginUiEntry };

/**
 * Le voci UI dei plugin montati dal core (`PLUGINS` in .env): il menu le rende
 * in coda alle aree, le ancore contestuali dove il manifesto le dichiara.
 * Vuoto o errore = nessun plugin: l'interfaccia non ne parla proprio.
 */
export function usePlugins() {
  return useQuery({
    queryKey: ["plugins-ui"],
    queryFn: () => api<{ plugins: PluginUiEntry[] }>("/api/plugins/ui"),
    staleTime: Infinity,
    retry: false,
    select: (data) => data.plugins,
  });
}
