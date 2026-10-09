import { RotateCcw } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { useColumnOrder } from "./useColumnOrder";

/**
 * Bottone "Ordine standard": ripristina l'ordine colonne salvato per la bacheca
 * `orderKey`. Si mette nella toolbar/header della vista (non su una riga a sé) e
 * non renderizza nulla se l'utente non ha un ordine personalizzato.
 */
export function ResetColumnOrder({ orderKey }: { orderKey: string }) {
  const { t } = useTranslation();
  const { orders, setOrder } = useColumnOrder();
  if (!orders[orderKey]?.length) return null;
  return (
    <Button
      variant="outline"
      size="sm"
      onClick={() => setOrder(orderKey, [])}
      title={t("Ripristina l'ordine standard delle colonne")}
    >
      <RotateCcw className="size-4" /> {t("Ordine standard")}
    </Button>
  );
}
