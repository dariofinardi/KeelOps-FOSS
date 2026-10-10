// Copyright (c) 2026 Jugaad s.r.l.
// SPDX-License-Identifier: AGPL-3.0-only

import { useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ArrowDown, ArrowUp, Plus, Trash2 } from "lucide-react";
import {
  ACTIVITY_CATEGORY_LABELS,
  ACTIVITY_CATEGORY_ORDER,
  ActivityCategory,
  type ActivityType,
  type CreateActivityTypeInput,
  type CreateTaskStatusInput,
  type TaskStatus,
  type UpdateActivityTypeInput,
  type UpdateTaskStatusInput,
} from "@kancrm/shared";
import { ApiError, api } from "@/lib/api";
import { useToast } from "@/components/ui/toast";
import { Button } from "@/components/ui/button";
import { ColorField } from "@/components/ui/color-field";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useCurrentUser } from "@/features/auth/useAuth";
import { useTaskStatuses } from "@/features/tasks/useTasks";
import { useActivityTypes } from "@/features/tasks/activity-types";
import { MergeStatusesButton } from "./MergeStatusesDialog";

function useStatusMutations() {
  const queryClient = useQueryClient();
  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ["task-statuses"] });
    void queryClient.invalidateQueries({ queryKey: ["tasks"] });
  };
  const create = useMutation({
    mutationFn: (input: CreateTaskStatusInput) =>
      api<TaskStatus>("/api/task-statuses", { method: "POST", body: input }),
    onSuccess: invalidate,
  });
  const update = useMutation({
    mutationFn: ({ id, ...input }: UpdateTaskStatusInput & { id: string }) =>
      api<TaskStatus>(`/api/task-statuses/${id}`, { method: "PATCH", body: input }),
    onSuccess: invalidate,
  });
  const remove = useMutation({
    mutationFn: (id: string) => api<void>(`/api/task-statuses/${id}`, { method: "DELETE" }),
    onSuccess: invalidate,
  });
  const reorder = useMutation({
    mutationFn: (ids: string[]) =>
      api<TaskStatus[]>("/api/task-statuses/reorder", { method: "PUT", body: { ids } }),
    onSuccess: invalidate,
  });
  return { create, update, remove, reorder };
}

/** Descrizione del flusso di ogni categoria, per orientarsi nella pagina. */
const CATEGORY_HINTS: Record<ActivityCategory, string> = {
  ADMIN: "scadenze fiscali, fatture, adempimenti",
  SALES: "telefonate, appuntamenti, preventivi",
  DEV: "sviluppo, fix, rilasci",
  QUALITY: "non conformità, azioni correttive, controlli programmati",
  GENERAL: "tipi validi in ogni area (es. Riunione), ticket e task senza tipo",
};

export function StatusesPage() {
  const { t } = useTranslation();
  const { data: statuses, isLoading } = useTaskStatuses();
  const [error, setError] = useState<string | null>(null);
  // Un manager configura solo le aree dei gruppi che gestisce (l'admin tutte):
  // mostrare le altre significherebbe offrire comandi che il server rifiuta.
  const { manageableCategories } = useCurrentUser();
  const categories = ACTIVITY_CATEGORY_ORDER.filter((category) =>
    manageableCategories.includes(category),
  );

  if (isLoading) {
    return <p className="text-sm text-muted-foreground">{t("Caricamento stati…")}</p>;
  }

  return (
    <div className="flex max-w-2xl flex-col gap-6">
      <p className="text-sm text-muted-foreground">
        {t("Gli stati sono distinti per")}{" "}
        <strong className="text-foreground">{t("categoria di attività")}</strong>
        {t(
          ': un task usa quelli della categoria del suo tipo (una telefonata non segue il flusso di una scadenza fiscale). Definiscono le colonne del Kanban; gli stati "chiusi" (Completato, Annullato…) escludono il task dalle viste di default e ne registrano la data di chiusura.',
        )}
      </p>
      {error && <p className="text-sm text-destructive">{error}</p>}

      {categories.map((category) => (
        <CategorySection
          key={category}
          category={category}
          statuses={(statuses ?? []).filter((status) => status.category === category)}
          onError={setError}
        />
      ))}

      <hr />
      <div>
        <h2 className="text-base font-semibold">{t("Tipi di attività")}</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          {t(
            "Il tipo determina la lista di stati usata dal task (una telefonata segue il flusso commerciale, una scadenza fiscale quello amministrativo). Eliminare un tipo già usato lo nasconde dalle tendine senza toccare i task esistenti.",
          )}
        </p>
      </div>
      {categories.map((category) => (
        <TypesSection key={category} category={category} onError={setError} />
      ))}
    </div>
  );
}

