// Copyright (c) 2026 Jugaad s.r.l.
// SPDX-License-Identifier: AGPL-3.0-only

import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Cloud, FolderTree, HardDrive, RefreshCw } from "lucide-react";
import { ApiError, api } from "@/lib/api";
import { formatBytes } from "@/lib/bytes";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SectionIcon } from "@/components/ui/section-icon";
import { useConfirm } from "@/components/ui/confirm";
import { useToast } from "@/components/ui/toast";
import { edizione } from "@/edition/rotte";

/**
 * **Dove vivono gli allegati**, nella pagina Sistema (18/08/2026).
 *
 * Due cose che sembrano una sola e non lo sono:
 *  - la **cartella** dice dove andranno i prossimi file. Si cambia da qui,
 *    come l'indirizzo pubblico della posta;
 *  - lo **spostamento** muove quelli che ci sono già, e si chiede a parte. Se
 *    cambiare il campo trascinasse mille file, la stessa distrazione che oggi
 *    corregge un refuso domani sposterebbe l'archivio.
 *
 * Il **bucket** invece si legge e basta: sta nel `.env` con le credenziali, e
 * cambiare il magazzino di tutti i documenti da un campo in una pagina web è
 * un'operazione che nessuno dovrebbe poter fare per sbaglio.
 */
interface AttachmentInfo {
  backend: "LOCAL" | "GCP";
  dove: string;
  localDir: string;
  localDirSource: "configurazione" | "ambiente";
  uri: string;
  gcpProject: string;
  count: number;
  bytes: number;
  /** Le istantanee del database, che vivono nello stesso magazzino. */
  backupCount: number;
  backupBytes: number;
  /** Quando è stato preso il conteggio. `null` = non è mai stato fatto. */
  countedAt: string | null;
  /** Il conteggio è più vecchio del giro quotidiano. */
  countStale: boolean;
  error: string | null;
  rimastiSulDisco: number;
  /** Estensioni ammesse in più ai clienti del portale, come sono configurate. */
  estensioniInPiu: string;
  /** Quelle che valgono comunque: si mostrano, non si modificano. */
  estensioniDiCasa: string[];
}

interface MoveReport {
  totali: number;
  spostati: number;
  saltati: number;
  byte: number;
  errori: Array<{ key: string; motivo: string }>;
}

/** Quando è stato preso il conteggio, per esteso: è metà dell'informazione. */
const quando = (iso: string, locale: string) =>
  new Date(iso).toLocaleString(locale, { dateStyle: "medium", timeStyle: "short" });

