// Copyright (c) 2026 Jugaad s.r.l.
// SPDX-License-Identifier: AGPL-3.0-only

import { useTranslation } from "react-i18next";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { FileText, Hourglass, Loader2, Receipt, Trash2, X, Newspaper } from "lucide-react";
import type { LlmJob, LlmJobState } from "@kancrm/shared";
import { ApiError, api } from "@/lib/api";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { SectionIcon } from "@/components/ui/section-icon";
import { useConfirm } from "@/components/ui/confirm";
import { useToast } from "@/components/ui/toast";
import { formatDateTime } from "@/features/tasks/task-utils";

/**
 * **La coda dei lavori del modello**: chi ha chiesto cosa, a che punto è, e il
 * modo di fermarla. Nata per le note di rilascio, dal 21/08/2026 ospita anche
 * la lettura degli allegati di un'offerta vinta — due lavori diversi con lo
 * stesso vincolo, e un vincolo solo merita un pannello solo. Pagina sua, aperta a chi **guida qualcosa** — un gruppo o
 * un progetto, l'ambito non conta: è una risorsa condivisa e lenta, e
 * sorvegliarla è un compito di chi guida del lavoro, non di chi amministra il
 * sistema.
 *
 * Serve perché la generazione è lenta per costruzione — una sintesi costa un
 * paio di secondi e Ollama ne serve una per volta — quindi "non è ancora
 * arrivata" ha due significati diversi (è in fila / si è rotta) e senza questo
 * pannello non si distinguono.
 *
 * Si aggiorna da sola finché c'è qualcosa in ballo: una coda che sta ferma
 * mentre il lavoro procede è peggio di nessuna coda, perché la si crede
 * bloccata. Quando non c'è più niente in corso smette, invece di interrogare il
 * server per sempre.
 */

const ATTIVI: LlmJobState[] = ["queue", "running", "generating", "removing"];

const ETICHETTE: Record<LlmJobState, string> = {
  queue: "In coda",
  running: "Avviata",
  generating: "Generazione",
  removing: "In arresto",
  done: "Consegnata",
  failed: "Non riuscita",
  cancelled: "Annullata",
};

const TONI: Record<LlmJobState, string> = {
  queue: "bg-muted text-muted-foreground",
  running: "bg-sky-100 text-sky-800 dark:bg-sky-950 dark:text-sky-300",
  generating: "bg-sky-100 text-sky-800 dark:bg-sky-950 dark:text-sky-300",
  removing: "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300",
  done: "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300",
  failed: "bg-destructive/10 text-destructive",
  cancelled: "bg-muted text-muted-foreground",
};

