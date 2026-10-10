// Copyright (c) 2026 Jugaad s.r.l.
// SPDX-License-Identifier: AGPL-3.0-only

import { useTranslation } from "react-i18next";
import { useQueryClient } from "@tanstack/react-query";
import { KeyRound } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ChangePasswordForm } from "./ChangePasswordForm";
import { useLogout } from "./useAuth";

/**
 * Primo accesso con una password provvisoria: si sceglie la propria, e prima di
 * allora l'applicazione non si apre (15/08/2026).
 *
 * Prende il posto di **tutta** l'interfaccia, come fa la pagina di accesso, e
 * per la stessa ragione: una password consegnata da qualcun altro — per di più
 * viaggiata per email — non è ancora un'identità. Non è un promemoria che si
 * chiude con la ✕ e si rimanda per tre mesi; il server la pensa allo stesso
 * modo e con quel segno addosso lascia passare solo le rotte per cambiarla
 * (`plugins/auth.ts`), quindi qui non c'è niente da mostrare comunque.
 *
 * Il campo "password attuale" resta al suo posto: è **quella ricevuta**, che chi
 * arriva ha ancora sotto gli occhi nell'email, e chiederla evita che una
 * sessione lasciata aperta su una macchina altrui diventi un cambio di
 * credenziali. Chi non ce l'ha più esce e si fa rifare il reset.
 */
export function ForcePasswordChange({ name }: { name: string }) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const logout = useLogout();

  return (
    <div className="flex min-h-screen items-center justify-center bg-muted/40 p-4">
      <div className="w-full max-w-lg rounded-lg border bg-card p-8 shadow-sm">
        <div className="mb-6 flex flex-col items-center gap-2 text-center">
          <KeyRound className="size-8" />
          <h1 className="text-xl font-semibold">{t("Scegli la tua password")}</h1>
          <p className="text-sm text-muted-foreground">
            {t(
              "Ciao {{name}}, la password che stai usando è provvisoria: te l'ha assegnata un amministratore. Scegline una tua per continuare.",
              { name },
            )}
          </p>
        </div>
        <ChangePasswordForm
          onChanged={() => void queryClient.invalidateQueries({ queryKey: ["me"] })}
          showLogoutOthers={false}
          extraActions={
            <Button
              type="button"
              variant="outline"
              disabled={logout.isPending}
              onClick={() => logout.mutate()}
            >
              {t("Esci")}
            </Button>
          }
        />
      </div>
    </div>
  );
}
