// Copyright (c) 2026 Jugaad s.r.l.
// SPDX-License-Identifier: AGPL-3.0-only

import { createContext, useContext, useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { UserRole, type AuthProviders, type CurrentUser, type LoginInput } from "@kancrm/shared";
import { ApiError, api, onForbidden } from "@/lib/api";
import { useToast } from "@/components/ui/toast";
import { useTranslation } from "react-i18next";
import { dimenticaLinguaScelta } from "@/lib/i18n";
import { edizioneDellaBuild } from "@/edition/rotte";

/**
 * Provider disponibili (SSO Google, selettore Drive). Letto senza sessione: la
 * pagina di login lo usa per mostrare il pulsante Google, gli allegati per il
 * selettore Drive. Non cambia a runtime → si tiene in cache a lungo.
 */
/**
 * **The web build and the server must be the same edition** (10/10/2026). The
 * server decides at run time (KEELOPS_EDITION, or the stubs of the community
 * tree); the web decided when it was built. They never diverge in a normal
 * install — the server serves its own build — but a commercial build pointed at
 * a community server would offer tickets and timesheet extras to routes that
 * answer 404. Said once, loudly, in the console: the page keeps working.
 */
let edizioneControllata = false;
export function controllaEdizione(delServer: "community" | "commerciale"): boolean {
  const dellaBuild = edizioneDellaBuild();
  const coerente = delServer === dellaBuild;
  if (!coerente && !edizioneControllata) {
    console.error(
      `[KeelOps] edizione del server «${delServer}», build web «${dellaBuild}»: ` +
        "le due devono coincidere (ricostruire il web dallo stesso albero del server).",
    );
  }
  edizioneControllata = true;
  return coerente;
}

export function useProviders() {
  return useQuery({
    queryKey: ["auth-providers"],
    queryFn: async () => {
      const providers = await api<AuthProviders>("/api/auth/providers");
      controllaEdizione(providers.edizione);
      return providers;
    },
    staleTime: Infinity,
    retry: false,
  });
}

/**
 * **I permessi cambiano anche mentre si lavora**: l'elevazione ad
 * amministratore dura mezz'ora, e alla scadenza il server smette di concedere
 * ciò che la pagina sta ancora offrendo. Al primo rifiuto si rilegge l'utente,
 * così i comandi che non valgono più spariscono da soli invece di fallire
 * uno dopo l'altro (26/08/2026).
 */
export function useForbiddenRefresh(): void {
  const queryClient = useQueryClient();
  const toast = useToast();
  const { t } = useTranslation();
  useEffect(() => {
    onForbidden(() => {
      const prima = queryClient.getQueryData<CurrentUser | null>(["me"]);
      void queryClient.refetchQueries({ queryKey: ["me"] }).then(() => {
        const adesso = queryClient.getQueryData<CurrentUser | null>(["me"]);
        // Perdere i privilegi mentre si lavora va DETTO: senza, la pagina si
        // limita a rimandare altrove e sembra un guasto. Succede quando
        // l'elevazione scade, o quando la si chiude da un'altra scheda.
        if (prima?.role === "ADMIN" && adesso && adesso.role !== "ADMIN") {
          toast(
            t(
              "I privilegi di amministratore non sono più attivi: rielevati da «Diventa admin» se ti servono.",
            ),
            "info",
          );
        }
      });
    });
    return () => onForbidden(null);
  }, [queryClient, toast, t]);
}

export function useMe() {
  return useQuery({
    queryKey: ["me"],
    queryFn: async (): Promise<CurrentUser | null> => {
      try {
        return await api<CurrentUser>("/api/auth/me");
      } catch (error) {
        if (error instanceof ApiError && error.status === 401) return null;
        throw error;
      }
    },
    retry: false,
    staleTime: 5 * 60 * 1000,
  });
}

export function useOtpLogin() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { email: string; code: string }) =>
      api<CurrentUser>("/api/auth/otp/verify", { method: "POST", body: input }),
    onSuccess: (user) => queryClient.setQueryData(["me"], user),
  });
}

export function useLogin() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: LoginInput) =>
      api<CurrentUser>("/api/auth/login", { method: "POST", body: input }),
    onSuccess: (user) => queryClient.setQueryData(["me"], user),
  });
}

export function useLogout() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => api<void>("/api/auth/logout", { method: "POST" }),
    onSuccess: () => {
      // La lingua scelta a mano vale per chi l'ha scelta: uscendo si dimentica,
      // o il prossimo che entra da questo browser si troverebbe la sua.
      dimenticaLinguaScelta();
      queryClient.setQueryData(["me"], null);
      queryClient.removeQueries({ predicate: (query) => query.queryKey[0] !== "me" });
    },
  });
}

export const CurrentUserContext = createContext<CurrentUser | null>(null);

/**
 * **In dimostrazione non si caricano file.** Il rifiuto vero lo dà il server su
 * tutto ciò che arriva come `multipart` (vedi `app.ts`): questo serve solo a
 * non far provare, e a dire perché. Una vetrina aperta a chiunque, con il
 * trascinamento attivo, è uno spazio di archiviazione gratuito per il primo
 * che passa.
 */
