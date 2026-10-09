import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Bell, Check, CheckCheck, Settings } from "lucide-react";
import { NOTIFICATION_TYPE_LABELS, type NotificationDto } from "@kancrm/shared";
import { useRecordOpener } from "@/features/tasks/useRecordOpener";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { PushToggle } from "./PushToggle";
import { formatDateTime } from "@/features/tasks/task-utils";
import { groupNotifications, type NotificationGroup } from "./notification-groups";
import {
  useMarkAllRead,
  useMarkRead,
  useNotificationPreferences,
  useNotifications,
  useNotificationStream,
  useUpdateEmailDigest,
  useUpdatePreference,
} from "./useNotifications";

/**
 * Il contenuto del pannello notifiche: intestazione con "Tutte lette" e
 * preferenze, più l'elenco cliccabile. Vive qui una volta sola e lo usano in
 * due: la campanella in alto (tendina) e la dashboard (finestra) — stessa
 * lista, stessi gesti, ovunque la si apra.
 *
 * **Il pannello non apre il record: lo chiede a chi lo contiene.** Cliccare una
 * notifica chiude l'elenco, e un pannello del task creato qui dentro morirebbe
 * insieme all'elenco — succedeva davvero: il clic non portava da nessuna parte.
 * Chi apre il record deve vivere più a lungo di chi lo chiede.
 */
export function NotificationPanel({
  onOpenRecord,
}: {
  onOpenRecord: (notification: NotificationDto) => void;
}) {
  const { t } = useTranslation();
  const { data } = useNotifications();
  const markRead = useMarkRead();
  const markAllRead = useMarkAllRead();
  const [prefsOpen, setPrefsOpen] = useState(false);
  const unread = data?.unreadCount ?? 0;
  // Una riga per task: si legge l'ultima, le altre ci stanno dietro.
  const gruppi = useMemo(
    () => groupNotifications(data?.notifications ?? []),
    [data?.notifications],
  );

  return (
    <>
      <div className="flex items-center justify-between border-b px-4 py-2">
        <span className="text-sm font-semibold">{t("Notifiche")}</span>
        <div className="flex gap-1">
          <Button
            variant="ghost"
            size="sm"
            disabled={unread === 0 || markAllRead.isPending}
            onClick={() => markAllRead.mutate()}
          >
            <Check className="size-3.5" /> {t("Tutte lette")}
          </Button>
          {/* Acceso/spento delle notifiche del browser: sta qui perché è qui che
              uno se ne ricorda, guardando l'elenco. */}
          <PushToggle />
          <Button
            variant="ghost"
            size="icon"
            title={t("Preferenze notifiche")}
            onClick={() => setPrefsOpen(true)}
          >
            <Settings className="size-4" />
          </Button>
        </div>
      </div>
      {/* Più alta di prima: lo spazio c'è, e sei righe non bastavano a farsi
          un'idea senza scorrere (24/08/2026). */}
      <ul className="max-h-[min(32rem,60vh)] overflow-y-auto">
        {gruppi.map((gruppo) => (
          <NotificationRow
            key={gruppo.latest.id}
            gruppo={gruppo}
            onRead={() => markRead.mutate(gruppo.ids)}
            onOpen={() => onOpenRecord(gruppo.latest)}
          />
        ))}
        {gruppi.length === 0 && (
          <li className="p-6 text-center text-sm text-muted-foreground">
            {t("Nessuna notifica.")}
          </li>
        )}
      </ul>
      <PreferencesDialog open={prefsOpen} onClose={() => setPrefsOpen(false)} />
    </>
  );
}

