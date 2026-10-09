import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CalendarPlus, Mail, Send } from "lucide-react";
import type { MailConfig, UpdateMailSettingsInput } from "@kancrm/shared";
import { ApiError, api } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SkeletonRows } from "@/components/ui/skeleton";
import { useToast } from "@/components/ui/toast";
import { useAutosaveText } from "@/lib/useAutosaveText";

function useMailConfig() {
  return useQuery({ queryKey: ["mail-config"], queryFn: () => api<MailConfig>("/api/admin/mail") });
}

/**
 * Configurazione delle email di notifica.
 *
 * Tre cose in una pagina: **cosa dicono** (indirizzo pubblico, testi), **come si
 * vedono** (anteprima del template vero, non un disegno) e **se funzionano**
 * (invio di prova a sé stessi). L'ultima è quella che conta: una configurazione
 * di posta si può solo provare — host, credenziali e mittente verificato dal
 * provider si scoprono sbagliati soltanto spedendo.
 */
export function MailPage() {
  const { t } = useTranslation();
  const { data, isLoading } = useMailConfig();
  const queryClient = useQueryClient();
  const toast = useToast();

  const save = useMutation({
    mutationFn: (patch: UpdateMailSettingsInput) =>
      api("/api/admin/mail", { method: "PUT", body: patch }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["mail-config"] }),
    onError: (error) =>
      toast(error instanceof ApiError ? error.message : t("Salvataggio non riuscito"), "error"),
  });
  const sendTest = useMutation({
    mutationFn: () => api<{ sentTo: string }>("/api/admin/mail/test", { method: "POST" }),
    onSuccess: (result) =>
      toast(t("Email di prova inviata a {{email}}", { email: result.sentTo }), "success"),
    onError: (error) =>
      toast(error instanceof ApiError ? error.message : t("Invio non riuscito"), "error"),
  });

  if (isLoading || !data) return <SkeletonRows rows={5} />;
  return (
    <MailForm
      config={data}
      onSave={save.mutate}
      onTest={sendTest.mutate}
      testing={sendTest.isPending}
    />
  );
}

/**
 * L'interruttore dei calendari sottoscrivibili.
 *
 * È l'unico punto dell'applicazione che si legge **senza sessione**: il token
 * nell'indirizzo è tutta l'autenticazione che un client di calendario sa
 * portare, e quell'indirizzo finisce sui server di Google e nelle
 * configurazioni dei telefoni. Perciò lo si accende di proposito, e
 * spegnendolo i link smettono di rispondere — non solo di crearsi.
 */
function CalendarSwitch({ enabled }: { enabled: boolean }) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const toast = useToast();
  const [on, setOn] = useState(enabled);
  const save = useMutation({
    mutationFn: (feedsEnabled: boolean) =>
      api("/api/admin/calendar", { method: "PUT", body: { feedsEnabled } }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["mail-config"] }),
    onError: (error) => {
      setOn(enabled);
      toast(error instanceof ApiError ? error.message : t("Salvataggio non riuscito"), "error");
    },
  });

  return (
    <section className="rounded-lg border p-4">
      <h3 className="flex items-center gap-2 font-semibold">
        <CalendarPlus className="size-4" /> {t("Calendari sottoscrivibili")}
      </h3>
      <label className="mt-2 flex items-start gap-2 text-sm">
        <input
          type="checkbox"
          className="mt-1"
          checked={on}
          onChange={(event) => {
            setOn(event.target.checked);
            save.mutate(event.target.checked);
          }}
        />
        <span>
          {t(
            "Permetti a ciascuno di generare, dal proprio Profilo, i link iCal delle bacheche da aprire in Google Calendar, Outlook/M365 o sul telefono.",
          )}
        </span>
      </label>
      <p className="mt-2 text-xs text-muted-foreground">
        {on
          ? t(
              "Ogni link vale come una password: chi lo conosce legge quella bacheca finché non viene revocato, e Google e Outlook lo conservano sui loro server. Spegnendo questo interruttore tutti i link smettono di rispondere, anche quelli già distribuiti.",
            )
          : t(
              "Spento: nessuno può generare nuovi link, e quelli eventualmente già distribuiti non rispondono. È l'unico punto dell'applicazione che si legge senza sessione — acceso di proposito, non per inerzia.",
            )}
      </p>
    </section>
  );
}

