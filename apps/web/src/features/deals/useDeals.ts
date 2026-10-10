// Copyright (c) 2026 Jugaad s.r.l.
// SPDX-License-Identifier: AGPL-3.0-only

import { useMutation, useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import type {
  CreateDealInput,
  CreateDealFromTaskInput,
  DealDetail,
  DealFilters,
  DealStage,
  PagedDeals,
  UpdateDealInput,
} from "@kancrm/shared";
import { ApiError, api } from "@/lib/api";
import { useInvalidateTaskWorld } from "@/lib/invalidate";
import { useToast } from "@/components/ui/toast";
import { useConfirm } from "@/components/ui/confirm";

export function useDealStages() {
  return useQuery({
    queryKey: ["deal-stages"],
    queryFn: () => api<DealStage[]>("/api/deal-stages"),
    staleTime: 60_000,
  });
}

/**
 * **I filtri, tradotti in indirizzo.** Sta a parte perché è il punto in cui un
 * filtro nuovo si dimentica: l'elenco qui sotto e lo schema condiviso sono due
 * cose che devono restare uguali, e il 04/09/2026 non lo sono state — il filtro
 * «di chi sono le offerte» era nella pagina, nello schema e nel server, ma non
 * qui, e cambiare la tendina non cambiava niente. Il test accanto lo pretende
 * confrontando questa funzione con i campi dello schema: chi ne aggiunge uno
 * domani se lo sente dire.
 */
export function dealsQueryString(filters: Partial<DealFilters>): string {
  const params = new URLSearchParams();
  if (filters.owner && filters.owner !== "all") params.set("owner", filters.owner);
  if (filters.stageId) params.set("stageId", filters.stageId);
  if (filters.companyId) params.set("companyId", filters.companyId);
  if (filters.value) params.set("value", filters.value);
  if (filters.q) params.set("q", filters.q);
  if (filters.includeClosed) params.set("includeClosed", "true");
  if (filters.page) params.set("page", String(filters.page));
  if (filters.pageSize) params.set("pageSize", String(filters.pageSize));
  if (filters.sortBy) params.set("sortBy", filters.sortBy);
  if (filters.sortDir) params.set("sortDir", filters.sortDir);
  if (filters.stalled) params.set("stalled", filters.stalled);
  if (filters.months) params.set("months", filters.months);
  return params.toString();
}

export function useDeals(filters: Partial<DealFilters>, enabled = true) {
  const qs = dealsQueryString(filters);
  return useQuery({
    queryKey: ["deals", filters],
    queryFn: () => api<PagedDeals>(`/api/deals${qs ? `?${qs}` : ""}`),
    enabled,
  });
}

export function useDealDetail(id: string | null) {
  return useQuery({
    queryKey: ["deal", id],
    queryFn: () => api<DealDetail>(`/api/deals/${id}`),
    enabled: id !== null,
  });
}

export function useCreateDeal() {
  const invalidate = useInvalidateTaskWorld();
  return useMutation({
    mutationFn: (input: CreateDealInput) =>
      api<DealDetail>("/api/deals", { method: "POST", body: input }),
    onSuccess: () => invalidate(),
  });
}

/** Un'offerta da un task (06/10/2026): il server aggiunge il link al task fra gli allegati. */
export function useCreateDealFromTask() {
  const invalidate = useInvalidateTaskWorld();
  return useMutation({
    mutationFn: ({ taskId, ...input }: CreateDealFromTaskInput & { taskId: string }) =>
      api<{ id: string }>(`/api/tasks/${taskId}/deal`, { method: "POST", body: input }),
    // Anche il task: la sua cronologia ha una voce nuova.
    onSuccess: (_offerta, variabili) => invalidate(variabili.taskId),
  });
}

export function useUpdateDeal() {
  const { t } = useTranslation();
  const invalidate = useInvalidateTaskWorld();
  const toast = useToast();
  const confirm = useConfirm();
  return useMutation({
    mutationFn: ({ id, ...input }: UpdateDealInput & { id: string }) =>
      api<DealDetail>(`/api/deals/${id}`, { method: "PATCH", body: input }),
    onSuccess: (data, variables) => {
      invalidate(variables.id);
      /**
       * **La seconda volta in fase vinta.** Un'offerta si sposta indietro per
       * correggere qualcosa e si riporta avanti: la lettura degli allegati non
       * riparte, perché rifarla sovrascriverebbe le correzioni fatte a mano e —
       * se i task erano già nati — ne creerebbe un secondo gruppo identico. Il
       * server non tocca niente, e qui lo si dice: sparire in silenzio farebbe
       * credere che la funzione non abbia funzionato.
       *
       * Sta nel gancio e non nelle tre pagine che portano in fase vinta
       * (pannello, elenco, pipeline): l'avviso è uno, e tre copie divergono.
       */
      /**
       * **Entrando in fase vinta non si chiede più niente**: si legge l'offerta
       * e le domande arrivano con la proposta (21/08/2026). Ma qualcosa va detto
       * subito, o lo spostamento sembra non aver prodotto nulla.
       */
      if (data?.analysisState === "in-coda") {
        toast(
          t("Sto leggendo i documenti dell'offerta: ti avviso quando la proposta è pronta"),
          "success",
        );
      } else if (data?.analysisState === "senza-modello") {
        toast(
          t("Modello di lettura spento: ho creato il task per l'amministrazione, senza proposta"),
        );
      }
      const avviso = data?.analysisNotice;
      if (avviso) {
        void confirm({
          title: t("Gli allegati erano già stati letti"),
          message: avviso.applicata
            ? t(
                "Questa offerta era già passata in fase vinta: la lettura del {{quando}} è ancora lì e i suoi task sono già stati creati. Non ho toccato niente.",
                { quando: new Date(avviso.fattaIl).toLocaleDateString() },
              )
            : t(
                "Questa offerta era già passata in fase vinta: la lettura del {{quando}} è ancora lì, con le correzioni che avevi fatto. Non l'ho rifatta né aggiunta: la trovi nel pannello dell'offerta.",
                { quando: new Date(avviso.fattaIl).toLocaleDateString() },
              ),
          confirmLabel: t("Ho capito"),
          dismissOnly: true,
        });
      }
    },
    onError: (error) =>
      toast(error instanceof ApiError ? error.message : t("Modifica non riuscita"), "error"),
  });
}

export function useDeleteDeal() {
  const { t } = useTranslation();
  const invalidate = useInvalidateTaskWorld();
  const toast = useToast();
  return useMutation({
    mutationFn: (id: string) => api<void>(`/api/deals/${id}`, { method: "DELETE" }),
    onSuccess: () => {
      invalidate();
      toast(t("Offerta spostata nel cestino"), "success");
    },
    onError: (error) =>
      toast(error instanceof ApiError ? error.message : t("Eliminazione non riuscita"), "error"),
  });
}
