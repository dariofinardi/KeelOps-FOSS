import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { HandCoins } from "lucide-react";
import type { DealListItem } from "@kancrm/shared";
import { Combobox } from "@/components/ui/combobox";
import { useDeals } from "./useDeals";

/** "Titolo · Azienda · Contatto": con molte offerte il solo titolo non basta. */
export function dealLabel(deal: DealListItem): string {
  return [deal.title, deal.company?.name, deal.contact?.name].filter(Boolean).join(" · ");
}

/** Combo offerta con filtro su titolo, azienda e contatto. */
export function DealCombobox({
  value,
  onChange,
  placeholder,
  includeClosed = false,
}: {
  value: string | null;
  onChange: (dealId: string | null) => void;
  placeholder?: string;
  /** Includi anche le offerte chiuse (vinte/perse): utile per legarci una ricorrenza. */
  includeClosed?: boolean;
}) {
  const { t } = useTranslation();
  // Le offerte stanno in una pagina sola: il filtro è locale e immediato.
  const { data } = useDeals({ includeClosed, pageSize: 500 });
  const items = useMemo(
    () => (data?.items ?? []).map((deal) => ({ id: deal.id, label: dealLabel(deal) })),
    [data],
  );

  return (
    <Combobox
      value={value}
      onChange={onChange}
      items={items}
      placeholder={placeholder ?? t("Cerca per offerta, azienda o persona…")}
      emptyLabel={t("Nessuna offerta")}
      icon={<HandCoins className="size-4 shrink-0 text-muted-foreground" />}
    />
  );
}
