import { useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  BellRing,
  CalendarArrowDown,
  CalendarPlus,
  Copy,
  Download,
  FileSpreadsheet,
  KeyRound,
  Plus,
  Upload,
  UserRound,
} from "lucide-react";
import {
  AppTheme,
  Currency,
  IMPORT_TYPE_LABELS,
  ImportType,
  Locale,
  type CurrentUser,
  type ImportReport,
  type UpdateProfileInput,
  type UserRef,
} from "@kancrm/shared";
import { api, ApiError, apiUpload } from "@/lib/api";
import { downscaleImage } from "@/lib/image";
import { disablePush, enablePush, getPushSubscription, pushSupported } from "@/lib/push";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SectionIcon } from "@/components/ui/section-icon";
import { PluginMenu } from "@/features/plugins/PluginMenu";
import { useToast } from "@/components/ui/toast";
import { ChangePasswordForm } from "@/features/auth/ChangePasswordForm";
import { AdminElevationCard } from "@/features/auth/AdminElevation";
import { useCurrentUser } from "@/features/auth/useAuth";
import { useProjects } from "@/features/projects/useProjects";
import { formatDate } from "@/features/tasks/task-utils";
import { applyLanguage, dimenticaLinguaScelta, LANGUAGE_NAMES } from "@/lib/i18n";

const CURRENCY_LABELS: Record<Currency, string> = {
  EUR: "Euro (€)",
  USD: "Dollaro USA ($)",
  GBP: "Sterlina (£)",
  CHF: "Franco svizzero (CHF)",
};

const THEME_LABELS: Record<AppTheme, string> = {
  auto: "Automatico (segue il sistema)",
  light: "Chiaro minimal",
  dark: "Notte",
  company: "Aziendale",
};

export function ProfilePage() {
  const user = useCurrentUser();
  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-6">
      <PreferencesCard user={user} />
      <SecurityCard />
      <AdminElevationCard />
      <CalendarFeedCard />
      <PushCard />
      <ImportsCard user={user} />
    </div>
  );
}

/**
 * Sicurezza dell'account: password e sessioni. Sta nel profilo, dove uno cerca le
 * cose del proprio account — prima era dietro un'icona a chiave nella barra in
 * alto, che nessuno associava al cambio password.
 */
function SecurityCard() {
  const { t } = useTranslation();
  return (
    <section className="rounded-lg border bg-card p-5">
      <h2 className="flex items-center gap-2 font-semibold">
        <SectionIcon tone="amber">
          <KeyRound className="size-4" />
        </SectionIcon>
        {t("Sicurezza")}
      </h2>
      <p className="mb-4 mt-1 text-sm text-muted-foreground">
        {t(
          "Cambia la password del tuo account. Cambiandola, le sessioni aperte altrove vengono disconnesse: puoi farlo anche da solo, se hai lasciato l'accesso aperto su un altro computer.",
        )}
      </p>
      <ChangePasswordForm />
    </section>
  );
}

interface CalendarFeedDto {
  id: string;
  scope: string;
  targetId: string | null;
  label: string;
  lastReadAt: string | null;
  /** Assoluto, costruito dall'indirizzo pubblico della pagina Email. */
  url: string | null;
}

/**
 * I calendari da sottoscrivere: uno per bacheca.
 *
 * Sono **in sola lettura**, e non per prudenza: un calendario sottoscritto per
 * indirizzo è una sorgente, e nessun client può rimandare indietro una
 * modifica. L'unica cosa che torna è il "fatto", e passa da un link dentro
 * l'evento — che chiede conferma prima di chiudere.
 *
 * Uno per bacheca e non uno per persona perché un tecnico non deve ritrovarsi
 * in agenda le scadenze fiscali, e perché revocare dev'essere un gesto
 * chirurgico: si toglie il calendario di un progetto senza spegnere il proprio.
 */
