// Copyright (c) 2026 Jugaad s.r.l.
// SPDX-License-Identifier: AGPL-3.0-only

import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, GitMerge } from "lucide-react";
import {
  ACTIVITY_CATEGORY_LABELS,
  type ActivityCategory,
  type TaskStatus,
  type TaskStatusMergePreview,
  type TaskStatusMergeResult,
} from "@kancrm/shared";
import { ApiError, api } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { useConfirm } from "@/components/ui/confirm";
import { useToast } from "@/components/ui/toast";

/**
 * **Fondere due stati** di un'area: i task del primo passano al secondo.
 *
 * Lo stesso dialogo in ogni area, aperto dall'icona accanto al titolo, perché
 * il flusso da rimettere in ordine è quello di quell'area e la mano lo cerca
 * dove l'ha lasciato.
 *
 * Tre cose che questa finestra deve fare bene, essendo un'operazione che non si
 * annulla:
 *
 *  1. **Dire quanti record cambieranno, prima di chiedere.** Il numero è
 *     l'unica cosa che permette di accorgersi di aver scelto lo stato
 *     sbagliato, e si aggiorna appena si scelgono le due tendine.
 *  2. **Dire le conseguenze meno prevedibili**: task che si chiuderanno o
 *     riapriranno, task nel cestino, ricorrenze e fasi pipeline che seguono il
 *     riferimento, contrassegni che passano allo stato di arrivo — e che alla
 *     fine **lo stato di partenza viene eliminato**.
 *  3. **Chiedere due volte**, e la seconda dicendo che non si torna indietro.
 *     Non è cerimonia: la prima conferma si legge come "ho capito quanti", la
 *     seconda come "ho capito che è definitivo".
 */
