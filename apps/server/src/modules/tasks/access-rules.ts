// Copyright (c) 2026 Jugaad s.r.l.
// SPDX-License-Identifier: AGPL-3.0-only

import { TaskKind, type VisibilityAccess } from "@kancrm/shared";
import type { Prisma, User } from "../../generated/prisma/client";
import { moduliAttivi } from "../../edition/registry";
import type { TaskAccessInfo } from "./access";
import type { TaskAccessContext } from "./permissions";

/**
 * **Le regole di accesso ai task che porta un modulo dell'edizione**
 * (08/10/2026). La regola unica (`permissions.ts`) decide per i ruoli e i tipi
 * del nucleo; i moduli commerciali aggiungono i loro — i ticket e il portale, il
 * monitor vendite — senza che il nucleo li conosca per nome.
 *
 * Un esito `null` è «nessun parere»: si passa alla regola dopo, e infine a
 * quelle del nucleo. Le regole dei moduli girano **dopo** la sola regola delle
 * menzioni (che vale per i ruoli del nucleo) e **prima** di tutte le altre.
 */
export type RifiutoAccesso = { status: 403 | 404; message: string };
export type EsitoAccesso = { consenti: true } | { nega: RifiutoAccesso } | null;

export interface RegoleAccessoTask {
  /** I tipi di task che il modulo porta: il nucleo nega quelli che nessuno porta. */
  tipi?: readonly string[];
  /** Quello che il modulo aggiunge al contesto, letto una volta per richiesta. */
  contesto?: (user: User) => Promise<Partial<TaskAccessContext>>;
  vista?: (ctx: TaskAccessContext, task: TaskAccessInfo) => EsitoAccesso;
  modifica?: (
    ctx: TaskAccessContext,
    task: TaskAccessInfo,
    viewDenial: RifiutoAccesso | undefined,
  ) => EsitoAccesso;
  /** Oltre a poterlo modificare: `null` = decide il nucleo. */
  eliminazione?: (ctx: TaskAccessContext, task: TaskAccessInfo) => boolean | null;
  /**
   * Il contributo del modulo al perimetro degli elenchi trasversali
   * (`visibility/task-perimeter.ts`): rami in più dell'`OR` dei tipi visibili.
   */
  perimetro?: (user: User) => Promise<Prisma.TaskWhereInput[]>;
  /** L'accesso d'area che serve a modificare i task «di altri» di un tipo suo. */
  accessoArea?: Readonly<Record<string, (ctx: TaskAccessContext) => VisibilityAccess | null>>;
}

let impostate: readonly RegoleAccessoTask[] | null = null;

/** Le regole dei moduli attivi (o di quelli dell'edizione configurata, fuori da `buildApp`). */
export function regoleAccessoTask(): readonly RegoleAccessoTask[] {
  return (impostate ??= moduliAttivi().flatMap((m) => (m.accessoTask ? [m.accessoTask] : [])));
}

export function impostaRegoleAccessoTask(regole: readonly RegoleAccessoTask[]): void {
  impostate = regole;
}

const TIPI_DEL_NUCLEO: ReadonlySet<string> = new Set([
  TaskKind.ADMIN,
  TaskKind.PROJECT,
  TaskKind.DEAL,
  TaskKind.PERSONAL,
]);

/** Un tipo di task che questa edizione sa servire. */
export function tipoTaskPrevisto(tipo: string): boolean {
  return TIPI_DEL_NUCLEO.has(tipo) || regoleAccessoTask().some((r) => r.tipi?.includes(tipo));
}
