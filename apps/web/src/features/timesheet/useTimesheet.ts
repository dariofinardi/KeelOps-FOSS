import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  SummaryGroupBy,
  TimesheetBreakdownRow,
  TimesheetMonth,
  TimesheetSummaryRow,
  TimesheetTaskPage,
  TimesheetUser,
  UpsertTimeEntryInput,
} from "@kancrm/shared";
import { api } from "@/lib/api";

/** La griglia del periodo guardato: un mese (`2026-08`) o una settimana (`2026-08-03`). */
export function useTimesheetPeriod(period: string, userIds: string[] = []) {
  const params = new URLSearchParams({ period });
  if (userIds.length) params.set("userIds", userIds.join(","));
  return useQuery({
    // Con più utenti la griglia è aggregata (sola lettura); vuoto = il proprio timesheet.
    queryKey: ["timesheet", period, userIds.length ? [...userIds].sort().join(",") : "me"],
    queryFn: () => api<TimesheetMonth>(`/api/timesheet?${params.toString()}`),
  });
}

export function useUpsertEntry() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: UpsertTimeEntryInput) =>
      api("/api/timesheet/entry", { method: "PUT", body: input }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["timesheet"] });
      void queryClient.invalidateQueries({ queryKey: ["timesheet-summary"] });
    },
  });
}

/** Tiene un task nella griglia del periodo anche prima di registrarci delle ore. */
export function useAddRow() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ taskId, period }: { taskId: string; period: string }) =>
      api<void>("/api/timesheet/rows", { method: "POST", body: { taskId, period } }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["timesheet"] }),
  });
}

export function useDeleteRow() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ taskId, period }: { taskId: string; period: string }) =>
      api<void>(`/api/timesheet/rows/${taskId}?period=${period}`, { method: "DELETE" }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["timesheet"] });
      void queryClient.invalidateQueries({ queryKey: ["timesheet-summary"] });
    },
  });
}

/**
 * Task proponibili nella griglia, a blocchi: senza cercare sono i propri
 * (assegnati o supervisionati), scrivendo diventa la ricerca su tutto quello
 * che si può vedere. Il server ordina alfabeticamente in entrambi i casi.
 */
/**
 * Task proponibili nella tendina. Senza cercare sono quelli su cui si sta
 * **lavorando nel periodo mostrato**; scrivendo, la ricerca si allarga a tutto
 * ciò che si può vedere — i propri task e quelli dei colleghi.
 */
export function useVisibleTasks(q: string, period: string) {
  return useInfiniteQuery({
    queryKey: ["timesheet-visible-tasks", q, q ? "" : period],
    initialPageParam: 0,
    queryFn: ({ pageParam }) =>
      api<TimesheetTaskPage>(
        `/api/timesheet/visible-tasks?skip=${pageParam}` +
          (q ? `&q=${encodeURIComponent(q)}` : `&period=${period}`),
      ),
    getNextPageParam: (last, pages) =>
      last.hasMore ? pages.reduce((n, page) => n + page.items.length, 0) : undefined,
  });
}

/** The flat summary of a period: a month or a week (since 08/10/2026). */
export function useTimesheetSummary(period: string, groupBy: SummaryGroupBy) {
  return useQuery({
    queryKey: ["timesheet-summary", period, groupBy],
    queryFn: () =>
      api<TimesheetSummaryRow[]>(`/api/timesheet/summary?period=${period}&groupBy=${groupBy}`),
  });
}

/** Utenti selezionabili nel timesheet (inclusi i disattivati con ore). Solo admin. */
export function useTimesheetUsers(enabled = true) {
  return useQuery({
    queryKey: ["timesheet-users"],
    queryFn: () => api<TimesheetUser[]>("/api/timesheet/users"),
    staleTime: 60_000,
    enabled,
  });
}

/** Projects › people of a period: a month or a week (since 08/10/2026). */
export function useTimesheetBreakdown(period: string, userIds: string[]) {
  const qs = userIds.length ? `&userIds=${userIds.join(",")}` : "";
  return useQuery({
    queryKey: ["timesheet-breakdown", period, userIds],
    queryFn: () => api<TimesheetBreakdownRow[]>(`/api/timesheet/breakdown?period=${period}${qs}`),
  });
}
