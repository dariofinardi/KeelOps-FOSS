import webPush from "web-push";
import { prisma } from "../../db";

const VAPID_PUBLIC = "vapid_public_key";
const VAPID_PRIVATE = "vapid_private_key";

let configured = false;
let publicKeyCache: string | null = null;

/** Coppia VAPID: da env, oppure generata al primo uso e salvata in AppSetting. */
export async function getVapidPublicKey(): Promise<string> {
  if (publicKeyCache) return publicKeyCache;

  let publicKey = process.env.VAPID_PUBLIC_KEY ?? null;
  let privateKey = process.env.VAPID_PRIVATE_KEY ?? null;

  if (!publicKey || !privateKey) {
    const [storedPublic, storedPrivate] = await Promise.all([
      prisma.appSetting.findUnique({ where: { key: VAPID_PUBLIC } }),
      prisma.appSetting.findUnique({ where: { key: VAPID_PRIVATE } }),
    ]);
    if (storedPublic && storedPrivate) {
      publicKey = storedPublic.value;
      privateKey = storedPrivate.value;
    } else {
      const generated = webPush.generateVAPIDKeys();
      publicKey = generated.publicKey;
      privateKey = generated.privateKey;
      await prisma.appSetting.createMany({
        data: [
          { key: VAPID_PUBLIC, value: publicKey },
          { key: VAPID_PRIVATE, value: privateKey },
        ],
      });
    }
  }

  webPush.setVapidDetails("mailto:admin@kancrm.local", publicKey, privateKey);
  configured = true;
  publicKeyCache = publicKey;
  return publicKey;
}

/**
 * Invia una notifica push a tutti i dispositivi dell'utente. Errori 404/410
 * (sottoscrizione scaduta) rimuovono la sottoscrizione; gli altri sono ignorati
 * (il push è best-effort, la notifica in-app resta la fonte di verità).
 *
 * Restituisce a quanti dispositivi è stata consegnata: serve all'invio di prova,
 * dove "non è arrivato niente" e "non c'era nessun dispositivo" sono due
 * diagnosi diverse e chi prova deve poterle distinguere.
 */
export async function pushToUser(userId: string, title: string, body: string): Promise<number> {
  if (process.env.NODE_ENV === "test") return 0; // niente rete nei test
  const subscriptions = await prisma.pushSubscription.findMany({ where: { userId } });
  if (subscriptions.length === 0) return 0;
  if (!configured) await getVapidPublicKey();

  const payload = JSON.stringify({ title, body });
  let delivered = 0;
  await Promise.all(
    subscriptions.map(async (subscription) => {
      try {
        await webPush.sendNotification(
          {
            endpoint: subscription.endpoint,
            keys: { p256dh: subscription.p256dh, auth: subscription.auth },
          },
          payload,
          { TTL: 3600 },
        );
        delivered += 1;
      } catch (error) {
        const statusCode = (error as { statusCode?: number }).statusCode;
        const servizio = new URL(subscription.endpoint).host;
        if (statusCode === 404 || statusCode === 410) {
          await prisma.pushSubscription
            .delete({ where: { id: subscription.id } })
            .catch(() => undefined);
          console.warn(`[push] iscrizione scaduta su ${servizio} (${statusCode}): rimossa`);
        } else {
          /**
           * Ogni altro rifiuto **si annota**. Best-effort voleva dire silenzio
           * assoluto: una chiave VAPID che non corrisponde più (403) o un
           * payload rifiutato (400) si comportavano esattamente come "va tutto
           * bene", e chi diceva «non mi arrivano le notifiche» non aveva un
           * posto dove guardare (04/09/2026).
           */
          console.warn(
            `[push] non consegnata a ${servizio}${statusCode ? ` (${statusCode})` : ""}: ${
              error instanceof Error ? error.message : String(error)
            }`,
          );
        }
      }
    }),
  );
  return delivered;
}
