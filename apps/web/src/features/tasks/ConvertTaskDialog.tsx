// Copyright (c) 2026 Jugaad s.r.l.
// SPDX-License-Identifier: AGPL-3.0-only

import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  ACTIVITY_CATEGORY_LABELS,
  ActivityCategory,
  equivalentStatusId,
  statusCategoryOf,
  TaskKind,
  type ActivityType,
  type TaskDetail,
} from "@kancrm/shared";
import { Dialog } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Combobox } from "@/components/ui/combobox";
import { cn } from "@/lib/utils";
import { useCurrentUser } from "@/features/auth/useAuth";
import { DealCombobox } from "@/features/deals/DealCombobox";
import { useOptions } from "@/features/options/useOptions";
import type { OptionsModule } from "@/features/options/rules";
import { ActivityTypeSelect, useActivityTypes } from "./activity-types";
import { UserSelect } from "./UserSelect";
import { useTaskStatuses, useUpdateTask } from "./useTasks";

/** Le tre appartenenze di un task: un'offerta, un progetto, o lo scadenzario. */
type Destination = "deal" | "project" | "admin";

const DEST_LABEL: Record<Destination, string> = {
  deal: "Offerta",
  project: "Progetto",
  admin: "Amministrativo",
};

const DEST_MODULE: Record<Destination, OptionsModule> = {
  deal: "DEAL",
  project: "PROJECT",
  admin: "ADMIN",
};

/** Dove sta ora il task: è la destinazione preselezionata (e il no-op da evitare). */
function currentDestination(task: TaskDetail): Destination {
  if (task.projectId) return "project";
  if (task.relatedDeal) return "deal";
  return "admin";
}

/**
 * Il modulo (TaskKind) in cui vive un task con quella appartenenza: un task
 * d'offerta e uno amministrativo restano nello scadenzario (ADMIN) — l'offerta è
 * un collegamento —, un task di sviluppo è di progetto.
 */
function destinationKind(dest: Destination): TaskKind {
  return dest === "project" ? TaskKind.PROJECT : TaskKind.ADMIN;
}

/**
 * Tipo di attività di partenza per una destinazione: si tiene quello attuale se
 * è già del mestiere giusto, altrimenti il primo di quella categoria.
 *
 * Un task d'offerta è **commerciale** (categoria SALES): lo decide il tipo di
 * attività, perché il modulo di un task d'offerta resta lo scadenzario. Per
 * questo la destinazione "Offerta" parte da un tipo SALES vero (non "Generale",
 * che nello scadenzario varrebbe amministrativo).
 */
function defaultTypeId(dest: Destination, task: TaskDetail, types: ActivityType[]): string {
  const current = task.activityType;
  if (dest === "deal") {
    if (current?.category === ActivityCategory.SALES) return current.id;
    return types.find((t) => t.category === ActivityCategory.SALES)?.id ?? "";
  }
  const wanted = dest === "project" ? ActivityCategory.DEV : ActivityCategory.ADMIN;
  // Per sviluppo/amministrativo va bene anche un tipo Generale (trasversale).
  if (current && (current.category === wanted || current.category === ActivityCategory.GENERAL)) {
    return current.id;
  }
  return "";
}

/**
 * **Converti / Sposta** un task tra le sue appartenenze — offerta, progetto,
 * scadenzario — mostrando e lasciando correggere la mappatura di tipo e stato.
 *
 * Ogni appartenenza ha il suo mestiere: offerta = commerciale (SALES), progetto
 * = sviluppo (DEV), amministrativo (ADMIN). Cambiando appartenenza lo stato va
 * rimappato: il default è l'equivalente (`equivalentStatusId`, la stessa regola
 * del server) e si può cambiare prima di confermare. La categoria degli stati
 * segue il **tipo scelto**, così scegliere un tipo commerciale porta agli stati
 * commerciali; nessun accostamento che il server poi rifiuterebbe.
 *
 * **Chi converte diventa supervisore** e sceglie l'assegnatario, ma solo tra chi
 * ha i privilegi giusti sulla destinazione: per un progetto i suoi membri, per
 * offerta/scadenzario chi vede quel modulo. Cambiando destinazione l'assegnatario
 * si azzera, così non resta impostato qualcuno che nel nuovo contesto non
 * potrebbe vederlo.
 *
 * Un solo PATCH fa tutto: il server sposta di modulo, rimappa e — entrando in un
 * progetto — stacca l'offerta; uscire da un progetto resta riservato al manager.
 */
