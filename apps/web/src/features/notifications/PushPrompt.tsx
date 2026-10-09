import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { BellRing } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import { useListPrefs } from "@/lib/useListPrefs";
import { enablePush, getPushSubscription, pushSupported } from "@/lib/push";

/**
 * La domanda sulle notifiche del browser: **una volta sola, per dispositivo**.
 *
 * Perché chiedere prima noi, invece di far comparire subito il permesso del
 * browser: quello si può chiedere **una volta sola**. Se arriva a freddo, nel
 * mezzo di altro, quasi tutti premono "Blocca" per togliersela di torno — e
 * quel no è definitivo, non lo si può più ripetere nemmeno volendo. Chiedendo
 * prima in italiano, il permesso del browser lo si tira fuori solo davanti a un
 * sì.
 *
 * Non è una finestra modale: sta in basso, non copre niente e non ruba il
 * fuoco. Chi non risponde la ritrova al prossimo accesso; chi risponde — sì o
 * no — non la rivede più, e l'interruttore resta nell'intestazione delle
 * notifiche per cambiare idea quando vuole.
 *
 * La memoria è **locale al dispositivo**, come il permesso: lo stesso utente sul
 * telefono deve poter dire sì, anche se sul portatile aveva detto no.
 */
export function PushPrompt({ delayMs = 3000 }: { delayMs?: number }) {
  const { t } = useTranslation();
  const toast = useToast();
  const { prefs, update } = useListPrefs("kancrm-push-prompt", { answered: false });
  const [visible, setVisible] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (prefs.answered || !pushSupported()) return;
    // Il browser ha già una risposta (concesso o bloccato): non c'è niente da
    // chiedere, e insistere non riaprirebbe comunque il permesso.
    if (Notification.permission !== "default") {
      update({ answered: true });
      return;
    }
    let alive = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    void getPushSubscription().then((subscription) => {
      if (!alive || subscription) return;
      // Un attimo dopo l'apertura: la prima schermata è già abbastanza piena.
      timer = setTimeout(() => alive && setVisible(true), delayMs);
    });
    return () => {
      alive = false;
      if (timer) clearTimeout(timer);
    };
    // Solo all'avvio: la domanda si fa una volta, non a ogni cambio di stato.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!visible) return null;

  const rispondi = async (si: boolean) => {
    setBusy(true);
    // La scheda sparisce SUBITO, prima di aspettare qualunque cosa: il permesso
    // del browser può restare appeso per minuti (le "richieste silenziose" lo
    // mettono in una campanella nella barra degli indirizzi), e una scheda che
    // resta lì sbiadita fa credere che il clic non sia arrivato. L'esito lo
    // dice l'avviso in fondo, quando c'è.
    setVisible(false);
    try {
      if (si) await enablePush();
      if (si) toast(t("Notifiche attive su questo dispositivo."), "success");
      // Ricordare vale per le risposte: sì o no che sia, non si chiede più.
      update({ answered: true });
    } catch (error) {
      // Un guasto NON è un rifiuto: si dice cos'è andato storto e si richiederà
      // alla prossima apertura. (Se è stato il browser a negare il permesso,
      // alla prossima apertura non si chiede lo stesso: il permesso non è più
      // "default" e la domanda si salta da sé.)
      console.warn("[push] attivazione non riuscita", error);
      toast(error instanceof Error ? error.message : t("Non riuscito"), "error");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      role="status"
      aria-live="polite"
      className="pointer-events-none fixed inset-x-0 bottom-4 z-[95] flex justify-center px-4"
    >
      <div className="pointer-events-auto flex max-w-md flex-col gap-2 rounded-lg border bg-card p-4 text-sm shadow-lg">
        <p className="flex items-start gap-2">
          <BellRing className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
          <span>
            {t(
              "Vuoi essere avvisato su questo dispositivo quando ti assegnano un task o commentano dove lavori? Le notifiche arrivano anche a scheda chiusa, e si spengono quando vuoi dalla campanella.",
            )}
          </span>
        </p>
        <div className="flex justify-end gap-2">
          <Button variant="outline" size="sm" disabled={busy} onClick={() => void rispondi(false)}>
            {t("No, grazie")}
          </Button>
          <Button size="sm" disabled={busy} onClick={() => void rispondi(true)}>
            {t("Sì, avvisami")}
          </Button>
        </div>
      </div>
    </div>
  );
}