export function MergeStatusesButton({
  category,
  statuses,
}: {
  category: ActivityCategory;
  statuses: TaskStatus[];
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  // Con un solo stato non c'è niente da fondere: il comando non si offre.
  if (statuses.length < 2) return null;
  return (
    <>
      <Button
        variant="ghost"
        size="icon"
        title={t("Fondi due stati di quest'area")}
        aria-label={t("Fondi due stati di quest'area")}
        onClick={() => setOpen(true)}
      >
        <GitMerge className="size-4 text-primary" />
      </Button>
      {open && (
        <MergeStatusesDialog
          category={category}
          statuses={statuses}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}

function MergeStatusesDialog({
  category,
  statuses,
  onClose,
}: {
  category: ActivityCategory;
  statuses: TaskStatus[];
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const confirm = useConfirm();
  const toast = useToast();
  const queryClient = useQueryClient();
  const [sourceId, setSourceId] = useState("");
  const [targetId, setTargetId] = useState("");
  const [error, setError] = useState<string | null>(null);

  const source = statuses.find((status) => status.id === sourceId);
  const target = statuses.find((status) => status.id === targetId);
  const ready = Boolean(source && target && sourceId !== targetId);

  // L'anteprima arriva dal server: i conteggi dei task per stato non stanno in
  // questa pagina, e indovinarli sarebbe il modo più sicuro di mostrare un
  // numero diverso da quello che verrà scritto.
  const preview = useQuery({
    queryKey: ["task-status-merge-preview", sourceId, targetId],
    enabled: ready,
    queryFn: () =>
      api<TaskStatusMergePreview>(`/api/task-statuses/${sourceId}/merge-preview`, {
        method: "POST",
        body: { targetId },
      }),
  });

  const merge = useMutation({
    mutationFn: () =>
      api<TaskStatusMergeResult>(`/api/task-statuses/${sourceId}/merge`, {
        method: "POST",
        body: { targetId },
      }),
    onSuccess: (result) => {
      void queryClient.invalidateQueries({ queryKey: ["task-statuses"] });
      void queryClient.invalidateQueries({ queryKey: ["tasks"] });
      void queryClient.invalidateQueries({ queryKey: ["dashboard"] });
      toast(
        t("{{count}} task passati a «{{to}}». Lo stato «{{from}}» è stato eliminato.", {
          count: result.migrated,
          from: result.deleted,
          to: target!.name,
        }) +
          (result.flagsMoved.length > 0
            ? " " + t("Contrassegni spostati: {{flags}}.", { flags: result.flagsMoved.join(", ") })
            : ""),
        "success",
        { duration: 8000 },
      );
      onClose();
    },
    onError: (err) => setError(err instanceof ApiError ? err.message : t("Errore imprevisto")),
  });

  const run = async () => {
    if (!ready || !preview.data) return;
    setError(null);
    const counts = preview.data;

    // Prima domanda: quanti record. È il numero che fa accorgere di uno stato
    // scelto per sbaglio.
    const capito = await confirm({
      title: t("Fondere «{{from}}» in «{{to}}»?", { from: source!.name, to: target!.name }),
      message: [
        t("{{count}} task verranno modificati.", { count: counts.tasks }),
        counts.trashed > 0
          ? t("Più {{count}} nel cestino, che seguono lo stato.", { count: counts.trashed })
          : null,
        counts.closes ? t("I task risulteranno CHIUSI: lo stato di arrivo è chiuso.") : null,
        counts.reopens ? t("I task torneranno APERTI: lo stato di arrivo è aperto.") : null,
        t("Poi «{{from}}» verrà eliminato.", { from: source!.name }),
      ]
        .filter(Boolean)
        .join(" "),
      confirmLabel: t("Avanti"),
    });
    if (!capito) return;

    // Seconda domanda: che non si torna indietro. Separata dalla prima perché
    // sono due cose diverse da capire, e una sola finestra le fa leggere come una.
    const sicuro = await confirm({
      title: t("Confermi? L'operazione non è reversibile"),
      message: t(
        "Non esiste un annulla: lo stato «{{from}}» verrà eliminato, e per tornare indietro bisognerebbe ricrearlo e riportarci a mano ogni task. Ogni task riceverà una riga di storico con la migrazione.",
        { from: source!.name },
      ),
      confirmLabel: t("Fondi definitivamente"),
      tone: "danger",
    });
    if (!sicuro) return;
    merge.mutate();
  };

  const options = (exclude: string) =>
    statuses
      .filter((status) => status.id !== exclude)
      .map((status) => (
        <option key={status.id} value={status.id}>
          {status.name}
          {status.isClosed ? ` — ${t("chiuso")}` : ""}
        </option>
      ));

  return (
    <Dialog
      open
      onClose={onClose}
      title={t("Fondi stati — {{category}}", {
        category: t(ACTIVITY_CATEGORY_LABELS[category]),
      })}
    >
      <div className="flex flex-col gap-4">
        <p className="text-sm text-muted-foreground">
          {t(
            "I task dello stato di partenza passano allo stato di arrivo. Al termine lo stato di partenza viene eliminato, perché resta vuoto.",
          )}
        </p>

        <div className="grid gap-3 sm:grid-cols-2">
          <div className="flex flex-col gap-1.5">
            <Label importance="required" htmlFor="merge-source">
              {t("Stato di partenza")}
            </Label>
            <select
              id="merge-source"
              data-autofocus
              className="w-full rounded-md border bg-background px-3 text-sm"
              value={sourceId}
              onChange={(event) => setSourceId(event.target.value)}
            >
              <option value="">{t("Scegli…")}</option>
              {options(targetId)}
            </select>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label importance="required" htmlFor="merge-target">
              {t("Stato di arrivo")}
            </Label>
            <select
              id="merge-target"
              className="w-full rounded-md border bg-background px-3 text-sm"
              value={targetId}
              onChange={(event) => setTargetId(event.target.value)}
            >
              <option value="">{t("Scegli…")}</option>
              {options(sourceId)}
            </select>
          </div>
        </div>

        {ready && preview.data && <MergeSummary preview={preview.data} />}
        {ready && preview.isLoading && (
          <p className="text-sm text-muted-foreground">{t("Conto i task…")}</p>
        )}
        {error && <p className="text-sm text-destructive">{error}</p>}

        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={onClose}>
            {t("Annulla")}
          </Button>
          <Button
            variant="destructive"
            disabled={!ready || !preview.data || merge.isPending}
            onClick={() => void run()}
          >
            <GitMerge className="size-4" />
            {t("Fondi")}
          </Button>
        </div>
      </div>
    </Dialog>
  );
}

/** Cosa cambierà: il numero grande, e sotto quello che non si vedrebbe da solo. */
function MergeSummary({ preview }: { preview: TaskStatusMergePreview }) {
  const { t } = useTranslation();
  const warnings = [
    preview.trashed > 0
      ? t("{{count}} task nel cestino seguono lo stato (o non si svuoterebbe).", {
          count: preview.trashed,
        })
      : null,
    preview.closes ? t("I task risulteranno chiusi: lo stato di arrivo è uno stato chiuso.") : null,
    preview.reopens ? t("I task torneranno aperti: lo stato di arrivo è uno stato aperto.") : null,
    preview.recurrences > 0
      ? t(
          "{{count}} ricorrenze nascono in questo stato: il riferimento passa a quello di arrivo.",
          {
            count: preview.recurrences,
          },
        )
      : null,
    preview.dealStages > 0
      ? t("{{count}} fasi pipeline generano un task in questo stato: seguono anche loro.", {
          count: preview.dealStages,
        })
      : null,
    preview.flags.length > 0
      ? t("I contrassegni passano allo stato di arrivo: {{flags}}.", {
          flags: preview.flags.join(", "),
        })
      : null,
    t("Lo stato di partenza verrà eliminato: resta vuoto."),
    t("Non partono notifiche: è una manutenzione della configurazione."),
  ].filter((line): line is string => line !== null);

  return (
    <div className="rounded-lg border bg-muted/40 p-3">
      <p className="text-sm">
        <strong className="text-base tabular-nums">{preview.tasks}</strong>{" "}
        {t("task verranno modificati.")}
      </p>
      <ul className="mt-2 flex flex-col gap-1">
        {warnings.map((line) => (
          <li key={line} className="flex items-start gap-1.5 text-xs text-muted-foreground">
            <AlertTriangle className="mt-0.5 size-3.5 shrink-0 text-amber-600 dark:text-amber-500" />
            {line}
          </li>
        ))}
      </ul>
    </div>
  );
}