export function AttachmentStoreSection() {
  const { t, i18n } = useTranslation();
  const toast = useToast();
  const confirm = useConfirm();
  const queryClient = useQueryClient();
  const { data } = useQuery({
    queryKey: ["admin-attachments"],
    queryFn: () => api<AttachmentInfo>("/api/admin/attachments"),
  });
  const [dir, setDir] = useState<string | null>(null);
  /** `null` = non toccato: si mostra quello configurato. */
  const [estensioni, setEstensioni] = useState<string | null>(null);
  const [report, setReport] = useState<MoveReport | null>(null);

  const salvaCartella = useMutation({
    mutationFn: (localDir: string) =>
      api<{ localDir: string }>("/api/admin/attachments", { method: "PUT", body: { localDir } }),
    onSuccess: () => {
      setDir(null);
      toast(t("Cartella aggiornata: i prossimi allegati andranno lì."), "success");
      void queryClient.invalidateQueries({ queryKey: ["admin-attachments"] });
    },
    onError: (error) =>
      toast(error instanceof ApiError ? error.message : t("Errore imprevisto"), "error"),
  });

  // Il giro automatico è quotidiano (03:15): questo serve quando si è appena
  // spostato l'archivio, o quando la data del conteggio non convince.
  const salvaEstensioni = useMutation({
    mutationFn: (extensions: string) =>
      api<{ extensions: string[] }>("/api/admin/attachment-extensions", {
        method: "PUT",
        body: { extensions },
      }),
    onSuccess: ({ extensions }) => {
      setEstensioni(null);
      toast(
        extensions.length === 0
          ? t("Nessuna estensione in più: valgono solo quelle di casa.")
          : t("Ammesse in più: {{elenco}}", { elenco: extensions.join(", ") }),
        "success",
      );
      void queryClient.invalidateQueries();
    },
    onError: (errore) =>
      toast(errore instanceof ApiError ? errore.message : t("Errore imprevisto"), "error"),
  });

  const riconta = useMutation({
    mutationFn: () => api("/api/admin/attachments/recount", { method: "POST" }),
    onSuccess: () => {
      toast(t("Conteggio rifatto."), "success");
      void queryClient.invalidateQueries({ queryKey: ["admin-attachments"] });
    },
    onError: (error) =>
      toast(error instanceof ApiError ? error.message : t("Errore imprevisto"), "error"),
  });

  const sposta = useMutation({
    mutationFn: (from: "local" | "gcs") =>
      api<MoveReport>("/api/admin/attachments/move", { method: "POST", body: { from } }),
    onSuccess: (esito) => {
      setReport(esito);
      toast(t("Spostati {{n}} file.", { n: esito.spostati }), "success");
      void queryClient.invalidateQueries({ queryKey: ["admin-attachments"] });
    },
    onError: (error) =>
      toast(error instanceof ApiError ? error.message : t("Errore imprevisto"), "error"),
  });

  if (!data) return null;
  const suBucket = data.backend === "GCP";
  const cartella = dir ?? data.localDir;
  const estensioniScritte = estensioni ?? data.estensioniInPiu;

  return (
    <section className="rounded-lg border bg-card p-4">
      <h2 className="mb-3 flex items-center gap-2 font-semibold">
        <SectionIcon tone="emerald">
          {suBucket ? <Cloud className="size-4" /> : <HardDrive className="size-4" />}
        </SectionIcon>
        {t("Allegati")}
      </h2>

      <p className="text-sm">
        {t("Magazzino attivo")}: <span className="font-medium">{data.dove}</span>
      </p>
      {/* Il numero **con la data in cui è stato preso**: elencare un bucket
          costa, quindi si conta una volta al giorno invece che a ogni apertura
          di questa pagina, e un numero senza la sua data non si sa se valga
          ancora. Le istantanee del database stanno nello stesso magazzino ma si
          contano a parte: se lo spazio cresce, la domanda è se a crescere siano
          i documenti o le copie notturne. */}
      <p className="mt-1 text-xs text-muted-foreground">
        {data.error
          ? t("Non raggiungibile: {{error}}", { error: data.error })
          : data.countedAt
            ? `${t("{{count}} file, {{size}}", {
                count: data.count,
                size: formatBytes(data.bytes),
              })} — ${t("più {{n}} istantanee del database ({{size}})", {
                n: data.backupCount,
                size: formatBytes(data.backupBytes),
              })}`
            : t("Spazio non ancora conteggiato.")}
      </p>
      <p className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
        {data.countedAt && (
          <span className={data.countStale ? "text-amber-600 dark:text-amber-500" : undefined}>
            {t("Contato il {{quando}}", { quando: quando(data.countedAt, i18n.language) })}
            {data.countStale && ` — ${t("più vecchio di un giorno")}`}
          </span>
        )}
        <Button
          variant="ghost"
          size="sm"
          className="h-6 px-2"
          disabled={riconta.isPending}
          onClick={() => riconta.mutate()}
        >
          <RefreshCw className={`size-3.5 ${riconta.isPending ? "animate-spin" : ""}`} />
          {t("Riconta adesso")}
        </Button>
      </p>

      {/* La cartella: si cambia solo quando i file stanno sul disco. Con il
          bucket acceso resta scritta, ma è il posto da cui si spostano i file. */}
      <div className="mt-4 flex flex-col gap-1.5">
        <Label htmlFor="attachments-dir">{t("Cartella su disco")}</Label>
        <div className="flex flex-wrap gap-2">
          <Input
            id="attachments-dir"
            className="min-w-0 flex-1 font-mono text-xs"
            value={cartella}
            spellCheck={false}
            onChange={(e) => setDir(e.target.value)}
          />
          <Button
            variant="outline"
            disabled={salvaCartella.isPending || dir === null || dir === data.localDir}
            onClick={() => salvaCartella.mutate(cartella)}
          >
            <FolderTree className="size-4" /> {t("Usa questa cartella")}
          </Button>
        </div>
        <p className="text-xs text-muted-foreground">
          {data.localDirSource === "ambiente"
            ? t("Valore di partenza dalla variabile UPLOADS_DIR. Percorso assoluto.")
            : t("Scelta da qui. Percorso assoluto; i file già caricati non si spostano da soli.")}
        </p>
      </div>

      {/* Only with the ticket module: the portal is where clients attach files (08/10/2026). */}
      {edizione.moduli.has("ticket") && (
        <>
          {/*
            I formati che un **cliente del portale** può allegare aprendo o lavorando
            una richiesta. Gli interni non hanno limiti. L'elenco di casa vale
            comunque; qui si aggiunge quello che nasce con i prodotti — `.dwg`,
            `.step` — senza aspettare un rilascio (21/08/2026).
          */}
          <div className="mt-4 flex flex-col gap-1.5 border-t pt-4">
            <Label htmlFor="attachments-ext">{t("Estensioni ammesse in più ai clienti")}</Label>
            <div className="flex flex-wrap gap-2">
              <Input
                id="attachments-ext"
                className="min-w-0 flex-1 font-mono text-xs"
                value={estensioniScritte}
                spellCheck={false}
                placeholder=".dwg .step"
                onChange={(e) => setEstensioni(e.target.value)}
              />
              <Button
                variant="outline"
                disabled={salvaEstensioni.isPending || estensioni === null}
                onClick={() => salvaEstensioni.mutate(estensioniScritte)}
              >
                {t("Salva")}
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              {t(
                "Separate da spazi o virgole; il punto e le maiuscole non contano. Valgono sempre, comunque: {{elenco}}.",
                { elenco: data.estensioniDiCasa.join(" ") },
              )}
            </p>
          </div>
        </>
      )}

      {/* Lo spostamento: da dove sono i file a dove dice la configurazione. */}
      <div className="mt-4 flex flex-wrap items-center gap-2 border-t pt-4">
        <Button
          variant="outline"
          disabled={sposta.isPending}
          onClick={() => {
            void confirm({
              title: t("Spostare i file?"),
              message: t(
                'I file vengono copiati in "{{dove}}" e tolti da dove sono ora, uno per volta. Si può rilanciare: quello che è già arrivato non si ricopia.',
                { dove: data.dove },
              ),
              confirmLabel: t("Sposta"),
            }).then((ok) => {
              if (ok) sposta.mutate(suBucket ? "local" : "local");
            });
          }}
        >
          {sposta.isPending ? t("Spostamento…") : t("Sposta qui i file dal disco")}
        </Button>
        {suBucket && (
          <Button
            variant="outline"
            disabled={sposta.isPending}
            onClick={() => sposta.mutate("gcs")}
            title={t("Riporta indietro i file dal bucket alla cartella")}
          >
            {t("…oppure dal bucket")}
          </Button>
        )}
        {suBucket && data.rimastiSulDisco > 0 && (
          <span className="text-xs text-amber-700 dark:text-amber-400">
            {t("{{count}} file sono ancora nella cartella locale.", {
              count: data.rimastiSulDisco,
            })}
          </span>
        )}
      </div>

      {report && (
        <p className="mt-2 text-xs text-muted-foreground">
          {t("Spostati {{spostati}} di {{totali}} ({{size}}), già presenti {{saltati}}.", {
            spostati: report.spostati,
            totali: report.totali,
            size: formatBytes(report.byte),
            saltati: report.saltati,
          })}
          {report.errori.length > 0 && (
            <span className="block text-destructive">
              {t("Non riusciti: {{n}} — {{primo}}", {
                n: report.errori.length,
                primo: report.errori[0]!.motivo,
              })}
            </span>
          )}
        </p>
      )}

      {/* Il bucket si legge, non si tocca: sta nel `.env` con le credenziali. */}
      <div className="mt-4 border-t pt-4 text-xs text-muted-foreground">
        <p>
          {t("Bucket Google Cloud")}:{" "}
          <span className="font-mono">{data.uri || t("non configurato")}</span>
          {data.gcpProject && ` · ${t("progetto")} ${data.gcpProject}`}
        </p>
        <p className="mt-1">
          {t(
            "Si imposta nel file .env (ATTACHMENT, ATTACHMENT_URI, ATTACHMENT_GCP_PROJECT) e vale dal riavvio. Le credenziali non stanno lì: si usa il service account della macchina.",
          )}
        </p>
      </div>
    </section>
  );
}