function CalendarFeedCard() {
  const { t } = useTranslation();
  const toast = useToast();
  const queryClient = useQueryClient();
  const { data } = useQuery({
    queryKey: ["calendar-feeds"],
    queryFn: () =>
      api<{ enabled: boolean; requestPending: boolean; feeds: CalendarFeedDto[] }>(
        "/api/calendar/feeds",
      ),
  });
  const feeds = data?.feeds;
  const refresh = () => queryClient.invalidateQueries({ queryKey: ["calendar-feeds"] });
  const askAccess = useMutation({
    mutationFn: () => api<{ notified: number }>("/api/calendar/feeds/request", { method: "POST" }),
    onSuccess: (result) => {
      void refresh();
      toast(
        result.notified > 0
          ? t("Richiesta inviata a {{count}} amministratori: hanno due giorni per rispondere.", {
              count: result.notified,
            })
          : t("La richiesta era già stata inviata."),
        "success",
      );
    },
    onError: (error) =>
      toast(error instanceof ApiError ? error.message : t("Richiesta non inviata"), "error"),
  });
  const { data: projects } = useProjects();

  const create = useMutation({
    mutationFn: (body: { scope: string; targetId?: string | null }) =>
      api<CalendarFeedDto>("/api/calendar/feeds", { method: "POST", body }),
    onSuccess: () => {
      void refresh();
      toast(t("Calendario pronto: copia il link e incollalo nel tuo programma."), "success");
    },
    onError: (error) =>
      toast(error instanceof ApiError ? error.message : t("Non riuscito"), "error"),
  });
  const revoke = useMutation({
    mutationFn: (id: string) => api<void>(`/api/calendar/feeds/${id}`, { method: "DELETE" }),
    onSuccess: () => {
      void refresh();
      toast(t("Calendario revocato: quel link non funziona più."));
    },
  });

  const existing = new Set((feeds ?? []).map((feed) => `${feed.scope}:${feed.targetId ?? ""}`));
  const manca = (scope: string, targetId?: string | null) =>
    !existing.has(`${scope}:${targetId ?? ""}`);

  return (
    <section className="rounded-lg border bg-card p-5">
      <h2 className="mb-1 flex items-center gap-2 font-semibold">
        <SectionIcon tone="sky">
          <CalendarPlus className="size-4" />
        </SectionIcon>
        {t("Calendari da sottoscrivere")}
      </h2>
      <p className="mb-3 text-sm text-muted-foreground">
        {t(
          "Le tue scadenze dentro Google Calendar, Outlook/M365 o il telefono, una bacheca alla volta. In Google:",
        )}{" "}
        <em>{t("Altri calendari → + → Da URL")}</em>
        {t("; in Outlook:")} <em>{t("Aggiungi calendario → Iscriviti dal Web")}</em>
        {t(". Sono in")} <strong>{t("sola lettura")}</strong>{" "}
        {t(
          "— il calendario non può rimandare indietro modifiche — ma dentro ogni evento trovi il link per aprire il record e quello per segnarlo come fatto. Google e Outlook rileggono ogni alcune ore, l'iPhone si può impostare a pochi minuti.",
        )}
      </p>

      {data && !data.enabled && (
        <div className="mb-3 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
          <p>
            {t(
              "La funzione non è disponibile: i calendari sottoscrivibili li accende un amministratore. Finché restano spenti, anche i link già distribuiti non rispondono.",
            )}
          </p>
          {/* Davanti a una porta chiusa la cosa peggiore è un cartello che non
              dice a chi bussare: il bottone apre un task a ogni amministratore,
              con scadenza a due giorni, e lascia chi ha chiesto come referente. */}
          {data.requestPending ? (
            <p className="mt-2 text-xs">
              {t(
                "Richiesta già inviata agli amministratori: la trovi tra i task che supervisioni.",
              )}
            </p>
          ) : (
            <Button
              className="mt-2"
              size="sm"
              variant="outline"
              disabled={askAccess.isPending}
              onClick={() => askAccess.mutate()}
            >
              {t("Chiedi agli amministratori di poter accedere ai tuoi calendari dall'esterno")}
            </Button>
          )}
        </div>
      )}

      {feeds && feeds.length > 0 && (
        <ul className="mb-4 flex flex-col gap-2">
          {feeds.map((feed) => (
            <li key={feed.id} className="rounded-md border p-3">
              <div className="mb-2 flex items-center gap-2">
                <span className="min-w-0 flex-1 truncate text-sm font-medium">{feed.label}</span>
                <span className="shrink-0 text-xs text-muted-foreground">
                  {feed.lastReadAt
                    ? t("letto {{date}}", { date: formatDate(feed.lastReadAt.slice(0, 10)) })
                    : t("mai letto")}
                </span>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={revoke.isPending}
                  onClick={() => revoke.mutate(feed.id)}
                >
                  {t("Revoca")}
                </Button>
              </div>
              {feed.url ? (
                <div className="flex gap-2">
                  <Input readOnly value={feed.url} className="font-mono text-xs" />
                  <Button
                    variant="outline"
                    size="icon"
                    title={t("Copia l'indirizzo")}
                    onClick={() => {
                      void navigator.clipboard.writeText(feed.url!);
                      toast(t("Indirizzo copiato."), "success");
                    }}
                  >
                    <Copy className="size-4" />
                  </Button>
                </div>
              ) : (
                <p className="text-xs text-amber-700 dark:text-amber-400">
                  {t(
                    "Manca l'indirizzo pubblico dell'applicazione: un amministratore lo imposta nella pagina Email. Senza, non c'è un indirizzo assoluto da dare a Google.",
                  )}
                </p>
              )}
            </li>
          ))}
        </ul>
      )}

      {/* Spenti: non si mostra cosa non si può fare. */}
      {data?.enabled && (
        <div className="flex flex-wrap items-center gap-2">
          {manca("MINE") && (
            <Button variant="outline" size="sm" onClick={() => create.mutate({ scope: "MINE" })}>
              <Plus className="size-4" /> {t("Le mie scadenze")}
            </Button>
          )}
          {manca("SUPERVISED") && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => create.mutate({ scope: "SUPERVISED" })}
            >
              <Plus className="size-4" /> {t("Task che supervisiono")}
            </Button>
          )}
          <select
            className="h-9 rounded-md border bg-background px-2 text-sm"
            value=""
            onChange={(event) =>
              event.target.value &&
              create.mutate({ scope: "PROJECT", targetId: event.target.value })
            }
          >
            <option value="">{t("Aggiungi un progetto…")}</option>
            {(projects ?? [])
              .filter((project) => manca("PROJECT", project.id))
              .map((project) => (
                <option key={project.id} value={project.id}>
                  {project.name}
                </option>
              ))}
          </select>
        </div>
      )}
      <p className="mt-3 text-xs text-muted-foreground">
        ⚠{" "}
        {t(
          "Chi conosce uno di questi indirizzi legge quella bacheca: trattalo come una password, e revocalo se finisce dove non doveva. Google e Outlook conservano l'indirizzo sui loro server finché il calendario resta iscritto.",
        )}
      </p>
    </section>
  );
}

