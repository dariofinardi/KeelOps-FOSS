import { UserRole } from "@kancrm/shared";
import { config } from "../../config";
import { prisma } from "../../db";
import { localeOfUser } from "../../i18n";
import { buildNotificationEmail, type NotificationRef } from "./notification-mail";
import { buildDigestEmail, type DigestEntry } from "./digest-mail";
import { buildLockoutAlertEmail } from "./lockout-mail";
import { buildPasswordResetEmail } from "./password-mail";
import {
  buildLoginCodeEmail,
  buildUnlockCodeEmail,
  buildPasswordResetLinkEmail,
} from "./access-mail";
import { readMailBrand, readMailSettings } from "./settings";
import type { LogoEmbed } from "./template";
import { logTransport, smtpTransport } from "./transports";
import type { MailMessage, MailTransport } from "./types";

/**
 * Il connettore, montato una volta sola all'avvio secondo la configurazione.
 *
 * Regole di questo strato, tutte in un posto:
 * - **spento di default**: senza `MAILER_HOST` non parte niente, e
 *   l'applicazione si comporta esattamente come prima;
 * - **best-effort**: un guasto della posta non deve mai far fallire l'operazione
 *   che l'ha originata. Una notifica non recapitata resta comunque nella
 *   campanella, che è il canale su cui l'applicazione fa affidamento;
 * - **niente coda**: la v1 spedisce e basta. Se servirà ritentare, il posto dove
 *   metterlo è qui dentro, senza toccare i chiamanti.
 */

let transport: MailTransport | null = null;
/**
 * Invii ancora in volo. `notify()` non aspetta la posta — un server SMTP lento
 * rallenterebbe ogni assegnazione — ma qualcuno deve poterli attendere: i test,
 * e lo spegnimento ordinato del servizio, che altrimenti taglierebbe a metà i
 * messaggi in partenza.
 */
const inFlight = new Set<Promise<unknown>>();

function currentTransport(): MailTransport | null {
  if (!config.mail.enabled) return null;
  if (!transport) {
    transport =
      config.mail.transport === "smtp"
        ? smtpTransport({
            host: config.mail.smtp.host,
            port: config.mail.smtp.port,
            secure: config.mail.smtp.secure,
            user: config.mail.smtp.user,
            password: config.mail.smtp.password,
            from: config.mail.from,
          })
        : // Il registro del processo: in produzione finisce nei log del servizio.
          logTransport((message) => console.info(message));
  }
  return transport;
}

/** Solo per i test: sostituisce il trasporto attivo. */
export function setMailTransport(next: MailTransport | null): void {
  transport = next;
}

/** Attende gli invii in volo (test, e chiusura del processo). */
export async function flushMail(): Promise<void> {
  await Promise.allSettled([...inFlight]);
}

/**
 * Spedisce subito un messaggio già composto, e **lascia salire l'errore**: è
 * l'opposto delle notifiche (dove un guasto della posta non deve rovinare
 * l'operazione). Serve all'invio di prova, dove il guasto è proprio ciò che si
 * vuole vedere.
 */
export async function sendNow(message: MailMessage): Promise<void> {
  const active = currentTransport();
  if (!active) throw new Error("Posta non configurata");
  await active.send(message);
}

/** C'è un modo di spedire? Chi manda un documento vuole saperlo **prima**. */
export function mailEnabled(): boolean {
  return currentTransport() !== null;
}

/** Nome del trasporto attivo, per la pagina Sistema ("spento" se non configurato). */
export function mailTransportName(): string {
  return config.mail.enabled ? (currentTransport()?.name ?? "spento") : "spento";
}

/**
 * Manda per email una notifica già creata. Non decide *se* notificare — quello
 * l'ha già deciso `notify()` con le preferenze del destinatario: qui si decide
 * solo se il canale email è attivo e se l'indirizzo è utilizzabile.
 *
 * Riceve l'id e non l'utente: a connettore spento non deve costare niente, e
 * leggere il destinatario da chi chiama significherebbe una query in più su ogni
 * notifica anche quando la posta non è configurata.
 */
export function sendNotificationEmail(
  userId: string,
  notification: NotificationRef,
): Promise<void> {
  const active = currentTransport();
  if (!active) return Promise.resolve();
  const sending = deliver(active, userId, notification).finally(() => inFlight.delete(sending));
  inFlight.add(sending);
  return sending;
}

/**
 * **Il riepilogo**: un'email sola con tutti gli avvisi accumulati.
 *
 * Torna `true` se è partita. Qui il silenzio non va bene come per le notifiche
 * singole: chi chiama deve sapere se può togliere gli avvisi dalla coda, e
 * cancellarli su un invio fallito vorrebbe dire perderli per sempre.
 */
