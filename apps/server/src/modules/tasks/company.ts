import type { Prisma } from "../../generated/prisma/client";

/**
 * **Il cliente di un task**, in un posto solo.
 *
 * Un task non ha un campo "cliente" da leggere: l'azienda arriva da dove
 * capita — dal task stesso (offerte e richieste), dall'offerta collegata o da
 * quella che l'ha generato, dal progetto di appartenenza o da quello di
 * riferimento. Derivare invece di copiare vuol dire che collegare un task a
 * un'offerta o a un progetto gli dà il cliente da sé, e che il cliente resta
 * giusto anche quando cambia sul progetto.
 *
 * Il prezzo è che la stessa precedenza serve in **tre forme**: l'oggetto da
 * mostrare in elenco, l'id per contare quanti task ha ogni cliente, e un
 * `where` per filtrare. Scritte in tre punti, prima o poi una delle tre
 * diverge — e il filtro comincia a nascondere righe che l'elenco mostra. Qui
 * l'ordine è dichiarato una volta e le tre forme lo seguono.
 */

/** Le vie da cui il cliente può arrivare, **in ordine di precedenza**. */
const SOURCES = ["company", "relatedDeal", "sourceDeal", "project", "relatedProject"] as const;

type WithCompany = { company?: { id: string; name: string } | null } | null | undefined;
type TaskLike = {
  company?: { id: string; name: string } | null;
  relatedDeal?: WithCompany;
  sourceDeal?: WithCompany;
  project?: WithCompany;
  relatedProject?: WithCompany;
};

/** L'azienda da mostrare: la prima che c'è, nell'ordine dichiarato. */
export function companyOf(task: TaskLike): { id: string; name: string } | null {
  for (const source of SOURCES) {
    const found = source === "company" ? task.company : task[source]?.company;
    if (found) return found;
  }
  return null;
}

/**
 * Il `where` per filtrare su un cliente: **una delle vie** deve portarci.
 *
 * Va messo dentro un `AND`, non appoggiato accanto agli altri filtri: due
 * chiavi `OR` fratelle nello stesso oggetto si sovrascrivono, e a perdere
 * sarebbe la ricerca per testo o questa, a seconda dell'ordine di scrittura.
 */
export function companyWhere(companyId: string): Prisma.TaskWhereInput {
  return {
    OR: [
      { companyId },
      { relatedDeal: { companyId } },
      { sourceDeal: { companyId } },
      { project: { companyId } },
      { relatedProject: { companyId } },
    ],
  };
}

/** Lo stesso, per **nome**: è quello che serve alla ricerca globale. */
export function companyNameWhere(q: string): Prisma.TaskWhereInput {
  const company = { name: { contains: q } };
  return {
    OR: [
      { company },
      { relatedDeal: { company } },
      { sourceDeal: { company } },
      { project: { company } },
      { relatedProject: { company } },
    ],
  };
}

/** Il minimo da leggere per sapere di chi è un task: serve ai conteggi. */
export const companyIdSelect = {
  companyId: true,
  relatedDeal: { select: { companyId: true } },
  sourceDeal: { select: { companyId: true } },
  project: { select: { companyId: true } },
  relatedProject: { select: { companyId: true } },
} satisfies Prisma.TaskSelect;

type IdsOnly = {
  companyId?: string | null;
  relatedDeal?: { companyId: string | null } | null;
  sourceDeal?: { companyId: string | null } | null;
  project?: { companyId: string | null } | null;
  relatedProject?: { companyId: string | null } | null;
};

/** L'id del cliente, con la stessa precedenza di `companyOf`. */
export function companyIdOf(task: IdsOnly): string | null {
  return (
    task.companyId ??
    task.relatedDeal?.companyId ??
    task.sourceDeal?.companyId ??
    task.project?.companyId ??
    task.relatedProject?.companyId ??
    null
  );
}