function PushCard() {
  const { t } = useTranslation();
  const toast = useToast();
  const [supported] = useState(pushSupported);
  const [active, setActive] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!supported) {
      setActive(false);
      return;
    }
    void getPushSubscription().then((subscription) => setActive(subscription !== null));
  }, [supported]);

  const toggle = async () => {
    setBusy(true);
    try {
      if (active) {
        await disablePush();
        setActive(false);
        toast(t("Notifiche push disattivate su questo dispositivo."));
      } else {
        await enablePush();
        setActive(true);
        toast(t("Notifiche push attivate su questo dispositivo."), "success");
      }
    } catch (error) {
      toast(error instanceof Error ? error.message : t("Errore nelle notifiche push"), "error");
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="rounded-lg border bg-card p-5">
      <h2 className="mb-1 flex items-center gap-2 font-semibold">
        <SectionIcon tone="violet">
          <BellRing className="size-4" />
        </SectionIcon>
        {t("Notifiche push")}
      </h2>
      <p className="mb-3 text-sm text-muted-foreground">
        {t(
          "Ricevi le notifiche di KeelOps (assegnazioni, ticket, scadenze…) come notifiche del browser, anche ad app chiusa. Vale per questo dispositivo; i tipi di evento si scelgono dalle preferenze della campanella. Su iPhone serve installare l'app come PWA.",
        )}
      </p>
      {!supported ? (
        <p className="text-sm text-muted-foreground">
          {t("Questo browser non supporta le notifiche push.")}
        </p>
      ) : (
        <Button disabled={busy || active === null} onClick={() => void toggle()}>
          {busy
            ? t("Attendere…")
            : active
              ? t("Disattiva su questo dispositivo")
              : t("Attiva su questo dispositivo")}
        </Button>
      )}
    </section>
  );
}

