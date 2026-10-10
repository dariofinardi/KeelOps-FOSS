// Copyright (c) 2026 Jugaad s.r.l.
// SPDX-License-Identifier: AGPL-3.0-only

import { useCallback, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, useNavigate } from "react-router-dom";
import {
  Archive,
  ArchiveRestore,
  Building2,
  CalendarClock,
  GripVertical,
  Pencil,
  Plus,
  RotateCcw,
  Sparkles,
  SquarePen,
  Trash2,
  UserCheck,
  UserRound,
  Users,
} from "lucide-react";
import {
  PROJECT_ROLE_LABELS,
  richTextToPlain,
  UserRole,
  type ProjectListItem,
  type ProjectRole,
} from "@kancrm/shared";
import { cn } from "@/lib/utils";
import { ProjectGlyph, projectBorderClass } from "./project-style";
import { ProjectFormDialog } from "./ProjectFormDialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useConfirm } from "@/components/ui/confirm";
import {
  useContextMenu,
  useCreateAreaMenu,
  type ContextMenuItem,
} from "@/components/ui/context-menu";
import { Combobox } from "@/components/ui/combobox";
import { FILTER_ICONS } from "@/components/ui/filter-select";
import { SkeletonRows } from "@/components/ui/skeleton";
import { useCurrentUser } from "@/features/auth/useAuth";
import { formatDate, todayISO } from "@/features/tasks/task-utils";
import { useListPrefs } from "@/lib/useListPrefs";
import { useViewSearch } from "@/lib/view-search";
import { useUrlFilterHandoff } from "@/lib/useUrlFilterHandoff";
import { applyManualOrder, compareProjects, projectTier, tierLabel } from "./project-order";
import {
  useDeleteProject,
  useProjectOrder,
  useProjects,
  useSetProjectOrder,
  useUpdateProject,
} from "./useProjects";

/**
 * I tre modi di ordinare, nell'ordine in cui compaiono: **Automatico** (le regole
 * in `project-order.ts`), **Titolo** (alfabetico), **Manuale** (l'ordine che ci si
 * trascina da sé). Il trascinamento vive solo nel manuale: prima si trascinava
 * dentro l'automatico, e da lì in poi l'automatico non ordinava più niente senza
 * che si capisse perché.
 */
type ProjectSort = "auto" | "title" | "manual";
const PREFS_KEY = "kancrm-projects-prefs";

interface ProjectsPrefs {
  sortBy: ProjectSort;
  q: string;
  searchTasks: boolean;
  companyId: string | null;
  showArchived: boolean;
}

const DEFAULT_PREFS: ProjectsPrefs = {
  sortBy: "auto",
  q: "",
  searchTasks: false,
  companyId: null,
  showArchived: false,
};

/** Migrazione delle preferenze salvate prima che i modi diventassero tre. */
function migrateSort(value: string): ProjectSort {
  // "smart" e "myDue" (la vecchia "Mia scadenza") ora vivono dentro l'automatico.
  return value === "title" || value === "manual" ? value : "auto";
}

/**
 * Ordinamento "consigliato" a tre fasce: (1) progetti con miei task aperti, per
 * prima scadenza; (2) progetti con miei task (tutti chiusi), per assegnazione più
 * recente; (3) gli altri, alfabetico.
 */
/** Sposta `sourceId` immediatamente prima di `targetId` nell'elenco di id. */
function moveBefore(ids: string[], sourceId: string, targetId: string): string[] {
  if (sourceId === targetId) return ids;
  const out = ids.filter((id) => id !== sourceId);
  const at = out.indexOf(targetId);
  out.splice(at < 0 ? out.length : at, 0, sourceId);
  return out;
}

export function ProgressBar({ closed, total }: { closed: number; total: number }) {
  const percent = total > 0 ? Math.round((closed / total) * 100) : 0;
  return (
    <div className="flex items-center gap-2">
      <div className="h-2 flex-1 overflow-hidden rounded-full bg-muted">
        <div className="h-full rounded-full bg-primary" style={{ width: `${percent}%` }} />
      </div>
      <span className="shrink-0 text-xs text-muted-foreground">
        {closed}/{total}
      </span>
    </div>
  );
}