export function ConvertTaskDialog({ task, onClose }: { task: TaskDetail; onClose: () => void }) {
  const { t } = useTranslation();
  const currentUser = useCurrentUser();
  const updateTask = useUpdateTask();
  const { data: statuses } = useTaskStatuses();
  const { data: activityTypes } = useActivityTypes();
  const types = activityTypes ?? [];
  const allStatuses = statuses ?? [];

  const initial = currentDestination(task);
  const [destination, setDestination] = useState<Destination>(initial);
  const [dealId, setDealId] = useState<string | null>(task.relatedDeal?.id ?? null);
  const [projectId, setProjectId] = useState<string | null>(task.projectId ?? null);
  const [activityTypeId, setActivityTypeId] = useState(() => defaultTypeId(initial, task, types));
  const [statusId, setStatusId] = useState("");
  const [assigneeId, setAssigneeId] = useState(task.assignee?.id ?? "");

  // Persone e progetti già filtrati per il modulo di destinazione (regole di casa
  // in un posto solo): per un progetto i suoi membri stanno in cima.
  const options = useOptions({
    module: DEST_MODULE[destination],
    projectId: destination === "project" ? projectId : null,
    task,
  });
  // Assegnabili col privilegio giusto: in un progetto solo chi ne è membro;
  // altrove chi vede quel modulo. (I membri portano solo l'id: si filtrano gli
  // utenti col nome tenendo quelli del progetto.)
  const memberIds = new Set((options.projectMembers ?? []).map((m) => m.userId));
  const assigneeUsers =
    destination === "project" ? options.users.filter((u) => memberIds.has(u.id)) : options.users;

  // La categoria degli stati segue il tipo scelto (e, senza tipo, il modulo della
  // destinazione): scegliere un tipo commerciale porta agli stati commerciali.
  const selectedType = types.find((t) => t.id === activityTypeId) ?? null;
  const targetCategory = statusCategoryOf({
    activityType: selectedType,
    kind: destinationKind(destination),
  });
  const targetStatuses = allStatuses.filter((s) => s.category === targetCategory);

  // Quando cambia la categoria di destinazione, lo stato torna all'equivalente —
  // a meno che quello scelto sia già valido lì (l'utente l'aveva corretto a mano).
  useEffect(() => {
    setStatusId((prev) =>
      prev && targetStatuses.some((s) => s.id === prev)
        ? prev
        : (equivalentStatusId(task.status, allStatuses, targetCategory) ?? ""),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [targetCategory, statuses]);

  const changeDestination = (dest: Destination) => {
    setDestination(dest);
    setActivityTypeId(defaultTypeId(dest, task, types));
    setAssigneeId(""); // contesto nuovo: si riscegli chi ha i privilegi giusti
  };

  const missingTarget =
    (destination === "deal" && !dealId) || (destination === "project" && !projectId);
  const unchanged =
    destination === initial &&
    (destination !== "deal" || dealId === (task.relatedDeal?.id ?? null)) &&
    (destination !== "project" || projectId === (task.projectId ?? null));

  const submit = () => {
    const base = {
      id: task.id,
      activityTypeId: activityTypeId || null,
      statusId: statusId || undefined,
      // Chi converte se ne fa carico: diventa supervisore e sceglie l'assegnatario.
      supervisorId: currentUser.id,
      assigneeId: assigneeId || null,
    };
    const payload =
      destination === "project"
        ? { ...base, projectId }
        : destination === "deal"
          ? { ...base, projectId: null, relatedDealId: dealId }
          : { ...base, projectId: null, relatedDealId: null };
    updateTask.mutate(payload, { onSuccess: onClose });
  };

  const leavingProject = task.projectId && destination !== "project";

  return (
    <Dialog open onClose={onClose} title={t("Converti o sposta il task")}>
      <div className="flex flex-col gap-4">
        <div className="flex flex-col gap-1.5">
          <Label>{t("Destinazione")}</Label>
          <div className="flex gap-1 rounded-md border p-1">
            {(Object.keys(DEST_LABEL) as Destination[]).map((dest) => (
              <button
                key={dest}
                type="button"
                onClick={() => changeDestination(dest)}
                className={cn(
                  "flex-1 rounded px-3 py-1.5 text-sm font-medium",
                  destination === dest
                    ? "bg-primary text-primary-foreground"
                    : "text-muted-foreground hover:bg-muted/60",
                )}
              >
                {t(DEST_LABEL[dest])}
                {dest === initial && ` ${t("(attuale)")}`}
              </button>
            ))}
          </div>
        </div>

        {destination === "deal" && (
          <div className="flex flex-col gap-1.5">
            <Label importance="required">{t("Offerta")}</Label>
            <DealCombobox value={dealId} onChange={setDealId} includeClosed />
          </div>
        )}
        {destination === "project" && (
          <div className="flex flex-col gap-1.5">
            <Label importance="required">{t("Progetto")}</Label>
            <Combobox
              value={projectId}
              onChange={(id) => {
                setProjectId(id);
                setAssigneeId(""); // membri diversi: si riscegli
              }}
              items={options.projects.map((p) => ({ id: p.id, label: p.name }))}
              placeholder={t("Cerca un progetto…")}
              emptyLabel={t("Nessuno")}
            />
          </div>
        )}

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div className="flex flex-col gap-1.5">
            <Label>{t("Tipo di attività")}</Label>
            <ActivityTypeSelect
              value={activityTypeId}
              onChange={setActivityTypeId}
              category={targetCategory}
              emptyLabel={t("Nessuno")}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label>{t("Stato")}</Label>
            <select
              className="h-9 rounded-md border bg-background px-2 text-sm"
              value={statusId}
              onChange={(e) => setStatusId(e.target.value)}
            >
              {targetStatuses.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </div>
        </div>
        <p className="-mt-2 text-xs text-muted-foreground">
          {t("Stati {{category}}, proposti dallo stato attuale ({{status}}); puoi cambiarli.", {
            category: t(ACTIVITY_CATEGORY_LABELS[targetCategory]).toLowerCase(),
            status: task.status.name,
          })}
        </p>

        <div className="flex flex-col gap-1.5">
          <Label>{t("Assegnatario")}</Label>
          <UserSelect
            value={assigneeId}
            onChange={setAssigneeId}
            users={assigneeUsers}
            projectMembers={destination === "project" ? options.projectMembers : undefined}
            title={t("A chi assegnare il task")}
          />
          <p className="text-xs text-muted-foreground">
            {t("Diventi tu il supervisore. Assegnabile solo a chi ha accesso alla destinazione.")}
          </p>
        </div>

        {destination === "project" && task.relatedDeal && (
          <p className="text-xs text-muted-foreground">
            {t("Entrando nel progetto, il collegamento all'offerta “{{title}}” viene rimosso.", {
              title: task.relatedDeal.title,
            })}
          </p>
        )}
        {leavingProject && (
          <p className="text-xs text-muted-foreground">
            {t("Esce dal progetto: i suoi membri non lo vedranno più (serve esserne manager).")}
          </p>
        )}

        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={onClose}>
            {t("Annulla")}
          </Button>
          <Button
            type="button"
            onClick={submit}
            disabled={updateTask.isPending || missingTarget || unchanged}
          >
            {updateTask.isPending ? t("Sposto…") : t("Converti")}
          </Button>
        </div>
      </div>
    </Dialog>
  );
}
