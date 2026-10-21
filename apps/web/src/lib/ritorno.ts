// Copyright (c) 2026 Jugaad s.r.l.
// SPDX-License-Identifier: AGPL-3.0-only

import { useCallback } from "react";
import { useTranslation } from "react-i18next";
import { useLocation, useNavigate } from "react-router-dom";
import { AREAS } from "@/components/layout/areas";

/**
 * **Da dove si arriva, e come si torna** (21/10/2026).
 *
 * La regola dell'utente: in nessuna situazione ci si deve trovare in un posto
 * senza poter tornare a quello da cui si è partiti, **esattamente nella vista
 * che si stava guardando**. Il tasto «indietro» del browser lo fa già — ma
 * bisogna sapere che c'è, e il pannello che si chiude perde la strada.
 *
 * Chi porta altrove (un collegamento in un pannello, un contatore, un
 * risultato di ricerca) usa `useVaiA`: il salto si porta dietro un'etichetta
 * («Offerta Rinnovo 2027»), e chi arriva mostra «← Offerta Rinnovo 2027»
 * accanto al titolo del record o in cima alla pagina. Tornare è un passo
 * indietro nella cronologia: la pagina di partenza ritrova i suoi filtri (sono
 * ricordati), la sua posizione e — se prima di partire l'abbiamo scritto
 * nell'indirizzo con `qui` — il pannello che era aperto.
 */
export interface Ritorno {
  /** Come si chiama il posto da cui si arriva: un record o una pagina. */
  etichetta: string;
  /**
   * L'id del record aperto all'arrivo, se si arriva su un pannello: il
   * pulsante sta nel suo pannello e vale finché si guarda quello. Senza, si
   * arriva su una pagina e il pulsante sta in cima alla pagina.
   */
  record?: string | null;
}

interface StatoConRitorno {
  ritorno?: Ritorno;
}

/**
 * Va a `to` portando con sé il ritorno. `qui`, se c'è, sostituisce prima
 * l'indirizzo di partenza: è la pagina di adesso con il pannello aperto
 * scritto dentro (vedi `quiConPannello`), così tornando lo si ritrova.
 */
export function useVaiA(): (to: string, ritorno: Ritorno, qui?: string | null) => void {
  const navigate = useNavigate();
  return useCallback(
    (to, ritorno, qui) => {
      if (qui) navigate(qui, { replace: true });
      navigate(to, { state: { ritorno } satisfies StatoConRitorno });
    },
    [navigate],
  );
}

/**
 * Il ritorno da mostrare: in un pannello (`record` = l'id che il pannello
 * mostra) o in cima a una pagina (`record` assente). Null se non si è arrivati
 * con un salto, o se il pulsante è di un altro posto.
 */
export function useRitorno(
  record?: string | null,
): { etichetta: string; torna: () => void } | null {
  const location = useLocation();
  const navigate = useNavigate();
  const ritorno = (location.state as StatoConRitorno | null)?.ritorno;
  if (!ritorno?.etichetta) return null;
  if (record === undefined ? Boolean(ritorno.record) : ritorno.record !== record) return null;
  return { etichetta: ritorno.etichetta, torna: () => navigate(-1) };
}

/** Le pagine che sanno riaprire un pannello dall'indirizzo, e con quale parametro. */
const PANNELLI = {
  task: { pagina: AREAS.tasks.to, parametro: "task" },
  deal: { pagina: AREAS.deals.to, parametro: "deal" },
  azienda: { pagina: AREAS.contacts.to, parametro: "azienda" },
} as const;

/**
 * L'indirizzo di adesso con il pannello aperto scritto dentro, se la pagina sa
 * riaprirlo (`/bacheche?task=…`, `/offerte?deal=…`, `/contatti?azienda=…`);
 * altrimenti null, e si torna alla pagina com'era, senza pannello.
 */
export function quiConPannello(
  posizione: { pathname: string; search: string },
  tipo: keyof typeof PANNELLI,
  id: string,
): string | null {
  const { pagina, parametro } = PANNELLI[tipo];
  if (posizione.pathname !== pagina) return null;
  const parametri = new URLSearchParams(posizione.search);
  parametri.set(parametro, id);
  return `${pagina}?${parametri.toString()}`;
}

/** Il nome dell'area in cui si è, per il ritorno da una pagina («Offerte», «La mia giornata»). */
export function etichettaDellaPagina(pathname: string): string {
  if (pathname === "/") return AREAS.home.label;
  const area = Object.values(AREAS).find((a) => a.to !== "/" && pathname.startsWith(a.to));
  return area?.label ?? AREAS.home.label;
}

/**
 * Va a `to` da una **pagina** (un contatore, un risultato di ricerca, una
 * notifica): il ritorno si chiama come l'area in cui si è («← Offerte»).
 * `record` se a destinazione si apre un pannello.
 */
export function useVaiDallaPagina(): (to: string, record?: string | null) => void {
  const vaiA = useVaiA();
  const location = useLocation();
  const { t } = useTranslation();
  return useCallback(
    (to, record) => vaiA(to, { etichetta: t(etichettaDellaPagina(location.pathname)), record }),
    [vaiA, location.pathname, t],
  );
}