export function ProjectsPage() {
  const { t } = useTranslation();
  const currentUser = useCurrentUser();
  const navigate = useNavigate();
  const updateProject = useUpdateProject();
  const deleteProject = useDeleteProject();
  const confirm = useConfirm();
  const { open, menu } = useContextMenu();
  const [createOpen, setCreateOpen] = useState(false);
  // Tasto destro nello spazio vuoto: crea (sulle card vince il menu del progetto).
  const { areaProps, menu: areaMenu } = useCreateAreaMenu(t("Nuovo progetto"), () =>
    setCreateOpen(true),
  );
  const [editProject, setEditProject] = useState<ProjectListItem | null>(null);
  // Filtri e ordinamento si ricordano, come in tutte le liste (regola di casa).
  const { prefs, update } = useListPrefs<ProjectsPrefs>(PREFS_KEY, DEFAULT_PREFS);
  const sortBy = migrateSort(prefs.sortBy);
  const { searchTasks, companyId, showArchived } = prefs;
  // Arrivo dai contatori di una scheda cliente: l'elenco si apre già filtrato.
  useUrlFilterHandoff(["cliente"], (values) => update({ companyId: values.cliente ?? null }));
  // La ricerca vive in topbar (campo unico locale/globale) e arriva già a
  // digitazione ferma: il debounce è UNO, dentro la barra di ricerca.
  const searchSetQ = useCallback((value: string) => update({ q: value }), [update]);
  useViewSearch({ q: prefs.q, setQ: searchSetQ, placeholder: t("Cerca un progetto…") });
  const q = prefs.q;
  const { data: projects, isLoading } = useProjects({ q, searchTasks });
  const { data: manualOrder } = useProjectOrder();
  const setProjectOrder = useSetProjectOrder();
  const [dragId, setDragId] = useState<string | null>(null);
  const [overId, setOverId] = useState<string | null>(null);

  const setSort = (value: ProjectSort) => update({ sortBy: value });

  const today = todayISO();
  const isAdmin = currentUser.role === UserRole.ADMIN;
  const canManage = (project: ProjectListItem) => isAdmin || project.myRole === "MANAGER";

  if (isLoading) {
    return <SkeletonRows rows={6} />;
  }

  const filtered = (projects ?? []).filter(
    (p) => (showArchived || !p.isArchived) && (companyId === null || p.company?.id === companyId),
  );
  // Le aziende proposte sono quelle dei progetti che si vedono: una tendina con
  // clienti che non porterebbero da nessuna parte è solo rumore.
  const companyCounts = new Map<string, { name: string; count: number }>();
  for (const project of projects ?? []) {
    if (!project.company) continue;
    const row = companyCounts.get(project.company.id);
    if (row) row.count += 1;
    else companyCounts.set(project.company.id, { name: project.company.name, count: 1 });
  }
  const companyOptions = [...companyCounts]
    .map(([id, { name, count }]) => ({ id, label: `${name} (${count})` }))
    .sort((a, b) => a.label.localeCompare(b.label));
  const hasManualOrder = (manualOrder?.length ?? 0) > 0;
  const visible =
    sortBy === "title"
      ? [...filtered].sort((a, b) => a.name.localeCompare(b.name))
      : sortBy === "manual"
        ? applyManualOrder(filtered, manualOrder ?? [], today)
        : [...filtered].sort((a, b) => compareProjects(a, b, today));

  // Il trascinamento appartiene al modo manuale: è lì che l'ordine è tuo.
  const dndEnabled = sortBy === "manual";
  const onDropOn = (targetId: string) => {
    if (dragId && dragId !== targetId) {
      setProjectOrder.mutate(
        moveBefore(
          visible.map((p) => p.id),
          dragId,
          targetId,
        ),
      );
    }
    setDragId(null);
    setOverId(null);
  };

  const projectMenu = (project: ProjectListItem): ContextMenuItem[] => {
    const items: ContextMenuItem[] = [
      {
        label: t("Apri"),
        icon: <SquarePen className="size-4" />,
        onSelect: () => navigate(`/progetti/${project.id}`),
      },
    ];
    if (canManage(project)) {
      items.push({
        label: t("Membri"),
        icon: <Users className="size-4" />,
        onSelect: () => navigate(`/progetti/${project.id}?membri=1`),
      });
      items.push({
        label: t("Modifica"),
        icon: <Pencil className="size-4" />,
        onSelect: () => setEditProject(project),
      });
      items.push({
        label: project.isArchived ? t("Ripristina") : t("Archivia"),
        icon: project.isArchived ? (
          <ArchiveRestore className="size-4" />
        ) : (
          <Archive className="size-4" />
        ),
        onSelect: () => updateProject.mutate({ id: project.id, isArchived: !project.isArchived }),
      });
      items.push({
        label: t("Elimina"),
        icon: <Trash2 className="size-4" />,
        danger: true,
        separatorBefore: true,
        onSelect: () => {
          void confirm({
            title: t("Eliminare il progetto?"),
            message: t('"{{name}}" e i suoi task finiranno nel cestino.', { name: project.name }),
            confirmLabel: t("Sposta nel cestino"),
            tone: "danger",
          }).then((ok) => {
            if (ok) deleteProject.mutate(project.id);
          });
        },
      });
    }
    return items;
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex rounded-md border p-0.5">
          <Button
            variant={sortBy === "auto" ? "default" : "ghost"}
            size="sm"
            onClick={() => setSort("auto")}
            title={t(
              "Prima le tue scadenze entro 15 giorni, poi i progetti su cui hai lavorato di recente, poi il resto",
            )}
          >
            <Sparkles className="size-4" /> {t("Automatico")}
          </Button>
          <Button
            variant={sortBy === "title" ? "default" : "ghost"}
            size="sm"
            onClick={() => setSort("title")}
          >
            {t("Titolo")}
          </Button>
          <Button
            variant={sortBy === "manual" ? "default" : "ghost"}
            size="sm"
            onClick={() => setSort("manual")}
            title={t("Il tuo ordine: trascina le card per sistemarle")}
          >
            <GripVertical className="size-4" /> {t("Manuale")}
          </Button>
        </div>
        {sortBy === "manual" && hasManualOrder && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setProjectOrder.mutate([])}
            title={t("Dimentica l'ordine trascinato e riparti dall'automatico")}
          >
            <RotateCcw className="size-4" /> {t("Azzera")}
          </Button>
        )}
        {/* Ricerca per parola: sul nome del progetto e, con la spunta, anche
            dentro i titoli dei task — capita di ricordarsi il task e non il
            progetto in cui sta. */}
        <label
          className="flex items-center gap-1.5 text-sm text-muted-foreground"
          title={t(
            "Cerca la parola anche nei titoli dei task: escono i progetti che ne contengono almeno uno",
          )}
        >
          <input
            type="checkbox"
            checked={searchTasks}
            onChange={(e) => update({ searchTasks: e.target.checked })}
          />
          {t("Anche nei task")}
        </label>
        {/* Stessa forma di Offerte e Bacheche: icona, larghezza e testi uguali,
            col numero di progetti accanto a ogni cliente. */}
        {companyOptions.length > 0 && (
          <Combobox
            className="w-52"
            value={companyId}
            onChange={(value) => update({ companyId: value })}
            items={companyOptions}
            emptyLabel={t("Tutti i clienti")}
            placeholder={t("Cerca un cliente…")}
            icon={<FILTER_ICONS.company className="size-4 shrink-0 text-primary" />}
          />
        )}
        <label className="flex items-center gap-1.5 text-sm text-muted-foreground">
          <input
            type="checkbox"
            checked={showArchived}
            onChange={(e) => update({ showArchived: e.target.checked })}
          />
          {t("Mostra archiviati")}
        </label>
        <Button className="ml-auto" onClick={() => setCreateOpen(true)}>
          <Plus className="size-4" /> {t("Nuovo progetto")}
        </Button>
      </div>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3" {...areaProps}>
        {visible.map((project) => (
          <Link
            key={project.id}
            to={`/progetti/${project.id}`}
            draggable={dndEnabled}
            className={cn(
              "flex flex-col gap-3 rounded-lg border bg-card p-4 transition-shadow hover:shadow",
              project.color && "border-2",
              projectBorderClass(project.color),
              dndEnabled && "cursor-grab active:cursor-grabbing",
              dragId === project.id && "opacity-40",
              overId === project.id && dragId && dragId !== project.id && "ring-2 ring-primary",
            )}
            onContextMenu={(e) => open(e, projectMenu(project))}
            onDragStart={
              dndEnabled
                ? (e) => {
                    setDragId(project.id);
                    e.dataTransfer.effectAllowed = "move";
                    // Alcuni browser avviano il drag solo con dei dati impostati.
                    e.dataTransfer.setData("text/plain", project.id);
                  }
                : undefined
            }
            onDragEnd={
              dndEnabled
                ? () => {
                    setDragId(null);
                    setOverId(null);
                  }
                : undefined
            }
            onDragOver={
              dndEnabled
                ? (e) => {
                    e.preventDefault();
                    if (overId !== project.id) setOverId(project.id);
                  }
                : undefined
            }
            onDrop={
              dndEnabled
                ? (e) => {
                    e.preventDefault();
                    onDropOn(project.id);
                  }
                : undefined
            }
          >
            <div className="flex items-start justify-between gap-2">
              <h3 className="flex items-center gap-1.5 font-semibold">
                {dndEnabled && (
                  <GripVertical
                    className="-ml-1 size-4 shrink-0 text-muted-foreground"
                    aria-hidden
                  />
                )}
                <ProjectGlyph icon={project.icon} className="size-4 text-muted-foreground" />
                {project.name}
              </h3>
              {project.isArchived && (
                <Badge variant="outline">
                  <Archive className="mr-1 size-3" /> Archiviato
                </Badge>
              )}
            </div>
            {project.company && (
              <p className="flex items-center gap-1.5 text-sm text-muted-foreground">
                <Building2 className="size-3.5" /> {project.company.name}
              </p>
            )}
            {project.description && (
              <p className="line-clamp-2 text-sm text-muted-foreground">
                {/* Su una scheda serve l'inizio del testo, non il documento. */}
                {richTextToPlain(project.description)}
              </p>
            )}
            <ProgressBar closed={project.closedTaskCount} total={project.taskCount} />
            <div className="flex items-center justify-between text-xs text-muted-foreground">
              <span className="flex items-center gap-2">
                <span>{project.members.length} membri</span>
                {/* Perché sta in questa posizione: un ordine "consigliato" che
                    non si spiega sembra casuale. Solo dove l'ordine è il suo. */}
                {sortBy === "auto" && tierLabel(projectTier(project, today)) && (
                  <span className="inline-flex items-center gap-1 text-primary">
                    <Sparkles className="size-3" />
                    {t(tierLabel(projectTier(project, today)) ?? "")}
                  </span>
                )}
                {project.myNextDueDate && (
                  <span
                    className="inline-flex items-center gap-1"
                    title={t("Prima scadenza di un tuo task in questo progetto")}
                  >
                    <CalendarClock className="size-3" /> {formatDate(project.myNextDueDate)}
                  </span>
                )}
              </span>
              {/* Di questo progetto faccio parte, o lo vedo per altro motivo
                  (amministratore, accesso di gruppo)? Il ruolo lo dice solo se
                  c'è: il resto lo si vede perché si vede tutto, ed è bene
                  saperlo distinguere. */}
              {project.myRole ? (
                <Badge variant="secondary" title={t("Sei membro di questo progetto")}>
                  <UserCheck className="mr-1 size-3" /> {t(roleLabel(project.myRole))}
                </Badge>
              ) : project.myOpenTaskCount > 0 ? (
                <Badge
                  variant="outline"
                  title={t(
                    "Non sei membro: sono i task aperti di cui ti occupi qui, da assegnatario o supervisore (subtask compresi)",
                  )}
                >
                  <UserRound className="mr-1 size-3" /> {project.myOpenTaskCount} tuoi
                </Badge>
              ) : (
                <Badge
                  variant="outline"
                  title={t("Non sei membro e non hai task qui: lo vedi per i tuoi permessi")}
                >
                  Non sei membro
                </Badge>
              )}
            </div>
          </Link>
        ))}
        {visible.length === 0 && (
          <div className="col-span-full rounded-lg border border-dashed p-10 text-center text-sm text-muted-foreground">
            {q || companyId ? (
              <>
                {t("Nessun progetto trovato con questi filtri.")}
                {q && !searchTasks && ` ${t("Prova a cercare anche nei task.")}`}
              </>
            ) : showArchived ? (
              t("Nessun progetto.")
            ) : (
              t("Nessun progetto attivo.")
            )}
          </div>
        )}
      </div>

      {areaMenu}
      {/* Montati solo quando aperti (con key per-record in modifica): i campi
          partono sempre dal dato salvato, niente stato residuo tra aperture. */}
      {createOpen && <ProjectFormDialog onClose={() => setCreateOpen(false)} />}
      {editProject && (
        <ProjectFormDialog
          key={editProject.id}
          project={editProject}
          onClose={() => setEditProject(null)}
        />
      )}
      {menu}
    </div>
  );
}

/** Etichetta del ruolo: la stessa che il server usa negli avvisi. */
export function roleLabel(role: string): string {
  return PROJECT_ROLE_LABELS[role as ProjectRole] ?? role;
}
