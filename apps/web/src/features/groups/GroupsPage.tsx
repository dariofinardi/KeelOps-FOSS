import { useState, type FormEvent } from "react";
import { Combobox } from "@/components/ui/combobox";
import { useTranslation } from "react-i18next";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Eye, Pencil, Plus, Trash2, Users, Puzzle } from "lucide-react";
import {
  ACTIVITY_CATEGORY_LABELS,
  ActivityCategory,
  UserRole,
  VISIBILITY_SCOPE_LABELS,
  VisibilityAccess,
  VisibilityScope,
  type Group,
} from "@kancrm/shared";
import { api } from "@/lib/api";
import { ApiError } from "@/lib/api";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { SectionIcon } from "@/components/ui/section-icon";
import { Dialog } from "@/components/ui/dialog";
import { useSaveOrDiscard } from "@/lib/unsaved-changes";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useUsers } from "@/features/users/useUsers";
import { useUserOptions } from "@/features/tasks/useTasks";
import { useCurrentUser } from "@/features/auth/useAuth";
import {
  useCreateGroup,
  useSetGroupArea,
  useDeleteGroup,
  useGroups,
  useRenameGroup,
  useUpdateGroupMembers,
} from "./useGroups";
import { edizione } from "@/edition/rotte";

/**
 * Moduli con visibilità configurabile per gruppo, tutti con tre livelli:
 * Niente / Sola lettura / Completo. Chi ha un task intestato lo vede e lo
 * lavora comunque, anche senza accesso al modulo.
 */
const VISIBILITY_MODULES = [
  {
    scope: VisibilityScope.DEALS,
    title: "Offerte",
    description:
      "Pipeline commerciale e forecast. In sola lettura si vedono le offerte ma non si modificano; con accesso completo ognuno crea e modifica le proprie. In «Giornate» (sviluppatori) resta il solo elenco, non apribile, con gli importi tradotti in giornate di lavoro e senza contatti, allegati né dati commerciali.",
  },
  {
    scope: VisibilityScope.CONTACTS,
    title: "Persone (contatti)",
    description:
      "Le persone del CRM. Le aziende restano visibili a chi lavora il CRM e, per gli altri, limitatamente a quelle dei propri progetti.",
  },
  {
    scope: VisibilityScope.ADMIN_TASKS,
    title: "Scadenzario completo",
    description:
      "Con l'accesso si vede TUTTO lo scadenzario (in sola lettura non lo si modifica). Gli altri utenti vedono comunque i propri task (assegnati, supervisionati o creati).",
  },
  {
    scope: VisibilityScope.PROJECTS,
    title: "Progetti (sviluppo)",
    description:
      "In sola lettura si osservano tutti i progetti; con accesso completo se ne lavorano i task. I permessi per singolo progetto (membri) restano validi e possono dare di più.",
  },
  // The Tickets scope exists with the ticket module (08/10/2026).
  ...(edizione.moduli.has("ticket")
    ? [
        {
          scope: VisibilityScope.TICKETS,
          title: "Ticket",
          description:
            "Ticket di supporto (lato interno). In sola lettura si consultano senza poterli lavorare.",
        },
      ]
    : []),
] as const;

