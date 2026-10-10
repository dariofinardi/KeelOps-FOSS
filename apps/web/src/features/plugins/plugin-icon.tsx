// Copyright (c) 2026 Jugaad s.r.l.
// SPDX-License-Identifier: AGPL-3.0-only

import type { ComponentType } from "react";
import { Bot, Columns3, Puzzle, Share2, type LucideIcon } from "lucide-react";
import type { PluginUiEntry } from "@kancrm/shared";
import { cn } from "@/lib/utils";

/**
 * **L'icona di un plugin, in un posto solo** (prima la stessa mappa stava nel
 * menù laterale e nel menù a tre puntini, e «columns-3» mancava in entrambe).
 *
 * Due strade: un nome del set lucide già in uso — niente accostamenti nuovi,
 * un nome ignoto ricade sul puzzle — oppure un file del plugin (`iconaUrl`,
 * che il server espone solo se il file esiste). Il file si disegna come
 * **maschera** tinta di `currentColor`: così la sua icona si comporta come le
 * altre — cambia colore con la voce attiva e con il tema — e al plugin basta
 * un SVG monocromatico, senza sapere nulla dei colori del core.
 */
const LUCIDE: Record<string, LucideIcon> = {
  "share-2": Share2,
  bot: Bot,
  puzzle: Puzzle,
  "columns-3": Columns3,
};

type Icona = ComponentType<{ className?: string }>;
export type IconaDiPlugin = Pick<PluginUiEntry, "icona" | "iconaUrl">;

// Un componente per indirizzo, stabile fra i render: React non rimonta la voce.
const perUrl = new Map<string, Icona>();

function daFile(url: string): Icona {
  let icona = perUrl.get(url);
  if (!icona) {
    const maschera = `url("${url}")`;
    icona = function IconaDaFile({ className }: { className?: string }) {
      return (
        <span
          aria-hidden
          data-icona-url={url}
          className={cn("inline-block shrink-0", className)}
          style={{
            backgroundColor: "currentColor",
            maskImage: maschera,
            WebkitMaskImage: maschera,
            maskSize: "contain",
            WebkitMaskSize: "contain",
            maskRepeat: "no-repeat",
            WebkitMaskRepeat: "no-repeat",
            maskPosition: "center",
            WebkitMaskPosition: "center",
          }}
        />
      );
    };
    perUrl.set(url, icona);
  }
  return icona;
}

/** Il componente icona di un plugin: si usa come una qualsiasi icona lucide. */
export function iconaDelPlugin(plugin: IconaDiPlugin): Icona {
  if (plugin.iconaUrl) return daFile(plugin.iconaUrl);
  return LUCIDE[plugin.icona] ?? Puzzle;
}
