// Copyright (c) 2026 Jugaad s.r.l.
// SPDX-License-Identifier: AGPL-3.0-only

import type { ComponentType, ReactNode } from "react";
import type { TFunction } from "i18next";
import type { DealDetail, TaskDetail, TaskStatus, TimesheetHint } from "@kancrm/shared";
import type { ToastOptions } from "@/components/ui/toast";
import type { RichiestaDelTask } from "@/features/tasks/richiesta";
import { SLOT_COMMERCIALI } from "./commercial/slots";

/**
 * **I punti in cui l'edizione aggiunge qualcosa alle pagine del nucleo**
 * (08/10/2026). Il nucleo non importa i componenti commerciali per nome: rende
 * lo slot, se c'è. Nella community l'oggetto è vuoto e al loro posto non
 * compare niente; nella commerciale lo riempie `commercial/slots.tsx`, l'unico
 * file che il nucleo legge per saperlo.
 *
 * Gli slot sono componenti importati in modo statico, non `lazy`: ogni pagina
 * che ne rende uno se li portava già dietro, e così continua — stesso grafo
 * dei moduli, stesso disegno al primo colpo.
 */
export interface AzioniProgettoProps {
  projectId: string;
  projectName: string;
  statuses: TaskStatus[];
  onlyOwnTasks: boolean;
  canEdit: boolean;
}

/** A document chosen in the Drive picker: what a LINK attachment needs. */
export interface DocumentoDrive {
  name: string;
  url: string;
  mimeType: string;
}

/** The Drive picker: whether to show its button, and what it returns when used. */
export interface SelettoreDrive {
  enabled: boolean;
  open: () => Promise<DocumentoDrive[]>;
}

export interface SlotEdizione {
  /** Intestazione dell'offerta: la lettura degli allegati (modulo analisi-offerte). */
  LetturaAllegati?: ComponentType<{ dealId: string; allegati: DealDetail["attachments"] }>;
  /** Il pannello di una richiesta di supporto (kind TICKET), aperto da un elenco o da un link. */
  PannelloTicket?: ComponentType<{
    ticketId: string | null;
    onClose: () => void;
    editable: boolean;
    layer?: "panel" | "over";
  }>;
  /** Nel pannello del task: presa in carico e richiedente (hook, uguale a ogni render). */
  useRichiesta?: (task: TaskDetail) => RichiestaDelTask;
  /** Nella chat dal portale: le persone menzionabili su quella richiesta (hook). */
  usePersoneDellaRichiesta?: (taskId: string | null) => {
    data: Array<{ id: string; name: string }> | undefined;
  };
  /** Il dialogo «Registra le ore di oggi» del pannello del task (modulo timesheet). */
  RegistraOre?: ComponentType<{ taskId: string; title: string; onClose: () => void }>;
  /** Login page: the "Sign in with Google" button (module google). */
  AccessoGoogle?: ComponentType;
  /** Login page: the messages of the `?sso=` outcome, back from Google (module google). */
  esitiAccessoGoogle?: Readonly<Record<string, string>>;
  /** Attachments of tasks, offers, recurrences: the Google Drive picker (hook, module google). */
  useSelettoreDrive?: () => SelettoreDrive;
  /** Dopo un cambio di stato verso uno aperto: i lavori simili, se ci sono (indice-modelli). */
  lavoriSimili?: (
    taskId: string,
    toast: (message: ReactNode, tone?: "info" | "success" | "error", o?: ToastOptions) => void,
    t: TFunction,
  ) => Promise<void>;
}

export const slot: SlotEdizione = SLOT_COMMERCIALI;

/**
 * **Gli slot delle pagine**: componenti che una pagina sola rende (la giornata,
 * il progetto, Aspetto, Sistema). Stanno fuori dall'oggetto `slot` perché quello
 * lo leggono anche moduli del bundle iniziale, e tutto ciò che contiene finirebbe
 * lì (misurato: 55 KB in più al primo caricamento). Ognuno sta in un file suo e
 * si importa per nome da `edition/slot-pagine.ts`: così finisce nel pezzo della
 * pagina che lo usa, come quando la pagina lo importava da sé.
 */
export interface SlotPagine {
  /** Intestazione del progetto: nota di rilascio e note per il portale, con i loro dialoghi. */
  AzioniProgetto?: ComponentType<AzioniProgettoProps>;
  /** Pagina Aspetto, in coda: i modelli Word di nota e newsletter. */
  SezioniAspetto?: ComponentType;
  /** Pagina Sistema, dopo i plugin: le chiavi dei Client API e i moduli iniettabili. */
  SezioniSistema?: ComponentType;
  /** Timesheet grid, next to the task picker: rows from activity, removal of empty rows. */
  RigheDalleAttivita?: ComponentType<{ period: string }>;
  /** Timesheet grid: suggested hours in the empty cells (hook, the same at every render). */
  useOreSuggerite?: (period: string, enabled: boolean) => { data: TimesheetHint[] | undefined };
  /** Timesheet summaries: the client report (.docx) and the CSV export. */
  EsportazioniOre?: ComponentType<{ month: string; breakdownUserIds: string[] }>;
  /** Timesheet: the Report view with the users' newsletter. */
  VistaReportOre?: ComponentType<{
    period: string;
    soloPeriodo: boolean;
    onSoloPeriodo: (soloPeriodo: boolean) => void;
    etichettaPeriodo: string;
  }>;
  /** Timesheet summaries: the productivity of the month. */
  ProduttivitaOre?: ComponentType<{ month: string; selected: string[] }>;
}