export function NotificationBell() {
  const { t } = useTranslation();
  useNotificationStream();
  const { data } = useNotifications();
  const [open, setOpen] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);
  // Fuori dalla tendina, che si chiude al clic: il pannello del record deve
  // sopravviverle.
  const record = useRecordOpener();

  useEffect(() => {
    if (!open) return;
    const onClick = (event: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, [open]);

  const unread = data?.unreadCount ?? 0;

  return (
    <div className="relative" ref={panelRef}>
      <Button
        variant="ghost"
        size="icon"
        title={t("Notifiche")}
        onClick={() => setOpen((value) => !value)}
      >
        <Bell className="size-4" />
        {unread > 0 && (
          <span className="absolute -right-0.5 -top-0.5 flex size-4 items-center justify-center rounded-full bg-destructive text-[10px] font-semibold text-destructive-foreground">
            {unread > 9 ? "9+" : unread}
          </span>
        )}
      </Button>

      {open && (
        // Sul telefono la campanella non sta sul bordo destro (dopo c'è un'altra
        // icona): ancorato a lei, il pannello largo quasi quanto lo schermo
        // usciva a sinistra (03/10/2026). Lì si fissa ai margini dello schermo.
        <div className="fixed inset-x-3 top-14 z-50 rounded-lg border bg-popover text-popover-foreground shadow-lg sm:absolute sm:inset-x-auto sm:right-0 sm:top-11 sm:w-[min(30rem,calc(100vw-1.5rem))]">
          <NotificationPanel
            onOpenRecord={(notification) => {
              setOpen(false);
              record.openNotification(notification);
            }}
          />
        </div>
      )}
      {record.node}
    </div>
  );
}

function NotificationRow({
  gruppo,
  onRead,
  onOpen,
}: {
  gruppo: NotificationGroup;
  onRead: () => void;
  onOpen: () => void;
}) {
  const { t } = useTranslation();
  const { latest, count, unread } = gruppo;
  return (
    <li
      className={cn(
        "flex cursor-pointer items-start gap-2 border-b px-4 py-2.5 text-sm last:border-0 hover:bg-muted/40",
        unread > 0 && "bg-primary/5",
      )}
      // Una notifica parla di qualcosa: cliccarla porta lì. Segnarla letta è
      // l'effetto collaterale, non il motivo per cui la si clicca.
      onClick={() => {
        if (unread > 0) onRead();
        onOpen();
      }}
      title={t("Apri")}
    >
      {unread > 0 && <span className="mt-1.5 size-2 shrink-0 rounded-full bg-primary" />}
      <div className="min-w-0 flex-1">
        <p className="leading-snug">{latest.text}</p>
        <p className="mt-0.5 flex items-center gap-2 text-xs text-muted-foreground">
          {formatDateTime(latest.createdAt)}
          {count > 1 && (
            /* La riga sta per più notizie dello stesso task: dirlo evita di
               far pensare che le altre siano sparite. */
            <span className="rounded-full bg-muted px-1.5 py-0.5">
              {t("{{count}} aggiornamenti", { count })}
            </span>
          )}
        </p>
      </div>
      {unread > 0 && (
        /**
         * **Letta senza andarci.** Prima l'unico modo di togliersi una riga
         * dagli occhi era aprirla e finire su un record che non interessava;
         * "Tutte lette" era l'alternativa, cioè tutto o niente (24/08/2026).
         */
        <button
          type="button"
          className="-my-1 shrink-0 rounded p-2 text-muted-foreground hover:bg-accent hover:text-foreground"
          title={t("Segna come letta")}
          aria-label={t("Segna come letta")}
          onClick={(event) => {
            event.stopPropagation(); // qui non si apre niente: si legge e basta
            onRead();
          }}
        >
          <CheckCheck className="size-4" />
        </button>
      )}
    </li>
  );
}

/**
 * **Due canali, due caselle.** Per ogni evento si sceglie se vederlo nella
 * campanella e se riceverlo per email. Prima era un interruttore solo: chi
 * voleva meno posta si toglieva anche l'avviso dentro il prodotto, e in pratica
 * o si teneva tutto o si perdeva tutto (04/09/2026).
 */
function PreferencesDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t } = useTranslation();
  const { data: preferences } = useNotificationPreferences();
  const update = useUpdatePreference();
  const aggregazione = useUpdateEmailDigest();
  const colonne = "grid grid-cols-[1fr_3.5rem_3.5rem] items-center gap-x-2";

  return (
    <Dialog open={open} onClose={onClose} title={t("Preferenze notifiche")}>
      <p className="mb-3 text-sm text-muted-foreground">
        {t(
          "Scegli come essere avvisato, evento per evento: nell'applicazione, per email, o in nessun modo.",
        )}
      </p>
      <div
        className={`${colonne} border-b pb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground`}
      >
        <span />
        <span className="text-center">{t("In app")}</span>
        <span className="text-center">{t("Email")}</span>
      </div>
      <div className="flex flex-col">
        {/*
          `?.` anche su `items`, che il tipo dà per certo: la risposta arriva
          dalla rete, e durante un rilascio la pagina nuova può parlare per un
          istante con il server vecchio, che qui mandava un elenco. Senza,
          l'intera campanella smetterebbe di disegnarsi.
        */}
        {preferences?.items?.map((preference) => {
          const etichetta = t(NOTIFICATION_TYPE_LABELS[preference.type]);
          return (
            <div key={preference.type} className={`${colonne} py-1.5 text-sm`}>
              <span className="min-w-0">{etichetta}</span>
              {/*
                Le caselle non hanno un'etichetta accanto — la riga è l'etichetta,
                le colonne dicono il canale. Chi legge con la tastiera o con uno
                screen reader le due cose insieme non le vede: qui le trova unite.
              */}
              <input
                type="checkbox"
                className="mx-auto"
                aria-label={`${etichetta} — ${t("In app")}`}
                checked={preference.enabled}
                disabled={update.isPending}
                onChange={(e) =>
                  update.mutate({ type: preference.type, enabled: e.target.checked })
                }
              />
              <input
                type="checkbox"
                className="mx-auto"
                aria-label={`${etichetta} — ${t("Email")}`}
                checked={preference.email}
                disabled={update.isPending}
                onChange={(e) => update.mutate({ type: preference.type, email: e.target.checked })}
              />
            </div>
          );
        })}
      </div>
      {/*
        **Un riepilogo invece di un'email per avviso.** Sta sotto la colonna che
        governa, dopo le caselle e non prima: si arriva qui per spegnere
        qualcosa, e questa è l'alternativa allo spegnere. Riguarda solo la
        posta, e lo dice.
      */}
      <label className="mt-3 flex items-start gap-2 rounded-md border bg-muted/30 p-3 text-sm">
        <input
          type="checkbox"
          className="mt-0.5"
          checked={preferences?.emailDigest ?? false}
          disabled={aggregazione.isPending || !preferences}
          onChange={(e) => aggregazione.mutate({ emailDigest: e.target.checked })}
        />
        <span>
          {t("Aggrega le email")}
          <span className="block text-xs text-muted-foreground">
            {t(
              "Un solo riepilogo ogni {{count}} minuti al posto di un'email per avviso. Nell'applicazione gli avvisi restano immediati.",
              { count: preferences?.emailDigestMinutes ?? 15 },
            )}
          </span>
        </span>
      </label>
      {/* Spento di serie: il weekend è del weekend (06/09/2026). */}
      <label className="mt-2 flex items-start gap-2 rounded-md border bg-muted/30 p-3 text-sm">
        <input
          type="checkbox"
          className="mt-0.5"
          checked={preferences?.emailWeekend ?? false}
          disabled={aggregazione.isPending || !preferences}
          onChange={(e) => aggregazione.mutate({ emailWeekend: e.target.checked })}
        />
        <span>
          {t("Ricevi le email anche nel weekend")}
          <span className="block text-xs text-muted-foreground">
            {t(
              "Spento, le email di sabato e domenica aspettano il lunedì mattina, in un riepilogo. Nell'applicazione gli avvisi restano immediati.",
            )}
          </span>
        </span>
      </label>
      <div className="mt-4 flex justify-end">
        <Button variant="outline" onClick={onClose}>
          {t("Chiudi")}
        </Button>
      </div>
    </Dialog>
  );
}
