// Copyright (c) 2026 Jugaad s.r.l.
// SPDX-License-Identifier: AGPL-3.0-only

import { useCallback, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { useSaveOrDiscard } from "@/lib/unsaved-changes";
import { ChangePasswordForm } from "./ChangePasswordForm";

/**
 * Cambio password in finestra, per il **portale clienti**: lì non c'è la pagina
 * del profilo, che per gli utenti interni ospita la stessa cosa nella sezione
 * "Sicurezza".
 */
export function ChangePasswordDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t } = useTranslation();
  const saveOrDiscard = useSaveOrDiscard();
  const [dirty, setDirty] = useState(false);
  const onDirtyChange = useCallback((value: boolean) => setDirty(value), []);

  // Password digitate a metà: chiudendo si sceglie, non si perde in silenzio.
  // Qui non si offre di salvare: il cambio password lo conferma solo il suo
  // bottone, con la password attuale a portata di mano.
  const close = () =>
    saveOrDiscard({
      isDirty: dirty,
      canSave: false,
      what: t("le password digitate"),
      onSave: onClose,
      onDiscard: onClose,
    });

  return (
    <Dialog open={open} onClose={close} title={t("Sicurezza account")}>
      <ChangePasswordForm
        onDirtyChange={onDirtyChange}
        extraActions={
          <Button type="button" variant="outline" onClick={close}>
            {t("Chiudi")}
          </Button>
        }
      />
    </Dialog>
  );
}