function PreferencesCard({ user }: { user: CurrentUser }) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const toast = useToast();
  const [nickName, setNickName] = useState(user.nickName ?? "");
  const [accentColor, setAccentColor] = useState(user.accentColor ?? "#6366f1");
  const [currency, setCurrency] = useState<Currency>(user.currency as Currency);
  const [locale, setLocale] = useState<Locale>(user.locale as Locale);
  const [theme, setTheme] = useState<AppTheme>(user.theme as AppTheme);

  const save = useMutation({
    mutationFn: (input: UpdateProfileInput) =>
      api<CurrentUser>("/api/profile", { method: "PUT", body: input }),
    onSuccess: (updated) => {
      queryClient.setQueryData(["me"], updated);
      toast(t("Preferenze salvate."), "success");
    },
    onError: (error) =>
      toast(error instanceof ApiError ? error.message : t("Errore nel salvataggio"), "error"),
  });

  const fileRef = useRef<HTMLInputElement>(null);
  const applyUser = (updated: CurrentUser) => queryClient.setQueryData(["me"], updated);
  const uploadAvatar = useMutation({
    mutationFn: async (file: File) => {
      return apiUpload<CurrentUser>("/api/profile/avatar", file);
    },
    onSuccess: (updated) => {
      applyUser(updated);
      toast(t("Avatar aggiornato."), "success");
    },
    onError: (error) => toast(error instanceof Error ? error.message : t("Errore"), "error"),
  });
  const deleteAvatar = useMutation({
    mutationFn: () => api<CurrentUser>("/api/profile/avatar", { method: "DELETE" }),
    onSuccess: (updated) => {
      applyUser(updated);
      toast(t("Avatar rimosso."), "success");
    },
    onError: (error) => toast(error instanceof ApiError ? error.message : t("Errore"), "error"),
  });
  const initials = user.name
    .split(/\s+/)
    .map((part) => part[0] ?? "")
    .join("")
    .slice(0, 2)
    .toUpperCase();

  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    save.mutate({
      nickName: nickName.trim() || null,
      accentColor,
      currency,
      locale,
      theme,
    });
  };

  return (
    <section className="rounded-lg border bg-card p-5">
      <h2 className="mb-1 flex items-center gap-2 font-semibold">
        <SectionIcon tone="violet">
          <UserRound className="size-4" />
        </SectionIcon>
        {t("Preferenze personali")}
        {/* i plugin montati (Assistenti AI, Mappa…), allineati a destra del riquadro */}
        <span className="ml-auto">
          <PluginMenu anchor="profile" />
        </span>
      </h2>
      <p className="mb-4 text-sm text-muted-foreground">
        {t("Valgono solo per il tuo account. Nome e email li gestisce l'amministratore.")}
      </p>
      <form onSubmit={onSubmit} className="flex flex-col gap-4">
        {/* Avatar: immagine caricabile (salvataggio immediato), con colore di ripiego. */}
        <div className="flex items-center gap-4">
          {user.avatarUrl ? (
            <img
              src={user.avatarUrl}
              alt={t("Avatar")}
              className="size-14 rounded-full border object-cover"
            />
          ) : (
            <span
              className="flex size-14 items-center justify-center rounded-full text-lg font-medium text-white"
              style={{ backgroundColor: accentColor }}
            >
              {initials}
            </span>
          )}
          <div className="flex flex-col gap-2">
            <div className="flex flex-wrap items-center gap-2">
              <input
                ref={fileRef}
                type="file"
                accept="image/png,image/jpeg,image/webp,image/gif"
                className="hidden"
                onChange={async (e) => {
                  const file = e.target.files?.[0];
                  e.target.value = "";
                  if (file) uploadAvatar.mutate(await downscaleImage(file, 512));
                }}
              />
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={uploadAvatar.isPending}
                onClick={() => fileRef.current?.click()}
              >
                <Upload className="size-4" />{" "}
                {user.avatarUrl ? t("Cambia immagine") : t("Carica immagine")}
              </Button>
              {user.avatarUrl && (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  disabled={deleteAvatar.isPending}
                  onClick={() => deleteAvatar.mutate()}
                >
                  {t("Rimuovi")}
                </Button>
              )}
            </div>
            <label className="flex items-center gap-2 text-xs text-muted-foreground">
              {t("Colore senza immagine")}
              <input
                type="color"
                className="h-7 w-10 cursor-pointer rounded border bg-background"
                value={accentColor}
                onChange={(e) => setAccentColor(e.target.value)}
              />
            </label>
          </div>
        </div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="pf-nick">{t("Nickname (usato nei saluti)")}</Label>
            <Input
              id="pf-nick"
              placeholder={user.name.split(" ")[0]}
              value={nickName}
              onChange={(e) => setNickName(e.target.value)}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="pf-currency">{t("Valuta")}</Label>
            <select
              id="pf-currency"
              className="h-9 rounded-md border bg-background px-2 text-sm"
              value={currency}
              onChange={(e) => setCurrency(e.target.value as Currency)}
            >
              {Object.values(Currency).map((code) => (
                <option key={code} value={code}>
                  {t(CURRENCY_LABELS[code])}
                </option>
              ))}
            </select>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="pf-locale">{t("Lingua")}</Label>
            <select
              id="pf-locale"
              className="h-9 rounded-md border bg-background px-2 text-sm"
              value={locale}
              onChange={(e) => {
                const next = e.target.value as Locale;
                setLocale(next);
                // Anteprima immediata: si applica subito, e il salvataggio la
                // rende permanente sull'utente. Senza salvare, al ricarico torna
                // la lingua salvata.
                //
                // E si dimentica l'eventuale scelta fatta sulla schermata di
                // accesso: da qui in poi comanda la preferenza, che è quella
                // che si sta scrivendo.
                dimenticaLinguaScelta();
                applyLanguage(next);
              }}
            >
              {Object.values(Locale).map((code) => (
                <option key={code} value={code}>
                  {code === Locale.AUTO
                    ? t("Automatica (browser)")
                    : LANGUAGE_NAMES[code as keyof typeof LANGUAGE_NAMES]}
                </option>
              ))}
            </select>
            <p className="text-xs text-muted-foreground">
              {t("La traduzione è in corso: le parti non ancora tradotte restano in italiano.")}
            </p>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="pf-theme">{t("Tema")}</Label>
            <select
              id="pf-theme"
              className="h-9 rounded-md border bg-background px-2 text-sm"
              value={theme}
              onChange={(e) => setTheme(e.target.value as AppTheme)}
            >
              {Object.values(AppTheme).map((value) => (
                <option key={value} value={value}>
                  {t(THEME_LABELS[value])}
                </option>
              ))}
            </select>
            <p className="text-xs text-muted-foreground">
              {t('"Aziendale" usa la palette impostata dall\'amministratore.')}
            </p>
          </div>
        </div>
        <Button type="submit" className="self-end" disabled={save.isPending}>
          {save.isPending ? t("Salvataggio…") : t("Salva preferenze")}
        </Button>
      </form>
    </section>
  );
}

