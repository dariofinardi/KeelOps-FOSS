// Copyright (c) 2026 Jugaad s.r.l.
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Connettore per l'invio delle email.
 *
 * L'applicazione non conosce SMTP: conosce **questo** contratto. Chi spedisce
 * davvero (un server SMTP tipo SendGrid, un file di log in sviluppo, un finto
 * trasporto nei test) sta dietro `MailTransport`, e si sceglie dalla
 * configurazione. Aggiungere domani un provider diverso — API HTTP invece di
 * SMTP — vuol dire scrivere un altro trasporto, non toccare chi manda le
 * notifiche.
 *
 * Stessa forma dell'apertura degli allegati (`AttachmentTarget`): un punto solo
 * che decide, e il resto del codice che lo segue.
 */

export interface MailMessage {
  /** Indirizzo del destinatario. Un messaggio, un destinatario: niente CC. */
  to: string;
  subject: string;
  /**
   * Dove va la **risposta**, se non dove va il mittente.
   *
   * Serve alle email che escono verso persone che in KeelOps non esistono (il
   * modulo di assistenza iniettato in un'applicazione ospite): il mittente è
   * una casella tecnica, e «rispondi» deve aprire l'indirizzo di chi legge
   * davvero. Senza, la risposta finisce in una casella che nessuno apre — che
   * è peggio di un messaggio senza risposta, perché chi scrive crede di aver
   * risposto.
   */
  replyTo?: string;
  /** Corpo in testo semplice: è quello che si legge ovunque. */
  text: string;
  /** Corpo HTML, facoltativo: chi non lo sa leggere ricade sul testo. */
  html?: string;
  /**
   * Immagini incorporate nel messaggio, richiamate dall'HTML con `cid:<id>`.
   *
   * È l'unico modo perché una figura si veda davvero: un `src` remoto obbliga il
   * client del destinatario a raggiungere il nostro server — con un certificato
   * che accetti, da qualunque rete si trovi — e molti client le immagini remote
   * le bloccano comunque finché non si chiede il permesso.
   */
  inlineImages?: InlineImage[];
  /**
   * Documenti allegati al messaggio — quelli che il destinatario salva.
   *
   * Distinti dalle immagini incorporate, che nel messaggio si *vedono* e non
   * compaiono come allegati: qui l'intenzione è opposta, il file è la ragione
   * per cui l'email è stata mandata (la nota di rilascio di un progetto).
   */
  attachments?: MailAttachment[];
}

export interface MailAttachment {
  filename: string;
  contentType: string;
  content: Buffer;
}

export interface InlineImage {
  /** Identificatore usato nell'HTML: `<img src="cid:questo">`. */
  cid: string;
  filename: string;
  contentType: string;
  content: Buffer;
}

export interface MailTransport {
  /** Nome per i log e per la pagina Sistema ("log", "smtp", "memoria"). */
  readonly name: string;
  /**
   * Spedisce. Può lanciare: il chiamante isola il guasto — un'email che non
   * parte non deve far fallire l'operazione che l'ha originata (vedi
   * `mail/service.ts`).
   */
  send(message: MailMessage): Promise<void>;
}
