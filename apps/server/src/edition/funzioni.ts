// Copyright (c) 2026 Jugaad s.r.l.
// SPDX-License-Identifier: AGPL-3.0-only

import {
  FUNZIONI_DEL_NUCLEO,
  funzioniSpenteEffettive,
  spentaPerColpaDi,
  type FunzioneAccendibile,
  type FunzioneIstanza,
} from "@kancrm/shared";
import { prisma } from "../db";
import { badRequest } from "../lib/http-errors";
import { impostaSpenteInMemoria } from "./funzioni-stato";
import { moduliDellEdizione } from "./registry";

/**
 * **Le funzioni dell'istanza** (17/10/2026): accendere e spegnere, per
 * installazione, le aree del nucleo e i moduli dell'edizione. Il disegno sta
 * in `plan/funzioni-istanza.md`.
 *
 * Lo stato è l'elenco delle funzioni spente **a mano**, in `AppSetting`. Vuoto,
 * o mai scritto, vuol dire tutto acceso: le installazioni esistenti non
 * cambiano. Un valore illeggibile vale «tutto acceso» — spegnere mezza
 * applicazione per un JSON rotto sarebbe peggio del guasto.
 */
const KEY = "istanza.funzioniSpente";

/** Ogni quanto si rilegge da sé: copre gli script e un secondo processo. */
const RILETTURA_MS = 60_000;

let spenteAMano: ReadonlySet<string> = new Set();

type VoceDelCatalogo = FunzioneAccendibile & { tipo: "nucleo" | "modulo" };

/** Le aree del nucleo e i moduli che questa edizione porta, ciascuno con la sua voce. */
export function catalogoFunzioni(): VoceDelCatalogo[] {
  return [
    ...FUNZIONI_DEL_NUCLEO.map((funzione) => ({ ...funzione, tipo: "nucleo" as const })),
    ...moduliDellEdizione().map((modulo) => ({
      chiave: modulo.nome,
      etichetta: modulo.interruttore?.etichetta ?? modulo.nome,
      descrizione: modulo.interruttore?.descrizione ?? "",
      richiede: modulo.interruttore?.richiede ?? [],
      scope: modulo.interruttore?.scope ?? null,
      tipo: "modulo" as const,
    })),
  ];
}

function applica(nuove: Iterable<string>): void {
  spenteAMano = new Set(nuove);
  const catalogo = catalogoFunzioni();
  const effettive = funzioniSpenteEffettive(spenteAMano, catalogo);
  const scope = catalogo.flatMap((f) => (f.scope && effettive.has(f.chiave) ? [f.scope] : []));
  impostaSpenteInMemoria(effettive, scope);
}

function leggiValore(valore: string | undefined): string[] {
  if (!valore) return [];
  try {
    const letto: unknown = JSON.parse(valore);
    return Array.isArray(letto) ? letto.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
}

/** Rilegge lo stato dal database. Al boot, alla scrittura e ogni minuto. */
export async function caricaFunzioni(): Promise<void> {
  const riga = await prisma.appSetting.findUnique({ where: { key: KEY } });
  applica(leggiValore(riga?.value));
}

let timer: ReturnType<typeof setInterval> | null = null;

/** La rilettura periodica: non tiene vivo il processo, e un errore non la ferma. */
export function avviaRiletturaFunzioni(log: (errore: unknown) => void): void {
  if (timer) return;
  timer = setInterval(() => {
    caricaFunzioni().catch(log);
  }, RILETTURA_MS);
  timer.unref?.();
}

/** Lo stato per la pagina Sistema: ogni voce del catalogo, con il perché se è spenta. */
export function statoFunzioni(): FunzioneIstanza[] {
  const catalogo = catalogoFunzioni();
  return catalogo.map((funzione) => ({
    chiave: funzione.chiave,
    etichetta: funzione.etichetta,
    descrizione: funzione.descrizione,
    tipo: funzione.tipo,
    richiede: [...funzione.richiede],
    scope: funzione.scope,
    spenta: spenteAMano.has(funzione.chiave),
    spentaDa: spentaPerColpaDi(funzione.chiave, spenteAMano, catalogo),
  }));
}

/**
 * Scrive le funzioni spente a mano. Una chiave che il catalogo di questa
 * edizione non conosce è un errore di chi chiama, non una funzione da
 * ricordare: si rifiuta, con il nome.
 */
export async function impostaFunzioniSpente(spente: readonly string[]): Promise<FunzioneIstanza[]> {
  const note = new Set(catalogoFunzioni().map((funzione) => funzione.chiave));
  const ignota = spente.find((chiave) => !note.has(chiave));
  if (ignota) throw badRequest("Funzione sconosciuta: {{chiave}}", { chiave: ignota });
  const valore = JSON.stringify([...new Set(spente)].sort());
  await prisma.appSetting.upsert({
    where: { key: KEY },
    create: { key: KEY, value: valore },
    update: { value: valore },
  });
  applica(JSON.parse(valore) as string[]);
  return statoFunzioni();
}

/**
 * **Le rotte delle aree del nucleo**, per prefisso: con l'area spenta
 * rispondono 404. I moduli dell'edizione non sono qui: le loro rotte stanno in
 * un contesto con la sua guardia (`app.ts`).
 */
export const PREFISSI_DEL_NUCLEO: Readonly<Record<string, readonly string[]>> = {
  offerte: ["/api/deals", "/api/deal-stages"],
  contatti: ["/api/contacts"],
  progetti: ["/api/projects", "/api/profile/project-order"],
  ore: ["/api/timesheet"],
  andamento: ["/api/dashboard/dev-metrics"],
};

/** La funzione del nucleo a cui appartiene un indirizzo, o null. */
export function funzioneDelPercorso(url: string): string | null {
  const percorso = url.split("?")[0] ?? url;
  for (const [funzione, prefissi] of Object.entries(PREFISSI_DEL_NUCLEO)) {
    if (prefissi.some((p) => percorso === p || percorso.startsWith(`${p}/`))) return funzione;
  }
  return null;
}

type Cron = typeof import("node-cron").default;

/**
 * **Il cron di un modulo spegnibile**: lo stesso `node-cron`, ma ogni lavoro
 * pianificato prima di partire chiede se il modulo è acceso. Il lavoro di un
 * modulo spento salta il giro; riacceso, riprende al giro dopo, senza riavvio.
 */
export function cronCondizionato(base: Cron, acceso: () => boolean): Cron {
  return {
    ...base,
    schedule: (espressione, lavoro, opzioni) =>
      base.schedule(
        espressione,
        typeof lavoro === "string"
          ? lavoro
          : (contesto) => (acceso() ? lavoro(contesto) : undefined),
        opzioni,
      ),
  };
}