/** Utenti abilitati come proprietari dei dati importati per il tipo indicato. */
function useImportOwners(type: ImportType) {
  return useQuery({
    queryKey: ["import-owners", type],
    queryFn: () => api<UserRef[]>(`/api/imports/owners/${type}`),
    staleTime: 60_000,
  });
}

function useFileImport(url: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ file, ownerId }: { file: File; ownerId?: string }) => {
      const finalUrl = ownerId ? `${url}?ownerId=${encodeURIComponent(ownerId)}` : url;
      return apiUpload<ImportReport>(finalUrl, file);
    },
    onSuccess: () => void queryClient.invalidateQueries(),
  });
}

function ReportSummary({ report }: { report: ImportReport }) {
  const { t } = useTranslation();
  return (
    <div className="rounded-md bg-muted/50 p-3 text-xs">
      <p>
        ✅ {t("Importati:")} <strong>{report.imported}</strong> · {t("saltati (duplicati):")}{" "}
        <strong>{report.skipped}</strong> · {t("errori:")} <strong>{report.errors.length}</strong>
      </p>
      {report.errors.length > 0 && (
        <ul className="mt-1 list-disc pl-4 text-destructive">
          {report.errors.slice(0, 8).map((error) => (
            <li key={error.row}>
              {t("Riga {{row}}", { row: error.row })}: {error.message}
            </li>
          ))}
          {report.errors.length > 8 && (
            <li>{t("… e altri {{count}} errori", { count: report.errors.length - 8 })}</li>
          )}
        </ul>
      )}
    </div>
  );
}

