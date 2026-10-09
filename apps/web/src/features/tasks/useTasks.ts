import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import type {
  ActivityPage,
  Attachment,
  Comment,
  CommentPage,
  CreateLinkAttachmentInput,
  CreateTaskInput,
  PagedTasks,
  TaskDetail,
  TaskFilters,
  TaskListItem,
  TaskStatus,
  UpdateTaskInput,
  UserRef,
} from "@kancrm/shared";
import {
  ActivityCategory,
  AttachmentType,
  statusCategoryOf,
  type AttachmentTarget,
  type VisibilityScope,
} from "@kancrm/shared";
import { useOpenLinkedTask } from "./linked-task-context";
import { api, ApiError, apiUpload } from "@/lib/api";
import { useInternalLists } from "@/features/auth/useAuth";
import { taskListQuery } from "./filters";
import { useInvalidateTaskWorld } from "@/lib/invalidate";
import { useConfirm } from "@/components/ui/confirm";
import { useToast } from "@/components/ui/toast";
import { slot } from "@/edition/slots";
import { formatDate } from "./task-utils";

// Codici 409 gestiti con una conferma dedicata: non mostrare il toast d'errore.
const CONFIRM_CODES = ["SEQUENCE_INCOMPLETE", "SUBTASKS_OPEN"];

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof ApiError ? error.message : fallback;
}

export function useTaskStatuses() {
  const enabled = useInternalLists();
  return useQuery({
    queryKey: ["task-statuses"],
    queryFn: () => api<TaskStatus[]>("/api/task-statuses"),
    staleTime: 60_000,
    enabled,
  });
}

/**
 * Stati utilizzabili da un task: quelli della categoria del suo tipo di attività
 * (senza tipo, i generali). Sono le uniche opzioni che il server accetta, quindi
 * ogni tendina di stato passa da qui.
 */
export function useStatusesFor(
  task:
    | {
        activityType?: { category: string } | null;
        kind?: string;
        status?: { id: string };
      }
    | null
    | undefined,
): TaskStatus[] {
  const { data: statuses } = useTaskStatuses();
  const category = statusCategoryOf(task);
  const inCategory = (statuses ?? []).filter((status) => status.category === category);
  // Lo stato in cui il task si trova ora resta sempre in elenco, anche se di
  // un'altra categoria: una tendina che non contiene il proprio valore mostra
  // il primo della lista e al primo tocco sposta il task senza che nessuno
  // l'abbia chiesto.
  const current = (statuses ?? []).find((status) => status.id === task?.status?.id);
  return current && !inCategory.some((status) => status.id === current.id)
    ? [...inCategory, current]
    : inCategory;
}

/**
 * Categoria più rappresentata in un insieme di task: la bacheca la usa come
 * default, così non si apre su colonne vuote. In parità vince l'ordine
 * dell'enum (amministrative prima).
 */
/**
 * Categorie che hanno davvero dei task, con quanti, nell'ordine dichiarato.
 *
 * La bacheca di un progetto mostra una categoria alla volta: proporre anche
 * quelle vuote significa offrire tre schermate vuote su quattro — in produzione
 * i task di progetto sono di sviluppo al 100%. Stessa regola delle altre tendine
 * dell'applicazione: si propone solo ciò che porta da qualche parte.
 */
export function presentCategories(
  tasks: Array<{ activityType?: { category: string } | null; kind?: string }>,
): Array<{ category: ActivityCategory; count: number }> {
  const counts = new Map<ActivityCategory, number>();
  for (const task of tasks) {
    const category = statusCategoryOf(task);
    counts.set(category, (counts.get(category) ?? 0) + 1);
  }
  return Object.values(ActivityCategory)
    .map((category) => ({ category, count: counts.get(category) ?? 0 }))
    .filter((entry) => entry.count > 0);
}

