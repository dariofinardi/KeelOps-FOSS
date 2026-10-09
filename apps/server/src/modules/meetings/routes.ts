import type { FastifyInstance } from "fastify";
import { TaskKind, UserRole, VisibilityScope, type MeetingMinutes } from "@kancrm/shared";
import { prisma } from "../../db";
import { notFound } from "../../lib/http-errors";
import { requireUser } from "../../plugins/auth";
import type { User } from "../../generated/prisma/client";
import { canSeeScope } from "../visibility/service";
import { assertTaskViewAccess } from "../tasks/routes";

/**
 * Riunioni: task il cui tipo attività ha isMeeting. Non sono un'entità a sé —
 * così un incontro eredita scadenza, allegati (l'ordine del giorno), ore a
 * timesheet e ricorrenza dai task normali.
 *
 * Le note prese durante l'incontro sono i commenti con meetingId: lette per
 * riunione danno il verbale, lette per task danno la cronologia dell'attività.
 */
export function meetingRoutes(app: FastifyInstance): void {
  /** Restringe lo scadenzario ai propri task per chi non ha lo scope ADMIN_TASKS. */
  async function ownershipFilter(user: User) {
    if (await canSeeScope(user, VisibilityScope.ADMIN_TASKS)) return {};
    return {
      OR: [{ assigneeId: user.id }, { supervisorId: user.id }, { creatorId: user.id }],
    };
  }

  app.get("/api/meetings", async (request) => {
    const user = requireUser(request);
    const meetings = await prisma.task.findMany({
      where: {
        activityType: { isMeeting: true },
        kind: { in: [TaskKind.ADMIN, TaskKind.PROJECT] },
        ...(await ownershipFilter(user)),
      },
      select: {
        id: true,
        title: true,
        dueDate: true,
        participants: true,
        _count: { select: { meetingNotes: true, meetingTasks: true } },
      },
      // Le più recenti per prime: di norma si annota l'incontro appena concluso.
      orderBy: [{ dueDate: "desc" }, { createdAt: "desc" }],
      take: 100,
    });

    return meetings.map((meeting) => ({
      id: meeting.id,
      title: meeting.title,
      dueDate: meeting.dueDate?.toISOString().slice(0, 10) ?? null,
      participants: meeting.participants,
      noteCount: meeting._count.meetingNotes,
      taskCount: meeting._count.meetingTasks,
    }));
  });

  /** Verbale: le note dell'incontro raggruppate per attività discussa. */
  app.get("/api/meetings/:id/minutes", async (request): Promise<MeetingMinutes> => {
    const user = requireUser(request);
    const { id } = request.params as { id: string };

    const meeting = await prisma.task.findUnique({
      where: { id },
      include: {
        activityType: true,
        _count: { select: { meetingNotes: true, meetingTasks: true } },
      },
    });
    if (!meeting || !meeting.activityType?.isMeeting) throw notFound("Riunione non trovata");
    await assertTaskViewAccess(user, meeting);

    const notes = await prisma.comment.findMany({
      where: { meetingId: id, task: { deletedAt: null } },
      include: { author: true, task: { include: { status: true } } },
      orderBy: { createdAt: "asc" },
    });

    // Le note su task che l'utente non può vedere restano fuori dal verbale.
    const groups = new Map<string, MeetingMinutes["groups"][number]>();
    for (const note of notes) {
      if (user.role !== UserRole.ADMIN) {
        try {
          await assertTaskViewAccess(user, note.task);
        } catch {
          continue;
        }
      }
      let group = groups.get(note.taskId);
      if (!group) {
        group = {
          task: {
            id: note.task.id,
            title: note.task.title,
            statusName: note.task.status!.name,
            statusColor: note.task.status!.color,
          },
          notes: [],
        };
        groups.set(note.taskId, group);
      }
      group.notes.push({
        id: note.id,
        body: note.body,
        createdAt: note.createdAt.toISOString(),
        author: { id: note.author.id, name: note.author.name },
      });
    }

    return {
      meeting: {
        id: meeting.id,
        title: meeting.title,
        dueDate: meeting.dueDate?.toISOString().slice(0, 10) ?? null,
        participants: meeting.participants,
        noteCount: meeting._count.meetingNotes,
        taskCount: meeting._count.meetingTasks,
      },
      groups: [...groups.values()],
    };
  });
}