function ImportRow({
  title,
  description,
  templateUrl,
  accept,
  importUrl,
  ownerType,
  icon,
}: {
  title: string;
  description: string;
  templateUrl?: string;
  accept: string;
  importUrl: string;
  /** Tipo usato per elencare i proprietari abilitati. */
  ownerType: ImportType;
  icon: ReactNode;
}) {
  const { t } = useTranslation();
  const toast = useToast();
  const currentUser = useCurrentUser();
  const fileRef = useRef<HTMLInputElement>(null);
  const [report, setReport] = useState<ImportReport | null>(null);
  const [ownerId, setOwnerId] = useState<string>("");
  const importFile = useFileImport(importUrl);
  const { data: owners } = useImportOwners(ownerType);

  // Default: l'utente corrente se abilitato, altrimenti il primo della lista.
  useEffect(() => {
    if (!owners || ownerId) return;
    const mine = owners.find((o) => o.id === currentUser.id);
    setOwnerId(mine?.id ?? owners[0]?.id ?? "");
  }, [owners, ownerId, currentUser.id]);

  return (
    <div className="flex flex-col gap-2 rounded-md border p-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-muted-foreground">{icon}</span>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium">{title}</p>
          <p className="text-xs text-muted-foreground">{description}</p>
        </div>
        {templateUrl && (
          <a href={templateUrl}>
            <Button variant="outline" size="sm">
              <Download className="size-3.5" /> {t("Template")}
            </Button>
          </a>
        )}
        <Button size="sm" disabled={importFile.isPending} onClick={() => fileRef.current?.click()}>
          <Upload className="size-3.5" /> {importFile.isPending ? t("Importazione…") : t("Importa")}
        </Button>
        <input
          ref={fileRef}
          type="file"
          accept={accept}
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) {
              setReport(null);
              importFile.mutate(
                { file, ownerId: ownerId || undefined },
                {
                  onSuccess: setReport,
                  onError: (error) =>
                    toast(
                      error instanceof ApiError ? error.message : t("Errore nell'import"),
                      "error",
                    ),
                },
              );
            }
            e.target.value = "";
          }}
        />
      </div>
      {/* Proprietario dei dati importati: solo utenti abilitati al modulo. */}
      {owners && owners.length > 0 && (
        <label className="flex items-center gap-2 text-xs text-muted-foreground">
          {t("Proprietario dei dati:")}
          <select
            className="h-8 rounded-md border bg-background px-2 text-sm text-foreground"
            value={ownerId}
            onChange={(e) => setOwnerId(e.target.value)}
          >
            {owners.map((owner) => (
              <option key={owner.id} value={owner.id}>
                {owner.name}
                {owner.id === currentUser.id ? ` ${t("(io)")}` : ""}
              </option>
            ))}
          </select>
        </label>
      )}
      {report && <ReportSummary report={report} />}
    </div>
  );
}

function ImportsCard({ user }: { user: CurrentUser }) {
  const { t } = useTranslation();
  const excelTypes = (Object.values(ImportType) as ImportType[]).filter((type) => {
    if (type === ImportType.TASKS) return user.canSeeAdminTasks;
    if (type === ImportType.CONTACTS) return user.canSeeContacts;
    if (type === ImportType.COMPANIES) return true; // aziende: tutti gli interni
    return user.canEditDeals; // import offerte = scrittura
  });

  return (
    <section className="rounded-lg border bg-card p-5">
      <h2 className="mb-1 flex items-center gap-2 font-semibold">
        <SectionIcon tone="emerald">
          <FileSpreadsheet className="size-4" />
        </SectionIcon>
        {t("Import dati")}
      </h2>
      <p className="mb-4 text-sm text-muted-foreground">
        {t(
          "Scarica il template Excel, compilalo (elimina la riga di esempio) e ricaricalo. Duplicati ed errori vengono segnalati riga per riga.",
        )}
      </p>
      <div className="flex flex-col gap-3">
        {user.canSeeAdminTasks && (
          <ImportRow
            title={t("Calendario (iCal / .ics)")}
            description={t(
              "Eventi e attività diventano task dello Scadenzario del proprietario scelto.",
            )}
            accept=".ics,text/calendar"
            importUrl="/api/imports/ical"
            ownerType={ImportType.TASKS}
            icon={<CalendarArrowDown className="size-4" />}
          />
        )}
        {excelTypes.map((type) => (
          <ImportRow
            key={type}
            title={IMPORT_TYPE_LABELS[type]}
            description={t("File .xlsx sul tracciato standard.")}
            templateUrl={`/api/imports/template/${type}`}
            accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
            importUrl={`/api/imports/${type}`}
            ownerType={type}
            icon={<FileSpreadsheet className="size-4" />}
          />
        ))}
      </div>
    </section>
  );
}
