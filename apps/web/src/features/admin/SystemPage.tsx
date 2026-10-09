import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Database, DatabaseBackup, Download, HardDrive, Layers, Power } from "lucide-react";
import { APP_VERSION } from "@kancrm/shared";
import type { MaintenanceState, PluginScheda, SetMaintenanceInput } from "@kancrm/shared";
import { api } from "@/lib/api";
import { formatBytes } from "@/lib/bytes";
import { WEB_VERSIONS } from "@/lib/build-info";
import { Button } from "@/components/ui/button";
import { SectionIcon } from "@/components/ui/section-icon";
import { useConfirm } from "@/components/ui/confirm";
import { AttachmentStoreSection } from "./AttachmentStoreSection";
import { SezioniSistema } from "@/edition/slot-pagine";
import { PluginsSection } from "./PluginsSection";

interface VersionEntry {
  name: string;
  version: string;
}

interface BackupFile {
  name: string;
  at: string;
  bytes: number;
}

interface SystemInfo {
  /** Su cosa gira davvero questa installazione: è la prima cosa da sapere. */
  database: {
    motore: "sqlite" | "mariadb";
    etichetta: string;
    versione: string | null;
    dove: string;
    dimensioneBytes: number;
  };
  /** Lo stato dei backup automatici: l'istantanea nel magazzino e lo zip su disco. */
  backup: {
    snapshot: BackupFile | null;
    snapshotCount: number;
    snapshotBytes: number;
    zip: BackupFile | null;
    zipCount: number;
    zipBytes: number;
    retentionDays: number;
    zipConAllegati: boolean;
    error: string | null;
  };
  maxUploadMb: number;
  /** Node, il motore e le librerie del server, nelle versioni davvero installate. */
  versions: VersionEntry[];
  /** I plugin installati e quelli presenti ma non installati: vedi PluginsSection. */
  plugins: PluginScheda[];
  /** Posta in uscita: "spento", "log" o "smtp". */
  mailTransport: string;
  counts: {
    users: number;
    tasks: number;
    deals: number;
    projects: number;
    companies: number;
    contacts: number;
    timeEntries: number;
  };
}

