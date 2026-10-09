import type { ActivityTypeRef, ProjectListItem, TagRef, TaskStatus, UserRef } from "@kancrm/shared";
import { useCurrentUser } from "@/features/auth/useAuth";
import { useProjects } from "@/features/projects/useProjects";
import { useTags } from "@/features/tags/useTags";
import {
  groupActivityTypes,
  useActivityTypes,
  type ActivityTypeGroup,
} from "@/features/tasks/activity-types";
import { useStatusesFor, useUserOptions } from "@/features/tasks/useTasks";
import type { ProjectMemberRef } from "@/features/tasks/UserSelect";
import {
  canAssignOthers,
  editableProjects,
  projectMembersOf,
  taskKindOf,
  userScopeFor,
  type OptionsModule,
} from "./rules";

export interface OptionsContext {
  /** Dove siamo: scadenzario, offerte, progetto, ticket, bacheca personale. */
  module: OptionsModule;
  /**
   * Il record in modifica. Serve a tenere in elenco il valore che ha già: una
   * tendina che non contiene il proprio valore, al primo tocco, lo cancella.
   */
  task?: { kind?: string; activityType?: ActivityTypeRef | null; status?: { id: string } } | null;
  /** Progetto del contesto: i suoi membri vanno in cima alle tendine persone. */
  projectId?: string | null;
  /** Solo per le bacheche: una condivisa si può intestare ai colleghi. */
  sharedBoard?: boolean;
}

export interface Options {
  /** Stati proponibili: quelli della categoria del contesto, più quello attuale. */
  statuses: TaskStatus[];
  /** Tipi di attività divisi per categoria (le intestazioni della tendina). */
  activityTypeGroups: ActivityTypeGroup[];
  /** Persone intestabili in questo contesto. */
  users: UserRef[];
  /** Chi lavora al progetto scelto, col ruolo (in cima alle tendine persone). */
  projectMembers: ProjectMemberRef[] | undefined;
  /** Progetti su cui si può creare o spostare lavoro. */
  projects: ProjectListItem[];
  tags: TagRef[];
  /** false nella bacheca personale, e per chi non può intestare ad altri. */
  canAssignOthers: boolean;
}

/**
 * Tutte le tendine di una schermata, in una chiamata sola e già filtrate per
 * ruolo e per vista.
 *
 * Chi costruisce una pagina non deve più ricordarsi *quale* filtro va messo
 * dove: chiede le opzioni del proprio contesto e le usa. Le regole stanno in
 * `rules.ts` (pure e verificate); qui si compongono con le query, che restano
 * quelle condivise e già in cache — nessuna chiamata di rete in più.
 */
export function useOptions(context: OptionsContext): Options {
  const user = useCurrentUser();
  const { data: users } = useUserOptions(true, userScopeFor(context.module));
  const { data: projects } = useProjects();
  const { data: tags } = useTags();
  const { data: activityTypes } = useActivityTypes();
  const kind = taskKindOf(context.module);
  const statuses = useStatusesFor(context.task ?? { kind });

  return {
    statuses,
    activityTypeGroups: groupActivityTypes(activityTypes, {
      value: context.task?.activityType?.id,
      kind,
    }),
    users: users ?? [],
    projectMembers: projectMembersOf(projects, context.projectId),
    projects: editableProjects(projects, user),
    tags: tags ?? [],
    canAssignOthers: canAssignOthers(context, user),
  };
}
