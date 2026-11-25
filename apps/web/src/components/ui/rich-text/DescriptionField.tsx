// Copyright (c) 2026 Jugaad s.r.l.
// SPDX-License-Identifier: AGPL-3.0-only

import type { CSSProperties } from "react";
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
  altezzaFissa,
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
  /**
   * **Altezza fissa, misurata sulla finestra** (18/11/2026): un testo lungo
   * scorre dentro il campo, e la finestra del form no — quel che sta sopra e
   * sotto resta a vista. Il campo prende i 90dvh del Dialog meno quello che gli
   * sta attorno, che dipende dal form: lo dichiara chi lo usa, **in rem e
   * misurato**, sullo schermo largo e sul telefono (dove i campi vanno in
   * colonna). Resta fra 7rem e 32rem (16rem sul telefono), perché sia un campo
   * e non una pagina. Senza, il campo cresce col testo come prima. Le misure
   * si ripetono con e2e/description-field-scroll.spec.ts se un form cambia.
   */
  altezzaFissa?: { attorno: number; attornoTelefono: number };
}) {
  const { t } = useTranslation();
  const misure = altezzaFissa
    ? ({
        "--attorno": `${altezzaFissa.attorno}rem`,
        "--attorno-telefono": `${altezzaFissa.attornoTelefono}rem`,
      } as CSSProperties)
    : undefined;
  return (
    <div className="flex flex-col gap-1.5" style={misure}>
      <Label importance={importance}>{label ?? t("Descrizione")}</Label>
      <RichTextField
        field={{ value, setValue: onChange }}
        taskId={null}
        pendingImages={pendingImages}
        dialogTitle={dialogTitle}
        placeholder={placeholder ?? t("Cosa c'è da fare?")}
        editorClassName={
          altezzaFissa
            ? "h-[clamp(7rem,calc(90dvh_-_var(--attorno)),32rem)] overflow-y-auto max-sm:h-[clamp(7rem,calc(90dvh_-_var(--attorno-telefono)),16rem)]"
            : undefined
        }
      />
    </div>
  );
}
