// Copyright (c) 2026 Jugaad s.r.l.
// SPDX-License-Identifier: AGPL-3.0-only

import { useState } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import { Building2, Check, Plus, X } from "lucide-react";
import { stessaAzienda } from "@kancrm/shared";
import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";
import { useCompanies, useCompanyMatch, useResolveCompany } from "./useCrm";
import { useAnchoredPanel } from "@/lib/useAnchoredPanel";

interface CompanyComboboxProps {
  value: string | null;
  onChange: (companyId: string | null) => void;
  placeholder?: string;
  /**
   * Il testo digitato, tenuto da chi ospita la tendina (vedi `useCampoAzienda`):
   * serve al modulo per usarlo al salvataggio. Senza, la tendina lo tiene per sé.
   */
  text?: string;
  onTextChange?: (text: string) => void;
  /**
   * Il modulo che ospita la tendina **trova o crea l'azienda al salvataggio**
   * dal nome scritto: la tendina lo dice sotto il campo, e uscendo dal campo
   * con il nome di un'azienda che c'è già la sceglie da sé.
   */
  risolviAlSalvataggio?: boolean;
}

/**
 * Combo azienda con filtro: digita per cercare, seleziona dalla lista oppure
 * crea al volo l'azienda col nome digitato se non esiste ancora.
 *
 * **Niente doppioni** (16/09/2026): «jugaad», «Jugaad» e «Jugaad srl» sono la
 * stessa azienda (`stessaAzienda`). Se il nome scritto ce l'ha già un'azienda,
 * la tendina propone quella — «Usa «Jugaad», già presente» — al posto di
 * «Crea», e anche il «Crea» passa dal server che trova prima di creare.
 */