export function useCaricamentiBloccati(): boolean {
  // `useContext` e non `useCurrentUser`: questo gancio vive dentro componenti
  // foglia che nei test si montano da soli, e fuori dal contesto la risposta
  // giusta è **no** — cioè il comportamento di sempre, quello di produzione.
  return useContext(CurrentUserContext)?.demoMode === true;
}

/**
 * **Le liste interne non sono per il portale.** Stati, tag, tipi di attività,
 * progetti e persone il server li nega a un cliente (403): chiederli comunque
 * riempiva la console di errori e faceva rileggere l'utente a ogni rifiuto
 * (24/09/2026). Il controllo sta qui, e gli hook di quelle liste lo usano come
 * `enabled`: una schermata condivisa col portale — il pannello del ticket —
 * non deve ricordarsene. Fuori dal contesto (i test) la risposta è **sì**.
 */
export function useInternalLists(): boolean {
  return useContext(CurrentUserContext)?.role !== UserRole.PORTAL;
}

/**
 * **Chi ha il bottone di download nel lettore** (25/09/2026). I monitor
 * vendite leggono e basta: il server a loro dà sempre il lettore, mai il file
 * (vedi `/open` negli allegati). Il portale clienti resta com'era, per scelta
 * del committente: il bottone è una novità dell'applicazione interna. Fuori
 * dal contesto (i test) la risposta è **sì**.
 */
export function useCanDownload(): boolean {
  const role = useContext(CurrentUserContext)?.role;
  return role !== UserRole.SALES_MONITOR && role !== UserRole.PORTAL;
}

/** Utente autenticato; utilizzabile solo sotto AuthGate. */
export function useCurrentUser(): CurrentUser {
  const user = useContext(CurrentUserContext);
  if (!user) throw new Error("useCurrentUser deve essere usato dentro CurrentUserContext");
  return user;
}

/**
 * Privilegi di amministratore a richiesta (stile sudo): ci si eleva quando
 * servono e si rientra subito dopo. Cambia CIÒ CHE SI VEDE ovunque, quindi si
 * butta via tutta la cache: menù, elenchi e perimetri vanno riletti.
 */
export function useAdminElevation() {
  const queryClient = useQueryClient();
  const refreshAll = (user: CurrentUser) => {
    queryClient.setQueryData(["me"], user);
    queryClient.removeQueries({ predicate: (query) => query.queryKey[0] !== "me" });
  };
  const elevate = useMutation({
    mutationFn: () => api<CurrentUser>("/api/auth/elevate", { method: "POST" }),
    onSuccess: refreshAll,
  });
  const stepDown = useMutation({
    mutationFn: () => api<CurrentUser>("/api/auth/step-down", { method: "POST" }),
    onSuccess: refreshAll,
  });
  return { elevate, stepDown };
}

/**
 * Minuti che restano all'elevazione (null se si lavora da utente normale).
 *
 * Alla scadenza **rilegge tutto**, non solo `/me`. Rileggere il solo utente
 * faceva sparire i comandi ma lasciava in pagina i *dati* raccolti da elevato:
 * l'elenco delle richieste continuava a mostrare quelle di tutti — colonna
 * "Richiedente" compresa — e aprirne una dava 404 in console e un pannello
 * vuoto, senza che niente dicesse perché (20/08/2026). Cambiato il ruolo,
 * cambia il perimetro di ogni risposta del server: si ricarica tutto.
 *
 * `onExpire` lo passa **un solo** montaggio (il badge in topbar): serve a dirlo
 * a chi guarda, e un avviso doppio è peggio di nessun avviso.
 */
export function useElevationCountdown(
  adminUntil: string | null,
  onExpire?: () => void,
): number | null {
  const queryClient = useQueryClient();
  const [left, setLeft] = useState<number | null>(null);
  const scaduta = useRef(onExpire);
  scaduta.current = onExpire;
  useEffect(() => {
    if (!adminUntil) {
      setLeft(null);
      return;
    }
    // Una volta sola, e poi il battito si ferma: scaduta l'elevazione il
    // controllo continuava a scattare ogni quindici secondi, e con lui la
    // ricarica di TUTTE le query e l'avviso — una tempesta, non un avviso.
    let fatto = false;
    let timer: ReturnType<typeof setInterval> | undefined;
    const tick = () => {
      const ms = new Date(adminUntil).getTime() - Date.now();
      if (ms > 0) {
        setLeft(Math.ceil(ms / 60_000));
        return;
      }
      setLeft(0);
      if (fatto) return;
      fatto = true;
      clearInterval(timer);
      void queryClient.invalidateQueries();
      scaduta.current?.();
    };
    tick();
    if (!fatto) timer = setInterval(tick, 15_000);
    return () => clearInterval(timer);
  }, [adminUntil, queryClient]);
  return left;
}
