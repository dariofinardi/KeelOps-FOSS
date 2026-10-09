import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { useMutation } from "@tanstack/react-query";
import { LogOut } from "lucide-react";
import type { ChangePasswordInput } from "@kancrm/shared";
import { ApiError, api } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

/**
 * Cambio password e disconnessione delle altre sessioni. Vive nel profilo
 * (sezione "Sicurezza"), dove uno si aspetta di trovare le cose del proprio
 * account; il portale clienti, che un profilo non ce l'ha, lo mostra nella
 * finestra `ChangePasswordDialog`.
 *
 * `onDirtyChange` serve a chi lo ospita in una finestra: sapere che ci sono campi
 * compilati per non chiuderla in silenzio.
 */
export function ChangePasswordForm({
  onDirtyChange,
  onChanged,
  showLogoutOthers = true,
  extraActions,
}: {
  onDirtyChange?: (dirty: boolean) => void;
  /**
   * Password cambiata davvero. Serve a chi deve **reagire** al cambio e non
   * solo mostrarlo: la schermata di primo accesso rilegge `/me`, perché è quel
   * dato a decidere se l'applicazione si apre.
   */
  onChanged?: () => void;
  /**
   * Le altre sessioni. Si nasconde dov'è una domanda senza risposta: al primo
   * accesso con password provvisoria le sessioni sono già state chiuse tutte
   * dal reset, e il pulsante porterebbe a una rotta che quel segno non lascia
   * passare.
   */
  showLogoutOthers?: boolean;
  /** Bottoni aggiuntivi accanto a "Cambia password" (es. "Chiudi" nella finestra). */
  extraActions?: ReactNode;
}) {
  const { t } = useTranslation();
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [message, setMessage] = useState<{ tone: "ok" | "error"; text: string } | null>(null);

  const changePassword = useMutation({
    mutationFn: (input: ChangePasswordInput) =>
      api<void>("/api/auth/change-password", { method: "POST", body: input }),
  });
  const logoutOthers = useMutation({
    mutationFn: () => api<void>("/api/auth/logout-others", { method: "POST" }),
  });

  const dirty = currentPassword !== "" || newPassword !== "" || confirmPassword !== "";
  useEffect(() => {
    // Con le graffe: il valore di ritorno non deve finire a React come funzione
    // di pulizia.
    onDirtyChange?.(dirty);
  }, [dirty, onDirtyChange]);

  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    setMessage(null);
    if (newPassword !== confirmPassword) {
      setMessage({ tone: "error", text: t("Le nuove password non coincidono") });
      return;
    }
    changePassword.mutate(
      { currentPassword, newPassword },
      {
        onSuccess: () => {
          setCurrentPassword("");
          setNewPassword("");
          setConfirmPassword("");
          setMessage({
            tone: "ok",
            text: t("Password aggiornata. Le altre sessioni sono state disconnesse."),
          });
          onChanged?.();
        },
        onError: (error) =>
          setMessage({
            tone: "error",
            text: error instanceof ApiError ? error.message : t("Errore imprevisto"),
          }),
      },
    );
  };

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-4">
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="pw-current">{t("Password attuale")}</Label>
        <Input
          id="pw-current"
          type="password"
          autoComplete="current-password"
          required
          value={currentPassword}
          onChange={(e) => setCurrentPassword(e.target.value)}
        />
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="pw-new">{t("Nuova password (min. 8)")}</Label>
          <Input
            id="pw-new"
            type="password"
            autoComplete="new-password"
            required
            minLength={8}
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="pw-confirm">{t("Conferma nuova")}</Label>
          <Input
            id="pw-confirm"
            type="password"
            autoComplete="new-password"
            required
            minLength={8}
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
          />
        </div>
      </div>
      {message && (
        <p
          className={message.tone === "ok" ? "text-sm text-green-600" : "text-sm text-destructive"}
        >
          {message.text}
        </p>
      )}
      <div className="flex flex-wrap items-center justify-between gap-2">
        {showLogoutOthers ? (
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={logoutOthers.isPending}
            onClick={() =>
              logoutOthers.mutate(undefined, {
                onSuccess: () =>
                  setMessage({ tone: "ok", text: t("Le altre sessioni sono state disconnesse.") }),
              })
            }
            title={t("Disconnette il tuo account da tutti gli altri dispositivi/browser")}
          >
            <LogOut className="size-3.5" /> {t("Disconnetti le altre sessioni")}
          </Button>
        ) : (
          <span />
        )}
        <div className="flex gap-2">
          {extraActions}
          <Button type="submit" disabled={changePassword.isPending}>
            {changePassword.isPending ? t("Salvataggio…") : t("Cambia password")}
          </Button>
        </div>
      </div>
    </form>
  );
}