export function GroupsPage() {
  const { t } = useTranslation();
  const currentUser = useCurrentUser();
  const isAdmin = currentUser.role === UserRole.ADMIN;
  const { data: groups, isLoading } = useGroups();
  const createGroup = useCreateGroup();
  const setArea = useSetGroupArea();
  const deleteGroup = useDeleteGroup();
  const [newName, setNewName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [membersGroup, setMembersGroup] = useState<Group | null>(null);
  const [renameGroup, setRenameGroup] = useState<Group | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Group | null>(null);

  const onCreate = (event: FormEvent) => {
    event.preventDefault();
    setError(null);
    createGroup.mutate(newName, {
      onSuccess: () => setNewName(""),
      onError: (err) => setError(err instanceof ApiError ? err.message : t("Errore imprevisto")),
    });
  };

  if (isLoading) {
    return <p className="text-sm text-muted-foreground">{t("Caricamento gruppi…")}</p>;
  }

  return (
    <div className="flex flex-col gap-4">
      {!isAdmin && (
        <p className="text-sm text-muted-foreground">
          {t(
            "Gestisci i membri dei gruppi di cui sei manager. La creazione dei gruppi, la nomina dei manager e la visibilità dei moduli restano all'amministratore.",
          )}
        </p>
      )}
      {isAdmin && (
        <form onSubmit={onCreate} className="flex items-end gap-2">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="group-name">{t("Nuovo gruppo")}</Label>
            <Input
              id="group-name"
              placeholder={t("Nome gruppo")}
              required
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              className="w-64"
            />
          </div>
          <Button type="submit" disabled={createGroup.isPending}>
            <Plus className="size-4" /> {t("Crea")}
          </Button>
          {error && <p className="pb-2 text-sm text-destructive">{error}</p>}
        </form>
      )}

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {groups?.map((group) => (
          <div key={group.id} className="flex flex-col gap-3 rounded-lg border bg-card p-4">
            <div className="flex items-center justify-between">
              <h2 className="flex items-center gap-2 font-semibold">
                {group.name}
                {/* Chi ha chiesto questo gruppo: l'ha creato un plugin al
                    primo avvio (22/09/2026). Resta un gruppo come gli altri —
                    si rinomina, si cancella, i membri li metti tu — ma da qui
                    si sa da dove viene, e il plugin lo ritrova lo stesso
                    perché non lo cerca per nome. */}
                {group.plugin && (
                  <Badge
                    variant="outline"
                    title={t(
                      "Gruppo chiesto dal plugin {{nick}}: puoi rinominarlo e cancellarlo come gli altri",
                      {
                        nick: group.plugin.nick,
                      },
                    )}
                  >
                    <Puzzle className="size-3" /> {group.plugin.nick}
                  </Badge>
                )}
              </h2>
              {isAdmin && (
                <div className="flex gap-1">
                  <Button
                    variant="ghost"
                    size="icon"
                    title={t("Rinomina")}
                    onClick={() => setRenameGroup(group)}
                  >
                    <Pencil className="size-4" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    title={t("Elimina")}
                    onClick={() => setDeleteTarget(group)}
                  >
                    <Trash2 className="size-4 text-destructive" />
                  </Button>
                </div>
              )}
            </div>
            <div className="flex flex-wrap gap-1">
              {group.members.map((member) => (
                <Badge
                  key={member.id}
                  variant={member.isManager ? "default" : "secondary"}
                  title={
                    member.isManager
                      ? t("{{email}} — manager del gruppo", { email: member.email })
                      : member.email
                  }
                >
                  {member.name}
                  {member.isManager && " ★"}
                </Badge>
              ))}
              {group.members.length === 0 && (
                <p className="text-xs text-muted-foreground">{t("Nessun membro")}</p>
              )}
            </div>
            {/* L'area GOVERNATA: chi è manager di questo gruppo legge i task di
                quell'area — di chiunque siano — e ne configura stati e tipi. È
                un'altra cosa dagli scope di visibilità, che dicono cosa il
                gruppo può vedere. */}
            {isAdmin && (
              <label className="flex items-center gap-2 text-xs text-muted-foreground">
                {t("Area governata")}
                <select
                  className="h-8 rounded-md border bg-background px-2 text-xs"
                  value={group.managedArea ?? ""}
                  title={t(
                    "Il manager di questo gruppo (★) vede e configura i task di quest'area, di chiunque siano",
                  )}
                  onChange={(e) =>
                    setArea.mutate({
                      id: group.id,
                      managedArea: (e.target.value || null) as ActivityCategory | null,
                    })
                  }
                >
                  <option value="">{t("Nessuna")}</option>
                  {[
                    ActivityCategory.ADMIN,
                    ActivityCategory.SALES,
                    ActivityCategory.DEV,
                    ActivityCategory.QUALITY,
                  ].map((category) => (
                    <option key={category} value={category}>
                      {t(ACTIVITY_CATEGORY_LABELS[category])}
                    </option>
                  ))}
                </select>
              </label>
            )}
            <Button
              variant="outline"
              size="sm"
              className="self-start"
              onClick={() => setMembersGroup(group)}
            >
              <Users className="size-4" /> {t("Gestisci membri")}
            </Button>
          </div>
        ))}
      </div>

      {isAdmin && (
        <div className="grid gap-4 md:grid-cols-2">
          {VISIBILITY_MODULES.map((module) => (
            <VisibilityCard key={module.scope} {...module} />
          ))}
          <AccessInspector />
        </div>
      )}

      <MembersDialog group={membersGroup} onClose={() => setMembersGroup(null)} />
      <RenameDialog group={renameGroup} onClose={() => setRenameGroup(null)} />
      <Dialog
        open={deleteTarget !== null}
        onClose={() => setDeleteTarget(null)}
        title={t('Eliminare "{{name}}"?', { name: deleteTarget?.name ?? "" })}
      >
        <p className="mb-4 text-sm text-muted-foreground">
          {t("Il gruppo verrà eliminato; gli utenti non verranno toccati.")}
        </p>
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={() => setDeleteTarget(null)}>
            {t("Annulla")}
          </Button>
          <Button
            variant="destructive"
            disabled={deleteGroup.isPending}
            onClick={() => {
              if (!deleteTarget) return;
              deleteGroup.mutate(deleteTarget.id, { onSuccess: () => setDeleteTarget(null) });
            }}
          >
            {t("Elimina")}
          </Button>
        </div>
      </Dialog>
    </div>
  );
}

type VisibilityGroupSetting = { groupId: string; access: VisibilityAccess };

function VisibilityCard({
  scope,
  title,
  description,
}: {
  scope: VisibilityScope;
  title: string;
  description: string;
}) {
  const { t } = useTranslation();
  const { data: groups } = useGroups();
  const queryClient = useQueryClient();
  const { data: settings } = useQuery({
    queryKey: ["visibility-settings"],
    queryFn: () => api<Record<string, VisibilityGroupSetting[]>>("/api/visibility-settings"),
  });
  const update = useMutation({
    mutationFn: (next: VisibilityGroupSetting[]) =>
      api("/api/visibility-settings", {
        method: "PUT",
        body: { scope, groups: next },
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["visibility-settings"] });
      void queryClient.invalidateQueries({ queryKey: ["me"] });
    },
  });

  const current = settings?.[scope] ?? [];
  const accessOf = (groupId: string): VisibilityAccess | null =>
    current.find((g) => g.groupId === groupId)?.access ?? null;

  const setAccess = (groupId: string, access: VisibilityAccess | null) => {
    const rest = current.filter((g) => g.groupId !== groupId);
    update.mutate(access ? [...rest, { groupId, access }] : rest);
  };

  return (
    <div className="rounded-lg border bg-card p-4">
      <h2 className="flex items-center gap-2 font-semibold">
        <SectionIcon tone="amber">
          <Eye className="size-4" />
        </SectionIcon>
        {t("Visibilità {{title}}", { title: t(title) })}
      </h2>
      <p className="mt-1 text-sm text-muted-foreground">{t(description)}</p>
      <div className="mt-3 flex flex-col gap-1.5">
        {groups?.map((group) => {
          const access = accessOf(group.id);
          return (
            <div key={group.id} className="flex items-center justify-between gap-2 text-sm">
              <span>{group.name}</span>
              <select
                className="h-8 rounded-md border bg-background px-2 text-sm"
                value={access ?? "NONE"}
                disabled={update.isPending}
                onChange={(e) =>
                  setAccess(
                    group.id,
                    e.target.value === "NONE" ? null : (e.target.value as VisibilityAccess),
                  )
                }
              >
                <option value="NONE">{t("Niente")}</option>
                {/* Lente delle Offerte: altrove non vorrebbe dire niente. */}
                {scope === VisibilityScope.DEALS && (
                  <option value={VisibilityAccess.DAYS}>{t("Giornate (sviluppo)")}</option>
                )}
                <option value={VisibilityAccess.READ}>{t("Sola lettura")}</option>
                <option value={VisibilityAccess.FULL}>{t("Completo")}</option>
              </select>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function MembersDialog({ group, onClose }: { group: Group | null; onClose: () => void }) {
  const { t } = useTranslation();
  const currentUser = useCurrentUser();
  const isAdmin = currentUser.role === UserRole.ADMIN;
  // La lista completa (con email) è admin-only; il manager usa il picker comune.
  const { data: fullUsers } = useUsers("tutti", isAdmin);
  const { data: options } = useUserOptions(!isAdmin);
  const users = isAdmin ? fullUsers : options?.map((u) => ({ id: u.id, name: u.name, email: "" }));
  const saveOrDiscard = useSaveOrDiscard();
  const updateMembers = useUpdateGroupMembers();
  const [selected, setSelected] = useState<string[] | null>(null);
  const [managers, setManagers] = useState<string[] | null>(null);

  // Alla prima apertura inizializza la selezione dai membri correnti.
  const selectedIds = selected ?? group?.members.map((m) => m.id) ?? [];
  const managerIds = managers ?? group?.members.filter((m) => m.isManager).map((m) => m.id) ?? [];

  const discard = () => {
    setSelected(null);
    setManagers(null);
    onClose();
  };

  const save = () => {
    if (!group) return;
    updateMembers.mutate(
      {
        id: group.id,
        userIds: selectedIds,
        // managerIds è efficace solo per l'admin; per il manager il server
        // conserva i flag correnti.
        ...(isAdmin ? { managerIds } : {}),
      },
      { onSuccess: discard },
    );
  };

  // Membri e manager si modificano su una copia: chiudendo con modifiche in
  // sospeso si sceglie, invece di perderle senza dirlo.
  const close = () =>
    saveOrDiscard({
      isDirty: selected !== null || managers !== null,
      canSave: true,
      what: t("le modifiche ai membri"),
      onSave: save,
      onDiscard: discard,
    });

  const toggleMember = (userId: string, checked: boolean) => {
    setSelected(checked ? [...selectedIds, userId] : selectedIds.filter((id) => id !== userId));
    // Chi esce dal gruppo perde anche il ruolo di manager.
    if (!checked) setManagers(managerIds.filter((id) => id !== userId));
  };

  return (
    <Dialog
      open={group !== null}
      onClose={close}
      title={t("Membri — {{name}}", { name: group?.name ?? "" })}
    >
      <div className="mb-4 flex max-h-72 flex-col gap-1 overflow-y-auto rounded-md border p-3">
        {users?.map((user) => (
          <div key={user.id} className="flex items-center gap-2 text-sm">
            <label className="flex min-w-0 flex-1 items-center gap-2">
              <input
                type="checkbox"
                checked={selectedIds.includes(user.id)}
                onChange={(e) => toggleMember(user.id, e.target.checked)}
              />
              <span className="truncate">{user.name}</span>
              {user.email && (
                <span className="truncate text-xs text-muted-foreground">{user.email}</span>
              )}
            </label>
            {/* Nomina dei manager: solo l'admin. Il manager vede il contrassegno. */}
            {selectedIds.includes(user.id) &&
              (isAdmin ? (
                <label
                  className="flex shrink-0 items-center gap-1 text-xs text-muted-foreground"
                  title={t(
                    "Manager del gruppo: legge le attività dei membri, gestisce i membri, configura stati e tipi",
                  )}
                >
                  <input
                    type="checkbox"
                    checked={managerIds.includes(user.id)}
                    onChange={(e) =>
                      setManagers(
                        e.target.checked
                          ? [...managerIds, user.id]
                          : managerIds.filter((id) => id !== user.id),
                      )
                    }
                  />
                  {t("Manager")}
                </label>
              ) : (
                managerIds.includes(user.id) && (
                  <span className="shrink-0 text-xs text-muted-foreground">{t("★ manager")}</span>
                )
              ))}
          </div>
        ))}
      </div>
      <div className="flex justify-end gap-2">
        <Button variant="outline" onClick={close}>
          {t("Annulla")}
        </Button>
        <Button disabled={updateMembers.isPending} onClick={save}>
          {updateMembers.isPending ? t("Salvataggio…") : t("Salva")}
        </Button>
      </div>
    </Dialog>
  );
}

function RenameDialog({ group, onClose }: { group: Group | null; onClose: () => void }) {
  const { t } = useTranslation();
  const saveOrDiscard = useSaveOrDiscard();
  const rename = useRenameGroup();
  const [name, setName] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const value = name ?? group?.name ?? "";

  const discard = () => {
    setName(null);
    setError(null);
    onClose();
  };

  const onSubmit = (event?: FormEvent) => {
    event?.preventDefault();
    if (!group) return;
    rename.mutate(
      { id: group.id, name: value },
      {
        onSuccess: discard,
        onError: (err) => setError(err instanceof ApiError ? err.message : t("Errore imprevisto")),
      },
    );
  };

  // Un nome digitato e non salvato non sparisce senza dirlo.
  const close = () =>
    saveOrDiscard({
      isDirty: name !== null && name !== group?.name,
      canSave: value.trim() !== "",
      what: t("il nuovo nome"),
      onSave: () => onSubmit(),
      onDiscard: discard,
    });

  return (
    <Dialog open={group !== null} onClose={close} title={t("Rinomina gruppo")}>
      <form onSubmit={onSubmit} className="flex flex-col gap-4">
        <Input required value={value} onChange={(e) => setName(e.target.value)} />
        {error && <p className="text-sm text-destructive">{error}</p>}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={close}>
            {t("Annulla")}
          </Button>
          <Button type="submit" disabled={rename.isPending}>
            {t("Salva")}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

interface UserAccess {
  userId: string;
  isAdmin: boolean;
  isPortal: boolean;
  scopes: Record<string, VisibilityAccess | null>;
  managerOf: string[];
  canViewAllTimesheets: boolean;
}

const ACCESS_LABELS: Record<string, string> = {
  [VisibilityAccess.READ]: "Sola lettura",
  [VisibilityAccess.FULL]: "Completo",
};

/**
 * "Chi vede cosa": dato un utente, mostra l'accesso effettivo modulo per modulo
 * come risulta dai suoi gruppi. Risponde a colpo d'occhio a "perché Tizio (non)
 * vede questo?" senza ricostruire a mano la matrice gruppi × moduli.
 */
function AccessInspector() {
  const { t } = useTranslation();
  const { data: users } = useUsers();
  const [userId, setUserId] = useState("");
  const { data: access } = useQuery({
    queryKey: ["user-access", userId],
    queryFn: () => api<UserAccess>(`/api/users/${userId}/access`),
    enabled: userId !== "",
  });

  return (
    <div className="rounded-lg border bg-card p-4">
      <h2 className="flex items-center gap-2 font-semibold">
        <SectionIcon tone="sky">
          <Eye className="size-4" />
        </SectionIcon>
        {t("Chi vede cosa")}
      </h2>
      <p className="mt-1 text-sm text-muted-foreground">
        {t(
          "Accesso effettivo di un utente, modulo per modulo (dai suoi gruppi vince il livello più permissivo). I task assegnati, supervisionati o creati restano comunque visibili ovunque.",
        )}
      </p>
      <Combobox
        className="mt-3 w-full"
        value={userId || null}
        onChange={(id) => setUserId(id ?? "")}
        items={(users ?? []).map((user) => ({ id: user.id, label: user.name }))}
        placeholder={t("Scegli un utente…")}
      />
      {access && (
        <div className="mt-3 flex flex-col gap-1.5 text-sm">
          {access.isAdmin && (
            <p className="text-muted-foreground">
              {t("Amministratore: accesso completo a tutto.")}
            </p>
          )}
          {access.isPortal && (
            <p className="text-muted-foreground">
              {t("Utente portale: vede solo i propri ticket.")}
            </p>
          )}
          {!access.isAdmin &&
            !access.isPortal &&
            Object.values(VisibilityScope).map((scope) => {
              const level = access.scopes[scope];
              return (
                <div key={scope} className="flex items-center justify-between gap-2">
                  <span>{t(VISIBILITY_SCOPE_LABELS[scope])}</span>
                  <Badge variant={level ? "default" : "outline"}>
                    {level ? t(ACCESS_LABELS[level] ?? "") : t("Niente")}
                  </Badge>
                </div>
              );
            })}
          {access.managerOf.length > 0 && (
            <p className="mt-1 text-xs text-muted-foreground">
              {t(
                "★ Manager di: {{areas}} (legge le attività dei membri in ogni area, gestisce i membri, configura stati e tipi).",
                { areas: access.managerOf.join(", ") },
              )}
            </p>
          )}
          {access.canViewAllTimesheets && (
            <p className="text-xs text-muted-foreground">{t("Vede i timesheet di tutti.")}</p>
          )}
        </div>
      )}
    </div>
  );
}
