import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import type { MeetingListItem, MeetingMinutes } from "@kancrm/shared";
import { api } from "@/lib/api";
import { useCurrentUser } from "@/features/auth/useAuth";
import { useUserOptions } from "@/features/tasks/useTasks";
import { useContacts } from "@/features/crm/useCrm";

/** Incontri disponibili: task di un tipo attività con isMeeting. */
export function useMeetings() {
  return useQuery({
    queryKey: ["meetings"],
    queryFn: () => api<MeetingListItem[]>("/api/meetings"),
    staleTime: 30_000,
  });
}

/** Verbale: le note dell'incontro raggruppate per attività discussa. */
export function useMeetingMinutes(meetingId: string | null) {
  return useQuery({
    queryKey: ["meeting-minutes", meetingId],
    queryFn: () => api<MeetingMinutes>(`/api/meetings/${meetingId}/minutes`),
    enabled: meetingId !== null,
  });
}

/**
 * Nomi proposti per il campo partecipanti: utenti dell'applicazione e contatti
 * dell'anagrafica. I contatti si caricano solo se l'utente ha accesso al CRM.
 */
export function usePeopleSuggestions(): string[] {
  const canSeeContacts = useCurrentUser().canSeeContacts;
  const { data: users } = useUserOptions();
  const { data: contacts } = useContacts("", 1, canSeeContacts);

  return useMemo(() => {
    const names = new Set<string>();
    for (const user of users ?? []) names.add(user.name);
    for (const contact of contacts?.items ?? []) {
      const name = `${contact.firstName} ${contact.lastName}`.trim();
      if (name) names.add(name);
    }
    return [...names].sort((a, b) => a.localeCompare(b, "it"));
  }, [users, contacts]);
}