export function dominantCategory(
  tasks: Array<{ activityType?: { category: string } | null; kind?: string }>,
): ActivityCategory {
  const counts = new Map<ActivityCategory, number>();
  for (const task of tasks) {
    const category = statusCategoryOf(task);
    counts.set(category, (counts.get(category) ?? 0) + 1);
  }
  let best: ActivityCategory = ActivityCategory.GENERAL;
  let bestCount = -1;
  for (const category of Object.values(ActivityCategory)) {
    const count = counts.get(category) ?? 0;
    if (count > bestCount) {
      best = category;
      bestCount = count;
    }
  }
  return best;
}

/**
 * Utenti selezionabili come assegnatario/supervisore: interni e attivi. Con uno
 * scope restringe a chi ha accesso completo a quel modulo (es. i commerciali per
 * le offerte).
 */
export function useUserOptions(enabled = true, scope?: VisibilityScope) {
  const internal = useInternalLists();
  return useQuery({
    queryKey: ["user-options", scope ?? null],
    queryFn: () => api<UserRef[]>(`/api/users/options${scope ? `?scope=${scope}` : ""}`),
    staleTime: 60_000,
    enabled: enabled && internal,
  });
}

/**
 * Chi governa un'area di lavoro: i manager dei gruppi che hanno quel modulo in
 * accesso completo (es. i manager dello sviluppo). Per le tendine che chiedono
 * "chi guida questo lavoro?".
 */
export function useAreaManagers(category: ActivityCategory, enabled = true) {
  return useQuery({
    queryKey: ["user-options", "managers", category],
    queryFn: () => api<UserRef[]>(`/api/users/options?managersOf=${category}`),
    staleTime: 60_000,
    enabled,
  });
}

export function useTasks(filters: Partial<TaskFilters>) {
  // La serializzazione sta in `filters.ts` (pura e testata): quando era fatta a
  // mano qui dentro, `dueWithinDays` restava fuori e il filtro di scadenza non
  // arrivava mai al server pur sembrando attivo in ogni vista.
  const qs = taskListQuery(filters);
  return useQuery({
    queryKey: ["tasks", filters],
    queryFn: () => api<PagedTasks>(`/api/tasks${qs ? `?${qs}` : ""}`),
  });
}

export function useTaskDetail(id: string | null) {
  return useQuery({
    queryKey: ["task", id],
    queryFn: () => api<TaskDetail>(`/api/tasks/${id}`),
    enabled: id !== null,
  });
}

/**
 * Commenti caricati in modo lazy: la prima pagina è la più recente, "mostra
 * precedenti" ne carica di più vecchi via cursore. Il client li riordina dal più
 * vecchio al più recente per la visualizzazione a conversazione.
 */
export function useTaskComments(taskId: string | null) {
  return useInfiniteQuery({
    queryKey: ["task-comments", taskId],
    queryFn: ({ pageParam }) =>
      api<CommentPage>(
        `/api/tasks/${taskId}/comments?limit=20${pageParam ? `&cursor=${pageParam}` : ""}`,
      ),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.nextCursor,
    enabled: taskId !== null,
  });
}

/** Storico attività (timeline) caricato in modo lazy: dal più recente, poi "mostra altro". */
export function useTaskActivities(taskId: string | null) {
  return useInfiniteQuery({
    queryKey: ["task-activities", taskId],
    queryFn: ({ pageParam }) =>
      api<ActivityPage>(
        `/api/tasks/${taskId}/activities?limit=20${pageParam ? `&cursor=${pageParam}` : ""}`,
      ),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.nextCursor,
    enabled: taskId !== null,
  });
}

export function useCreateTask() {
  const invalidate = useInvalidateTaskWorld();
  return useMutation({
    mutationFn: (input: CreateTaskInput) =>
      api<TaskDetail>("/api/tasks", { method: "POST", body: input }),
    onSuccess: () => invalidate(),
  });
}

