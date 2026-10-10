// Copyright (c) 2026 Jugaad s.r.l.
// SPDX-License-Identifier: AGPL-3.0-only

import { useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import { useMutation } from "@tanstack/react-query";
import { KeelopsLockup } from "@/components/ui/keelops-logo";
import { api, ApiError } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

/**
 * La pagina del collegamento di reset arrivato per email
 * (`/reimposta-password?token=…`). Vive nel ramo SENZA sessione di App: chi ha
 * il link non è dentro, per definizione. A password cambiata si torna
 * all'accesso — le vecchie sessioni sono già state chiuse dal server.
 */
export function ResetPasswordPage() {
  const { t } = useTranslation();
  const token = new URLSearchParams(window.location.search).get("token") ?? "";
  const [password, setPassword] = useState("");
  const [repeat, setRepeat] = useState("");
  const [error, setError] = useState<string | null>(null);
  const confirm = useMutation({
    mutationFn: () =>
      api("/api/auth/password-reset/confirm", { method: "POST", body: { token, password } }),
  });

  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    setError(null);
    if (password !== repeat) {
      setError(t("Le due password non coincidono."));
      return;
    }
    confirm.mutate(undefined, {
      onError: (err) =>
        setError(err instanceof ApiError ? err.message : t("Errore imprevisto, riprova")),
    });
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-muted/40 p-4">
      <div className="w-full max-w-sm rounded-lg border bg-card p-8 shadow-sm">
        <div className="mb-6 flex flex-col items-center gap-2">
          <KeelopsLockup className="h-20 w-auto" />
          <h1 className="sr-only">KeelOps</h1>
          <p className="text-sm text-muted-foreground">{t("Scegli una password nuova")}</p>
        </div>
        {confirm.isSuccess ? (
          <div className="flex flex-col gap-4 text-center">
            <p className="text-sm">
              {t("Fatto: la password è cambiata e le vecchie sessioni sono state chiuse.")}
            </p>
            <Button type="button" onClick={() => window.location.assign("/")}>
              {t("Vai all'accesso")}
            </Button>
          </div>
        ) : !token ? (
          <p className="text-sm text-muted-foreground">
            {t("Questo collegamento è incompleto: apri quello ricevuto per email o richiedine uno nuovo dalla pagina di accesso.")}
          </p>
        ) : (
          <form onSubmit={onSubmit} className="flex flex-col gap-4">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="new-password">{t("Nuova password")}</Label>
              <Input id="new-password" type="password" autoComplete="new-password" required
                minLength={8} autoFocus value={password}
                onChange={(e) => setPassword(e.target.value)} />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="repeat-password">{t("Ripeti la password")}</Label>
              <Input id="repeat-password" type="password" autoComplete="new-password" required
                minLength={8} value={repeat} onChange={(e) => setRepeat(e.target.value)} />
            </div>
            {error && <p className="text-sm text-destructive">{error}</p>}
            <Button type="submit" disabled={confirm.isPending}>
              {t("Imposta la password")}
            </Button>
          </form>
        )}
      </div>
    </div>
  );
}