export function CompanyCombobox({
  value,
  onChange,
  placeholder,
  text,
  onTextChange,
  risolviAlSalvataggio = false,
}: CompanyComboboxProps) {
  const { t } = useTranslation();
  const resolvedPlaceholder = placeholder ?? t("Cerca o crea un'azienda…");
  const [testoInterno, setTestoInterno] = useState("");
  const q = text ?? testoInterno;
  const setQ = (valore: string) => {
    if (text === undefined) setTestoInterno(valore);
    onTextChange?.(valore);
  };
  const [open, setOpen] = useState(false);
  /**
   * La tendina vive fuori dal suo contenitore: dentro la tabella degli utenti,
   * che scorre in orizzontale, veniva tagliata subito sotto la prima voce
   * (02/09/2026). Il perché e il come stanno in `lib/useAnchoredPanel`.
   */
  const { ancora, posizione } = useAnchoredPanel<HTMLDivElement>(open);
  const { data: matchData } = useCompanies(q.trim());
  const { data: allData } = useCompanies("");
  const matches = matchData?.items;
  const resolve = useResolveCompany();

  const selected = value ? (allData?.items.find((c) => c.id === value) ?? null) : null;
  const trimmed = q.trim();
  /** L'azienda che ha già il nome scritto, anche se scritta diversa. */
  const { data: matchNome } = useCompanyMatch(trimmed);
  const giaPresente = trimmed ? (matchNome?.company ?? null) : null;
  const exactMatch =
    giaPresente !== null || matches?.some((company) => stessaAzienda(company.name, trimmed));
  /** La proposta «Usa…» serve solo se l'azienda non è già nell'elenco qui sopra. */
  const proponiGiaPresente =
    giaPresente !== null && !matches?.some((company) => company.id === giaPresente.id);

  const select = (companyId: string | null) => {
    onChange(companyId);
    setQ("");
    setOpen(false);
  };

  // Trova o crea: se nel frattempo l'azienda è comparsa, il server dà quella.
  const createAndSelect = () => {
    if (!trimmed || resolve.isPending) return;
    resolve.mutate({ name: trimmed }, { onSuccess: (result) => select(result.id) });
  };

  return (
    <div className="relative" ref={ancora}>
      {selected && !open ? (
        <div className="flex h-9 items-center gap-2 rounded-md border bg-background px-3 text-sm">
          <Building2 className="size-4 shrink-0 text-muted-foreground" />
          <span className="min-w-0 flex-1 truncate">{selected.name}</span>
          <button
            type="button"
            className="text-muted-foreground hover:text-foreground"
            title={t("Cambia azienda")}
            onClick={() => setOpen(true)}
          >
            <span className="text-xs underline">{t("cambia")}</span>
          </button>
          <button
            type="button"
            className="text-muted-foreground hover:text-destructive"
            title={t("Rimuovi azienda")}
            onClick={() => onChange(null)}
          >
            <X className="size-3.5" />
          </button>
        </div>
      ) : (
        <Input
          placeholder={resolvedPlaceholder}
          value={q}
          autoFocus={selected !== null}
          onChange={(e) => {
            setQ(e.target.value);
            setOpen(true);
          }}
          data-no-autofocus
          onFocus={() => setOpen(true)}
          onBlur={() =>
            setTimeout(() => {
              setOpen(false);
              // Uscendo dal campo con il nome di un'azienda che c'è già, la si
              // sceglie: è quello che chi ha scritto intendeva.
              if (risolviAlSalvataggio && !value && giaPresente) select(giaPresente.id);
            }, 150)
          }
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault(); // non inviare il form della dialog
              if (giaPresente) select(giaPresente.id);
              else if (!exactMatch && trimmed) createAndSelect();
              else if (matches?.[0]) select(matches[0].id);
            }
            if (e.key === "Escape") setOpen(false);
          }}
        />
      )}
      {/*
        Cosa succederà salvando: il nome scritto non si perde più in silenzio
        (09/09/2026), e chi scrive sa prima se nasce un'azienda nuova o si usa
        quella che c'è.
      */}
      {risolviAlSalvataggio && !open && !selected && trimmed !== "" && (
        <p className="mt-1 text-xs text-muted-foreground">
          {giaPresente
            ? t("Salvando si collega «{{name}}», già presente", { name: giaPresente.name })
            : t("Salvando si crea l'azienda «{{name}}»", { name: trimmed })}
        </p>
      )}

      {open &&
        posizione !== null &&
        createPortal(
          // fissa e sopra ogni strato: dialog e pannelli stanno a z-50
          <ul
            className="fixed z-[60] overflow-y-auto rounded-md border bg-popover text-popover-foreground shadow-lg"
            style={{
              left: posizione.left,
              top: posizione.top,
              width: posizione.width,
              maxHeight: posizione.maxHeight,
            }}
          >
            <li>
              <button
                type="button"
                className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-muted-foreground hover:bg-muted/50"
                onMouseDown={(e) => {
                  e.preventDefault();
                  select(null);
                }}
              >
                {t("— Nessuna azienda")}
              </button>
            </li>
            {matches?.map((company) => (
              <li key={company.id}>
                <button
                  type="button"
                  className={cn(
                    "flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-muted/50",
                    company.id === value && "font-medium",
                  )}
                  onMouseDown={(e) => {
                    e.preventDefault();
                    select(company.id);
                  }}
                >
                  <Building2 className="size-4 shrink-0 text-muted-foreground" />
                  <span className="min-w-0 flex-1 truncate">{company.name}</span>
                  {company.city && (
                    <span className="shrink-0 text-xs text-muted-foreground">{company.city}</span>
                  )}
                  {company.id === value && <Check className="size-4 shrink-0" />}
                </button>
              </li>
            ))}
            {proponiGiaPresente && giaPresente && (
              <li className="border-t">
                <button
                  type="button"
                  className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm font-medium text-primary hover:bg-muted/50"
                  onMouseDown={(e) => {
                    e.preventDefault();
                    select(giaPresente.id);
                  }}
                >
                  <Building2 className="size-4 shrink-0" />
                  {t("Usa «{{name}}», già presente", { name: giaPresente.name })}
                </button>
              </li>
            )}
            {trimmed && !exactMatch && (
              <li className="border-t">
                <button
                  type="button"
                  className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm font-medium text-primary hover:bg-muted/50"
                  disabled={resolve.isPending}
                  onMouseDown={(e) => {
                    e.preventDefault();
                    createAndSelect();
                  }}
                >
                  <Plus className="size-4 shrink-0" />
                  {resolve.isPending
                    ? t("Creazione…")
                    : t('Crea azienda "{{name}}"', { name: trimmed })}
                </button>
              </li>
            )}
            {trimmed === "" && (matches?.length ?? 0) === 0 && (
              <li className="px-3 py-2 text-sm text-muted-foreground">
                {t("Nessuna azienda censita.")}
              </li>
            )}
          </ul>,
          document.body,
        )}
    </div>
  );
}
