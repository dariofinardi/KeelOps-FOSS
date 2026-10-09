import { useTranslation } from "react-i18next";
import { Label } from "@/components/ui/label";
import { RichTextField } from "./RichTextField";

/**
 * Il campo "Descrizione" dei form di creazione (nuovo task, nuovo task di
 * progetto, e chi verrà dopo).
 *
 * Esiste per non riscrivere ogni volta le stesse quattro decisioni: come si
 * chiama l'etichetta, cosa suggerisce il campo vuoto, che il record non c'è
 * ancora — quindi niente figure incollate finché non lo si salva — e come si
 * chiama la finestra grande quando la si apre. Quattro copie sono quattro
 * occasioni di scrivere "Descrizione:" in un posto e "Note" nell'altro.
 *
 * Nei **pannelli** non si usa: lì il campo è agganciato al salvataggio
 * automatico e passa `RichTextField` direttamente col suo `useAutosaveText`.
 */
export function DescriptionField({
  value,
  onChange,
  dialogTitle,
  placeholder,
  label,
  importance,
  pendingImages = false,
}: {
  value: string;
  onChange: (html: string) => void;
  /** Titolo della finestra grande: dice su cosa si sta scrivendo. */
  dialogTitle: string;
  placeholder?: string;
  /** Alcuni form la chiamano per esteso ("Descrizione del problema"). */
  label?: string;
  /** Il pallino della scala di importanza, dove il campo è obbligatorio. */
  importance?: "required" | "recommended";
  /**
   * Il form crea un **task** (o una richiesta di supporto): le figure incollate
   * possono aspettare il salvataggio. Da accendere solo lì — chi crea altro non
   * lega le figure, e resterebbero in attesa fino a sparire.
   */
  pendingImages?: boolean;
}) {
  const { t } = useTranslation();
  return (
    <div className="flex flex-col gap-1.5">
      <Label importance={importance}>{label ?? t("Descrizione")}</Label>
      <RichTextField
        field={{ value, setValue: onChange }}
        taskId={null}
        pendingImages={pendingImages}
        dialogTitle={dialogTitle}
        placeholder={placeholder ?? t("Cosa c'è da fare?")}
      />
    </div>
  );
}