/**
 * Task su cui i lavori simili sono già stati mostrati in questa sessione: si
 * dicono **una volta**, quando si mette mano al task. Ripeterli a ogni
 * spostamento di colonna li renderebbe rumore da ignorare.
 */
const similarWorkShown = new Set<string>();

export function useUpdateTask() {
  const { t } = useTranslation();
  const invalidate = useInvalidateTaskWorld();
  const toast = useToast();
  return useMutation({
    mutationFn: ({ id, ...input }: UpdateTaskInput & { id: string }) =>
      api<TaskDetail>(`/api/tasks/${id}`, { method: "PATCH", body: input }),
    onSuccess: (data, variables) => {
      invalidate(variables.id);
      // Cambiando stato a un task aperto si sta cominciando (o riprendendo) un
      // lavoro: è il momento in cui "quanto ci vorrà" uno se lo chiede davvero.
      // Best-effort e in sottofondo: non fa aspettare il salvataggio.
      if (
        slot.lavoriSimili &&
        variables.statusId &&
        !data.status.isClosed &&
        !similarWorkShown.has(variables.id)
      ) {
        similarWorkShown.add(variables.id);
        void slot.lavoriSimili(variables.id, toast, t);
      }
      // Cambiare il propedeutico modifica ANCHE il pannello di quel task: è lui
      // a elencare i successori. Senza questo, aprendo il propedeutico non si
      // vedeva il conseguente appena collegato finché la cache non scadeva.
      if (typeof variables.predecessorId === "string") invalidate(variables.predecessorId);
      // Occorrenza ricorrente completata: il server ha portato avanti la scadenza.
      // Il campo arriva solo in questo caso, quindi non serve altro controllo.
      if (data.nextOccurrenceDate !== undefined) {
        toast(
          data.nextOccurrenceDate
            ? t("Ciclo completato. Prossima scadenza: {{date}}", {
                date: formatDate(data.nextOccurrenceDate),
              })
            : t("Ricorrenza completata: non ci sono altre scadenze."),
          "success",
        );
      }
    },
    onError: (error, variables) => {
      // I 409 di sequenza/subtask li gestisce la conferma dedicata.
      if (error instanceof ApiError && CONFIRM_CODES.includes(error.code ?? "")) return;
      toast(errorMessage(error, t("Modifica non riuscita")), "error");
      // Il campo che ha appena rifiutato la modifica deve **tornare com'era**:
      // i campi del pannello tengono il proprio valore mentre il salvataggio
      // viaggia, e un errore lasciava a schermo un numero (o una data) che
      // sembrava salvato e non lo era. Chiudendo, spariva senza dire niente
      // (14/08/2026).
      invalidate(variables.id);
    },
  });
}

/**
 * Aggiorna un task; se il server risponde 409 con SEQUENCE_INCOMPLETE (propedeutico
 * aperto) o SUBTASKS_OPEN (subtask aperti) chiede conferma e ritenta col flag giusto.
 */
export function useUpdateTaskWithSequenceConfirm() {
  const { t } = useTranslation();
  const updateTask = useUpdateTask();
  const confirm = useConfirm();
  const mutateWithConfirm = (input: UpdateTaskInput & { id: string }) => {
    updateTask.mutate(input, {
      onError: (error) => {
        if (
          error instanceof ApiError &&
          (error.code === "SEQUENCE_INCOMPLETE" || error.code === "SUBTASKS_OPEN")
        ) {
          void confirm({
            title:
              error.code === "SEQUENCE_INCOMPLETE"
                ? t("Task propedeutico non completato")
                : t("Subtask ancora aperti"),
            message: t("{{message}}\n\nVuoi procedere comunque?", { message: error.message }),
            confirmLabel: t("Procedi comunque"),
          }).then((proceed) => {
            if (!proceed) return;
            const retry = {
              ...input,
              ...(error.code === "SEQUENCE_INCOMPLETE"
                ? { confirmSequence: true }
                : { confirmSubtasks: true }),
            };
            // Il retry può incontrare l'altro avviso: gestiscilo ricorsivamente.
            mutateWithConfirm(retry);
          });
        }
      },
    });
  };
  return { ...updateTask, mutateWithConfirm };
}

