import { useTranslation } from "react-i18next";
import { ApiError } from "@/lib/api";
import { Button } from "@/components/ui/button";

/**
 * **Un record che non si apre deve dirlo.**
 *
 * Senza questo il pannello resta su "Caricamento…" per sempre: succede
 * arrivando da una notifica su un record spostato o eliminato, da un
 * collegamento vecchio, o quando i privilegi di amministratore sono scaduti
 * mentre l'elenco era già in pagina (20/08/2026, sull'area Ticket).
 *
 * Le due frasi le porta chi lo usa, perché parlano del **suo** record: la prima
 * per "non c'è" (404), la seconda per "non è tuo" (403). Il pulsante chiude —
 * un vicolo cieco senza via d'uscita è la seconda metà dello stesso difetto.
 */
export function PanelError({
  error,
  notFound,
  forbidden,
  onClose,
}: {
  error: unknown;
  notFound: string;
  forbidden: string;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const mancante = error instanceof ApiError && error.status === 404;
  return (
    <div className="flex flex-col gap-3 p-6 text-sm">
      <p className="text-muted-foreground">{mancante ? notFound : forbidden}</p>
      <Button variant="outline" size="sm" className="self-start" onClick={onClose}>
        {t("Chiudi")}
      </Button>
    </div>
  );
}
