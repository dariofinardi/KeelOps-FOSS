import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Bell, BellOff, Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import { api, ApiError } from "@/lib/api";
import {
  disablePush,
  enablePush,
  getPushSubscription,
  pushBlockedByBrowser,
  pushSupported,
  PUSH_UNBLOCK_HINT,
} from "@/lib/push";

/**
 * Le notifiche del browser, accese o spente **su questo dispositivo**.
 *
 * Sta nell'intestazione dell'elenco perché è lì che uno se ne ricorda: nel
 * momento in cui guarda le notifiche e pensa "queste le voglio anche quando non
 * ho la scheda aperta" — oppure il contrario, alle undici di sera.
 *
 * È un interruttore **per dispositivo**, non per persona: il permesso lo dà il
 * browser a sé stesso, e lo stesso utente può volerle sul telefono e non sul
 * portatile. Le preferenze per *tipo* di notifica restano un'altra cosa e
 * stanno sotto l'ingranaggio.
 *
 * Da non confondere con il canale in tempo reale (SSE) che tiene aggiornata la
 * campanella mentre l'applicazione è aperta: quello non si spegne, non consuma
 * niente quando non succede nulla, e non ha bisogno del permesso di nessuno.
 */
export function PushToggle() {
  const { t } = useTranslation();
  const toast = useToast();
  const [active, setActive] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!pushSupported()) return;
    void getPushSubscription().then((subscription) => setActive(subscription !== null));
  }, []);

  // Browser che non le sa fare (o pagina non sicura): niente interruttore, che
  // acceso non farebbe nulla e spento sembrerebbe una scelta.
  if (!pushSupported() || active === null) return null;

  const toggle = async () => {
    // Bloccate dal browser: riprovare produrrebbe lo stesso rifiuto istantaneo.
    // Meglio spiegare dove si sblocca, che è l'unica cosa che può funzionare.
    if (!active && pushBlockedByBrowser()) {
      toast(PUSH_UNBLOCK_HINT, "error");
      return;
    }
    setBusy(true);
    try {
      if (active) {
        await disablePush();
        setActive(false);
        toast(t("Notifiche del browser spente su questo dispositivo."));
      } else {
        await enablePush();
        setActive(true);
        toast(t("Notifiche del browser attive su questo dispositivo."), "success");
      }
    } catch (error) {
      toast(error instanceof Error ? error.message : t("Non riuscito"), "error");
    } finally {
      setBusy(false);
    }
  };

  /**
   * Le push si possono solo provare: fra permesso, service worker e servizio di
   * Google ci sono quattro punti in cui la cosa si ferma in silenzio, e nessuno
   * si vede da qui. Il bottone compare solo a chi le ha accese — a chi non le ha
   * non servirebbe a niente.
   */
  const prova = async () => {
    setBusy(true);
    try {
      const { delivered } = await api<{ delivered: number }>("/api/push/test", { method: "POST" });
      toast(
        delivered > 0
          ? t("Notifica di prova inviata a {{count}} dispositivi.", { count: delivered })
          : t("Nessun dispositivo iscritto: prova a spegnere e riaccendere le notifiche."),
        delivered > 0 ? "success" : "error",
      );
    } catch (error) {
      toast(error instanceof ApiError ? error.message : t("Invio non riuscito"), "error");
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      {active && (
        <Button
          variant="ghost"
          size="icon"
          disabled={busy}
          title={t("Mandami una notifica di prova su questo dispositivo")}
          aria-label={t("Notifica di prova")}
          onClick={() => void prova()}
        >
          <Send className="size-4" />
        </Button>
      )}
      <Button
        variant="ghost"
        size="icon"
        disabled={busy}
        aria-pressed={active}
        title={
          active
            ? t("Notifiche del browser attive su questo dispositivo: premi per spegnerle")
            : t("Notifiche del browser spente: premi per riceverle anche a scheda chiusa")
        }
        aria-label={
          active ? t("Spegni le notifiche del browser") : t("Accendi le notifiche del browser")
        }
        onClick={() => void toggle()}
      >
        {active ? (
          <Bell className="size-4" />
        ) : (
          <BellOff className="size-4 text-muted-foreground" />
        )}
      </Button>
    </>
  );
}