/**
 * Spunta di completamento: chiede conferma e porta il task nel primo stato chiuso
 * della sua categoria. Su un task ricorrente la conferma avvisa che la scadenza si
 * sposta in avanti — il server crea la prossima occorrenza, che nasce nel primo
 * stato aperto e quindi con la spunta vuota.
 */
export function useCompleteTask() {
  const { t } = useTranslation();
  const { data: statuses } = useTaskStatuses();
  const update = useUpdateTaskWithSequenceConfirm();
  const confirm = useConfirm();
  const toast = useToast();

  return async (task: TaskListItem) => {
    if (task.status.isClosed) return;
    const category = statusCategoryOf(task);
    const done = (statuses ?? []).find((s) => s.category === category && s.isClosed);
    if (!done) {
      toast(t("Nessuno stato di chiusura configurato per questa categoria"), "error");
      return;
    }
    const ok = await confirm({
      title: t("Segnare come completato?"),
      message: task.recurrenceTemplateId
        ? t('"{{title}}" verrà completato e la ricorrenza riproporrà la prossima scadenza.', {
            title: task.title,
          })
        : t('"{{title}}" verrà messo in "{{status}}".', { title: task.title, status: done.name }),
      confirmLabel: t("Sì, completa"),
    });
    if (ok) update.mutateWithConfirm({ id: task.id, statusId: done.id });
  };
}

export function useDeleteTask() {
  const { t } = useTranslation();
  const invalidate = useInvalidateTaskWorld();
  const toast = useToast();
  return useMutation({
    mutationFn: (id: string) => api<void>(`/api/tasks/${id}`, { method: "DELETE" }),
    onSuccess: () => {
      invalidate();
      toast(t("Task spostato nel cestino"), "success");
    },
    onError: (error) => toast(errorMessage(error, t("Eliminazione non riuscita")), "error"),
  });
}

/**
 * Duplica un task. Il titolo della copia lo decide il **server**: porta il
 * numero della copia, tradotto, e quel numero dipende da cosa c'è già accanto —
 * il client non lo saprebbe senza chiederlo.
 */
export function useDuplicateTask() {
  const { t } = useTranslation();
  const invalidate = useInvalidateTaskWorld();
  const toast = useToast();
  return useMutation({
    mutationFn: (id: string) =>
      api<{ id: string; title: string }>(`/api/tasks/${id}/duplicate`, { method: "POST" }),
    onSuccess: (copia) => {
      invalidate();
      toast(t('Creato "{{title}}"', { title: copia.title }), "success");
    },
    onError: (error) => toast(errorMessage(error, t("Duplicazione non riuscita")), "error"),
  });
}

export function useAddComment() {
  const invalidate = useInvalidateTaskWorld();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      taskId,
      body,
      meetingId,
      attachmentIds,
      forza,
    }: {
      taskId: string;
      body: string;
      /** Incontro in cui è stata presa la nota (vedi Comment.meetingId). */
      meetingId?: string | null;
      /**
       * Allegati **già caricati sul task**: qui viaggiano solo gli
       * identificativi. Il caricamento è avvenuto prima, dall'endpoint degli
       * allegati, che è quello che sa dire di no a un formato o a chi non può.
       */
      attachmentIds?: string[];
      /**
       * Manda anche se la richiesta è **in carico a un collega**. Non parte da
       * sola: la offre l'avviso che spiega di chi è, dopo che il primo invio è
       * stato rifiutato (vedi TaskTimeline).
       */
      forza?: boolean;
    }) =>
      api<Comment>(`/api/tasks/${taskId}/comments`, {
        method: "POST",
        body: {
          body,
          meetingId: meetingId ?? null,
          ...(attachmentIds?.length ? { attachmentIds } : {}),
          ...(forza ? { forza: true } : {}),
        },
      }),
    onSuccess: (_data, variables) => {
      invalidate(variables.taskId);
      // Il verbale dell'incontro ha una nota in più.
      if (variables.meetingId) {
        void queryClient.invalidateQueries({
          queryKey: ["meeting-minutes", variables.meetingId],
        });
        void queryClient.invalidateQueries({ queryKey: ["meetings"] });
      }
    },
  });
}

