import cron from "node-cron";
import { purgePendingInlineImages } from "./modules/rich-text/inline-images";
import { buildApp } from "./app";
import { moduliAttivi } from "./edition/registry";
import { config } from "./config";
import { initDb, prisma } from "./db";
import { sweepExpiredChallenges } from "./modules/auth/challenges";
import { materializeAllTemplates } from "./modules/recurrence/service";
import {
  sendDeferredEmails,
  sendDueDigests,
  sendEmailDigests,
} from "./modules/notifications/service";
import { runScheduledBackup } from "./modules/admin/backup";
import { runDatabaseSnapshot } from "./modules/admin/db-snapshot";
import { cachedStorageUsage, isStale, refreshStorageUsage } from "./modules/admin/storage-usage";
import { sweepOrphanFiles } from "./modules/attachments/orphan-files";
import { purgeTrash } from "./modules/trash/service";
import { deleteExpiredSessions } from "./modules/auth/session";
import { initAttachmentStore, storeFor } from "./modules/attachments/settings";

async function main(): Promise<void> {
  await initDb();

  /**
   * Il magazzino degli allegati, montato **prima** di aprire la porta: se
   * `ATTACHMENT=GCP` e l'indirizzo del bucket è storto si muore qui, con un
   * messaggio. Partire lo stesso vorrebbe dire scrivere i documenti sul disco
   * locale credendo di metterli nel bucket, e accorgersene il giorno in cui si
   * cerca un file.
   */
  const attachments = await initAttachmentStore();
  console.info(
    `[allegati] magazzino: ${attachments.backend === "GCP" ? "Google Cloud Storage" : "disco"} · ` +
      `${storeFor(attachments).describe()}` +
      (attachments.backend === "GCP" && attachments.previousUri
        ? ` (trasloco in corso: cerca anche in ${attachments.previousUri})`
        : ""),
  );

  const app = await buildApp();

  // I cron usano la timezone aziendale, non quella di sistema: su un server in UTC
  // (container) le 07:00 e le 02:30 slitterebbero di 1-2 ore.
  const tz = { timezone: config.displayTimezone };

  // Materializzazione occorrenze ricorrenti: all'avvio e ogni notte alle 03:00.
  try {
    const created = await materializeAllTemplates();
    if (created > 0) app.log.info(`Ricorrenze: materializzati ${created} task`);
  } catch (error) {
    app.log.error(error, "Materializzazione ricorrenze fallita all'avvio");
  }
  cron.schedule(
    "0 3 * * *",
    async () => {
      try {
        const created = await materializeAllTemplates();
        app.log.info(`Cron ricorrenze: materializzati ${created} task`);
      } catch (error) {
        app.log.error(error, "Cron ricorrenze fallito");
      }
    },
    tz,
  );

  // Le sfide di accesso scadute (reset, OTP) non servono a nessuno: via.
  cron.schedule(
    "10 3 * * *",
    async () => {
      try {
        const swept = await sweepExpiredChallenges();
        if (swept > 0) app.log.info(`Cron sfide di accesso: eliminate ${swept} scadute`);
      } catch (error) {
        app.log.error(error, "Cron sfide di accesso fallito");
      }
    },
    tz,
  );

  // Digest scadenze (notifica in-app, una al giorno per utente): avvio + 07:00.
  try {
    await sendDueDigests();
  } catch (error) {
    app.log.error(error, "Digest scadenze fallito all'avvio");
  }
  cron.schedule(
    "0 7 * * *",
    async () => {
      try {
        const sent = await sendDueDigests();
        app.log.info(`Cron digest scadenze: inviate ${sent} notifiche`);
      } catch (error) {
        app.log.error(error, "Cron digest scadenze fallito");
      }
    },
    tz,
  );

  /**
   * **Il riepilogo delle email**, per chi ha chiesto di aggregarle. Ogni
   * `EMAIL_DIGEST_MINUTES` (15 di serie): abbastanza spesso da non far
   * aspettare una risposta, abbastanza rado da raccogliere davvero qualcosa.
   */
  cron.schedule(
    `*/${config.emailDigestMinutes} * * * *`,
    async () => {
      try {
        const inviate = await sendEmailDigests();
        if (inviate > 0) app.log.info(`Riepiloghi email: inviati ${inviate}`);
      } catch (error) {
        app.log.error(error, "Riepilogo email fallito");
      }
    },
    tz,
  );

  /**
   * **Le email una per una**, ogni minuto: partono quelle che hanno aspettato
   * `EMAIL_GRACE_MINUTES` senza che l'avviso fosse letto nella campanella
   * (vedi notifications/email-queue.ts).
   */
  cron.schedule(
    "* * * * *",
    async () => {
      try {
        const inviate = await sendDeferredEmails();
        if (inviate > 0) app.log.info(`Email differite: inviate ${inviate}`);
      } catch (error) {
        app.log.error(error, "Email differite: giro fallito");
      }
    },
    tz,
  );

  // I lavori dei moduli dell'edizione (promemoria e assenze del timesheet,
  // indice dei modelli…): nella community nessuno.
  for (const modulo of moduliAttivi()) modulo.job?.({ cron, app, tz });

  // Backup automatico giornaliero con retention: avvio (idempotente) + 02:30.
  const runBackup = async (label: string) => {
    try {
      const created = await runScheduledBackup();
      if (created) app.log.info(`Backup ${label}: creato ${created}`);
    } catch (error) {
      app.log.error(error, `Backup ${label} fallito`);
    }
  };
  await runBackup("all'avvio");
  cron.schedule("30 2 * * *", () => void runBackup("notturno"), tz);

  /**
   * Istantanea del solo database **nel magazzino degli allegati**, a
   * mezzanotte: in produzione finisce nel bucket, cioè fuori da questa
   * macchina. Lo zip delle 02:30 resta il ripristino completo, ma vive sul
   * disco — e un disco che muore si porta via anche i suoi backup.
   *
   * Mezzanotte chiude la giornata appena passata: l'istantanea del 19 alle
   * 00:00 contiene il lavoro del 18.
   */
  cron.schedule(
    "0 0 * * *",
    async () => {
      try {
        const key = await runDatabaseSnapshot();
        app.log.info(`Istantanea del database: ${key}`);
      } catch (error) {
        app.log.error(error, "Istantanea del database fallita");
      }
    },
    tz,
  );

  /**
   * Conteggio dello spazio occupato dai file: una volta al giorno alle 03:15.
   *
   * **Dopo** lo zip delle 02:30 e l'istantanea di mezzanotte, così il numero
   * comprende i backup della notte appena passata invece di quelli della notte
   * prima. Il conto è un elenco completo del magazzino — su un bucket, una
   * chiamata di rete per pagina — e per questo si fa qui e non quando qualcuno
   * apre la pagina Sistema.
   */
  const contaSpazio = async (label: string) => {
    try {
      const usage = await refreshStorageUsage();
      app.log.info(
        `Spazio occupato (${label}): ${usage.files} file, ${usage.bytes} byte, ` +
          `più ${usage.backupFiles} istantanee (${usage.backupBytes} byte) in ${usage.tookMs} ms`,
      );
    } catch (error) {
      app.log.error(error, `Conteggio dello spazio (${label}) fallito`);
    }
  };
  /**
   * Pulizia dei file orfani: 03:00, **prima** del conteggio dello spazio, così
   * il numero che si legge in pagina è quello del magazzino ripulito e non
   * quello di mezz'ora prima.
   *
   * Cancella file, quindi le cautele stanno tutte nel modulo: prefissi
   * riservati intatti, riferimenti cercati anche dentro i testi (non solo
   * nelle tabelle) e i file recenti lasciati stare. Quel che toglie finisce
   * nel registro con il nome, perché una pulizia silenziosa è indistinguibile
   * da una perdita di dati.
   */
  cron.schedule(
    "0 3 * * *",
    async () => {
      try {
        const esito = await sweepOrphanFiles();
        if (esito.rimossi.length > 0) {
          app.log.warn(
            { chiavi: esito.rimossi },
            `File orfani rimossi: ${esito.rimossi.length} (${esito.byte} byte)`,
          );
        }
        if (esito.rimandati > 0) {
          app.log.info(`File orfani: ${esito.rimandati} non esaminati, si riprende domani`);
        }
      } catch (error) {
        app.log.error(error, "Pulizia dei file orfani fallita");
      }
    },
    tz,
  );

  cron.schedule("15 3 * * *", () => void contaSpazio("notturno"), tz);
  // All'avvio solo se non c'è niente da mostrare o è roba di ieri l'altro: un
  // riavvio non deve costare un giro completo del bucket.
  if (isStale(await cachedStorageUsage())) void contaSpazio("all'avvio");

  // Svuotamento cestino: elimina definitivamente ciò che è nel cestino da 30+ giorni.
  cron.schedule(
    "0 4 * * *",
    async () => {
      try {
        const purged = await purgeTrash();
        if (purged > 0) app.log.info(`Cestino: eliminati definitivamente ${purged} elementi`);
        const sessions = await deleteExpiredSessions();
        if (sessions > 0) app.log.info(`Sessioni scadute eliminate: ${sessions}`);
        // Figure incollate in descrizioni mai salvate (dialogo abbandonato).
        const images = await purgePendingInlineImages();
        if (images > 0) app.log.info(`Figure in attesa rimosse: ${images}`);
      } catch (error) {
        app.log.error(error, "Purge notturno fallito");
      }
    },
    tz,
  );

  // Graceful shutdown: chiude connessioni HTTP/SSE, cron e database.
  let shuttingDown = false;
  const shutdown = async (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    app.log.info(`Ricevuto ${signal}: arresto in corso…`);
    try {
      for (const task of cron.getTasks().values()) {
        void task.stop();
      }
      await app.close();
      await prisma.$disconnect();
      app.log.info("Arresto completato");
      process.exit(0);
    } catch (error) {
      app.log.error(error, "Errore durante l'arresto");
      process.exit(1);
    }
  };
  process.once("SIGTERM", () => void shutdown("SIGTERM"));
  process.once("SIGINT", () => void shutdown("SIGINT"));

  await app.listen({ port: config.port, host: "0.0.0.0" });
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
