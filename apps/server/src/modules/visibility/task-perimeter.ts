// Copyright (c) 2026 Jugaad s.r.l.
// SPDX-License-Identifier: AGPL-3.0-only

import { TaskKind, UserRole, VisibilityScope } from "@kancrm/shared";
import { prisma } from "../../db";
import type { Prisma, User } from "../../generated/prisma/client";
import { canSeeScope, manageableCategories } from "./service";
import { regoleAccessoTask } from "../tasks/access-rules";

/**
 * Il perimetro dei task visibili a un utente, come filtro Prisma componibile:
 * è la versione "a insieme" della regola per-record di `tasks/permissions.ts`,
 * per le query che attraversano TUTTI i moduli in un colpo solo — la ricerca
 * globale, la tendina del timesheet. (Gli elenchi per-modulo hanno le loro
 * query: qui interessa il taglio trasversale.)
 *
 * Era scritto tre volte (ricerca, timesheet, dashboard) ed era GIÀ divergente:
 * la tendina del timesheet non offriva né i propri task dello scadenzario a chi
 * non ha lo scope, né i task assegnati in progetti di cui non si è membri —
 * entrambi lavorabili secondo la regola per-record. Le regole scritte due volte
 * divergono al primo ritocco: questa vive qui e basta.
 *
 * - Scadenzario (ADMIN): tutto con lo scope, altrimenti solo i propri;
 * - Offerte (DEAL): solo con lo scope pieno (la lente "giornate" degli
 *   sviluppatori NON basta: nasconde link e allegati, e un taglio trasversale
 *   li esporrebbe);
 * - Progetti: i membri i loro; chi non è membro comunque i task che gli sono
 *   assegnati/supervisionati/creati; admin e scope Progetti tutto;
 * - i tipi dei moduli dell'edizione (i ticket, con lo scope Ticket): li
 *   aggiunge il modulo (`perimetro` in tasks/access-rules.ts);
 * - il **manager di un'area** trova i task di quell'area, di chiunque siano
 *   (stessa regola della decisione per-record);
 * - mai il cestino, mai i task di board (hanno viste proprie).
 */
export async function visibleTaskWhere(
  user: User,
  options: {
    /**
     * Come entrano i task di progetto:
     *  - `"all"` (default): tutti quelli che l'utente può vedere — membership,
     *    scope Progetti, coinvolgimento. È il perimetro giusto per la RICERCA
     *    e per la tendina del timesheet, dove si cerca ciò che esiste.
     *  - `"involved"`: solo quelli **su cui lavoro io** (assegnatario o
     *    supervisore), e mai quelli di un **progetto archiviato**. Serve alle
     *    Bacheche: essere nella squadra di ventisei progetti non vuol dire
     *    volersi leggere i task di tutti (11/08/2026) — il progetto per intero
     *    si guarda dalla sua pagina, che c'è già. Archiviare un progetto vuol
     *    dire "non ci lavoro più": i suoi task restavano però in elenco, aperti
     *    e senza scadenza rispettata, e nessuno li avrebbe più chiusi
     *    (11/08/2026). Si trovano ancora dalla ricerca e dalla pagina del
     *    progetto, che è dove si va a guardare il passato.
     */
    projectTasks?: "all" | "involved";
  } = {},
): Promise<Prisma.TaskWhereInput | null> {
  const [seesAdmin, seesDeals, seesProjects, daiModuli] = await Promise.all([
    canSeeScope(user, VisibilityScope.ADMIN_TASKS),
    canSeeScope(user, VisibilityScope.DEALS),
    canSeeScope(user, VisibilityScope.PROJECTS),
    // I tipi che portano i moduli dell'edizione (i ticket, con il loro ambito).
    Promise.all(regoleAccessoTask().map((r) => r.perimetro?.(user) ?? [])),
  ]);
  const mine = {
    OR: [{ assigneeId: user.id }, { supervisorId: user.id }, { creatorId: user.id }],
  };

  const kinds: Prisma.TaskWhereInput[] = [];
  // Il manager legge i task dell'AREA che governa, di chiunque siano: è già la
  // regola per-record (`readsAsAreaManager` in tasks/permissions.ts), e senza il
  // gemello qui quei task si potevano aprire ma non si trovavano in nessun
  // elenco (11/08/2026). L'area di un task è quella del suo stato. I ticket
  // restano fuori: hanno un cancello proprio, e anche la regola per-record
  // decide su quelli prima di guardare il manager.
  const managedAreas = [...(await manageableCategories(user))];
  if (managedAreas.length > 0) {
    kinds.push({
      kind: { in: [TaskKind.ADMIN, TaskKind.DEAL, TaskKind.PROJECT] },
      status: { category: { in: managedAreas } },
    });
  }
  if (seesAdmin) kinds.push({ kind: TaskKind.ADMIN });
  else kinds.push({ kind: TaskKind.ADMIN, ...mine });
  if (seesDeals) kinds.push({ kind: TaskKind.DEAL });
  if (options.projectTasks === "involved") {
    // Solo il proprio lavoro: né la membership né lo scope allargano qui.
    kinds.push({
      kind: TaskKind.PROJECT,
      OR: [{ assigneeId: user.id }, { supervisorId: user.id }],
    });
  } else if (user.role === UserRole.ADMIN || seesProjects) {
    kinds.push({ kind: TaskKind.PROJECT });
  } else {
    const memberProjectIds = (
      await prisma.projectMember.findMany({ where: { userId: user.id } })
    ).map((m) => m.projectId);
    if (memberProjectIds.length > 0) {
      kinds.push({ kind: TaskKind.PROJECT, projectId: { in: memberProjectIds } });
    }
    // Assegnato in un progetto di cui non si è membri: il task si lavora
    // (regola dei permessi), quindi si deve anche trovare.
    kinds.push({ kind: TaskKind.PROJECT, ...mine });
  }
  kinds.push(...daiModuli.flat());

  if (kinds.length === 0) return null;
  // Fuori i progetti archiviati, per TUTTE le strade che portano a un task di
  // progetto (il proprio lavoro, ma anche l'area governata da manager): una sola
  // condizione in AND, altrimenti va ripetuta in ogni ramo e la prossima se ne
  // dimentica. I task senza progetto (scadenzario, offerte) non sono toccati.
  const openProjectsOnly =
    options.projectTasks === "involved"
      ? [{ OR: [{ projectId: null }, { project: { isArchived: false } }] }]
      : [];
  return {
    deletedAt: null,
    boardId: null,
    OR: kinds,
    ...(openProjectsOnly.length > 0 ? { AND: openProjectsOnly } : {}),
  };
}