export function useDeleteComment() {
  const invalidate = useInvalidateTaskWorld();
  return useMutation({
    mutationFn: ({ taskId, commentId }: { taskId: string; commentId: string }) =>
      api<void>(`/api/tasks/${taskId}/comments/${commentId}`, { method: "DELETE" }),
    onSuccess: (_data, variables) => invalidate(variables.taskId),
  });
}

export function useAddLinkAttachment() {
  const invalidate = useInvalidateTaskWorld();
  return useMutation({
    mutationFn: ({ taskId, ...input }: CreateLinkAttachmentInput & { taskId: string }) =>
      api<Attachment>(`/api/tasks/${taskId}/attachments/link`, { method: "POST", body: input }),
    onSuccess: (_data, variables) => invalidate(variables.taskId),
  });
}

export function useUploadAttachment() {
  const invalidate = useInvalidateTaskWorld();
  return useMutation({
    mutationFn: async ({ taskId, file }: { taskId: string; file: File }) => {
      return apiUpload<Attachment>(`/api/tasks/${taskId}/attachments/file`, file);
    },
    onSuccess: (_data, variables) => invalidate(variables.taskId),
  });
}

/**
 * Apre un allegato: **unica via** per i file e per i link, in tutta
 * l'applicazione. Il client non usa mai l'URL memorizzato — chiede al server
 * dove andare (`/api/attachments/:id/open`), che verifica i permessi e decide:
 * un URL di download firmato per i file, l'indirizzo esterno per i link.
 *
 * Quel punto è l'innesto per le integrazioni future (Google Workspace, un
 * visualizzatore o un editor): quando arriveranno, cambierà solo la risposta del
 * server e questa funzione, non le pagine che mostrano gli allegati.
 */
export function useOpenAttachment(): (attachment: {
  id: string;
  type: AttachmentType;
}) => Promise<void> {
  const { t } = useTranslation();
  const toast = useToast();
  // Un link a un task di questa istanza si apre nel suo pannello (06/10/2026).
  const apriTask = useOpenLinkedTask();
  return async (attachment) => {
    // I browser bloccano le finestre aperte dopo un'attesa: per i link la scheda
    // si apre subito, vuota, e la si indirizza quando il server ha risposto.
    const tab =
      attachment.type === AttachmentType.LINK ? window.open("about:blank", "_blank") : null;
    if (tab) tab.opener = null;
    try {
      const target = await api<AttachmentTarget>(`/api/attachments/${attachment.id}/open`);
      if (target.mode === "task" && target.taskId) {
        tab?.close();
        apriTask(target.taskId, target.taskKind);
        return;
      }
      if (target.mode === "external") {
        if (tab) tab.location.href = target.url;
        else window.open(target.url, "_blank", "noopener");
        return;
      }
      tab?.close();
      window.location.href = target.url;
    } catch (err) {
      tab?.close();
      toast(err instanceof Error ? err.message : t("Apertura dell'allegato non riuscita"), "error");
    }
  };
}

export function useDeleteAttachment() {
  const invalidate = useInvalidateTaskWorld();
  return useMutation({
    mutationFn: ({ taskId, attachmentId }: { taskId: string; attachmentId: string }) =>
      api<void>(`/api/tasks/${taskId}/attachments/${attachmentId}`, { method: "DELETE" }),
    onSuccess: (_data, variables) => invalidate(variables.taskId),
  });
}