export async function sendDigestEmail(userId: string, entries: DigestEntry[]): Promise<boolean> {
  const active = currentTransport();
  if (!active || entries.length === 0) return false;
  const recipient = await prisma.user.findUnique({
    where: { id: userId },
    select: { email: true, name: true, isActive: true, isSystem: true, locale: true, role: true },
  });
  if (!recipient || !puoRicevereEmail(recipient)) return false;

  const settings = await readMailSettings();
  const brand = await readMailBrand(settings.showLogo);
  const message = buildDigestEmail({
    to: recipient.email,
    locale: localeOfUser(recipient),
    recipientName: recipient.name,
    entries,
    baseUrl: settings.baseUrl,
    appName: config.mail.appName,
    brandTitle: brand.title,
    logo: brand.logo,
    intro: settings.intro,
    footer: settings.footer,
    perIlPortale: recipient.role === UserRole.PORTAL,
  });
  try {
    await active.send(message);
    return true;
  } catch (error) {
    console.warn(
      `[mail] riepilogo non recapitato a ${message.to} (${active.name}): ${
        error instanceof Error ? error.message : String(error)
      } — gli avvisi restano in coda`,
    );
    return false;
  }
}

/**
 * Costruisce il messaggio con il template configurato dalla pagina Email:
 * indirizzo pubblico, marchio, logo, testi di apertura e chiusura. Sta qui e non
 * dentro `buildNotificationEmail` perché quella è una funzione pura e testabile:
 * qui si leggono le impostazioni, lì si compone.
 */
export async function composeNotificationEmail(
  to: string,
  recipientName: string,
  notification: NotificationRef,
  logoEmbed: LogoEmbed = "cid",
  locale = "it",
  /** Il destinatario è un cliente del portale: il link porta a casa sua. */
  perIlPortale = false,
) {
  const settings = await readMailSettings();
  const brand = await readMailBrand(settings.showLogo);
  return buildNotificationEmail({
    to,
    locale,
    recipientName,
    notification,
    baseUrl: settings.baseUrl,
    appName: config.mail.appName,
    brandTitle: brand.title,
    logo: brand.logo,
    logoEmbed,
    intro: settings.intro,
    footer: settings.footer,
    perIlPortale,
  });
}

/**
 * Spedisce le credenziali provvisorie a chi ha subìto un reset e dice **se è
 * partita**.
 *
 * A differenza delle notifiche non si può fallire in silenzio: la campanella
 * qui non c'è (l'utente è fuori), e se l'email non parte l'unico che può
 * rimediare è l'amministratore che ha appena premuto il pulsante — deve saperlo
 * mentre ha ancora la password sotto gli occhi. Per lo stesso motivo l'errore
 * non risale: il reset è già avvenuto, e farlo sembrare fallito lo farebbe
 * ripetere.
 */
