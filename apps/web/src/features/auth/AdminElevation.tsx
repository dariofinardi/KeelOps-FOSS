import { useTranslation } from "react-i18next";
import { ShieldCheck, ShieldOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import { useConfirm } from "@/components/ui/confirm";
import { useAdminElevation, useCurrentUser, useElevationCountdown } from "./useAuth";

/**
 * Privilegi di amministratore a richiesta, stile `sudo` (11/08/2026).
 *
 * Un admin lavora con gli occhi di un utente normale — vede l'applicazione come
 * la vedono i colleghi e non rompe niente per distrazione — e si eleva solo per
 * il tempo che serve: mezz'ora, poi rientra da sé. Due facce dello stesso
 * comando: il **badge in topbar** (visibile solo da elevati, un clic per
 * uscire) e il **pulsante nel Profilo**, che è dove lo si va a cercare.
 */

/**
 * Badge in topbar: c'è solo mentre i privilegi sono attivi.
 *
 * È anche l'unico posto che **annuncia la scadenza**. Prima il badge spariva e
 * basta: chi stava lavorando restava con una pagina piena di roba che il
 * server non gli serviva più, e il primo clic dava un 404 senza spiegazione
 * (20/08/2026 sull'area Ticket, che in configurazione è dei soli Sviluppatori).
 */
export function AdminElevationBadge() {
  const { t } = useTranslation();
  const user = useCurrentUser();
  const toast = useToast();
  const confirm = useConfirm();
  const { stepDown } = useAdminElevation();
  const minutesLeft = useElevationCountdown(user.adminUntil, () =>
    toast(
      t(
        "I privilegi di amministratore sono scaduti: stai di nuovo vedendo l'applicazione come un utente normale.",
      ),
      "info",
    ),
  );
  if (!user.adminUntil) return null;
  return (
    <Button
      variant="outline"
      size="sm"
      className="gap-1.5 border-amber-500/60 text-amber-700 hover:bg-amber-50 dark:text-amber-400 dark:hover:bg-amber-950"
      title={t("Stai lavorando con i privilegi di amministratore: clicca per uscire")}
      disabled={stepDown.isPending}
      /**
       * **Chiede conferma.** Il badge si legge come uno stato — "Admin 24′" —
       * e invece è il comando che rientra: un clic di troppo faceva cadere i
       * privilegi in silenzio, e da lì in poi ogni comando da amministratore
       * veniva rifiutato con la pagina che continuava a offrirlo (26/08/2026,
       * ricostruito dai log: elevazione alle 12:47, rientro alle 12:51).
       */
      onClick={() => {
        void confirm({
          title: t("Uscire da amministratore?"),
          message: t(
            "Tornerai a vedere l'applicazione come un utente normale. Puoi rielevarti quando vuoi.",
          ),
          confirmLabel: t("Esci da amministratore"),
        }).then((ok) => {
          if (ok) stepDown.mutate();
        });
      }}
    >
      <ShieldCheck className="size-4" />
      <span className="hidden sm:inline">{t("Admin")}</span>
      {minutesLeft !== null && <span className="text-xs tabular-nums">{minutesLeft}′</span>}
    </Button>
  );
}

/** Il comando per esteso, nel Profilo: spiega cosa cambia e lo fa cambiare. */
export function AdminElevationCard() {
  const { t } = useTranslation();
  const user = useCurrentUser();
  const { elevate, stepDown } = useAdminElevation();
  const minutesLeft = useElevationCountdown(user.adminUntil);
  if (!user.canElevate) return null;
  const elevated = user.adminUntil !== null;
  return (
    // Bordo rosso: è il comando che cambia cosa si vede e cosa si può rompere,
    // e in mezzo alle altre schede del Profilo — lingua, tema, password —
    // spariva. Il colore lo separa dalle preferenze, che è quello che è.
    <div className="flex flex-col gap-2 rounded-lg border-2 border-destructive/60 p-4">
      <h3 className="flex items-center gap-1.5 text-sm font-semibold">
        {elevated ? (
          <ShieldCheck className="size-4 text-amber-600" />
        ) : (
          <ShieldOff className="size-4 text-muted-foreground" />
        )}
        {t("Privilegi di amministratore")}
      </h3>
      <p className="text-sm text-muted-foreground">
        {elevated
          ? t(
              "Stai vedendo l'applicazione da amministratore. I privilegi scadono da soli tra {{count}} minuti.",
              { count: minutesLeft ?? 0 },
            )
          : t(
              "Stai lavorando come un utente normale: vedi quello che vedono i tuoi colleghi. Elevati quando devi configurare l'applicazione — i privilegi durano mezz'ora, poi rientrano da soli.",
            )}
      </p>
      <div>
        {elevated ? (
          <Button variant="outline" disabled={stepDown.isPending} onClick={() => stepDown.mutate()}>
            <ShieldOff className="size-4" /> {t("Torna utente normale")}
          </Button>
        ) : (
          <Button disabled={elevate.isPending} onClick={() => elevate.mutate()}>
            <ShieldCheck className="size-4" /> {t("Diventa amministratore")}
          </Button>
        )}
      </div>
    </div>
  );
}
