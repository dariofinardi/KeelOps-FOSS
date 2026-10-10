// Copyright (c) 2026 Jugaad s.r.l.
// SPDX-License-Identifier: AGPL-3.0-only

import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import {
  ArrowUpRight,
  Building2,
  CalendarClock,
  Columns3,
  HandCoins,
  LifeBuoy,
  UserRound,
} from "lucide-react";
import { TaskKind, type TaskListItem } from "@kancrm/shared";
import { AREAS } from "@/components/layout/areas";

/**
 * Di che natura è un task, per gli elenchi in cui i moduli si mescolano: il
 * simbolo dice a colpo d'occhio se una riga è una scadenza amministrativa, un
 * lavoro di sviluppo o un'offerta, prima ancora di leggere il titolo.
 *
 * Un posto solo per la scelta dei simboli: chi li cambia qui li cambia ovunque.
 * Il calendario per l'amministrazione (sono scadenze: fatture, canoni, F24).
 *
 * Il lavoro che nasce da un progetto porta **l'icona dell'area Progetti**, presa
 * da `AREAS`: prima era `</>`, e la stessa cosa aveva due segni diversi a
 * seconda di dove la si guardava (menù, contatore sulla scheda cliente, riga in
 * dashboard). Un segno, un posto.
 */
const MODULE_META: Partial<Record<TaskKind, { icon: typeof Building2; label: string }>> = {
  [TaskKind.ADMIN]: { icon: CalendarClock, label: "Scadenzario" },
  [TaskKind.PROJECT]: { icon: AREAS.projects.icon, label: "Sviluppo" },
  [TaskKind.DEAL]: { icon: HandCoins, label: "Offerta" },
  [TaskKind.TICKET]: { icon: LifeBuoy, label: "Ticket" },
  [TaskKind.PERSONAL]: { icon: Columns3, label: "Personale" },
};

/**
 * Riga di contesto sotto al titolo di un task: natura, azienda cliente e
 * progetto. Serve negli elenchi trasversali (dashboard) dove i task di moduli
 * diversi stanno insieme e il solo titolo non dice a cosa si riferiscono —
 * "Chiama Sergio" o "Kick-off progetto" da soli non bastano.
 *
 * Per i task di progetto il modulo È il progetto: un segno solo (la cartella dei
 * Progetti + il nome), non un'etichetta "Sviluppo" più una cartella accanto. Il progetto di
 * appartenenza ha la precedenza su quello di riferimento (i ticket e le
 * occorrenze ricorrenti a contratto ne portano uno). Solo testo, mai link:
 * queste righe stanno dentro un bottone che apre il task, e un link annidato
 * non sarebbe né valido né cliccabile.
 */
/**
 * Il progetto di un task, con la freccia che lo apre: negli elenchi trasversali
 * (le Bacheche mostrano anche i task di progetto, 11/08/2026) sapere DA DOVE
 * viene il lavoro è metà dell'informazione, e arrivarci dev'essere un clic.
 * L'apertura sta sul campo stesso, come vuole la convenzione — non in una
 * banda che ripete il dato.
 */
function ProjectChip({ project }: { project: { id: string; name: string } }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  return (
    <span className="flex min-w-0 items-center gap-1">
      <AREAS.projects.icon className="size-3 shrink-0" />
      <span className="truncate" title={t("Progetto: {{name}}", { name: project.name })}>
        {project.name}
      </span>
      {/*
        **Non è un `<button>`, ed è voluto.** Questa riga vive dentro il bottone
        che apre il task (dashboard, riquadri della giornata): un bottone dentro
        un bottone è marcatura non valida — il browser lo dice, e come lo
        interpreti dipende da lui. Un `<span>` con il ruolo dichiarato fa la
        stessa cosa col mouse senza annidare niente.

        Sta **fuori dal giro dei Tab** per la stessa ragione: da tastiera si
        aprirebbe comunque il task, e al progetto ci si arriva dal pannello del
        task, dove il campo è un collegamento vero.
      */}
      <span
        role="button"
        tabIndex={-1}
        className="shrink-0 cursor-pointer rounded p-0.5 hover:bg-muted hover:text-foreground"
        title={t("Apri il progetto")}
        aria-label={t("Apri il progetto")}
        onClick={(event) => {
          // La riga sotto apre il task: qui si va altrove, e va detto al click.
          event.stopPropagation();
          navigate(`${AREAS.projects.to}/${project.id}`);
        }}
      >
        <ArrowUpRight className="size-3" />
      </span>
    </span>
  );
}

/**
 * **La riga sotto il titolo**, uguale dovunque un elenco mostra un record: il
 * modulo, l'azienda, l'interlocutore, il progetto — icona piccola e testo
 * attenuato. La usano i task (`TaskContext`) e le offerte nella dashboard.
 */
export function ContextLine({ children }: { children: React.ReactNode }) {
  return (
    <span className="mt-0.5 flex min-w-0 items-center gap-3 text-xs font-normal text-muted-foreground">
      {children}
    </span>
  );
}

export function CompanyChip({ name }: { name: string }) {
  const { t } = useTranslation();
  return (
    <span className="flex min-w-0 items-center gap-1" title={t("Cliente: {{name}}", { name })}>
      <Building2 className="size-3 shrink-0" />
      <span className="truncate">{name}</span>
    </span>
  );
}

export function ContactChip({ name }: { name: string }) {
  const { t } = useTranslation();
  return (
    <span
      className="flex min-w-0 items-center gap-1"
      title={t("Interlocutore: {{name}}", { name })}
    >
      <UserRound className="size-3 shrink-0" />
      <span className="truncate">{name}</span>
    </span>
  );
}

export function TaskContext({
  task,
  showModule = true,
}: {
  task: TaskListItem;
  /**
   * Il simbolo del modulo si spegne negli elenchi che vivono DENTRO un modulo
   * (il kanban dello scadenzario, la bacheca di un progetto): lì la natura è
   * quella della pagina, e ripeterla su ogni card sarebbe rumore.
   */
  showModule?: boolean;
}) {
  const { t } = useTranslation();
  const project = task.project ?? task.relatedProject;
  const module = showModule ? MODULE_META[task.kind] : undefined;
  const isProjectTask = task.kind === TaskKind.PROJECT && project !== null;
  if (!module && !task.company && !project) return null;
  return (
    <ContextLine>
      {isProjectTask ? (
        <ProjectChip project={project} />
      ) : (
        module && (
          <span className="flex shrink-0 items-center gap-1" title={t(module.label)}>
            <module.icon className="size-3 shrink-0" />
            {t(module.label)}
          </span>
        )
      )}
      {task.company && <CompanyChip name={task.company.name} />}
      {project && !isProjectTask && <ProjectChip project={project} />}
    </ContextLine>
  );
}
