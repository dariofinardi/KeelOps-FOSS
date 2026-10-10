// Copyright (c) 2026 Jugaad s.r.l.
// SPDX-License-Identifier: AGPL-3.0-only

import { useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import { isRichTextEmpty } from "@kancrm/shared";
import type { ProjectColor, ProjectIcon } from "@kancrm/shared";
import { ApiError } from "@/lib/api";
import { isDirtyForm, useSaveOrDiscard } from "@/lib/unsaved-changes";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { DescriptionField } from "@/components/ui/rich-text/DescriptionField";
import { CompanyCombobox } from "@/features/crm/CompanyCombobox";
import { useCampoAzienda } from "@/features/crm/useCampoAzienda";
import { DealCombobox } from "@/features/deals/DealCombobox";
import { useCurrentUser } from "@/features/auth/useAuth";
import { ColorPicker, IconPicker } from "./project-style";
import { useCreateProject, useUpdateProject } from "./useProjects";

/** Ciò che serve al form per modificare: va bene sia la card sia il dettaglio. */
export interface ProjectFormValue {
  id: string;
  name: string;
  description: string | null;
  company: { id: string; name: string } | null;
  deal?: { id: string; title: string } | null;
  color: ProjectColor | null;
  icon: ProjectIcon | null;
}

/**
 * Il form del progetto: crea se `project` manca, modifica se c'è.
 *
 * Era in due componenti gemelli (nuovo/modifica) con gli stessi campi, la
 * stessa domanda "Mantieni / Torna com'era" e lo stesso corpo: due copie da
 * tenere allineate a ogni campo aggiunto. Qui è uno solo, guidato dalla
 * presenza del progetto. Si apre da più posti — il pulsante "Nuovo", il menù
 * contestuale della card, il pulsante nel dettaglio: le azioni offerte in un
 * elenco devono esistere anche dentro il record.
 *
 * Va montato **solo quando aperto** (con `key` per-record in modifica), così i
 * campi partono sempre dal dato salvato e non resta stato tra un'apertura e
 * l'altra.
 */
export function ProjectFormDialog({
  project,
  onClose,
}: {
  /** Assente = nuovo progetto; presente = modifica di quello. */
  project?: ProjectFormValue;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const editing = project !== undefined;
  const saveOrDiscard = useSaveOrDiscard();
  // Senza il modulo Offerte non si può scegliere: il campo non compare, e il
  // legame eventualmente già presente resta dov'è.
  const canSeeDeals = useCurrentUser().canSeeDeals;
  const createProject = useCreateProject();
  const updateProject = useUpdateProject();
  const [name, setName] = useState(project?.name ?? "");
  const [description, setDescription] = useState(project?.description ?? "");
  // Il cliente si scrive e basta: al salvataggio si trova o si crea.
  const azienda = useCampoAzienda(project?.company?.id ?? null);
  const [dealId, setDealId] = useState<string | null>(project?.deal?.id ?? null);
  const [color, setColor] = useState<ProjectColor | null>(project?.color ?? null);
  const [icon, setIcon] = useState<ProjectIcon | null>(project?.icon ?? null);
  const [error, setError] = useState<string | null>(null);

  const pending = editing ? updateProject.isPending : createProject.isPending;

  // Uscendo (Annulla, ✕, Esc) si sceglie: salvare, o buttare via quel che si è scritto.
  const onSubmit = async (event?: FormEvent) => {
    event?.preventDefault();
    setError(null);
    const onError = (err: unknown) =>
      setError(err instanceof ApiError ? err.message : t("Errore imprevisto"));
    let companyId: string | null;
    try {
      companyId = await azienda.risolvi();
    } catch (err) {
      onError(err);
      return;
    }
    const payload = {
      name,
      description: isRichTextEmpty(description) ? null : description,
      companyId,
      dealId,
      color,
      icon,
    };
    if (editing) {
      updateProject.mutate({ id: project.id, ...payload }, { onSuccess: onClose, onError });
    } else {
      createProject.mutate(payload, { onSuccess: onClose, onError });
    }
  };

  const requestClose = () =>
    saveOrDiscard({
      isDirty: isDirtyForm([
        [name, project?.name ?? ""],
        [description, project?.description ?? ""],
        [azienda.companyId, project?.company?.id ?? null],
        [azienda.testo, ""],
        [dealId, project?.deal?.id ?? null],
        [color, project?.color ?? null],
        [icon, project?.icon ?? null],
      ]),
      canSave: name.trim() !== "",
      what: editing ? t("le modifiche") : t("il nuovo progetto"),
      onSave: () => onSubmit(),
      onDiscard: onClose,
    });

  return (
    <Dialog
      open
      onClose={requestClose}
      title={editing ? t("Modifica progetto") : t("Nuovo progetto")}
    >
      <form onSubmit={onSubmit} className="flex flex-col gap-4">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="project-name" importance="required">
            {t("Nome")}
          </Label>
          <Input
            id="project-name"
            required
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label>{t("Azienda cliente")}</Label>
          <CompanyCombobox {...azienda.comboProps} />
        </div>
        {/* Da quale offerta nasce la commessa: la mette il commerciale chiudendo
            l'offerta, oppure si sceglie qui quando il progetto si crea a mano. */}
        {canSeeDeals && (
          <div className="flex flex-col gap-1.5">
            <Label>{t("Offerta di provenienza")}</Label>
            <DealCombobox value={dealId} onChange={setDealId} includeClosed />
          </div>
        )}
        <DescriptionField
          value={description}
          onChange={setDescription}
          dialogTitle={t("Descrizione del progetto")}
          placeholder={t("Di cosa si occupa questo progetto?")}
        />
        <div className="flex flex-col gap-2">
          <Label>{t("Colore del bordo")}</Label>
          <ColorPicker value={color} onChange={setColor} />
        </div>
        <div className="flex flex-col gap-2">
          <Label>{t("Icona")}</Label>
          <IconPicker value={icon} onChange={setIcon} />
        </div>
        {!editing && (
          <p className="text-xs text-muted-foreground">
            {t("Sarai il manager del progetto: potrai aggiungere membri e gestirne i ruoli.")}
          </p>
        )}
        {error && <p className="text-sm text-destructive">{error}</p>}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={requestClose}>
            {t("Annulla")}
          </Button>
          <Button type="submit" disabled={pending}>
            {pending
              ? editing
                ? t("Salvataggio…")
                : t("Creazione…")
              : editing
                ? t("Salva")
                : t("Crea progetto")}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
