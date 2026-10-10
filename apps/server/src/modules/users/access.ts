// Copyright (c) 2026 Jugaad s.r.l.
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * **Chi può gestire quali utenti**, in un posto solo.
 *
 * Fino al 02/09/2026 la risposta era una sola: l'amministratore, e nessun
 * altro. Poi è arrivata l'area **customer care**, che dà ai manager di gruppo
 * un recinto: i clienti del portale, e nient'altro.
 *
 * Il recinto sta **qui e sul server**, non nell'interfaccia. Una pagina che
 * nasconde il selettore del ruolo è una cortesia verso chi guarda; la regola è
 * ciò che rifiuta una PATCH costruita a mano, e quella deve stare dove le
 * richieste arrivano davvero.
 */
import { UserRole } from "@kancrm/shared";
import type { User } from "../../generated/prisma/client";
import { prisma } from "../../db";
import { badRequest, forbidden } from "../../lib/http-errors";
import { requireUser } from "../../plugins/auth";
import { isGroupManager } from "../visibility/service";
import type { FastifyRequest } from "fastify";

/**
 * Cosa vede e cosa tocca chi chiede.
 *
 * `tutti` è l'amministratore: gli utenti sono tutti, i campi sono tutti.
 * `portale` è il manager di gruppo dall'area customer care: solo gli utenti
 * PORTAL, e solo i quattro campi che riguardano un cliente.
 */
export type PerimetroUtenti = "tutti" | "portale";

/**
 * I campi che un manager può cambiare su un cliente. È un elenco **chiuso**, e
 * la differenza rispetto a «nascondi i campi nel form» è tutta qui: ruolo,
 * gruppi, ore settimanali, permesso sui timesheet e referente di fatturazione
 * non passano nemmeno se qualcuno li scrive a mano nel corpo della richiesta.
 */
export const CAMPI_DEL_MANAGER = ["name", "companyId", "isActive", "ticketProjectIds"] as const;
export type CampoDelManager = (typeof CAMPI_DEL_MANAGER)[number];

/** Il perimetro di chi sta chiedendo, o un rifiuto se non ne ha nessuno. */
export async function perimetroUtenti(request: FastifyRequest): Promise<{
  utente: User;
  perimetro: PerimetroUtenti;
}> {
  const utente = requireUser(request);
  if (utente.role === UserRole.ADMIN) return { utente, perimetro: "tutti" };
  if (await isGroupManager(utente)) return { utente, perimetro: "portale" };
  throw forbidden("Riservato agli amministratori e ai manager di gruppo");
}

/** Come sopra, ma per le rotte che restano dell'amministratore soltanto. */
export function soloAmministratore(request: FastifyRequest): User {
  const utente = requireUser(request);
  if (utente.role !== UserRole.ADMIN) throw forbidden("Riservato agli amministratori");
  return utente;
}

/**
 * L'utente su cui si sta per agire rientra nel perimetro?
 *
 * Il messaggio dice **cosa** si può gestire, non «non sei autorizzato»: chi
 * legge sta guardando l'area sbagliata, e saperlo gli risparmia di cercare il
 * difetto altrove.
 */
export function assertNelPerimetro(perimetro: PerimetroUtenti, ruolo: string): void {
  if (perimetro === "tutti") return;
  if (ruolo !== UserRole.PORTAL) {
    throw forbidden("Da qui si gestiscono soltanto gli utenti del portale clienti");
  }
}

/**
 * Toglie dalla richiesta tutto ciò che il perimetro non ammette — e **si ferma**
 * invece di ignorarlo in silenzio. Una modifica sparita senza dirlo è peggio di
 * un errore: chi l'ha mandata crede di averla salvata.
 */
export function assertSoloCampiConsentiti(
  perimetro: PerimetroUtenti,
  campi: Record<string, unknown>,
): void {
  if (perimetro === "tutti") return;
  const consentiti = new Set<string>(CAMPI_DEL_MANAGER);
  const rifiutati = Object.keys(campi).filter(
    (campo) => campi[campo] !== undefined && !consentiti.has(campo),
  );
  if (rifiutati.length > 0) {
    throw forbidden(
      `Da qui si possono cambiare solo nome, azienda, stato e progetti (ricevuto: ${rifiutati.join(", ")})`,
    );
  }
}

/**
 * **Un cliente senza azienda apre il portale e vede una pagina vuota**: la
 * regola sta qui, nel percorso che scrive, e non come vincolo sulla banca dati
 * — in produzione ci sono già due clienti senza azienda, e un vincolo li
 * renderebbe impossibili da salvare prima ancora di poterli correggere
 * (scelta del 02/09/2026).
 */
export function assertAziendaDelCliente(
  ruolo: string,
  companyId: string | null | undefined,
  { obbligatoria = true }: { obbligatoria?: boolean } = {},
): void {
  if (ruolo !== UserRole.PORTAL || !obbligatoria) return;
  if (!companyId) {
    throw badRequest("Un utente del portale ha bisogno di un'azienda di riferimento");
  }
}

/**
 * **Tutti i progetti**, per il selettore dell'area customer care — di
 * proposito **fuori** dal perimetro di visibilità.
 *
 * Assegnare un progetto a un cliente è il gesto che gli permette di aprirci i
 * ticket: chi lo fa deve poter scegliere fra tutti, anche fra quelli su cui non
 * lavora e che non vedrebbe altrove. Il manager delle vendite non conosce i
 * progetti di sviluppo, e deve comunque poter abilitare un cliente su uno di
 * essi (richiesta del 02/09/2026).
 *
 * Quello che esce di qui sono **nomi**: niente task, niente ore, niente
 * contenuti. Chi un giorno volesse "correggere" questa funzione rimettendoci il
 * filtro di visibilità romperebbe la funzione, non la sicurezza.
 */
export async function progettiAssegnabili(): Promise<
  Array<{ id: string; name: string; company: string | null }>
> {
  const progetti = await prisma.project.findMany({
    where: { deletedAt: null, isArchived: false },
    select: { id: true, name: true, company: { select: { name: true } } },
    orderBy: { name: "asc" },
  });
  return progetti.map((p) => ({ id: p.id, name: p.name, company: p.company?.name ?? null }));
}
