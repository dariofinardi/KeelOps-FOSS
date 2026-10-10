// Copyright (c) 2026 Jugaad s.r.l.
// SPDX-License-Identifier: AGPL-3.0-only

import { useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { ArrowRight, X } from "lucide-react";
import type { TaskDetail } from "@kancrm/shared";
import { ApiError } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Combobox } from "@/components/ui/combobox";
import { Label } from "@/components/ui/label";
import { useToast } from "@/components/ui/toast";
import { useTasks, useUpdateTask } from "./useTasks";

export function SequenceSection({
  task,
  onOpenTask,
}: {
  task: TaskDetail;
  onOpenTask?: (id: string) => void;
}) {
  const { t } = useTranslation();
  const updateTask = useUpdateTask();
  const queryClient = useQueryClient();
  const toast = useToast();
  // Il propedeutico ha senso dentro lo stesso contesto: un task di progetto si
  // concatena agli altri del progetto, un task collegato a un'offerta agli altri
  // della stessa offerta, un task dello scadenzario "puro" agli altri liberi.
  // Senza questo, un task legato a un'offerta vedrebbe tutti i task amministrativi.
  const inProject = task.kind === "PROJECT" && task.projectId;
  const dealId = task.relatedDeal?.id ?? null;
  const { data: allTasks } = useTasks(
    inProject
      ? { projectId: task.projectId!, includeClosed: true, pageSize: 1000 }
      : { includeClosed: true, pageSize: 1000 },
  );
  const candidates = (allTasks?.items ?? []).filter((t) => {
    if (t.id === task.id) return false;
    if (inProject) return true;
    if (dealId) return t.relatedDeal?.id === dealId;
    // Scadenzario "puro": niente task legati a un'offerta.
    return !t.relatedDeal;
  });

  // Il "successivo" è l'altra faccia del propedeutico: si imposta scrivendo questo
  // task come predecessore dell'altro. Cambiando un ALTRO record va rinfrescato
  // anche questo dettaglio, che è quello che elenca i successori.
  const linkSuccessor = (successorId: string | null, previousId?: string) => {
    const targetId = successorId ?? previousId;
    if (!targetId) return;
    updateTask.mutate(
      { id: targetId, predecessorId: successorId ? task.id : null },
      {
        onSuccess: () => queryClient.invalidateQueries({ queryKey: ["task", task.id] }),
        // Il server rifiuta le catene circolari: mostralo invece di restare zitti.
        onError: (error) =>
          toast(error instanceof ApiError ? error.message : t("Errore imprevisto"), "error"),
      },
    );
  };

  // Candidati come successivo: né i successori già collegati né il propedeutico
  // di questo task (sarebbe un anello immediato).
  const successorCandidates = candidates.filter(
    (t) => t.predecessorId !== task.id && t.id !== task.predecessor?.id,
  );

  return (
    <section className="mt-6">
      <h3 className="mb-2 flex items-center gap-1.5 text-sm font-semibold">
        <ArrowRight className="size-4" /> {t("Sequenza")}
      </h3>
      <div className="flex flex-col gap-2 rounded-md border p-3">
        <div className="flex flex-col gap-1.5">
          <Label>{t("Task propedeutico (da completare prima di questo)")}</Label>
          <Combobox
            value={task.predecessor?.id ?? null}
            onChange={(predecessorId) => {
              // Cambiando o togliendo il propedeutico, anche il pannello del
              // VECCHIO va rinfrescato: nei suoi successori questo task non
              // c'è più (il nuovo lo rinfresca già useUpdateTask).
              const previousId = task.predecessor?.id;
              updateTask.mutate(
                { id: task.id, predecessorId },
                {
                  onSuccess: () => {
                    if (previousId && previousId !== predecessorId) {
                      void queryClient.invalidateQueries({ queryKey: ["task", previousId] });
                    }
                  },
                },
              );
            }}
            items={candidates.map((t) => ({ id: t.id, label: t.title }))}
            placeholder={t("Cerca un task…")}
            emptyLabel={t("Nessuno")}
          />
          <p className="text-xs text-muted-foreground">
            {inProject
              ? t("Tra i task di questo progetto.")
              : dealId
                ? t("Tra i task collegati alla stessa offerta.")
                : t("Tra i task dello scadenzario non collegati a un'offerta.")}
          </p>
          {task.predecessor && !task.predecessor.isClosed && (
            <p className="text-xs text-amber-600">
              {t("⚠ Il task propedeutico non è ancora completato.")}
            </p>
          )}
        </div>
        <div className="flex flex-col gap-1.5 border-t pt-2">
          <Label>{t("Task successivo (da fare dopo questo)")}</Label>
          <Combobox
            value={null}
            onChange={(successorId) => linkSuccessor(successorId)}
            items={successorCandidates.map((t) => ({ id: t.id, label: t.title }))}
            placeholder={t("Aggiungi un task successivo…")}
            emptyLabel={t("Nessuno")}
          />
          {task.successors.length > 0 ? (
            <ul className="mt-1 flex flex-col gap-1">
              {task.successors.map((successor) => (
                <li key={successor.id} className="flex items-center gap-1">
                  <button
                    className="inline-flex min-w-0 flex-1 items-center gap-1.5 text-left text-sm text-foreground hover:underline"
                    onClick={() => onOpenTask?.(successor.id)}
                  >
                    <ArrowRight className="size-3.5 shrink-0 text-muted-foreground" />
                    <span className="truncate">{successor.title}</span>
                    {successor.isClosed && (
                      <span className="shrink-0 text-xs text-muted-foreground">
                        {t("(completato)")}
                      </span>
                    )}
                  </button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="size-7 shrink-0"
                    title={t("Togli dalla sequenza")}
                    disabled={updateTask.isPending}
                    onClick={() => linkSuccessor(null, successor.id)}
                  >
                    <X className="size-3.5" />
                  </Button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-xs text-muted-foreground">
              {t("Nessun task successivo: sceglilo qui sopra o trascinalo sulla sequenza.")}
            </p>
          )}
        </div>
      </div>
    </section>
  );
}