export function LlmQueuePage() {
  const { t } = useTranslation();
  const toast = useToast();
  const confirm = useConfirm();
  const queryClient = useQueryClient();

  const jobs = useQuery({
    queryKey: ["llm-jobs"],
    queryFn: () => api<{ jobs: LlmJob[] }>("/api/llm-jobs"),
    // Finché qualcosa è in ballo si guarda spesso; poi si smette.
    refetchInterval: (query) =>
      (query.state.data?.jobs ?? []).some((job) => ATTIVI.includes(job.state)) ? 3000 : false,
  });

  const cancel = useMutation({
    mutationFn: (id: string) => api(`/api/llm-jobs/${id}`, { method: "DELETE" }),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ["llm-jobs"] }),
    onError: (error) =>
      toast(error instanceof ApiError ? error.message : t("Errore imprevisto"), "error"),
  });

  const ferma = async (job: LlmJob) => {
    const inCorso = job.state === "running" || job.state === "generating";
    if (inCorso) {
      // Fermare a metà butta il lavoro già fatto: si chiede, ma una volta sola
      // — non è un'operazione distruttiva su dati, solo tempo perso.
      const ok = await confirm({
        title: t("Fermare la generazione?"),
        message: t(
          "Il lavoro fatto finora viene buttato e non arriverà nessuna email. Ci vuole qualche secondo prima che si fermi davvero.",
        ),
        confirmLabel: t("Ferma"),
        tone: "danger",
      });
      if (!ok) return;
    }
    cancel.mutate(job.id);
  };

  const elenco = jobs.data?.jobs ?? [];

  return (
    <div className="flex flex-col gap-4">
      <header>
        <h2 className="flex items-center gap-2 text-xl font-semibold">
          <SectionIcon tone="sky">
            <Hourglass className="size-4" />
          </SectionIcon>
          {t("Coda AI")}
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">
          {t(
            "I lavori si eseguono uno alla volta: il modello serve una richiesta per volta, e metterne più in parallelo le rallenterebbe tutte.",
          )}
        </p>
      </header>

      {elenco.length === 0 ? (
        <p className="rounded-lg border bg-card p-6 text-center text-sm text-muted-foreground">
          {t("Nessuna richiesta in corso.")}
        </p>
      ) : (
        <div className="rounded-lg border bg-card">
          {/*
            Niente barra di scorrimento orizzontale: sotto `md` ogni richiesta è
            una scheda, sopra è una riga di tabella. Una tabella a larghezza
            minima fissa la produceva anche su schermi larghi, dentro il
            riquadro (19/08/2026) — e la regola di casa è che a scorrere in
            orizzontale non dev'essere né la pagina né ciò che si può impaginare
            in un altro modo.
          */}
          <table className="hidden w-full text-sm md:table">
            <thead>
              <tr className="border-b text-left text-xs uppercase text-muted-foreground">
                <th className="p-3 font-medium">{t("Stato")}</th>
                <th className="p-3 font-medium">{t("Lavoro")}</th>
                <th className="p-3 font-medium">{t("Di cosa")}</th>
                <th className="p-3 font-medium">{t("Dettaglio")}</th>
                <th className="p-3 font-medium">{t("Richiesta da")}</th>
                <th className="p-3 font-medium">{t("Quando")}</th>
                <th className="p-3" />
              </tr>
            </thead>
            <tbody>
              {elenco.map((job) => (
                <tr key={job.id} className="border-b last:border-0">
                  <td className="p-3">
                    <StateBadge state={job.state} />
                  </td>
                  <td className="p-3">
                    <KindBadge kind={job.kind} />
                  </td>
                  <td className="min-w-0 p-3">
                    <span className="block truncate">{job.title}</span>
                  </td>
                  <td className="p-3 text-muted-foreground">{job.subtitle}</td>
                  <td className="p-3">{job.userName}</td>
                  <td className="whitespace-nowrap p-3 text-xs text-muted-foreground">
                    {formatDateTime(job.requestedAt)}
                  </td>
                  <td className="p-3 text-right">
                    <StopButton
                      job={job}
                      onStop={() => void ferma(job)}
                      pending={cancel.isPending}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          <ul className="flex flex-col md:hidden">
            {elenco.map((job) => (
              <li key={job.id} className="flex flex-col gap-1.5 border-b p-3 last:border-0">
                <div className="flex items-start justify-between gap-2">
                  <span className="min-w-0 flex-1 font-medium">{job.title}</span>
                  <StopButton job={job} onStop={() => void ferma(job)} pending={cancel.isPending} />
                </div>
                <StateBadge state={job.state} />
                <p className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                  <KindBadge kind={job.kind} /> {job.subtitle} · {job.userName}
                </p>
                <p className="text-xs text-muted-foreground">{formatDateTime(job.requestedAt)}</p>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

/**
 * Di che lavoro si tratta. Due tipi soltanto, quindi un'icona con la sua
 * parola: una tabella dove le righe si distinguono solo dal testo si legge
 * male, e la coda si guarda di sfuggita.
 */
function KindBadge({ kind }: { kind: LlmJob["kind"] }) {
  const { t } = useTranslation();
  const Icona = kind === "newsletter" ? Newspaper : kind === "release-note" ? FileText : Receipt;
  const etichetta =
    kind === "newsletter"
      ? t("Newsletter")
      : kind === "release-note"
        ? t("Nota di rilascio")
        : t("Allegati offerta");
  return (
    <span className="inline-flex items-center gap-1.5 whitespace-nowrap text-xs text-muted-foreground">
      <Icona className="size-3.5" />
      {etichetta}
    </span>
  );
}

function StateBadge({ state }: { state: LlmJobState }) {
  const { t } = useTranslation();
  const inCorso = state === "running" || state === "generating";
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium",
        TONI[state],
      )}
    >
      {inCorso && <Loader2 className="size-3 animate-spin" />}
      {t(ETICHETTE[state])}
    </span>
  );
}

function StopButton({
  job,
  onStop,
  pending,
}: {
  job: LlmJob;
  onStop: () => void;
  pending: boolean;
}) {
  const { t } = useTranslation();
  const attivo = ATTIVI.includes(job.state);
  return (
    <Button
      variant="ghost"
      size="icon"
      disabled={job.state === "removing" || pending}
      title={attivo ? t("Ferma e togli") : t("Togli dall'elenco")}
      aria-label={attivo ? t("Ferma e togli") : t("Togli dall'elenco")}
      onClick={onStop}
    >
      {attivo ? (
        <X className="size-4 text-destructive" />
      ) : (
        <Trash2 className="size-4 text-muted-foreground" />
      )}
    </Button>
  );
}
