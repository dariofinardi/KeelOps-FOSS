// Copyright (c) 2026 Jugaad s.r.l.
// SPDX-License-Identifier: AGPL-3.0-only

import { api } from "./api";

export function pushSupported(): boolean {
  return "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
}

function urlBase64ToUint8Array(base64: string): Uint8Array {
  const padding = "=".repeat((4 - (base64.length % 4)) % 4);
  const normalized = (base64 + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = window.atob(normalized);
  return Uint8Array.from(raw, (char) => char.charCodeAt(0));
}

export async function getPushSubscription(): Promise<PushSubscription | null> {
  if (!pushSupported()) return null;
  const registration = await navigator.serviceWorker.getRegistration();
  if (!registration) return null;
  return registration.pushManager.getSubscription();
}

/**
 * Aspetta che il service worker sia attivo, ma **non per sempre**.
 *
 * `navigator.serviceWorker.ready` non si risolve mai se il worker non arriva ad
 * attivarsi — succede con un certificato che il browser non accetta, con una
 * registrazione precedente rimasta a metà, o se il file non è raggiungibile. Un
 * `await` senza limite lascia l'interfaccia in attesa per sempre: il pulsante
 * resta sbiadito e non succede niente, che è il modo peggiore di fallire.
 */
async function serviceWorkerReady(timeoutMs = 15_000): Promise<ServiceWorkerRegistration> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      navigator.serviceWorker.ready,
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () =>
            reject(
              new Error(
                "Il browser non ha attivato il servizio delle notifiche. Riprova, o controlla che il sito sia aperto in HTTPS con un certificato valido.",
              ),
            ),
          timeoutMs,
        );
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/**
 * Registra il service worker, traducendo il guasto più probabile.
 *
 * I browser rifiutano di scaricare il worker da un indirizzo con un certificato
 * che non riconoscono — anche se l'utente ha proseguito oltre l'avviso: le
 * notifiche push vivono fuori dalla pagina, e su una connessione di cui il
 * browser non si fida non le concede. Il messaggio originale parla di SSL e
 * scope, e a chi lo legge non dice cosa fare; questo lo dice.
 */
async function registerWorker(): Promise<ServiceWorkerRegistration> {
  try {
    return await navigator.serviceWorker.register("/sw.js");
  } catch (error) {
    console.warn("[push] registrazione del service worker non riuscita", error);
    throw new Error(
      "Il browser non accetta il certificato di questo indirizzo, e senza non attiva le notifiche. " +
        "Apri KeelOps dal suo indirizzo pubblico, con un certificato valido, e riprova.",
    );
  }
}

/**
 * Chiede il permesso, senza restare appesi.
 *
 * Edge e Chrome hanno le "richieste silenziose": invece della finestra mettono
 * una campanella nella barra degli indirizzi, e `requestPermission()` **non si
 * risolve** finché l'utente non preme lì. Senza un limite, chi ha quella
 * impostazione attiva vede l'interfaccia bloccata su una promessa che non
 * arriverà mai (successo il 07/08/2026, anche su un indirizzo con certificato
 * valido: il certificato era solo l'altra metà del problema).
 */
async function askPermission(timeoutMs = 30_000): Promise<NotificationPermission> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      Notification.requestPermission(),
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () =>
            reject(
              new Error(
                "Il browser non ha ancora avuto una risposta: cerca l'icona della campanella nella barra degli indirizzi e consenti le notifiche.",
              ),
            ),
          timeoutMs,
        );
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/**
 * Il permesso è "bloccato" a livello di browser?
 *
 * Un rifiuto istantaneo, senza che sia comparso niente, non è una risposta
 * dell'utente: è il browser che nega da sé. In Edge e Chrome succede quando
 * l'interruttore generale delle notifiche è spento, o quando il sito è finito
 * nell'elenco dei bloccati. Dirlo cambia tutto — l'utente sta cercando una
 * finestra che non comparirà mai.
 */
export function pushBlockedByBrowser(): boolean {
  return pushSupported() && Notification.permission === "denied";
}

/**
 * Dove si sblocca, detto per esteso: da una pagina web non ci si può portare da
 * soli, e i due posti da guardare sono due — il browser **e il sistema**.
 * Windows ha un interruttore per applicazione: se le notifiche del browser sono
 * spente lì, il browser nega da sé senza mostrare niente, e nelle sue
 * impostazioni non compare nessun sito bloccato. È il caso più difficile da
 * indovinare, perché tutto sembra a posto.
 */
export const PUSH_UNBLOCK_HINT =
  "Le notifiche sono bloccate fuori da KeelOps. Due posti da controllare: nel browser, dal lucchetto accanto all'indirizzo → «Impostazioni sito» → Notifiche su «Consenti»; in Windows, Impostazioni → Sistema → Notifiche, dove il browser deve essere attivo e «Non disturbare» spento.";

/** Attiva le notifiche push su questo dispositivo/browser. */
export async function enablePush(): Promise<void> {
  const permission = await askPermission();
  if (permission !== "granted") {
    // Negato senza che comparisse niente: non è una scelta, è una regola del
    // browser. Si dice dove si cambia, invece di ripetere "negato".
    throw new Error(permission === "denied" ? PUSH_UNBLOCK_HINT : "Richiesta annullata");
  }
  const registration = await registerWorker();
  await serviceWorkerReady();
  const { publicKey } = await api<{ publicKey: string }>("/api/push/public-key");
  const subscription = await registration.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: urlBase64ToUint8Array(publicKey) as BufferSource,
  });
  await api("/api/push/subscribe", { method: "POST", body: subscription.toJSON() });
}

export async function disablePush(): Promise<void> {
  const subscription = await getPushSubscription();
  if (!subscription) return;
  await api("/api/push/unsubscribe", {
    method: "POST",
    body: { endpoint: subscription.endpoint },
  });
  await subscription.unsubscribe();
}
