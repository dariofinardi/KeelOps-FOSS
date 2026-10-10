// Copyright (c) 2026 Jugaad s.r.l.
// SPDX-License-Identifier: AGPL-3.0-only

import { useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import { Lock, LockOpen, MailCheck } from "lucide-react";
import type { UnlockSecretCommentInput } from "@kancrm/shared";
import { ApiError, api } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { edizione } from "@/edition/rotte";

/**
 * Il corpo di un messaggio riservato (@secret). Arriva vuoto dal server: qui
 * si mostra il lucchetto e, al click, la verifica — la propria password oppure
 * un codice usa-e-getta via email (chi entra con Google una password non ce
 * l'ha: la casella è la sua identità). Il testo sbloccato vive SOLO nello
 * stato del componente: chiuso il pannello, torna il lucchetto.
 */
export function SecretMessage({ taskId, commentId }: { taskId: string; commentId: string }) {
  const { t } = useTranslation();
  const [revealed, setRevealed] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [codeSent, setCodeSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const unlock = async (input: UnlockSecretCommentInput) => {
    setBusy(true);
    setError(null);
    try {
      const result = await api<{ body?: string; sent?: boolean }>(
        `/api/tasks/${taskId}/comments/${commentId}/unlock`,
        { method: "POST", body: input },
      );
      if (input.method === "otp-request") {
        setCodeSent(true);
      } else if (typeof result.body === "string") {
        setRevealed(result.body);
        setOpen(false);
        setPassword("");
        setCode("");
        setCodeSent(false);
      }
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t("Verifica non riuscita"));
    } finally {
      setBusy(false);
    }
  };

  if (revealed !== null) {
    return (
      <div>
        <p className="mb-1 inline-flex items-center gap-1 rounded-full border border-primary/40 bg-muted px-2 py-0.5 text-xs text-muted-foreground">
          <LockOpen className="size-3 text-primary" /> {t("Messaggio riservato")}
        </p>
        <p className="whitespace-pre-wrap">{revealed}</p>
      </div>
    );
  }

  const submitPassword = (event: FormEvent) => {
    event.preventDefault();
    if (password) void unlock({ method: "password", password });
  };
  const submitCode = (event: FormEvent) => {
    event.preventDefault();
    if (/^\d{6}$/.test(code)) void unlock({ method: "otp", code });
  };

  return (
    <div className="flex items-center gap-2 rounded-md border border-primary/40 bg-muted/60 px-3 py-2 text-muted-foreground">
      <Lock className="size-4 shrink-0 text-primary" />
      <span className="text-sm">{t("Messaggio riservato")}</span>
      <Button variant="outline" size="sm" className="ml-auto" onClick={() => setOpen(true)}>
        {t("Sblocca")}
      </Button>
      <Dialog open={open} onClose={() => setOpen(false)} title={t("Sbloccare il messaggio?")}>
        <p className="text-sm text-muted-foreground">
          {t(
            "Il contenuto è cifrato: confermi la tua identità e lo leggi qui, senza che resti in giro.",
          )}
        </p>
        <form onSubmit={submitPassword} className="mt-3 flex items-end gap-2">
          <label className="flex-1 text-sm">
            {t("La tua password")}
            <input
              type="password"
              autoComplete="current-password"
              className="mt-1 w-full rounded-md border bg-background px-3 py-1.5 text-sm"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
            />
          </label>
          <Button type="submit" size="sm" disabled={busy || password === ""}>
            {t("Sblocca")}
          </Button>
        </form>
        <div className="mt-4 border-t pt-3">
          {codeSent ? (
            <form onSubmit={submitCode} className="flex items-end gap-2">
              <label className="flex-1 text-sm">
                <span className="inline-flex items-center gap-1">
                  <MailCheck className="size-3.5" /> {t("Codice inviato: controlla l'email")}
                </span>
                <input
                  inputMode="numeric"
                  pattern="\d{6}"
                  maxLength={6}
                  className="mt-1 w-full rounded-md border bg-background px-3 py-1.5 font-mono text-sm tracking-widest"
                  value={code}
                  onChange={(event) => setCode(event.target.value.replace(/\D/g, ""))}
                />
              </label>
              <Button type="submit" size="sm" disabled={busy || code.length !== 6}>
                {t("Verifica")}
              </Button>
            </form>
          ) : (
            <div className="flex items-center justify-between gap-2 text-sm text-muted-foreground">
              <span>
                {/* Signing in with Google is the commercial `google` module. */}
                {edizione.moduli.has("google")
                  ? t("Entri con Google o niente password?")
                  : t("Niente password?")}
              </span>
              <Button
                variant="outline"
                size="sm"
                disabled={busy}
                onClick={() => void unlock({ method: "otp-request" })}
              >
                {t("Mandami un codice via email")}
              </Button>
            </div>
          )}
        </div>
        {error && <p className="mt-3 text-sm text-destructive">{error}</p>}
      </Dialog>
    </div>
  );
}