function ElencoVersioni({ titolo, voci }: { titolo: string; voci: VersionEntry[] }) {
  if (voci.length === 0) return null;
  return (
    <div>
      <h3 className="mb-1 text-xs font-semibold uppercase text-muted-foreground">{titolo}</h3>
      <dl className="flex flex-col gap-0.5 text-sm">
        {voci.map((voce) => (
          <div key={voce.name} className="flex justify-between gap-2">
            <dt className="text-muted-foreground">{voce.name}</dt>
            <dd className="font-medium tabular-nums">{voce.version}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

/**
 * Una riga di backup: l\'ultima copia, quando, quanto pesa, e quante ce ne
 * sono in tutto. Il "quando" è la parte che si guarda per prima — un backup
 * senza data è una rassicurazione, non un\'informazione.
 */
function RigaBackup({
  titolo,
  file,
  count,
  bytes,
  vuoto,
  locale,
  t,
}: {
  titolo: string;
  file: BackupFile | null;
  count: number;
  bytes: number;
  vuoto: string;
  locale: string;
  t: (key: string, options?: Record<string, unknown>) => string;
}) {
  return (
    <div>
      <p className="text-xs font-semibold uppercase text-muted-foreground">{titolo}</p>
      {file ? (
        <>
          <p className="mt-0.5">
            <span className="font-medium">
              {new Date(file.at).toLocaleString(locale, {
                dateStyle: "medium",
                timeStyle: "short",
              })}
            </span>
            <span className="text-muted-foreground"> · {formatBytes(file.bytes)}</span>
          </p>
          <p className="text-xs text-muted-foreground">
            {t("{{n}} conservate, {{size}} in tutto", { n: count, size: formatBytes(bytes) })}
            {" · "}
            <span className="font-mono">{file.name}</span>
          </p>
        </>
      ) : (
        <p className="mt-0.5 text-muted-foreground">{vuoto}</p>
      )}
    </div>
  );
}

const COUNT_LABELS: Record<keyof SystemInfo["counts"], string> = {
  users: "Utenti",
  tasks: "Task amministrativi",
  deals: "Offerte",
  projects: "Progetti",
  companies: "Aziende",
  contacts: "Contatti",
  timeEntries: "Registrazioni ore",
};

function MaintenanceSection() {
  const { t } = useTranslation();
  const confirm = useConfirm();
  const queryClient = useQueryClient();
  const [message, setMessage] = useState("");
  const { data } = useQuery({
    queryKey: ["maintenance"],
    queryFn: () => api<MaintenanceState>("/api/maintenance"),
    refetchInterval: 30_000,
  });
  const toggle = useMutation({
    mutationFn: (input: SetMaintenanceInput) =>
      api<MaintenanceState>("/api/admin/maintenance", { method: "POST", body: input }),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ["maintenance"] }),
  });
  const active = data?.active === true;

  return (
    <section className="rounded-lg border bg-card p-4">
      <h2 className="mb-3 flex items-center gap-2 font-semibold">
        <SectionIcon tone="amber">
          <Power className="size-4" />
        </SectionIcon>
        {t("Manutenzione")}
      </h2>
      <p className="text-sm text-muted-foreground">
        {active
          ? t(
              "KeelOps è OFFLINE: gli utenti vedono la pagina di cortesia. Gli amministratori continuano a entrare.",
            )
          : t(
              "Mettendo KeelOps offline, gli utenti vedono una pagina di cortesia finché non lo riporti online. Il deploy lo fa da sé.",
            )}
      </p>
      {!active && (
        <input
          className="mt-3 w-full rounded-md border bg-background px-3 py-1.5 text-sm"
          placeholder={t("Messaggio per la pagina di cortesia (facoltativo)")}
          value={message}
          maxLength={300}
          onChange={(event) => setMessage(event.target.value)}
        />
      )}
      <div className="mt-3">
        <button
          type="button"
          disabled={toggle.isPending}
          className={
            active
              ? "rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground"
              : "rounded-md border border-destructive px-3 py-1.5 text-sm font-medium text-destructive"
          }
          onClick={() => {
            void (async () => {
              if (!active) {
                const ok = await confirm({
                  title: t("Mettere KeelOps offline?"),
                  message: t(
                    "Tutti gli utenti (portali compresi) verranno chiusi fuori finché non lo riporti online.",
                  ),
                  confirmLabel: t("Metti offline"),
                  tone: "danger",
                });
                if (!ok) return;
              }
              toggle.mutate({ active: !active, message: message.trim() || undefined });
            })();
          }}
        >
          {active ? t("Riporta online") : t("Metti offline")}
        </button>
        {active && data?.since && (
          <span className="ml-3 text-xs text-muted-foreground">
            {t("Offline dal {{when}}", { when: new Date(data.since).toLocaleString() })}
          </span>
        )}
      </div>
    </section>
  );
}

export function SystemPage() {
  const { t, i18n } = useTranslation();
  const { data, isLoading } = useQuery({
    queryKey: ["admin-system"],
    queryFn: () => api<SystemInfo>("/api/admin/system"),
  });

  if (isLoading || !data) {
    return <p className="text-sm text-muted-foreground">{t("Caricamento informazioni…")}</p>;
  }

  return (
    <div className="flex max-w-2xl flex-col gap-4">
      <MaintenanceSection />
      <PluginsSection plugins={data.plugins ?? []} />
      {SezioniSistema && <SezioniSistema />}
      <AttachmentStoreSection />
      <section className="rounded-lg border bg-card p-4">
        <h2 className="mb-3 flex items-center gap-2 font-semibold">
          <SectionIcon tone="sky">
            <Database className="size-4" />
          </SectionIcon>
          {t("Database")}
        </h2>
        {/*
          Con due motori possibili, «quale sto guardando» viene prima di ogni
          altro numero del riquadro: un conteggio giusto letto dall'ambiente
          sbagliato è peggio di nessun conteggio.
        */}
        <p className="mb-3 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
          <span className="rounded-full border border-primary/40 bg-primary/5 px-2.5 py-0.5 font-semibold text-primary">
            {data.database.etichetta}
            {data.database.versione ? ` ${data.database.versione}` : ""}
          </span>
          <span className="break-all font-mono text-xs text-muted-foreground">
            {data.database.dove}
          </span>
        </p>
        <div className="grid grid-cols-2 gap-x-6 gap-y-1 text-sm md:grid-cols-3">
          {(Object.keys(COUNT_LABELS) as Array<keyof SystemInfo["counts"]>).map((key) => (
            <p key={key} className="flex justify-between gap-2">
              <span className="text-muted-foreground">{t(COUNT_LABELS[key])}</span>
              <span className="font-medium">{data.counts[key]}</span>
            </p>
          ))}
        </div>
        <p className="mt-3 text-xs text-muted-foreground">
          {t(
            "Dimensione db: {{size}} · Limite upload: {{max}} MB per file (variabile MAX_UPLOAD_MB)",
            { size: formatBytes(data.database.dimensioneBytes), max: data.maxUploadMb },
          )}
        </p>
      </section>

      <section className="rounded-lg border bg-card p-4">
        <h2 className="mb-3 flex items-center gap-2 font-semibold">
          <SectionIcon tone="violet">
            <Layers className="size-4" />
          </SectionIcon>
          {t("Versioni")}
        </h2>
        <p className="mb-1 text-sm">
          {t("Versione installata:")} <span className="font-medium">KeelOps {APP_VERSION}</span>
        </p>
        <p className="mb-3 text-sm">
          {t("Posta in uscita:")} <span className="font-medium">{data.mailTransport}</span>
          {data.mailTransport === "spento" && (
            <span className="text-muted-foreground">
              {" "}
              {t("— le notifiche restano solo in-app")}
            </span>
          )}
        </p>
        {/* Server e frontend separati: girano in due posti diversi e possono
            disallinearsi (una build vecchia in cache, un servizio non riavviato). */}
        <div className="grid gap-x-8 gap-y-4 sm:grid-cols-2">
          <ElencoVersioni titolo={t("Server")} voci={data.versions} />
          <ElencoVersioni titolo={t("Frontend")} voci={WEB_VERSIONS} />
        </div>
      </section>

      {/* **Lo stato dei backup automatici.** Sono due e fanno due lavori
          diversi: l'istantanea di mezzanotte vive dove vivono gli allegati (in
          produzione il bucket, cioè fuori da questa macchina) e contiene il
          solo database; lo zip delle 02:30 contiene database e allegati ma sta
          sul disco di qui — e un disco che muore si porta via anche i propri
          backup. La domanda a cui questa sezione risponde è una sola: l'ultima
          copia di quando è, e quanto pesa. */}
      <section className="rounded-lg border bg-card p-4">
        <h2 className="mb-3 flex items-center gap-2 font-semibold">
          <SectionIcon tone="amber">
            <DatabaseBackup className="size-4" />
          </SectionIcon>
          {t("Backup automatici")}
        </h2>
        {data.backup.error && (
          <p className="mb-2 text-sm text-amber-600 dark:text-amber-500">
            {t("Magazzino non raggiungibile: {{error}}", { error: data.backup.error })}
          </p>
        )}
        <div className="flex flex-col gap-3 text-sm">
          <RigaBackup
            titolo={t("Istantanea del database (mezzanotte, nel magazzino allegati)")}
            file={data.backup.snapshot}
            count={data.backup.snapshotCount}
            bytes={data.backup.snapshotBytes}
            vuoto={t("Nessuna istantanea: la prima arriva stanotte.")}
            locale={i18n.language}
            t={t}
          />
          <RigaBackup
            titolo={
              data.backup.zipConAllegati
                ? t("Zip con database e allegati (02:30, su questo disco)")
                : t("Zip del solo database (02:30, su questo disco)")
            }
            file={data.backup.zip}
            count={data.backup.zipCount}
            bytes={data.backup.zipBytes}
            vuoto={t("Nessuno zip ancora scritto.")}
            locale={i18n.language}
            t={t}
          />
        </div>
        <p className="mt-3 text-xs text-muted-foreground">
          {t("Sia le istantanee sia gli zip più vecchi di {{days}} giorni vengono eliminati.", {
            days: data.backup.retentionDays,
          })}
          {!data.backup.zipConAllegati && (
            <>
              {" "}
              {t(
                "Gli allegati non entrano nello zip: vivono su un magazzino remoto e hanno la loro durabilità.",
              )}
            </>
          )}
        </p>
      </section>

      <section className="rounded-lg border bg-card p-4">
        <h2 className="mb-2 flex items-center gap-2 font-semibold">
          <SectionIcon tone="emerald">
            <HardDrive className="size-4" />
          </SectionIcon>
          {t("Backup manuale")}
        </h2>
        <p className="mb-3 text-sm text-muted-foreground">
          {t(
            "Scarica uno zip con una copia consistente del database (app.db) e di tutti gli allegati caricati (uploads/). Conservalo in un luogo sicuro.",
          )}
        </p>
        <a href="/api/admin/backup">
          <Button>
            <Download className="size-4" /> {t("Scarica backup (.zip)")}
          </Button>
        </a>
      </section>
    </div>
  );
}
