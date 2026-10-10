// Copyright (c) 2026 Jugaad s.r.l.
// SPDX-License-Identifier: AGPL-3.0-only

import { useQueries } from "@tanstack/react-query";
import { usePlugins } from "./usePlugins";

/** I gruppi della giornata, con la chiave che i plugin usano nell'indirizzo. */
export const GRUPPI_GIORNATA = ["overdue", "today", "tomorrow", "next", "none"] as const;
export type GruppoGiornata = (typeof GRUPPI_GIORNATA)[number];
export type ConteggiGruppi = Record<GruppoGiornata, number>;

/**
 * **Le card dei plugin nei riquadri della giornata.** Un plugin che dichiara
 * l'ancora `dashboardGroups` risponde su `api/gruppi` con quante ne ha per
 * gruppo (contratto in plugins/README.md): la pastiglia «Personali» somma
 * i numeri, e da aperta mostra la pagina del plugin dentro il riquadro con
 * `?ancora=dashboardGroups&gruppo=<chiave>`. Senza plugin con quell'ancora
 * la pastiglia non esiste: la pagina ospite non deve sapere se ne esistono.
 */
export function usePluginGroups(): { plugins: string[]; conteggi: ConteggiGruppi | null } {
  const plugins = (usePlugins().data ?? [])
    .filter((plugin) => plugin.anchors?.dashboardGroups)
    .map((plugin) => plugin.nome);
  const risposte = useQueries({
    queries: plugins.map((nome) => ({
      queryKey: ["plugin-gruppi", nome],
      queryFn: async () => {
        const r = await fetch(`/plugins/${encodeURIComponent(nome)}/api/gruppi`, {
          credentials: "same-origin",
        });
        if (!r.ok) throw new Error(`gruppi di ${nome}: ${r.status}`);
        return (await r.json()) as { gruppi: Partial<ConteggiGruppi> };
      },
      staleTime: 60_000,
      retry: false,
    })),
  });
  if (plugins.length === 0) return { plugins, conteggi: null };
  const conteggi = Object.fromEntries(GRUPPI_GIORNATA.map((g) => [g, 0])) as ConteggiGruppi;
  for (const r of risposte) {
    for (const g of GRUPPI_GIORNATA) conteggi[g] += Number(r.data?.gruppi?.[g] ?? 0);
  }
  return { plugins, conteggi };
}
