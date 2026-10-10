// Copyright (c) 2026 Jugaad s.r.l.
// SPDX-License-Identifier: AGPL-3.0-only

import { useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ArrowDown, ArrowUp, Plus, Trash2 } from "lucide-react";
import type { CreateDealStageInput, DealStage, UpdateDealStageInput } from "@kancrm/shared";
import { ApiError, api } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { ColorField } from "@/components/ui/color-field";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useDealStages } from "@/features/deals/useDeals";
import { useTaskStatuses, useUserOptions } from "@/features/tasks/useTasks";

function useStageMutations() {
  const queryClient = useQueryClient();
  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ["deal-stages"] });
    void queryClient.invalidateQueries({ queryKey: ["deals"] });
  };
  const create = useMutation({
    mutationFn: (input: CreateDealStageInput) =>
      api<DealStage>("/api/deal-stages", { method: "POST", body: input }),
    onSuccess: invalidate,
  });
  const update = useMutation({
    mutationFn: ({ id, ...input }: UpdateDealStageInput & { id: string }) =>
      api<DealStage>(`/api/deal-stages/${id}`, { method: "PATCH", body: input }),
    onSuccess: invalidate,
  });
  const remove = useMutation({
    mutationFn: (id: string) => api<void>(`/api/deal-stages/${id}`, { method: "DELETE" }),
    onSuccess: invalidate,
  });
  const reorder = useMutation({
    mutationFn: (ids: string[]) =>
      api<DealStage[]>("/api/deal-stages/reorder", { method: "PUT", body: { ids } }),
    onSuccess: invalidate,
  });
  return { create, update, remove, reorder };
}

export function DealStagesPage() {
  const { t } = useTranslation();
  const { data: stages, isLoading } = useDealStages();
  const { create, update, remove, reorder } = useStageMutations();
  const { data: statuses } = useTaskStatuses();
  const { data: users } = useUserOptions();
  const adminStatuses = (statuses ?? []).filter((s) => s.category === "ADMIN");
  const [newName, setNewName] = useState("");
  const [newColor, setNewColor] = useState("#60a5fa");
  const [error, setError] = useState<string | null>(null);

  if (isLoading) return <p className="text-sm text-muted-foreground">{t("Caricamento fasi…")}</p>;
  const list = stages ?? [];

  const move = (index: number, delta: -1 | 1) => {
    const target = index + delta;
    if (target < 0 || target >= list.length) return;
    const ids = list.map((s) => s.id);
    const moved = ids[index]!;
    ids[index] = ids[target]!;
    ids[target] = moved;
    reorder.mutate(ids);
  };

  const onCreate = (event: FormEvent) => {
    event.preventDefault();
    setError(null);
    create.mutate(
      { name: newName, color: newColor, isWon: false, isLost: false },
      {
        onSuccess: () => setNewName(""),
        onError: (err) => setError(err instanceof ApiError ? err.message : t("Errore imprevisto")),
      },
    );
  };

  return (
    <div className="flex max-w-3xl flex-col gap-4">
      <p className="text-sm text-muted-foreground">
        {t(
          "Le fasi definiscono la pipeline delle offerte. Portando un'offerta in una fase contrassegnata come",
        )}{" "}
        <strong className="text-foreground">{t("Vinta")}</strong>{" "}
        {t(
          "nasce automaticamente il task per l'amministrazione, con titolo, descrizione e allegati dell'offerta: nasce nello stato amministrativo che hai contrassegnato nella pagina Stati e va all'amministrativo di riferimento del commerciale (pagina Utenti).",
        )}
      </p>

      <form onSubmit={onCreate} className="flex items-end gap-2">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="stage-name">{t("Nuova fase")}</Label>
          <Input
            id="stage-name"
            placeholder={t("Nome fase")}
            required
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            className="w-56"
          />
        </div>
        <input
          type="color"
          aria-label={t("Colore")}
          className="h-9 w-12 cursor-pointer rounded-md border bg-background"
          value={newColor}
          onChange={(e) => setNewColor(e.target.value)}
        />
        <Button type="submit" disabled={create.isPending}>
          <Plus className="size-4" /> {t("Aggiungi")}
        </Button>
      </form>
      {error && <p className="text-sm text-destructive">{error}</p>}

      <ul className="flex flex-col gap-2">
        {list.map((stage, index) => (
          <li
            key={stage.id}
            className="flex flex-wrap items-center gap-2 rounded-lg border bg-card p-3"
          >
            <ColorField
              aria-label={t("Colore {{name}}", { name: stage.name })}
              className="h-8 w-10 cursor-pointer rounded border bg-background"
              value={stage.color}
              onCommit={(color) => update.mutate({ id: stage.id, color })}
            />
            <Input
              defaultValue={stage.name}
              className="w-48"
              onBlur={(e) => {
                const name = e.target.value.trim();
                if (name && name !== stage.name) update.mutate({ id: stage.id, name });
                else e.target.value = stage.name;
              }}
            />
            <label className="flex items-center gap-1 text-sm text-muted-foreground">
              <input
                type="checkbox"
                checked={stage.isWon}
                onChange={(e) => update.mutate({ id: stage.id, isWon: e.target.checked })}
              />
              {t("Vinta")}
            </label>
            <label className="flex items-center gap-1 text-sm text-muted-foreground">
              <input
                type="checkbox"
                checked={stage.isLost}
                onChange={(e) => update.mutate({ id: stage.id, isLost: e.target.checked })}
              />
              {t("Persa")}
            </label>
            <div className="ml-auto flex gap-1">
              <Button
                variant="ghost"
                size="icon"
                title={t("Sposta su")}
                disabled={index === 0 || reorder.isPending}
                onClick={() => move(index, -1)}
              >
                <ArrowUp className="size-4" />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                title={t("Sposta giù")}
                disabled={index === list.length - 1 || reorder.isPending}
                onClick={() => move(index, 1)}
              >
                <ArrowDown className="size-4" />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                title={t("Elimina")}
                onClick={() =>
                  remove.mutate(stage.id, {
                    onError: (err) =>
                      setError(err instanceof ApiError ? err.message : t("Errore imprevisto")),
                  })
                }
              >
                <Trash2 className="size-4 text-destructive" />
              </Button>
            </div>
            {stage.isWon && (
              <div className="flex w-full flex-wrap items-center gap-2 border-t pt-2 text-sm">
                <span className="text-muted-foreground">{t("Task amministrativo generato:")}</span>
                <select
                  className="h-8 rounded-md border bg-background px-2 text-sm"
                  title={t("Stato del task amministrativo")}
                  value={stage.wonTaskStatusId ?? ""}
                  onChange={(e) =>
                    update.mutate({ id: stage.id, wonTaskStatusId: e.target.value || null })
                  }
                >
                  <option value="">{t("Stato predefinito")}</option>
                  {adminStatuses.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </select>
                <select
                  className="h-8 rounded-md border bg-background px-2 text-sm"
                  title={t("Amministrativo a cui assegnarlo")}
                  value={stage.wonTaskAssigneeId ?? ""}
                  onChange={(e) =>
                    update.mutate({ id: stage.id, wonTaskAssigneeId: e.target.value || null })
                  }
                >
                  <option value="">{t("Assegnatario predefinito")}</option>
                  {(users ?? []).map((u) => (
                    <option key={u.id} value={u.id}>
                      {u.name}
                    </option>
                  ))}
                </select>
              </div>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
