// Copyright (c) 2026 Jugaad s.r.l.
// SPDX-License-Identifier: AGPL-3.0-only

import { z } from "zod";
import { dateOnly, userRefSchema } from "./tasks";

/** Riunione nell'elenco: un task il cui tipo attività ha isMeeting. */
export const meetingListItemSchema = z.object({
  id: z.string(),
  title: z.string(),
  dueDate: dateOnly.nullable(),
  participants: z.string().nullable(),
  /** Note raccolte durante l'incontro (commenti collegati). */
  noteCount: z.number().int(),
  /** Task nati da questo incontro. */
  taskCount: z.number().int(),
});
export type MeetingListItem = z.infer<typeof meetingListItemSchema>;

/** Note dell'incontro raggruppate per attività discussa: le celle di una colonna. */
export const meetingNoteGroupSchema = z.object({
  task: z.object({
    id: z.string(),
    title: z.string(),
    statusName: z.string(),
    statusColor: z.string(),
  }),
  notes: z.array(
    z.object({
      id: z.string(),
      body: z.string(),
      createdAt: z.string(),
      author: userRefSchema,
    }),
  ),
});
export type MeetingNoteGroup = z.infer<typeof meetingNoteGroupSchema>;

export const meetingMinutesSchema = z.object({
  meeting: meetingListItemSchema,
  groups: z.array(meetingNoteGroupSchema),
});
export type MeetingMinutes = z.infer<typeof meetingMinutesSchema>;
