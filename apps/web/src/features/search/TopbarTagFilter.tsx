// Copyright (c) 2026 Jugaad s.r.l.
// SPDX-License-Identifier: AGPL-3.0-only

import { useTranslation } from "react-i18next";
import { Combobox } from "@/components/ui/combobox";
import { FILTER_ICONS } from "@/components/ui/filter-select";
import { useViewSearchTarget } from "@/lib/view-search";
import { useTags } from "@/features/tags/useTags";

/**
 * Il filtro tag della vista corrente, in topbar a sinistra del campo di
 * ricerca (spostato qui dalla barra filtri: due campi con la lente uno accanto
 * all'altro non si capivano). Compare solo dove la vista registra un filtro
 * tag (oggi le Bacheche) e applica la scelta ai record correnti.
 */
export function TopbarTagFilter({ className }: { className?: string }) {
  const { t } = useTranslation();
  const target = useViewSearchTarget();
  const { data: tags } = useTags();
  if (!target?.tag || !tags || tags.length === 0) return null;
  const { tagId, setTagId } = target.tag;
  return (
    <Combobox
      className={className ?? "w-40"}
      value={tagId || null}
      onChange={(id) => setTagId(id ?? null)}
      items={tags.map((tag) => ({ id: tag.id, label: `${tag.name} (${tag.taskCount})` }))}
      emptyLabel={t("Tutti i tag")}
      placeholder={t("Cerca un tag…")}
      icon={<FILTER_ICONS.tag className="size-4 shrink-0 text-primary" />}
    />
  );
}
