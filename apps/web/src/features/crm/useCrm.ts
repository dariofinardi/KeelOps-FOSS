// Copyright (c) 2026 Jugaad s.r.l.
// SPDX-License-Identifier: AGPL-3.0-only

import { useMemo } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  CompanyDetail,
  CompanyListItem,
  CompanyMatch,
  ContactDetail,
  ContactListItem,
  CrmNote,
  ImportContactsResult,
  Paged,
  ResolveCompanyInput,
  ResolvedCompany,
  UpsertCompanyInput,
  UpsertContactInput,
} from "@kancrm/shared";
import { api, apiUpload } from "@/lib/api";

export function useCompanies(q: string, page = 1) {
  const params = new URLSearchParams({ page: String(page) });
  if (q) params.set("q", q);
  return useQuery({
    queryKey: ["companies", q, page],
    queryFn: () => api<Paged<CompanyListItem>>(`/api/companies?${params.toString()}`),
  });
}

export function useCompanyDetail(id: string | null) {
  return useQuery({
    queryKey: ["company", id],
    queryFn: () => api<CompanyDetail>(`/api/companies/${id}`),
    enabled: id !== null,
  });
}

/** `enabled: false` per gli utenti senza visibilità sulle persone (evita 403). */
/**
 * Persone selezionabili in una form: scelta l'azienda restano solo i suoi
 * referenti, altrimenti si vedono tutte. L'azienda è facoltativa, la persona no.
 */
export function useContactOptions(companyId: string | null | undefined, enabled = true) {
  const { data } = useContacts("", 1, enabled);
  return useMemo(() => {
    const items = data?.items ?? [];
    return companyId ? items.filter((contact) => contact.company?.id === companyId) : items;
  }, [data, companyId]);
}

export function useContacts(q: string, page = 1, enabled = true) {
  const params = new URLSearchParams({ page: String(page) });
  if (q) params.set("q", q);
  return useQuery({
    queryKey: ["contacts", q, page],
    queryFn: () => api<Paged<ContactListItem>>(`/api/contacts?${params.toString()}`),
    enabled,
  });
}

export function useContactDetail(id: string | null) {
  return useQuery({
    queryKey: ["contact", id],
    queryFn: () => api<ContactDetail>(`/api/contacts/${id}`),
    enabled: id !== null,
  });
}

function useInvalidateCrm() {
  const queryClient = useQueryClient();
  return () => {
    for (const key of ["companies", "company", "contacts", "contact", "deals"]) {
      void queryClient.invalidateQueries({ queryKey: [key] });
    }
  };
}

export function useUpsertCompany() {
  const invalidate = useInvalidateCrm();
  return useMutation({
    mutationFn: ({ id, ...input }: UpsertCompanyInput & { id?: string }) =>
      id
        ? api<{ id: string }>(`/api/companies/${id}`, { method: "PATCH", body: input })
        : api<{ id: string }>("/api/companies", { method: "POST", body: input }),
    onSuccess: invalidate,
  });
}

/**
 * L'azienda che ha già questo nome, scritta anche diversa («Jugaad srl» per
 * «Jugaad»). Serve alla tendina per proporre quella invece di crearne una.
 */
export function useCompanyMatch(name: string) {
  const nome = name.trim();
  return useQuery({
    queryKey: ["company-match", nome],
    queryFn: () =>
      api<CompanyMatch>(`/api/companies/match?${new URLSearchParams({ name: nome }).toString()}`),
    enabled: nome !== "",
    staleTime: 30_000,
  });
}

/** Trova o crea l'azienda per nome: la strada morbida dei moduli (vedi `useCampoAzienda`). */
export function useResolveCompany() {
  const invalidate = useInvalidateCrm();
  return useMutation({
    mutationFn: (input: ResolveCompanyInput) =>
      api<ResolvedCompany>("/api/companies/resolve", { method: "POST", body: input }),
    onSuccess: invalidate,
  });
}

export function useDeleteCompany() {
  const invalidate = useInvalidateCrm();
  return useMutation({
    mutationFn: (id: string) => api<void>(`/api/companies/${id}`, { method: "DELETE" }),
    onSuccess: invalidate,
  });
}

export function useUpsertContact() {
  const invalidate = useInvalidateCrm();
  return useMutation({
    mutationFn: ({ id, ...input }: UpsertContactInput & { id?: string }) =>
      id
        ? api<{ id: string }>(`/api/contacts/${id}`, { method: "PATCH", body: input })
        : api<{ id: string }>("/api/contacts", { method: "POST", body: input }),
    onSuccess: invalidate,
  });
}

export function useDeleteContact() {
  const invalidate = useInvalidateCrm();
  return useMutation({
    mutationFn: (id: string) => api<void>(`/api/contacts/${id}`, { method: "DELETE" }),
    onSuccess: invalidate,
  });
}

export function useAddCrmNote() {
  const invalidate = useInvalidateCrm();
  return useMutation({
    mutationFn: ({
      target,
      id,
      body,
    }: {
      target: "companies" | "contacts";
      id: string;
      body: string;
    }) => api<CrmNote>(`/api/${target}/${id}/notes`, { method: "POST", body: { body } }),
    onSuccess: invalidate,
  });
}

export function useImportContacts() {
  const invalidate = useInvalidateCrm();
  return useMutation({
    mutationFn: async (file: File) => {
      return apiUpload<ImportContactsResult>("/api/contacts/import", file);
    },
    onSuccess: invalidate,
  });
}
