// Copyright (c) 2026 Jugaad s.r.l.
// SPDX-License-Identifier: AGPL-3.0-only

import { randomBytes } from "node:crypto";
import { TaskKind } from "@kancrm/shared";
import { prisma } from "../../db";
import { badRequest, notFound } from "../../lib/http-errors";
import { assertProjectView } from "../projects/access";
import type { Prisma, User } from "../../generated/prisma/client";

/**
 * Le bacheche che si possono sottoscrivere come calendario.
 *
 * Una per feed, con il suo token: chi si iscrive sceglie cosa vedere e può
 * revocarne una senza toccare le altre. Un tecnico non deve ritrovarsi in
 * agenda le scadenze fiscali, e chi lascia un progetto non deve continuare a
 * vederne le consegne dal telefono.
 *
 * **Il perimetro non è scritto qui**: ogni feed rilegge i permessi a ogni
 * lettura, con le stesse regole dell'applicazione (`assertProjectView`,
 * `getBoardForView`, i campi assegnatario/supervisore). Un token che sopravvive
 * alla perdita dell'accesso non deve mostrare più niente.
 */
export const FEED_SCOPES = ["MINE", "SUPERVISED", "PROJECT"] as const;
export type FeedScope = (typeof FEED_SCOPES)[number];

export interface FeedTasksQuery {
  where: Prisma.TaskWhereInput;
  /** Nome del calendario, come lo mostrerà il client. */
  label: string;
}

/**
 * Cosa entra in un feed, ricalcolato al momento della lettura.
 *
 * Solo task **con una data**: un calendario mostra ciò che accade in un giorno,
 * e i client di posta i "senza data" (VTODO) li ignorano comunque — pubblicarli
 * vorrebbe dire spedirli e sperare. Restano dentro anche i chiusi di recente,
 * barrati: un evento che sparisce dall'agenda senza spiegazione è peggio.
 */
export async function feedQuery(
  user: User,
  scope: string,
  targetId: string | null,
): Promise<FeedTasksQuery> {
  const dated: Prisma.TaskWhereInput = {
    deletedAt: null,
    OR: [{ dueDate: { not: null } }, { kind: TaskKind.DEAL, expectedCloseDate: { not: null } }],
  };

  if (scope === "MINE") {
    return { label: "Le mie scadenze", where: { ...dated, assigneeId: user.id, boardId: null } };
  }
  if (scope === "SUPERVISED") {
    return {
      label: "Task che supervisiono",
      where: { ...dated, supervisorId: user.id, boardId: null },
    };
  }
  if (scope === "PROJECT") {
    if (!targetId) throw badRequest("Feed di progetto senza progetto");
    // Ripassa dai permessi del progetto: chi ne è uscito non vede più niente,
    // e chi ci ha solo del lavoro vede solo il proprio.
    const { onlyOwnTasks } = await assertProjectView(user, targetId);
    const project = await prisma.project.findUnique({ where: { id: targetId } });
    return {
      label: `Progetto: ${project?.name ?? "—"}`,
      where: {
        // `dated` porta la sua chiave `OR` (dueDate/expectedCloseDate not null):
        // il filtro dei propri task va sotto AND, o cancellerebbe quella e
        // farebbe entrare task senza data — che nel mapper esplodono su date!.
        AND: [
          dated,
          { projectId: targetId },
          ...(onlyOwnTasks
            ? [{ OR: [{ assigneeId: user.id }, { supervisorId: user.id }, { creatorId: user.id }] }]
            : []),
        ],
      },
    };
  }
  // Il feed per bacheca personale si è ritirato con «Personale» diventato
  // plugin (05/09/2026): zero in uso, e un plugin non riceve il segreto di firma.
  throw badRequest("Tipo di calendario sconosciuto");
}

/** Un token nuovo: 32 byte, come una password che nessuno digiterà mai. */
export function newFeedToken(): string {
  return randomBytes(32).toString("base64url");
}

/** Crea il feed (o restituisce quello che c'è già: due link per la stessa
 *  bacheca sarebbero solo due cose da revocare invece di una). */
export async function ensureFeed(user: User, scope: FeedScope, targetId: string | null) {
  const { label } = await feedQuery(user, scope, targetId);
  const existing = await prisma.calendarFeed.findFirst({
    where: { userId: user.id, scope, targetId },
  });
  if (existing) return existing;
  return prisma.calendarFeed.create({
    data: { userId: user.id, scope, targetId, label, token: newFeedToken() },
  });
}

/** Il feed di quel token, se esiste e se l'utente è ancora attivo. */
export async function feedByToken(token: string) {
  const feed = await prisma.calendarFeed.findUnique({ where: { token }, include: { user: true } });
  if (!feed || !feed.user.isActive) throw notFound("Calendario non trovato");
  return feed;
}