function TypesSection({
  category,
  onError,
}: {
  category: ActivityCategory;
  onError: (message: string | null) => void;
}) {
  const { t } = useTranslation();
  const { data: types } = useActivityTypes();
  const queryClient = useQueryClient();
  const toast = useToast();
  const invalidate = () => void queryClient.invalidateQueries({ queryKey: ["activity-types"] });
  const fail = (err: unknown) => {
    const messaggio = err instanceof ApiError ? err.message : t("Errore imprevisto");
    onError(messaggio);
    // Anche un avviso a schermo: la riga rossa sta in cima alla pagina, e i
    // comandi che possono fallire stanno in fondo — si aggiungeva uno stato,
    // non succedeva niente, e il perché era fuori campo (26/08/2026).
    toast(messaggio, "error");
  };

  const create = useMutation({
    mutationFn: (input: CreateActivityTypeInput) =>
      api<ActivityType>("/api/activity-types", { method: "POST", body: input }),
    onSuccess: invalidate,
  });
  const update = useMutation({
    mutationFn: ({ id, ...input }: UpdateActivityTypeInput & { id: string }) =>
      api<ActivityType>(`/api/activity-types/${id}`, { method: "PATCH", body: input }),
    onSuccess: invalidate,
  });
  const remove = useMutation({
    mutationFn: (id: string) => api<void>(`/api/activity-types/${id}`, { method: "DELETE" }),
    onSuccess: invalidate,
  });

  const [newName, setNewName] = useState("");
  const [newColor, setNewColor] = useState("#f59e0b");
  const inCategory = (types ?? []).filter((type) => type.category === category);

  const onCreate = (event: FormEvent) => {
    event.preventDefault();
    onError(null);
    create.mutate(
      { name: newName, category, color: newColor, isMeeting: false },
      { onSuccess: () => setNewName(""), onError: fail },
    );
  };

  return (
    <section className="flex flex-col gap-2">
      <h3 className="text-sm font-semibold">
        {t("Tipi di attività — {{category}}", { category: t(ACTIVITY_CATEGORY_LABELS[category]) })}
      </h3>
      <ul className="flex flex-col gap-2">
        {inCategory.map((type) => (
          <li
            key={type.id}
            className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-lg border bg-card p-3"
          >
            <ColorField
              aria-label={t("Colore {{name}}", { name: type.name })}
              className="h-8 w-10 shrink-0 cursor-pointer rounded border bg-background"
              value={type.color}
              onCommit={(color) => update.mutate({ id: type.id, color })}
            />
            <Input
              defaultValue={type.name}
              className="w-full sm:w-64"
              onBlur={(e) => {
                const name = e.target.value.trim();
                if (name && name !== type.name) {
                  update.mutate({ id: type.id, name }, { onError: fail });
                } else {
                  e.target.value = type.name;
                }
              }}
            />
            <label
              className="flex shrink-0 items-center gap-1.5 whitespace-nowrap text-sm text-muted-foreground"
              title={t("I task di questo tipo sono incontri e raccolgono note di altri task")}
            >
              <input
                type="checkbox"
                checked={type.isMeeting}
                onChange={(e) =>
                  update.mutate({ id: type.id, isMeeting: e.target.checked }, { onError: fail })
                }
              />
              {t("Riunione")}
            </label>
            <Button
              variant="ghost"
              size="icon"
              title={t("Elimina (se usato viene solo nascosto)")}
              className="ml-auto"
              onClick={() => remove.mutate(type.id, { onError: fail })}
            >
              <Trash2 className="size-4 text-destructive" />
            </Button>
          </li>
        ))}
        {inCategory.length === 0 && (
          <p className="text-sm text-muted-foreground">{t("Nessun tipo in questa categoria.")}</p>
        )}
      </ul>
      <form onSubmit={onCreate} className="flex flex-wrap items-end gap-2">
        {/* Il campo prende la riga sul telefono e il pulsante scende sotto. */}
        <div className="flex min-w-0 flex-1 flex-col gap-1.5 sm:flex-none">
          <Label htmlFor={`type-name-${category}`} className="sr-only">
            {t("Nuovo tipo — {{category}}", { category: t(ACTIVITY_CATEGORY_LABELS[category]) })}
          </Label>
          <Input
            id={`type-name-${category}`}
            placeholder={t("Nuovo tipo…")}
            required
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            className="w-full sm:w-64"
          />
        </div>
        <input
          type="color"
          aria-label={t("Colore")}
          className="h-9 w-12 cursor-pointer rounded-md border bg-background"
          value={newColor}
          onChange={(e) => setNewColor(e.target.value)}
        />
        <Button type="submit" variant="outline" disabled={create.isPending}>
          <Plus className="size-4" /> {t("Aggiungi")}
        </Button>
      </form>
    </section>
  );
}

