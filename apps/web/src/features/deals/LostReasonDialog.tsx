// Copyright (c) 2026 Jugaad s.r.l.
// SPDX-License-Identifier: AGPL-3.0-only

import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";

interface LostReasonDialogProps {
  open: boolean;
  dealTitle: string;
  onConfirm: (reason: string | null) => void;
  onCancel: () => void;
}

/** Chiesto quando un'offerta passa in una fase "Persa". */
export function LostReasonDialog({ open, dealTitle, onConfirm, onCancel }: LostReasonDialogProps) {
  const { t } = useTranslation();
  const [reason, setReason] = useState("");

  const submit = (value: string | null) => {
    setReason("");
    onConfirm(value);
  };

  return (
    <Dialog
      open={open}
      onClose={onCancel}
      title={t("Offerta persa — {{title}}", { title: dealTitle })}
    >
      <div className="flex flex-col gap-3">
        <Label htmlFor="lost-reason">{t("Perché è stata persa? (aiuta le analisi future)")}</Label>
        <textarea
          id="lost-reason"
          data-autofocus
          className="min-h-24 rounded-md border bg-background p-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          placeholder={t("Es. prezzo troppo alto, scelto un concorrente, progetto annullato…")}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
        />
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={onCancel}>
            {t("Annulla")}
          </Button>
          <Button variant="outline" onClick={() => submit(null)}>
            {t("Senza motivo")}
          </Button>
          <Button onClick={() => submit(reason.trim() || null)}>{t("Salva")}</Button>
        </div>
      </div>
    </Dialog>
  );
}
