// Copyright (c) 2026 Jugaad s.r.l.
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Come si apre la connessione al server di posta.
 *
 * È una regola sola, e sta qui perché la sua assenza costa un pomeriggio: la
 * **porta** decide la stretta di mano, non un'opzione. Sulla 465 il dialogo è
 * cifrato dal primo byte (TLS implicito); sulla 587 e sulla 25 si comincia in
 * chiaro e si sale a TLS con STARTTLS. Chiedere TLS immediato sulla 587 fa
 * fallire l'handshake con un messaggio che non aiuta nessuno:
 * *"wrong version number"* — il server ha risposto in chiaro e la libreria ha
 * provato a leggerlo come TLS.
 *
 * Il flag di configurazione (`MAILER_USE_TLS`) dice quindi un'altra cosa:
 * **pretendo che la connessione sia cifrata**. Con la 587 diventa "fai STARTTLS
 * e rifiuta se non riesce", che è ciò che quasi tutti intendono quando lo
 * accendono — nei prodotti da cui si copiano queste variabili significa proprio
 * quello.
 */
export interface SmtpHandshake {
  /** TLS dal primo byte: solo la porta dedicata. */
  secure: boolean;
  /** Su porta in chiaro: pretendi STARTTLS, non accontentarti. */
  requireTLS: boolean;
}

/** Porta storica del TLS implicito per SMTP. */
const IMPLICIT_TLS_PORT = 465;

export function smtpHandshake(port: number, useTls: boolean): SmtpHandshake {
  if (port === IMPLICIT_TLS_PORT) return { secure: true, requireTLS: false };
  return { secure: false, requireTLS: useTls };
}
