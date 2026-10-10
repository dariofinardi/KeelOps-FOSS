// Copyright (c) 2026 Jugaad s.r.l.
// SPDX-License-Identifier: AGPL-3.0-only

import { useEffect, useRef, useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import { ApiError } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { CompanyCombobox } from "./CompanyCombobox";
import { useResolveCompany, useUpsertContact } from "./useCrm";
import { useCampoAzienda } from "./useCampoAzienda";
import { useToast } from "@/components/ui/toast";
import { isDirtyForm, useSaveOrDiscard } from "@/lib/unsaved-changes";

// Creazione al volo di azienda/contatto senza passare dal modulo Contatti.
// `onCreated` riceve l'id del record creato per selezionarlo subito nel form.

export function QuickAddCompanyDialog({
  open,
  onClose,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  onCreated: (id: string) => void;
}) {
  const { t } = useTranslation();
  const saveOrDiscard = useSaveOrDiscard();
  const toast = useToast();
  // Trova o crea: «Jugaad srl» quando c'è già «Jugaad» sceglie quella, e lo dice.
  const upsert = useResolveCompany();
  const [name, setName] = useState("");
  const [city, setCity] = useState("");
  const [error, setError] = useState<string | null>(null);

  // Il dialogo resta MONTATO: senza ripulire all'apertura, "butta via quel che
  // hai scritto" non buttava via niente e il modulo si riapriva con la bozza
  // di prima (24/08/2026).
  useOpening(open, () => {
    setName("");
    setCity("");
    setError(null);
  });

  // Uscendo si sceglie: creare, o buttare via quel che si è scritto.
  const onSubmit = (event?: FormEvent) => {
    event?.preventDefault();
    event?.stopPropagation(); // non inviare il form della dialog sottostante
    setError(null);
    upsert.mutate(
      { name, city: city || null },
      {
        onSuccess: (result) => {
          setName("");
          setCity("");
          if (!result.created) {
            toast(t("«{{name}}» c'era già: è quella che hai scelto", { name: result.name }));
          }
          onCreated(result.id);
          onClose();
        },
        onError: (err) => setError(err instanceof ApiError ? err.message : t("Errore imprevisto")),
      },
    );
  };

  const requestClose = () =>
    saveOrDiscard({
      isDirty: isDirtyForm([
        [name, ""],
        [city, ""],
      ]),
      canSave: name.trim() !== "",
      what: t("la nuova azienda"),
      onSave: () => onSubmit(),
      onDiscard: onClose,
    });

  return (
    <Dialog open={open} onClose={requestClose} title={t("Nuova azienda al volo")}>
      <form onSubmit={onSubmit} className="flex flex-col gap-4">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="qa-company-name">{t("Ragione sociale")}</Label>
          <Input
            id="qa-company-name"
            required
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="qa-company-city">{t("Città (opzionale)")}</Label>
          <Input id="qa-company-city" value={city} onChange={(e) => setCity(e.target.value)} />
        </div>
        {error && <p className="text-sm text-destructive">{error}</p>}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={requestClose}>
            {t("Annulla")}
          </Button>
          <Button type="submit" disabled={upsert.isPending}>
            {upsert.isPending ? t("Creazione…") : t("Crea e seleziona")}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

export function QuickAddContactDialog({
  open,
  onClose,
  onCreated,
  defaultCompanyId,
}: {
  open: boolean;
  onClose: () => void;
  /** L'azienda viaggia col contatto: chi ospita può allinearsi (offerte). */
  onCreated: (id: string, companyId: string | null) => void;
  /** Precompila l'azienda (es. quella già scelta nell'offerta). */
  defaultCompanyId?: string | null;
}) {
  const { t } = useTranslation();
  const saveOrDiscard = useSaveOrDiscard();
  const upsert = useUpsertContact();
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [email, setEmail] = useState("");
  const azienda = useCampoAzienda(defaultCompanyId ?? null);
  const [error, setError] = useState<string | null>(null);

  /**
   * **L'azienda si rilegge a ogni apertura.**
   *
   * `useState` prende il valore iniziale una volta sola, e questo dialogo sta
   * montato per tutta la vita del form che lo ospita: aprendolo DOPO aver
   * scelto l'azienda nell'offerta, il campo restava vuoto e la persona nasceva
   * senza azienda — quindi fuori dall'elenco dei referenti di quel cliente, e
   * l'offerta sembrava non prenderla (24/08/2026, due contatti orfani in
   * produzione).
   */
  useOpening(open, () => {
    setFirstName("");
    setLastName("");
    setEmail("");
    azienda.reimposta(defaultCompanyId ?? null);
    setError(null);
  });

  // Uscendo si sceglie: creare, o buttare via quel che si è scritto.
  const onSubmit = async (event?: FormEvent) => {
    event?.preventDefault();
    event?.stopPropagation();
    setError(null);
    let companyId: string | null;
    try {
      companyId = await azienda.risolvi();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t("Errore imprevisto"));
      return;
    }
    upsert.mutate(
      {
        firstName,
        lastName,
        email: email || null,
        companyId,
      },
      {
        onSuccess: (result) => {
          setFirstName("");
          setLastName("");
          setEmail("");
          onCreated(result.id, companyId);
          onClose();
        },
        onError: (err) => setError(err instanceof ApiError ? err.message : t("Errore imprevisto")),
      },
    );
  };

  const requestClose = () =>
    saveOrDiscard({
      isDirty: isDirtyForm([
        [firstName, ""],
        [lastName, ""],
        [email, ""],
        [azienda.companyId, defaultCompanyId ?? null],
        [azienda.testo, ""],
      ]),
      canSave: firstName.trim() !== "" && lastName.trim() !== "",
      what: t("il nuovo contatto"),
      onSave: () => onSubmit(),
      onDiscard: onClose,
    });

  return (
    <Dialog open={open} onClose={requestClose} title={t("Nuovo contatto al volo")}>
      <form onSubmit={onSubmit} className="flex flex-col gap-4">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="qa-contact-first">{t("Nome")}</Label>
            <Input
              id="qa-contact-first"
              required
              autoFocus
              value={firstName}
              onChange={(e) => setFirstName(e.target.value)}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="qa-contact-last">{t("Cognome")}</Label>
            <Input
              id="qa-contact-last"
              required
              value={lastName}
              onChange={(e) => setLastName(e.target.value)}
            />
          </div>
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="qa-contact-email">{t("Email (opzionale)")}</Label>
          <Input
            id="qa-contact-email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label>{t("Azienda (opzionale)")}</Label>
          <CompanyCombobox {...azienda.comboProps} />
        </div>
        {error && <p className="text-sm text-destructive">{error}</p>}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={requestClose}>
            {t("Annulla")}
          </Button>
          <Button type="submit" disabled={upsert.isPending || azienda.inCorso}>
            {upsert.isPending ? t("Creazione…") : t("Crea e seleziona")}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

/** Esegue `azione` quando il dialogo PASSA da chiuso ad aperto, non a ogni giro. */
function useOpening(open: boolean, azione: () => void): void {
  const eraAperto = useRef(open);
  const ultima = useRef(azione);
  ultima.current = azione;
  useEffect(() => {
    if (open && !eraAperto.current) ultima.current();
    eraAperto.current = open;
  }, [open]);
}