function CategorySection({
  category,
  statuses,
  onError,
}: {
  category: ActivityCategory;
  statuses: TaskStatus[];
  onError: (message: string | null) => void;
}) {
  const { t } = useTranslation();
  const { create, update, remove, reorder } = useStatusMutations();
  const [newName, setNewName] = useState("");
  const [newColor, setNewColor] = useState("#60a5fa");

  const toast = useToast();
  const fail = (err: unknown) => {
    const messaggio = err instanceof ApiError ? err.message : t("Errore imprevisto");
    onError(messaggio);
    toast(messaggio, "error");
  };

  // Il riordino vale dentro la categoria: l'elenco inviato è solo il suo.
  const move = (index: number, delta: -1 | 1) => {
    const target = index + delta;
    if (target < 0 || target >= statuses.length) return;
    const ids = statuses.map((s) => s.id);
    const moved = ids[index]!;
    ids[index] = ids[target]!;
    ids[target] = moved;
    reorder.mutate(ids, { onError: fail });
  };

  const onCreate = (event: FormEvent) => {
    event.preventDefault();
    onError(null);
    create.mutate(
      {
        name: newName,
        category,
        color: newColor,
        isClosed: false,
        isWonTarget: false,
        isAssignedTarget: false,
        stopsRecurrence: false,
        isBillingMilestone: false,
        wipLimit: null,
      },
      { onSuccess: () => setNewName(""), onError: fail },
    );
  };

  return (
    <section className="flex flex-col gap-2">
      {/* Il comando di fusione sta accanto al titolo della SUA area: agisce solo
          sugli stati di quell'area, e un unico comando in cima alla pagina
          avrebbe avuto bisogno di una terza tendina per dire dove. */}
      <div className="flex items-start justify-between gap-2">
        <h2 className="text-sm font-semibold">
          {t("Stati — {{category}}", { category: t(ACTIVITY_CATEGORY_LABELS[category]) })}{" "}
          <span className="font-normal text-muted-foreground">— {t(CATEGORY_HINTS[category])}</span>
        </h2>
        <MergeStatusesButton category={category} statuses={statuses} />
      </div>

      <ul className="flex flex-col gap-2">
        {statuses.map((status, index) => (
          <li
            key={status.id}
            // `flex-wrap`, non compressione: quando i controlli non ci stanno
            // (le righe amministrative hanno anche "Da offerta vinta") vanno a
            // capo ordinati — prima era lo swatch del colore a farne le spese,
            // schiacciato a una barretta di 2px (11/08/2026).
            className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-lg border bg-card p-3"
          >
            <ColorField
              aria-label={t("Colore {{name}}", { name: status.name })}
              className="h-8 w-10 shrink-0 cursor-pointer rounded border bg-background"
              value={status.color}
              onCommit={(color) => update.mutate({ id: status.id, color })}
            />
            <Input
              defaultValue={status.name}
              className="w-full sm:w-56"
              onBlur={(e) => {
                const name = e.target.value.trim();
                if (name && name !== status.name) {
                  update.mutate({ id: status.id, name }, { onError: fail });
                } else {
                  e.target.value = status.name;
                }
              }}
            />
            {/*
              Le spunte in **griglia a due colonne**, non in un flex che va a
              capo: così "Attività amministrativa" sta sotto "Stato chiuso" e
              "Da offerta vinta" sotto "Task assegnati", invece di ricominciare
              da sinistra sotto lo swatch del colore (18/08/2026). Le colonne le
              detta la voce più larga, che è la griglia a farlo per entrambe le
              righe — un flex non può, perché ogni riga si misura da sé.
              Sul telefono la griglia diventa una colonna sola.
            */}
            <div className="grid gap-x-4 gap-y-1.5 sm:grid-cols-[auto_auto]">
              <label className="flex shrink-0 items-center gap-1.5 whitespace-nowrap text-sm text-muted-foreground">
                <input
                  type="checkbox"
                  checked={status.isClosed}
                  onChange={(e) => update.mutate({ id: status.id, isClosed: e.target.checked })}
                />
                {t("Stato chiuso")}
              </label>
              {/* Stato chiuso che interrompe la ricorrenza (es. "Annullato"): un'occorrenza
                  ricorrente che vi entra non avanza e resta ferma. */}
              {status.isClosed && (
                <label
                  className="flex shrink-0 items-center gap-1.5 whitespace-nowrap text-sm text-muted-foreground"
                  title={t(
                    "Un'occorrenza ricorrente in questo stato non avanza alla scadenza successiva",
                  )}
                >
                  <input
                    type="checkbox"
                    checked={status.stopsRecurrence}
                    onChange={(e) =>
                      update.mutate(
                        { id: status.id, stopsRecurrence: e.target.checked },
                        { onError: fail },
                      )
                    }
                  />
                  {t("Interrompe ricorrenza")}
                </label>
              )}
              {/* Destinazione dei task generati dalle offerte vinte: uno solo, e solo
                  tra gli amministrativi (il task nasce nello scadenzario). */}
              {!status.isClosed && (
                <label
                  className="flex shrink-0 items-center gap-1.5 whitespace-nowrap text-sm text-muted-foreground"
                  title={t("I task che hanno un assegnatario passano in questo stato")}
                >
                  <input
                    type="radio"
                    name={`assigned-target-${category}`}
                    checked={status.isAssignedTarget}
                    onChange={() => update.mutate({ id: status.id, isAssignedTarget: true })}
                  />
                  {t("Task assegnati")}
                </label>
              )}
              {/* Tappa da fatturare: la mette chi governa questa categoria — per gli
                  stati di sviluppo, un manager del gruppo Sviluppatori. Serve sui
                  traguardi che l'amministrazione trasforma in fattura (consegna
                  beta, consegna in produzione, collaudo). */}
              <label
                className="flex shrink-0 items-center gap-1.5 whitespace-nowrap text-sm text-muted-foreground"
                title={t(
                  "Attività amministrativa: chi entra in questo stato è una tappa da fatturare — il supervisore del task (o l'amministrativo di riferimento dell'assegnatario) riceve una notifica",
                )}
              >
                <input
                  type="checkbox"
                  checked={status.isBillingMilestone}
                  onChange={(e) =>
                    update.mutate(
                      { id: status.id, isBillingMilestone: e.target.checked },
                      { onError: fail },
                    )
                  }
                />
                {t("Attività amministrativa")}
              </label>
              {/* Limite WIP: un numero, non una spunta — e solo sugli stati
                  aperti, perché "quante cose si tengono in ballo insieme" non
                  significa niente su uno stato chiuso. Vuoto = nessun limite,
                  che è come nascono tutti. */}
              {!status.isClosed && (
                <label
                  className="flex shrink-0 items-center gap-1.5 whitespace-nowrap text-sm text-muted-foreground"
                  title={t(
                    "Limite WIP: quanti task una persona può tenere insieme in questo stato, dentro un progetto. Superarlo non blocca niente: la colonna lo segnala quando filtri su una persona sola, e la frase torna nel riepilogo della mattina. Vuoto = nessun limite.",
                  )}
                >
                  {t("Limite WIP")}
                  <input
                    type="number"
                    min={1}
                    className="h-8 w-16 rounded-md border bg-background px-2 text-sm"
                    placeholder="—"
                    defaultValue={status.wipLimit ?? ""}
                    onBlur={(e) => {
                      const raw = e.target.value.trim();
                      const value = raw === "" ? null : Number(raw);
                      if (value === (status.wipLimit ?? null)) return;
                      if (value !== null && (!Number.isInteger(value) || value < 1)) {
                        e.target.value = String(status.wipLimit ?? "");
                        return;
                      }
                      update.mutate({ id: status.id, wipLimit: value }, { onError: fail });
                    }}
                  />
                </label>
              )}
              {category === ActivityCategory.ADMIN && !status.isClosed && (
                <label
                  className="flex shrink-0 items-center gap-1.5 whitespace-nowrap text-sm text-muted-foreground"
                  title={t(
                    "Fallback: i task delle offerte vinte nascono qui SOLO se la fase vinta non ha uno stato configurato (pagina Fasi pipeline, che ha la precedenza)",
                  )}
                >
                  <input
                    type="radio"
                    name="won-target"
                    checked={status.isWonTarget}
                    onChange={() => update.mutate({ id: status.id, isWonTarget: true })}
                  />
                  {t("Da offerta vinta")}
                </label>
              )}
            </div>
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
                disabled={index === statuses.length - 1 || reorder.isPending}
                onClick={() => move(index, 1)}
              >
                <ArrowDown className="size-4" />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                title={t("Elimina")}
                onClick={() => remove.mutate(status.id, { onError: fail })}
              >
                <Trash2 className="size-4 text-destructive" />
              </Button>
            </div>
          </li>
        ))}
      </ul>

      <form onSubmit={onCreate} className="flex flex-wrap items-end gap-2">
        {/* Il campo prende la riga sul telefono e il pulsante scende sotto. */}
        <div className="flex min-w-0 flex-1 flex-col gap-1.5 sm:flex-none">
          <Label htmlFor={`status-name-${category}`} className="sr-only">
            {t("Nuovo stato — {{category}}", { category: t(ACTIVITY_CATEGORY_LABELS[category]) })}
          </Label>
          <Input
            id={`status-name-${category}`}
            placeholder={t("Nuovo stato…")}
            required
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            className="w-full sm:w-56"
          />
        </div>
        <input
          type="color"
          aria-label={t("Colore")}
          className="h-9 w-12 cursor-pointer rounded-md border bg-background"
          value={newColor}
          onChange={(e) => setNewColor(e.target.value)}
        />
        <Button type="submit" variant="outline" disabled={create.isPending}>
          <Plus className="size-4" /> {t("Aggiungi")}
        </Button>
      </form>
    </section>
  );
}
