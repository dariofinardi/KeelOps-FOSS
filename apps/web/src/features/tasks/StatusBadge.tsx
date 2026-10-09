import { useTranslation } from "react-i18next";
import type { TaskStatus } from "@kancrm/shared";
import { ColorPill } from "@/components/ui/color-pill";

/**
 * Lo stato del task, in pastiglia. La forma (e la regola "mai a capo") sta in
 * `ColorPill`, condivisa con le fasi delle offerte e i tipi di attività.
 *
 * `unread` fa lampeggiare il solo pallino: nell'elenco dei ticket dice che ci
 * sono messaggi di altri non ancora letti da chi guarda (14/09/2026).
 */
export function StatusBadge({ status, unread = false }: { status: TaskStatus; unread?: boolean }) {
  const { t } = useTranslation();
  return (
    <ColorPill
      color={status.color}
      label={status.name}
      pulse={unread}
      pulseLabel={unread ? t("Nuovi messaggi") : undefined}
    />
  );
}
