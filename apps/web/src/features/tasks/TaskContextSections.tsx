// Copyright (c) 2026 Jugaad s.r.l.
// SPDX-License-Identifier: AGPL-3.0-only

import { ArrowUpRight, CheckCircle2, Circle, FolderKanban, ListTree } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import { AREAS } from "@/components/layout/areas";
import type { TaskDetail } from "@kancrm/shared";
import { CompanyCombobox } from "@/features/crm/CompanyCombobox";
import { Label } from "@/components/ui/label";
import { useUpdateTask } from "./useTasks";

/**
 * Freccina accanto a un campo del Contesto: apre il record collegato.
 *
 * Prima l'apertura viveva in bande separate sotto il Contesto ("Collegato
 * all'offerta X ›"), che ripetevano il dato appena letto due righe sopra: il
 * campo diceva quale offerta, la banda la ripeteva per poterci andare. Un
 * dato solo, due posti. Ora il campo fa entrambe le cose.
 */
/**
 * La freccia che apre il record collegato. Esportata perché il segno di "questo
 * campo porta da qualche parte" deve essere lo stesso ovunque (regola di casa:
 * un dato, un posto) — la usa anche l'intestazione del progetto per la scheda
 * del cliente.
 */
export function OpenLinked({ to, title }: { to: string; title: string }) {
  const navigate = useNavigate();
  return (
    <button
      type="button"
      className="shrink-0 rounded-md p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
      title={title}
      aria-label={title}
      onClick={() => navigate(to)}
    >
      <ArrowUpRight className="size-4" />
    </button>
  );
}

export function ContextSection({ task }: { task: TaskDetail }) {
  const { t } = useTranslation();
  const updateTask = useUpdateTask();

  const movable =
    (task.kind === "ADMIN" || task.kind === "PROJECT") &&
    !task.recurrenceTemplateId &&
    !task.parent &&
    task.subtasks.length === 0;
  if (!movable) return null;

  // Il progetto del task, o quello di riferimento (occorrenze a contratto,
  // richieste da ticket): la freccia porta comunque lì.
  const projectLinkId = task.projectId ?? task.relatedProject?.id ?? null;

  return (
    <section className="mb-4 flex flex-col gap-2 rounded-md border p-3">
      <h3 className="text-sm font-semibold">{t("Contesto")}</h3>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {/* Progetto e offerta si cambiano con "Converti/Sposta" nell'intestazione
            (una sola porta per spostare, con la mappatura di tipo e stato): qui si
            leggono soltanto, con la freccia per aprirli. */}
        <div className="flex flex-col gap-1.5">
          <Label>{t("Progetto")}</Label>
          <div className="flex items-center gap-1">
            <span className="inline-flex min-w-0 flex-1 items-center gap-1.5 text-sm">
              <FolderKanban className="size-4 shrink-0 text-muted-foreground" />
              <span className="truncate">
                {task.projectId ? (task.project?.name ?? "—") : t("Scadenzario")}
              </span>
            </span>
            {projectLinkId && (
              <OpenLinked
                to={`${AREAS.projects.to}/${projectLinkId}`}
                title={t("Apri il progetto")}
              />
            )}
          </div>
        </div>
        <div className="flex flex-col gap-1.5">
          <Label>{t("Offerta collegata")}</Label>
          <div className="flex items-center gap-1">
            <span className="min-w-0 flex-1 truncate text-sm">
              {task.relatedDeal ? (
                task.relatedDeal.title
              ) : (
                <span className="text-muted-foreground">{t("Nessuna")}</span>
              )}
            </span>
            {task.relatedDeal && (
              <OpenLinked
                to={`${AREAS.deals.to}?deal=${task.relatedDeal.id}`}
                title={t("Apri l'offerta collegata")}
              />
            )}
          </div>
        </div>
        <div className="flex flex-col gap-1.5">
          <Label>{t("Azienda cliente")}</Label>
          {task.relatedDeal ? (
            // Con un'offerta collegata il cliente è il suo: un secondo campo
            // creerebbe due verità sullo stesso dato.
            <p className="text-xs text-muted-foreground">
              {t("È quella dell'offerta collegata")}
              {task.company ? `: ${task.company.name}` : ""}.
            </p>
          ) : (
            <>
              <div className="flex items-center gap-1">
                <div className="min-w-0 flex-1">
                  <CompanyCombobox
                    value={task.company?.id ?? null}
                    onChange={(companyId) => updateTask.mutate({ id: task.id, companyId })}
                  />
                </div>
                {task.company && (
                  <OpenLinked
                    to={`${AREAS.contacts.to}?azienda=${task.company.id}`}
                    title={t("Apri la scheda del cliente")}
                  />
                )}
              </div>
              <p className="text-xs text-muted-foreground">
                {t("Se non la imposti, vale quella dell'offerta o del progetto collegati.")}
              </p>
            </>
          )}
        </div>
      </div>
    </section>
  );
}

export function SubtasksSection({
  task,
  onOpenTask,
}: {
  task: TaskDetail;
  onOpenTask?: (id: string) => void;
}) {
  const { t } = useTranslation();
  // Il legame verso il padre non sta più qui: è un breadcrumb in testa al
  // pannello, dove si cerca la via di ritorno. Qui restano i figli.
  if (task.subtasks.length === 0) return null;
  const closed = task.subtasks.filter((s) => s.isClosed).length;

  return (
    <section className="mt-6">
      {task.subtasks.length > 0 && (
        <>
          <h3 className="mb-2 flex items-center gap-1.5 text-sm font-semibold">
            <ListTree className="size-4" /> {t("Subtask")} ({closed}/{task.subtasks.length})
          </h3>
          <ul className="flex flex-col gap-1">
            {task.subtasks.map((sub) => (
              <li key={sub.id}>
                <button
                  className="flex w-full items-center gap-2 rounded-md border px-3 py-2 text-left text-sm hover:bg-muted/40"
                  onClick={() => onOpenTask?.(sub.id)}
                >
                  {sub.isClosed ? (
                    <CheckCircle2 className="size-4 shrink-0 text-muted-foreground" />
                  ) : (
                    <Circle className="size-4 shrink-0 text-muted-foreground" />
                  )}
                  <span
                    className={
                      sub.isClosed ? "flex-1 text-muted-foreground line-through" : "flex-1"
                    }
                  >
                    {sub.title}
                  </span>
                </button>
              </li>
            ))}
          </ul>
          <p className="mt-1 text-xs text-muted-foreground">
            {t("Il task è completo quando tutti i subtask sono chiusi.")}
          </p>
        </>
      )}
    </section>
  );
}
