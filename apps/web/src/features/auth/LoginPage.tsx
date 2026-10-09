import { useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import { KeelopsLockup } from "@/components/ui/keelops-logo";
import { useMutation } from "@tanstack/react-query";
import { api, ApiError } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { applyLanguage, LANGUAGES, LANGUAGE_NAMES } from "@/lib/i18n";
import { useLogin, useOtpLogin, useProviders } from "./useAuth";
import { SceltaStatistiche } from "@/features/analytics/DemoAnalytics";
import { slot } from "@/edition/slots";

/**
 * Esito del ritorno dal SSO, passato come `?sso=` dal callback del server. The
 * messages come with sign-in with Google, a commercial slot: without it there
 * is no SSO and no outcome to tell.
 */
const ssoMessages = (): Readonly<Record<string, string>> => slot.esitiAccessoGoogle ?? {};

/** Dove il browser tiene la scelta sui cookie: `1` accettati, `0` solo necessari. */
const CONSENT_COOKIE = "kancrm_consenso";

function leggiConsenso(): "1" | "0" | null {
  const trovato = document.cookie.split("; ").find((c) => c.startsWith(`${CONSENT_COOKIE}=`));
  const valore = trovato?.split("=")[1];
  return valore === "1" || valore === "0" ? valore : null;
}

function scriviConsenso(valore: "1" | "0"): void {
  // Un anno: la scelta non si richiede a ogni accesso. `SameSite=Lax` e, dove
  // c'è HTTPS, `Secure`: è la stessa cura del cookie di sessione.
  const sicuro = window.location.protocol === "https:" ? "; Secure" : "";
  document.cookie = `${CONSENT_COOKIE}=${valore}; Max-Age=31536000; Path=/; SameSite=Lax${sicuro}`;
}

function readSsoOutcome(): string | null {
  const value = new URLSearchParams(window.location.search).get("sso");
  if (value && value in ssoMessages()) {
    // Pulisce l'indirizzo: un refresh non deve rimostrare il messaggio.
    window.history.replaceState(null, "", window.location.pathname);
    return value;
  }
  return null;
}

export function LoginPage() {
  const { t, i18n } = useTranslation();
  const login = useLogin();
  const providers = useProviders();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const AccessoGoogle = slot.AccessoGoogle;
  const [ssoOutcome] = useState(readSsoOutcome);
  const [consenso, setConsenso] = useState(leggiConsenso);
  const scegli = (valore: "1" | "0") => {
    scriviConsenso(valore);
    setConsenso(valore);
  };
  const demo = providers.data?.demo ?? null;
  /** password | reset | reset-sent | otp-email | otp-code */
  const [mode, setMode] = useState<"password" | "reset" | "reset-sent" | "otp-email" | "otp-code">(
    "password",
  );
  const [code, setCode] = useState("");
  const otpLogin = useOtpLogin();
  const requestReset = useMutation({
    mutationFn: (address: string) =>
      api("/api/auth/password-reset/request", { method: "POST", body: { email: address } }),
    onSuccess: () => setMode("reset-sent"),
  });
  const requestCode = useMutation({
    mutationFn: (address: string) =>
      api("/api/auth/otp/request", { method: "POST", body: { email: address } }),
    onSuccess: () => setMode("otp-code"),
  });
  const emailSelf = providers.data?.email;

  const switchTo = (next: typeof mode) => {
    setMode(next);
    setError(null);
    setCode("");
  };

  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    setError(null);
    login.mutate(
      { email, password },
      {
        onError: (err) =>
          setError(err instanceof ApiError ? err.message : t("Errore imprevisto, riprova")),
      },
    );
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-muted/40 p-4">
      <div className="w-full max-w-sm rounded-lg border bg-card p-8 shadow-sm">
        <div className="mb-6 flex flex-col items-center gap-2">
          <KeelopsLockup className="h-24 w-auto" />
          <h1 className="sr-only">KeelOps</h1>
          <p className="text-sm text-muted-foreground">{t("Accedi al gestionale interno")}</p>
        </div>
        {ssoOutcome && (
          <p
            className={`mb-4 rounded-md border px-3 py-2 text-sm ${
              ssoOutcome === "pending"
                ? "border-sky-200 bg-sky-50 text-sky-800 dark:border-sky-900 dark:bg-sky-950 dark:text-sky-200"
                : "border-destructive/30 bg-destructive/10 text-destructive"
            }`}
          >
            {t(ssoMessages()[ssoOutcome] ?? "")}
          </p>
        )}
        {mode === "reset" && (
          <form
            className="flex flex-col gap-4"
            onSubmit={(event) => {
              event.preventDefault();
              requestReset.mutate(email);
            }}
          >
            <p className="text-sm text-muted-foreground">
              {t(
                "Scrivi il tuo indirizzo: ti mandiamo un collegamento per scegliere una password nuova.",
              )}
            </p>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="reset-email">{t("Email")}</Label>
              <Input
                id="reset-email"
                type="email"
                autoComplete="email"
                required
                autoFocus
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </div>
            <Button type="submit" disabled={requestReset.isPending}>
              {t("Mandami il collegamento")}
            </Button>
            <button
              type="button"
              className="text-xs text-muted-foreground hover:underline"
              onClick={() => switchTo("password")}
            >
              {t("Torna all'accesso")}
            </button>
          </form>
        )}
        {mode === "reset-sent" && (
          <div className="flex flex-col gap-4 text-center">
            <p className="text-sm">
              {t(
                "Se l'indirizzo è registrato, il collegamento è in viaggio: controlla la posta. Vale trenta minuti.",
              )}
            </p>
            <button
              type="button"
              className="text-xs text-muted-foreground hover:underline"
              onClick={() => switchTo("password")}
            >
              {t("Torna all'accesso")}
            </button>
          </div>
        )}
        {mode === "otp-email" && (
          <form
            className="flex flex-col gap-4"
            onSubmit={(event) => {
              event.preventDefault();
              requestCode.mutate(email);
            }}
          >
            <p className="text-sm text-muted-foreground">
              {t(
                "Scrivi il tuo indirizzo: ti mandiamo un codice di sei cifre che vale dieci minuti.",
              )}
            </p>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="otp-email">{t("Email")}</Label>
              <Input
                id="otp-email"
                type="email"
                autoComplete="email"
                required
                autoFocus
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </div>
            <Button type="submit" disabled={requestCode.isPending}>
              {t("Mandami il codice")}
            </Button>
            <button
              type="button"
              className="text-xs text-muted-foreground hover:underline"
              onClick={() => switchTo("password")}
            >
              {t("Torna all'accesso")}
            </button>
          </form>
        )}
        {mode === "otp-code" && (
          <form
            className="flex flex-col gap-4"
            onSubmit={(event) => {
              event.preventDefault();
              setError(null);
              otpLogin.mutate(
                { email, code },
                {
                  onError: (err) =>
                    setError(
                      err instanceof ApiError ? err.message : t("Errore imprevisto, riprova"),
                    ),
                },
              );
            }}
          >
            <p className="text-sm text-muted-foreground">
              {t("Il codice è in viaggio verso {{email}}: scrivilo qui.", { email })}
            </p>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="otp-code">{t("Codice di accesso")}</Label>
              <Input
                id="otp-code"
                inputMode="numeric"
                pattern="\d{6}"
                maxLength={6}
                required
                autoFocus
                autoComplete="one-time-code"
                className="text-center text-2xl tracking-[0.5em]"
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
              />
            </div>
            {error && <p className="text-sm text-destructive">{error}</p>}
            <Button type="submit" disabled={otpLogin.isPending || code.length !== 6}>
              {otpLogin.isPending ? t("Accesso in corso…") : t("Accedi")}
            </Button>
            <button
              type="button"
              className="text-xs text-muted-foreground hover:underline"
              onClick={() => switchTo("otp-email")}
            >
              {t("Non è arrivato? Rimanda il codice")}
            </button>
          </form>
        )}
        {mode === "password" && (
          <>
            <form onSubmit={onSubmit} className="flex flex-col gap-4">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="email">{t("Email")}</Label>
                <Input
                  id="email"
                  type="email"
                  autoComplete="email"
                  required
                  autoFocus
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="password">{t("Password")}</Label>
                <Input
                  id="password"
                  type="password"
                  autoComplete="current-password"
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />
              </div>
              {emailSelf?.passwordReset && (
                <button
                  type="button"
                  className="self-end text-xs text-muted-foreground underline-offset-2 hover:underline"
                  onClick={() => switchTo("reset")}
                >
                  {t("Password dimenticata?")}
                </button>
              )}
              {error && <p className="text-sm text-destructive">{error}</p>}
              <Button type="submit" disabled={login.isPending}>
                {login.isPending ? t("Accesso in corso…") : t("Accedi")}
              </Button>
            </form>
            {providers.data?.google.sso && AccessoGoogle && <AccessoGoogle />}
            {emailSelf?.otp && (
              <Button
                type="button"
                variant="outline"
                className="mt-3 w-full"
                onClick={() => switchTo("otp-email")}
              >
                {t("Accedi con un codice via email")}
              </Button>
            )}
          </>
        )}
        {/* La dimostrazione: le credenziali stanno **in pagina**, perché la
            demo esiste per far entrare chi passa senza chiedere niente a
            nessuno. Un clic riempie i campi: scrivere a mano un indirizzo
            inventato e una password è già un ostacolo di troppo. */}
        {demo && demo.accounts.length > 0 && mode === "password" && (
          <div className="mt-6 rounded-md border border-dashed p-3">
            <p className="mb-2 text-xs font-medium">{t("Entra con uno di questi profili")}</p>
            <ul className="flex flex-col gap-1">
              {demo.accounts.map((conto) => (
                <li key={conto.email}>
                  <button
                    type="button"
                    // Va a capo invece di uscire dal riquadro: un'email lunga
                    // (le persone anonimizzate della qualità, 22/09/2026) si
                    // spezza, e l'etichetta scende sotto allineata a destra.
                    className="flex w-full flex-wrap items-baseline justify-between gap-x-2 rounded px-2 py-1 text-left text-xs hover:bg-muted"
                    onClick={() => {
                      setEmail(conto.email);
                      setPassword(demo.password);
                      setError(null);
                    }}
                  >
                    <span className="min-w-0 break-all font-mono">{conto.email}</span>
                    <span className="ml-auto text-right text-muted-foreground">{conto.role}</span>
                  </button>
                </li>
              ))}
            </ul>
            <p className="mt-2 px-2 text-xs text-muted-foreground">
              {t("Password per tutti")}: <span className="font-mono">{demo.password}</span>
            </p>
            <p className="mt-2 px-2 text-xs text-muted-foreground">
              {t("Dati inventati, e i file non si caricano: è una vetrina.")}
            </p>
          </div>
        )}

        {/* I cookie: **solo nella dimostrazione**, che è pubblica. In un
            gestionale interno non si chiede niente a nessuno — chi entra ha un
            contratto di lavoro, non un banner — e il comportamento resta
            quello di sempre.
            Dove si chiede, si chiede la sola cosa sensata: il cookie che ti fa
            entrare è necessario e non si può rifiutare, quindi domandarne il
            permesso sarebbe una finta; quello che il permesso lo richiede
            davvero è restare connessi fra una visita e l'altra. */}
        {demo && consenso === null && (
          <div className="mt-6 rounded-md border bg-muted/40 p-3">
            <p className="text-xs text-muted-foreground">
              {t(
                "Per farti entrare usiamo un cookie tecnico, senza il quale l'applicazione non funziona. Vuoi anche restare connesso fra una visita e l'altra?",
              )}
            </p>
            <div className="mt-2 flex gap-2">
              <Button type="button" size="sm" className="flex-1" onClick={() => scegli("1")}>
                {t("Sì, resta connesso")}
              </Button>
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="flex-1"
                onClick={() => scegli("0")}
              >
                {t("Solo il necessario")}
              </Button>
            </div>
          </div>
        )}
        {demo && consenso === "0" && (
          <p className="mt-4 text-center text-xs text-muted-foreground">
            {t("L'accesso durerà quanto questa finestra.")}{" "}
            <button type="button" className="underline" onClick={() => scegli("1")}>
              {t("Resta connesso")}
            </button>
          </p>
        )}
        {demo && <SceltaStatistiche />}

        {/* Scelta della lingua prima ancora di accedere: chi arriva su una
            schermata in una lingua che non conosce deve poterla cambiare subito.
            Dopo l'accesso vale la preferenza salvata sull'utente. */}
        <div className="mt-6 flex items-center justify-center gap-2">
          <Label htmlFor="login-lang" className="text-xs text-muted-foreground">
            {t("Lingua")}
          </Label>
          <select
            id="login-lang"
            className="h-8 rounded-md border bg-background px-2 text-xs"
            value={i18n.language}
            onChange={(e) => applyLanguage(e.target.value, { esplicita: true })}
          >
            {LANGUAGES.map((code) => (
              <option key={code} value={code}>
                {LANGUAGE_NAMES[code]}
              </option>
            ))}
          </select>
        </div>
      </div>
    </div>
  );
}
