// Copyright (c) 2026 Jugaad s.r.l.
// SPDX-License-Identifier: AGPL-3.0-only

import { useTranslation } from "react-i18next";
import type { DeadlineSection, TaskListItem } from "@kancrm/shared";
import { StatusBadge } from "@/features/tasks/StatusBadge";
import { TaskContext } from "@/features/tasks/TaskContext";
import { formatDate } from "@/features/tasks/task-utils";
import { cn } from "@/lib/utils";
import { PluginPanel } from "@/features/plugins/PluginPanel";
import type { GruppoGiornata } from "@/features/plugins/usePluginGroups";
import { chipRiepilogo } from "./chip";
import { DashboardPanel } from "./DashboardPanel";

/** Quale elenco si guarda: i miei, quelli che supervisiono, le card personali dei plugin. */
export type ListaGiornata = "mine" | "supervised" | "personal";

/** Le preferenze scritte prima del 06/09/2026 erano un booleano (supervisionati sì/no). */
export function listaDaPreferenza(value: unknown): ListaGiornata {
  if (value === true || value === "supervised") return "supervised";
  if (value === "personal") return "personal";
  return "mine";
}

/**
 * Un riquadro della giornata: una fascia di scadenza, con i suoi elenchi
 * (miei / supervisionati, e «personali» quando un plugin porta le sue card
 * nei gruppi della giornata) che i contatori fanno anche da filtro.
 *
 * Sta in un file suo perché ha una regola che vale la pena provare da sola: le
 * sezioni **richiudibili**. "Senza scadenza" raccoglie tutto il lavoro aperto a
 * cui nessuno ha messo una data — decine di righe — e sotto la giornata di
 * oggi ci vuole poco a seppellirla. Nasce quindi chiusa, con i contatori in
 * vista sulla barra: si vede che c'è e quanto, e si apre quando serve.
 */
export function TaskGroup({
  id,
  title,
  icon,
  tone,
  section,
  lista,
  onLista,
  /** La chiave del gruppo per i plugin, e quante card hanno qui: assenti = niente pastiglia. */
  gruppo,
  personali,
  emptyText,
  onOpen,
  onContext,
  collapsed,
  onCollapsed,
}: {
  /** L'identificatore nella disposizione della giornata (layout.ts). */
  id: string;
  title: string;
  icon: React.ReactNode;
  tone?: "danger";
  /** Le due liste della sezione: i miei task e quelli che supervisiono. */
  section: DeadlineSection;
  lista: ListaGiornata;
  onLista: (value: ListaGiornata) => void;
  gruppo?: GruppoGiornata;
  personali?: number | null;
  emptyText: string;
  onOpen: (id: string) => void;
  onContext: (event: React.MouseEvent, task: TaskListItem) => void;
  /** Chiuso = solo la barra con i contatori; lo stato lo tiene la disposizione. */
  collapsed: boolean;
  onCollapsed: (collapsed: boolean) => void;
}) {
  const { t } = useTranslation();
  // Un contatore a zero non si mostra (regola 11): la pastiglia c'è solo se
  // il plugin ha davvero card in questo gruppo.
  const conPersonali =
    gruppo !== undefined && personali !== null && personali !== undefined && personali > 0;
  // una preferenza «personali» scritta quando il plugin c'era, e ora non c'è più: si torna ai miei
  const showing: ListaGiornata = lista === "personal" && !conPersonali ? "mine" : lista;
  const tasks = showing === "supervised" ? section.supervised : section.mine;
  const chip = chipRiepilogo;
  // I contatori sono anche il filtro: si guarda una lista alla volta, e i
  // numeri dicono cosa c'è nell'altra.
  const pastiglie = (
    <>
      <button
        type="button"
        className={chip(showing === "mine")}
        title={t("I task assegnati a te")}
        onClick={() => onLista("mine")}
      >
        {t("Miei")} ({section.mine.length})
      </button>
      <button
        type="button"
        className={chip(showing === "supervised")}
        title={t("I task di cui sei supervisore (e che esegue qualcun altro)")}
        onClick={() => onLista("supervised")}
      >
        {t("Supervisionati")} ({section.supervised.length})
      </button>
      {conPersonali && (
        <button
          type="button"
          className={chip(showing === "personal")}
          title={t("Le card delle tue bacheche personali")}
          onClick={() => onLista("personal")}
        >
          {t("Personali")} ({personali})
        </button>
      )}
    </>
  );
  return (
    <DashboardPanel
      id={id}
      title={title}
      icon={icon}
      tone={tone && section.mine.length + section.supervised.length > 0 ? tone : undefined}
      chips={pastiglie}
      collapsed={collapsed}
      onCollapsed={onCollapsed}
    >
      {showing === "personal" ? (
        // le card dei plugin, dentro il riquadro: la pagina del plugin aperta sul gruppo
        <PluginPanel anchor="dashboardGroups" query={`gruppo=${gruppo}`} senzaTitolo />
      ) : tasks.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          {showing === "supervised" ? t("Niente tra i supervisionati, qui.") : emptyText}
        </p>
      ) : (
        <ul className="flex flex-col gap-1.5">
          {tasks.map((task) => (
            <li key={task.id}>
              <button
                // Stessa regola dell'agenda: su schermo stretto il titolo si
                // prende la riga intera, stato e data vanno sotto.
                className="flex w-full flex-wrap items-center gap-x-2 gap-y-1 rounded-md border px-3 py-2 text-left text-sm hover:bg-muted/40"
                onClick={() => onOpen(task.id)}
                onContextMenu={(e) => onContext(e, task)}
              >
                <span className="flex w-full min-w-0 flex-col sm:w-auto sm:flex-1">
                  <span className="truncate font-medium">{task.title}</span>
                  <TaskContext task={task} />
                </span>
                <StatusBadge status={task.status} />
                <span
                  className={cn(
                    "ml-auto w-16 text-right text-xs sm:ml-0",
                    tone === "danger" ? "font-medium text-destructive" : "text-muted-foreground",
                  )}
                >
                  {task.dueDate ? formatDate(task.dueDate) : ""}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </DashboardPanel>
  );
}
