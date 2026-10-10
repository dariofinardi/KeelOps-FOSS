// Copyright (c) 2026 Jugaad s.r.l.
// SPDX-License-Identifier: AGPL-3.0-only

import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import { TaskKind } from "@kancrm/shared";
import { Button } from "@/components/ui/button";
import { Combobox } from "@/components/ui/combobox";
import { Dialog } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/components/ui/toast";
import { useCurrentUser } from "@/features/auth/useAuth";
import { useCompanies } from "@/features/crm/useCrm";
import { useOptions } from "@/features/options/useOptions";
import { useTaskDetail } from "@/features/tasks/useTasks";
import { DealFromTaskContext } from "./deal-from-task-context";
import { useCreateDealFromTask, useDealStages } from "./useDeals";

/** Monta il dialogo una volta sola: chi sta sotto apre con `useCreateDealFromTaskCommand`. */
export function DealFromTaskProvider({ children }: { children: ReactNode }) {
  const [taskId, setTaskId] = useState<string | null>(null);
  return (
    <DealFromTaskContext.Provider value={setTaskId}>
      {children}
      {taskId && <DealFromTaskDialog taskId={taskId} onClose={() => setTaskId(null)} />}
    </DealFromTaskContext.Provider>
  );
}

/**
 * **Un'offerta da un task** (06/10/2026). Titolo e cliente proposti dal task (il
 * cliente è quello del task o del suo progetto), la descrizione è la sua — senza
 * le figure incollate, le toglie il server —, la fase proposta è la vinta. File
 * e chat del task non vanno nell'offerta: fra i suoi allegati ci sarà il link al
 * task, che si apre nel pannello.
 *
 * Il valore è obbligatorio se l'offerta nasce vinta: altrimenti la previsione la
 * conterebbe a zero. Chi non vede le Offerte (un manager dello sviluppo, spesso)
 * non riceve l'elenco delle fasi: l'offerta nasce vinta, ed è ciò che serve.
 */
function DealFromTaskDialog({ taskId, onClose }: { taskId: string; onClose: () => void }) {
  const { t } = useTranslation();
  const toast = useToast();
  const navigate = useNavigate();
  const currentUser = useCurrentUser();
  const { data: task } = useTaskDetail(taskId);
  const stagesQuery = useDealStages();
  const stages = stagesQuery.data;
  const companies = useCompanies("").data?.items;
  const { users } = useOptions({ module: "DEAL" });
  const crea = useCreateDealFromTask();

  const [title, setTitle] = useState("");
  const [stageId, setStageId] = useState("");
  const [companyId, setCompanyId] = useState("");
  const [assigneeId, setAssigneeId] = useState(currentUser.id);
  const [dealValue, setDealValue] = useState("");
  const [error, setError] = useState<string | null>(null);

  // Le proposte arrivano col task: una volta, poi decide chi scrive.
  const [proposto, setProposto] = useState(false);
  useEffect(() => {
    if (!task || proposto) return;
    setTitle(task.title);
    setCompanyId(task.company?.id ?? "");
    setProposto(true);
  }, [task, proposto]);
  useEffect(() => {
    if (stages && !stageId) setStageId(stages.find((s) => s.isWon)?.id ?? "");
  }, [stages, stageId]);

  const fase = stages?.find((s) => s.id === stageId);
  // Senza elenco delle fasi l'offerta nasce vinta (la sceglie il server).
  const vinta = fase ? fase.isWon : true;
  const aziende = [
    ...(task?.company && !(companies ?? []).some((c) => c.id === task.company!.id)
      ? [task.company]
      : []),
    ...(companies ?? []),
  ];

  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    setError(null);
    if (!task) return;
    if (vinta && dealValue.trim() === "") {
      setError(t("Indica il valore: un'offerta vinta senza importo conterebbe zero"));
      return;
    }
    crea.mutate(
      {
        taskId,
        title: title.trim(),
        description: task.description,
        ...(stageId ? { stageId } : {}),
        companyId: companyId || null,
        assigneeId: assigneeId || null,
        dealValue: dealValue.trim() === "" ? null : Number(dealValue),
      },
      {
        onSuccess: ({ id }) => {
          onClose();
          // Chi vede le Offerte la ritrova aperta; gli altri leggono che c'è.
          if (currentUser.canSeeDeals) navigate(`/offerte?deal=${id}`);
          else toast(t("Offerta creata: la segue il commerciale scelto"), "success");
        },
        onError: (err) => setError(err instanceof Error ? err.message : String(err)),
      },
    );
  };

  const selectClass = "h-10 w-full rounded-md border bg-background px-2 text-sm sm:h-9";
  if (task && task.kind === TaskKind.DEAL) return null;

  return (
    <Dialog open onClose={onClose} title={t("Crea offerta da questo task")}>
      <form onSubmit={onSubmit} className="flex flex-col gap-4">
        <p className="text-sm text-muted-foreground">
          {t(
            "L'offerta riceve titolo, descrizione e cliente del task; fra i suoi allegati ci sarà il link al task. File e chat del task restano nel task.",
          )}
        </p>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="dft-title" importance="required">
            {t("Titolo")}
          </Label>
          <Input
            id="dft-title"
            required
            autoFocus
            value={title}
            onChange={(e) => setTitle(e.target.value)}
          />
        </div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="dft-value" importance={vinta ? "required" : "recommended"}>
              {t("Valore (€)")}
            </Label>
            <Input
              id="dft-value"
              type="number"
              min={0}
              step="0.01"
              value={dealValue}
              onChange={(e) => setDealValue(e.target.value)}
            />
          </div>
          {stages && (
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="dft-stage" importance="recommended">
                {t("Fase")}
              </Label>
              <select
                id="dft-stage"
                className={selectClass}
                value={stageId}
                onChange={(e) => setStageId(e.target.value)}
              >
                {stages.map((stage) => (
                  <option key={stage.id} value={stage.id}>
                    {stage.name}
                  </option>
                ))}
              </select>
            </div>
          )}
          <div className="flex flex-col gap-1.5">
            <Label importance="recommended">{t("Cliente")}</Label>
            <Combobox
              value={companyId || null}
              onChange={(id) => setCompanyId(id ?? "")}
              items={aziende.map((company) => ({ id: company.id, label: company.name }))}
              emptyLabel={t("Nessuna")}
              placeholder={t("Cerca un'azienda…")}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label importance="recommended">{t("Commerciale")}</Label>
            <Combobox
              value={assigneeId || null}
              onChange={(id) => setAssigneeId(id ?? "")}
              items={(users ?? []).map((user) => ({ id: user.id, label: user.name }))}
              emptyLabel={t("Nessuno")}
              placeholder={t("Cerca un commerciale…")}
            />
          </div>
        </div>
        {error && <p className="text-sm text-destructive">{error}</p>}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onClose}>
            {t("Annulla")}
          </Button>
          <Button type="submit" disabled={!task || crea.isPending || title.trim() === ""}>
            {t("Crea offerta")}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