export async function sendPasswordResetEmail(
  recipient: { email: string; name: string; locale?: string | null },
  password: string,
): Promise<boolean> {
  const active = currentTransport();
  if (!active) return false;
  const settings = await readMailSettings();
  const brand = await readMailBrand(settings.showLogo);
  const message = buildPasswordResetEmail({
    to: recipient.email,
    locale: localeOfUser({ locale: recipient.locale ?? null }),
    recipientName: recipient.name,
    password,
    baseUrl: settings.baseUrl,
    appName: config.mail.appName,
    brandTitle: brand.title,
    logo: brand.logo,
    intro: settings.intro,
    footer: settings.footer,
  });
  try {
    await active.send(message);
    return true;
  } catch (error) {
    console.warn(
      `[mail] credenziali non recapitate a ${message.to} (${active.name}): ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
    return false;
  }
}

/**
 * **Troppe password sbagliate su un account: lo sanno gli amministratori.**
 * Una email per ciascun amministratore attivo con un indirizzo, nella sua
 * lingua. Best-effort come le notifiche: il freno non dipende dalla posta.
 */
export async function sendLockoutAlertEmail(
  account: { id: string; name: string; email: string },
  attempts: number,
  lockedUntil: Date | null,
): Promise<number> {
  const active = currentTransport();
  if (!active) return 0;
  // Tracciata come le notifiche: `flushMail()` la aspetta (test e spegnimento).
  const lavoro = consegnaAvvisoBlocco(active, account, attempts, lockedUntil).finally(() =>
    inFlight.delete(lavoro),
  );
  inFlight.add(lavoro);
  return lavoro;
}

async function consegnaAvvisoBlocco(
  active: MailTransport,
  account: { id: string; name: string; email: string },
  attempts: number,
  lockedUntil: Date | null,
): Promise<number> {
  const admins = await prisma.user.findMany({
    where: { role: UserRole.ADMIN, isActive: true, isSystem: false },
    select: { email: true, name: true, locale: true },
  });
  if (admins.length === 0) return 0;
  const settings = await readMailSettings();
  const brand = await readMailBrand(settings.showLogo);
  let inviate = 0;
  for (const admin of admins) {
    const message = buildLockoutAlertEmail({
      to: admin.email,
      locale: localeOfUser(admin),
      recipientName: admin.name,
      account,
      attempts,
      lockedUntil,
      baseUrl: settings.baseUrl,
      appName: config.mail.appName,
      brandTitle: brand.title,
      logo: brand.logo,
      intro: settings.intro,
      footer: settings.footer,
    });
    try {
      await active.send(message);
      inviate += 1;
    } catch (error) {
      console.warn(
        `[mail] avviso di blocco non recapitato a ${message.to} (${active.name}): ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }
  return inviate;
}

/** Il link di reimpostazione self-service. `true` = email partita. */
export async function sendPasswordResetLinkEmail(
  recipient: { email: string; name: string; locale?: string | null },
  resetUrl: string,
): Promise<boolean> {
  const active = currentTransport();
  if (!active) return false;
  const settings = await readMailSettings();
  const brand = await readMailBrand(settings.showLogo);
  const message = buildPasswordResetLinkEmail({
    to: recipient.email,
    locale: localeOfUser({ locale: recipient.locale ?? null }),
    recipientName: recipient.name,
    resetUrl,
    baseUrl: settings.baseUrl,
    appName: config.mail.appName,
    brandTitle: brand.title,
    logo: brand.logo,
    intro: settings.intro,
    footer: settings.footer,
  });
  try {
    await active.send(message);
    return true;
  } catch (error) {
    console.warn(
      `[mail] link di reset non recapitato a ${message.to} (${active.name}): ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
    return false;
  }
}

/** Il codice di accesso via email (OTP). `true` = email partita. */
export async function sendUnlockCodeEmail(
  recipient: { email: string; name: string; locale?: string | null },
  code: string,
): Promise<boolean> {
  const active = currentTransport();
  if (!active) return false;
  const settings = await readMailSettings();
  const message = buildUnlockCodeEmail({
    to: recipient.email,
    locale: localeOfUser({ locale: recipient.locale ?? null }),
    recipientName: recipient.name,
    code,
    baseUrl: settings.baseUrl,
    appName: config.mail.appName,
  });
  try {
    await sendNow(message);
    return true;
  } catch (error) {
    console.warn(
      `[mail] codice di sblocco non recapitato a ${message.to} (${active.name}): ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
    return false;
  }
}

export async function sendLoginCodeEmail(
  recipient: { email: string; name: string; locale?: string | null },
  code: string,
): Promise<boolean> {
  const active = currentTransport();
  if (!active) return false;
  const settings = await readMailSettings();
  const brand = await readMailBrand(settings.showLogo);
  const message = buildLoginCodeEmail({
    to: recipient.email,
    locale: localeOfUser({ locale: recipient.locale ?? null }),
    recipientName: recipient.name,
    code,
    baseUrl: settings.baseUrl,
    appName: config.mail.appName,
    brandTitle: brand.title,
    logo: brand.logo,
    intro: settings.intro,
    footer: settings.footer,
  });
  try {
    await active.send(message);
    return true;
  } catch (error) {
    console.warn(
      `[mail] codice di accesso non recapitato a ${message.to} (${active.name}): ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
    return false;
  }
}

/**
 * **Chi può ricevere un'email.** Utenti disattivati e utenti di sistema
 * («Archivio») non hanno una casella che qualcuno legga: scrivergli è solo
 * rumore in uscita.
 *
 * Il ruolo **non** entra in questa domanda, ed è voluto: un cliente del portale
 * riceve le sue email come chiunque altro — è anzi l'unico che *solo* per email
 * può essere raggiunto, visto che nell'applicazione non ci vive dentro. Una
 * riga in più qui e i clienti smetterebbero di ricevere qualunque cosa, senza
 * un errore da nessuna parte: per questo la regola è una funzione con un test.
 */
export function puoRicevereEmail(destinatario: {
  email: string;
  isActive: boolean;
  isSystem: boolean;
}): boolean {
  return destinatario.isActive && !destinatario.isSystem && destinatario.email.includes("@");
}

async function deliver(
  active: MailTransport,
  userId: string,
  notification: NotificationRef,
): Promise<void> {
  const recipient = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      email: true,
      name: true,
      isActive: true,
      isSystem: true,
      locale: true,
      role: true,
    },
  });
  if (!recipient || !puoRicevereEmail(recipient)) return;

  // L'email esce nella lingua del destinatario, come la notifica in-app.
  const message = await composeNotificationEmail(
    recipient.email,
    recipient.name,
    notification,
    "cid",
    localeOfUser(recipient),
    recipient.role === UserRole.PORTAL,
  );
  try {
    await active.send(message);
  } catch (error) {
    // Si annota e si va avanti: la notifica in-app c'è già.
    console.warn(
      `[mail] invio non riuscito verso ${message.to} (${active.name}): ${
        error instanceof Error ? error.message : String(error)
      } — la notifica resta in-app`,
    );
  }
}
