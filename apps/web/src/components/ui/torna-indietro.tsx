// Copyright (c) 2026 Jugaad s.r.l.
// SPDX-License-Identifier: AGPL-3.0-only

import { useTranslation } from "react-i18next";
import { ArrowLeft } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * **«← Da dove si arriva»**: lo stesso segno in ogni pannello e in cima alle
 * pagine (vedi `lib/ritorno.ts`). Sta sopra il titolo, dove l'occhio cerca la
 * strada di casa, come il ritorno al task padre.
 */
export function TornaIndietro({
  etichetta,
  onClick,
  className,
}: {
  etichetta: string;
  onClick: () => void;
  className?: string;
}) {
  const { t } = useTranslation();
  const titolo = t("Torna a «{{etichetta}}»", { etichetta });
  return (
    <button
      type="button"
      onClick={onClick}
      title={titolo}
      aria-label={titolo}
      className={cn(
        "flex max-w-full items-center gap-1 text-xs text-muted-foreground hover:text-foreground hover:underline",
        className,
      )}
    >
      <ArrowLeft className="size-3.5 shrink-0" />
      <span className="truncate">{etichetta}</span>
    </button>
  );
}
