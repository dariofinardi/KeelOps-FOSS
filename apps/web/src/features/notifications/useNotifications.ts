// Copyright (c) 2026 Jugaad s.r.l.
// SPDX-License-Identifier: AGPL-3.0-only

import { useEffect } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { NotificationList, NotificationPreferences, NotificationType } from "@kancrm/shared";
import { api } from "@/lib/api";
import { notePendingChanges, type PendingRecord } from "@/features/realtime/pending-changes";
import { segnaLette, segnaTutteLette } from "./read-state";
import { chiaveBarra } from "@/features/plugins/barra";

/**
 * La campanella è aperta in più posti insieme (la tendina, la finestra della
 * giornata, il pallino sul campanello) e leggono tutti questa chiave: scriverci
 * dentro fa comparire la spunta **ovunque nello stesso istante**, senza
 * aspettare il giro sul server.
 */
const CHIAVE = ["notifications"];

export function useNotifications() {
  return useQuery({
    queryKey: CHIAVE,
    queryFn: () => api<NotificationList>("/api/notifications"),
    refetchInterval: 60_000, // fallback se l'SSE cade
  });
}

/**
 * L'unica connessione agli eventi del server, e lo smistamento di ciò che
 * arriva. Una sola: con HTTP/1.1 ogni connessione aperta è una delle poche per
 * origine, e aprirne una per funzione metterebbe in coda le richieste normali.
 *
 * Due tipi di evento, due comportamenti opposti:
 * - **notifica** (`kind: "notification"`) — riguarda la persona: si rinfresca
 *   la campanella, che è roba sua;
 * - **record cambiato** (`kind: "record-changed"`) — riguarda lo schermo: si
 *   annota e basta. Non si invalida niente, non si ricarica niente: lo decide
 *   l'utente dall'avviso in fondo (`UpdatesToast`).
 *
 * Più un terzo, dal 23/09/2026: **un plugin** (`kind: "plugin"`) che dice
 * «il mio bottone nella barra è cambiato» — si rilegge quello, e nient'altro.
 */
export function useNotificationStream() {
  const queryClient = useQueryClient();
  useEffect(() => {
    const source = new EventSource("/api/notifications/stream");
    source.onmessage = (event: MessageEvent<string>) => {
      let data: { kind?: string; records?: PendingRecord[]; plugin?: string; taskId?: string } = {};
      try {
        data = JSON.parse(event.data) as typeof data;
      } catch {
        // Evento illeggibile: meglio ignorarlo che rinfrescare a caso.
        return;
      }
      if (data.kind === "record-changed") {
        notePendingChanges(data.records ?? []);
        return;
      }
      // Un collega ha preso in carico, forzando, la richiesta che avevo io: il
      // pannello aperto deve passare subito in sola lettura.
      if (data.kind === "ticket-lock") {
        if (data.taskId)
          void queryClient.invalidateQueries({ queryKey: ["ticket-lock", data.taskId] });
        return;
      }
      if (data.kind === "plugin") {
        if (data.plugin) void queryClient.invalidateQueries({ queryKey: chiaveBarra(data.plugin) });
        return;
      }
      void queryClient.invalidateQueries({ queryKey: CHIAVE });
    };
    return () => source.close();
  }, [queryClient]);
}

/**
 * Segna letta una notifica o **un gruppo intero** (le notifiche dello stesso
 * task si mostrano come una riga sola: leggerne una le legge tutte, o il
 * contatore resterebbe indietro rispetto a ciò che si vede).
 */
export function useMarkRead() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (ids: string | string[]) => {
      const elenco = Array.isArray(ids) ? ids : [ids];
      await Promise.all(
        elenco.map((id) => api<void>(`/api/notifications/${id}/read`, { method: "POST" })),
      );
    },
    onMutate: async (ids) => {
      // Si ferma un eventuale rinfresco in volo: tornando dopo, riporterebbe
      // indietro la riga che stiamo segnando.
      await queryClient.cancelQueries({ queryKey: CHIAVE });
      const prima = queryClient.getQueryData<NotificationList>(CHIAVE);
      queryClient.setQueryData<NotificationList | undefined>(CHIAVE, (elenco) =>
        segnaLette(elenco, Array.isArray(ids) ? ids : [ids]),
      );
      return { prima };
    },
    // Se il server rifiuta, la spunta si toglie: meglio una riga che ricompare
    // di una che si crede letta e non lo è.
    onError: (_errore, _ids, contesto) => {
      if (contesto?.prima) queryClient.setQueryData(CHIAVE, contesto.prima);
    },
    onSettled: () => void queryClient.invalidateQueries({ queryKey: CHIAVE }),
  });
}

export function useMarkAllRead() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => api<void>("/api/notifications/read-all", { method: "POST" }),
    onMutate: async () => {
      await queryClient.cancelQueries({ queryKey: CHIAVE });
      const prima = queryClient.getQueryData<NotificationList>(CHIAVE);
      queryClient.setQueryData<NotificationList | undefined>(CHIAVE, segnaTutteLette);
      return { prima };
    },
    onError: (_errore, _niente, contesto) => {
      if (contesto?.prima) queryClient.setQueryData(CHIAVE, contesto.prima);
    },
    onSettled: () => void queryClient.invalidateQueries({ queryKey: CHIAVE }),
  });
}

export function useNotificationPreferences() {
  return useQuery({
    queryKey: ["notification-preferences"],
    queryFn: () => api<NotificationPreferences>("/api/notification-preferences"),
  });
}

/**
 * **Le email raccolte in un riepilogo**, o una per una. Una scelta sola per
 * tutta la posta: il problema che risolve è il numero di messaggi, non quali
 * siano.
 */
export function useUpdateEmailDigest() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (scelta: { emailDigest?: boolean; emailWeekend?: boolean }) =>
      api("/api/notification-preferences/aggregation", {
        method: "PUT",
        body: scelta,
      }),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ["notification-preferences"] }),
  });
}

/** Si muove **una casella alla volta**: il canale non nominato resta com'è. */
export function useUpdatePreference() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { type: NotificationType; enabled?: boolean; email?: boolean }) =>
      api("/api/notification-preferences", { method: "PUT", body: input }),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ["notification-preferences"] }),
  });
}