function MailForm({
  config,
  onSave,
  onTest,
  testing,
}: {
  config: MailConfig;
  onSave: (patch: UpdateMailSettingsInput) => void;
  onTest: () => void;
  testing: boolean;
}) {
  const { t } = useTranslation();
  const { settings, status } = config;
  const [showLogo, setShowLogo] = useState(settings.showLogo);

  // Stessi campi autosalvanti del resto dell'applicazione: si scrive e basta.
  const baseUrl = useAutosaveText({
    value: settings.baseUrl,
    singleLine: true,
    onSave: (value) => onSave({ baseUrl: value }),
  });
  const intro = useAutosaveText({
    value: settings.intro,
    onSave: (value) => onSave({ intro: value }),
  });
  const footer = useAutosaveText({
    value: settings.footer,
    singleLine: true,
    onSave: (value) => onSave({ footer: value }),
  });

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center gap-3">
        <h2 className="flex items-center gap-2 text-lg font-semibold">
          <Mail className="size-5" /> {t("Email e calendari")}
        </h2>
        <span
          className={
            status.enabled
              ? "rounded-full bg-emerald-500/15 px-2 py-0.5 text-xs font-medium text-emerald-700 dark:text-emerald-400"
              : "rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground"
          }
        >
          {status.enabled ? t("Attiva · {{host}}", { host: status.host }) : t("Non configurata")}
        </span>
        <Button className="ml-auto" disabled={!status.enabled || testing} onClick={() => onTest()}>
          <Send className="size-4" /> {testing ? t("Invio…") : t("Invia email di prova")}
        </Button>
      </div>

      {!status.enabled && (
        <p className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
          {t("Le notifiche restano solo nella campanella: manca")} <code>MAILER_HOST</code>{" "}
          {t(
            "nel file di ambiente del server. Le credenziali del provider stanno lì e non passano da questa pagina.",
          )}
        </p>
      )}

      <CalendarSwitch enabled={config.calendar.feedsEnabled} />

      <div className="grid gap-6 lg:grid-cols-2">
        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <Label importance="required" htmlFor="mail-base-url">
              {t("Indirizzo pubblico dell'applicazione")}
            </Label>
            <Input id="mail-base-url" placeholder="https://crm.example.com" {...baseUrl.props} />
            <p className="text-xs text-muted-foreground">
              {t(
                "Rende cliccabili le email: è con questo che si costruiscono i collegamenti al task, all'offerta o al ticket. Se manca, il messaggio arriva senza pulsante — meglio nessun link che uno che porta al server.",
              )}
            </p>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="mail-intro">{t("Riga di apertura")}</Label>
            <textarea
              id="mail-intro"
              className="min-h-16 rounded-md border bg-background p-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              placeholder={t("Facoltativa: compare sopra il testo della notifica.")}
              {...intro.props}
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="mail-footer">{t("Chiusura")}</Label>
            <Input
              id="mail-footer"
              placeholder={t("Es. Team KeelOps · uso interno")}
              {...footer.props}
            />
          </div>

          <label className="flex items-center gap-2 text-sm text-muted-foreground">
            <input
              type="checkbox"
              checked={showLogo}
              onChange={(event) => {
                setShowLogo(event.target.checked);
                onSave({ showLogo: event.target.checked });
              }}
            />
            {t("Mostra il logo aziendale (quello della pagina Aspetto)")}
          </label>
          {showLogo && (
            <p className="text-xs text-muted-foreground">
              {t(
                "Il logo viaggia dentro il messaggio — si vede anche fuori ufficio, senza che il destinatario apra il nostro server — e ci viaggia come PNG della misura giusta, qualunque formato tu abbia caricato: nella posta il PNG lo leggono tutti, il WEBP con trasparenza in certi programmi diventa un rettangolo nero.",
              )}
            </p>
          )}
          <p className="text-xs text-muted-foreground">
            {t("Il mittente è")} <span className="font-medium">{status.from}</span>{" "}
            {t(
              "e si cambia dal file di ambiente. Dev'essere un indirizzo verificato presso il provider, altrimenti le email vengono rifiutate. La porta decide come si apre la connessione — 465 cifrata da subito, 587 in chiaro con passaggio a TLS — e ci pensa il server: non c'è niente da regolare qui.",
            )}
          </p>
        </div>

        <div className="flex flex-col gap-1.5">
          <Label>{t("Anteprima")}</Label>
          {/* Il template vero, reso dal server con queste impostazioni: quello
              che si vede qui è quello che arriva nella casella. */}
          <iframe
            title={t("Anteprima dell'email")}
            className="h-[520px] w-full rounded-md border bg-white"
            sandbox=""
            srcDoc={config.previewHtml}
          />
        </div>
      </div>
    </div>
  );
}
