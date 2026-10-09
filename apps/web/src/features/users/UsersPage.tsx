import { useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import {
  Building2,
  Copy,
  KeyRound,
  LifeBuoy,
  Plus,
  RefreshCw,
  Trash2,
  UserCheck,
  UserX,
  LockOpen,
} from "lucide-react";
import {
  UserRole,
  generateTempPassword,
  type ResetPasswordResult,
  type User as UserDto,
} from "@kancrm/shared";
import { ApiError } from "@/lib/api";
import { useToast } from "@/components/ui/toast";
import { formatDateTime } from "@/features/tasks/task-utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { isDirtyForm, useSaveOrDiscard } from "@/lib/unsaved-changes";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useCurrentUser } from "@/features/auth/useAuth";
import { CompanyCombobox } from "@/features/crm/CompanyCombobox";
import { useCampoAzienda } from "@/features/crm/useCampoAzienda";
import { useAutosaveText } from "@/lib/useAutosaveText";
import { useGroups } from "@/features/groups/useGroups";
import {
  useCreateUser,
  useDeleteUser,
  useDeletionImpact,
  useResetPassword,
  useUpdateUser,
  useUsers,
  useAssignableProjects,
  type PerimetroUtenti,
  useUnlockUser,
} from "./useUsers";
import { edizione } from "@/edition/rotte";

/**
 * Colonne che sul telefono non entrano e nemmeno servono: la pagina Utenti si
 * usa da scrivania. Sotto `lg` restano nome, email, ruolo, stato e azioni —
 * quanto basta per riconoscere una persona e agire; il resto torna appena c'è
 * spazio. La classe è **una sola** perché ogni colonna sono due celle (`th` e
 * `td`) e nasconderne una sola sfalsa tutta la tabella.
 */
const WIDE_ONLY = "hidden lg:table-cell";

/** L'ora (Europe/Rome) fino a cui il freno tiene chiuso: si legge nella riga. */
const oraDi = (iso: string) =>
  new Date(iso).toLocaleTimeString("it-IT", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Europe/Rome",
  });

/**
 * Data e ora di un momento, con "mai" quando non c'è. Il giorno da solo non
 * basta: per l'ultima attività la distanza di poche ore è proprio ciò che dice
 * se la persona sta lavorando adesso.
 */
function QuandoCell({ value }: { value: string | null }) {
  const { t } = useTranslation();
  if (!value) return <span className="text-xs italic">{t("mai")}</span>;
  const quando = new Date(value);
  const giorniFa = Math.floor((Date.now() - quando.getTime()) / 86_400_000);
  return (
    <span
      className="text-xs"
      title={
        giorniFa === 0
          ? t("oggi")
          : giorniFa === 1
            ? t("ieri")
            : t("{{count}} giorni fa", { count: giorniFa })
      }
    >
      {formatDateTime(quando.toISOString())}
    </span>
  );
}

/**
 * Progetti su cui la persona può **aprire richieste di supporto**.
 *
 * Nata per i clienti del portale, dal 12/08/2026 vale anche per gli interni che
 * non tengono il desk: un commerciale che segnala il problema del suo cliente
 * non deve per questo ritrovarsi in mano le richieste di tutti. L'elenco È il
 * permesso — nessun progetto, nessun ticket — quindi non c'è una spunta a parte
 * da tenere allineata.
 */
function TicketProjectsCell({ user, compact = false }: { user: UserDto; compact?: boolean }) {
  const { t } = useTranslation();
  // NON `useProjects`: quella è filtrata dalla visibilità, e qui servono tutti
  // i progetti — assegnarne uno è ciò che abilita il cliente ad aprirci ticket,
  // e chi lo fa può non conoscerli (vedi useAssignableProjects).
  const { data: projects } = useAssignableProjects();
  const updateUser = useUpdateUser();
  const [open, setOpen] = useState(false);
  const selected = new Set(user.ticketProjects.map((project) => project.id));

  const toggle = (projectId: string) => {
    const next = new Set(selected);
    if (next.has(projectId)) next.delete(projectId);
    else next.add(projectId);
    updateUser.mutate({ id: user.id, ticketProjectIds: [...next] });
  };

  return (
    <div className="flex flex-col gap-1">
      <div className="flex flex-wrap items-center gap-1">
        {compact && (
          <span className="flex items-center gap-1 text-xs text-muted-foreground">
            <LifeBuoy className="size-3.5" />
            {t("Ticket su")}
          </span>
        )}
        {user.ticketProjects.map((project) => (
          <Badge key={project.id} variant="secondary">
            {project.name}
          </Badge>
        ))}
        {user.ticketProjects.length === 0 && (
          <span className="text-xs text-muted-foreground">{t("nessun progetto")}</span>
        )}
        <Button variant="ghost" size="sm" className="h-7" onClick={() => setOpen((v) => !v)}>
          {open ? t("Chiudi") : t("Scegli")}
        </Button>
      </div>
      {open && (
        <div className="max-h-40 overflow-y-auto rounded-md border p-2">
          {(projects ?? []).map((project) => (
            <label key={project.id} className="flex items-center gap-2 py-0.5 text-sm">
              <input
                type="checkbox"
                className="size-4 accent-primary"
                checked={selected.has(project.id)}
                disabled={updateUser.isPending}
                onChange={() => toggle(project.id)}
              />
              {project.name}
            </label>
          ))}
          {(projects ?? []).length === 0 && (
            <p className="text-xs text-muted-foreground">{t("Nessun progetto in archivio.")}</p>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * Il nome, modificabile sul posto: si salva da solo come ogni testo
 * dell'applicazione, senza un bottone Salva dentro una tabella.
 */
function NomeCell({ user }: { user: UserDto }) {
  const { t } = useTranslation();
  const updateUser = useUpdateUser();
  const nome = useAutosaveText({
    value: user.name,
    required: true,
    singleLine: true,
    onSave: async (value) => {
      await updateUser.mutateAsync({ id: user.id, name: value });
    },
  });
  // L'utente Archivio custodisce le ore di chi è stato eliminato: non si tocca.
  if (user.isSystem) return <span>{user.name}</span>;
  return (
    <Input
      className="h-8 max-w-52 border-transparent px-2 font-medium hover:border-input focus:border-input"
      aria-label={t("Nome")}
      {...nome.props}
    />
  );
}

/** L'azienda del cliente: senza, il portale gli mostra una pagina vuota. */
function AziendaCell({ user }: { user: UserDto }) {
  const { t } = useTranslation();
  const updateUser = useUpdateUser();
  return (
    <div className="flex flex-col gap-1">
      <span className="flex items-center gap-1 text-xs text-muted-foreground">
        <Building2 className="size-3.5" />
        {t("Azienda")}
      </span>
      <CompanyCombobox
        value={user.companyId ?? null}
        onChange={(companyId) => updateUser.mutate({ id: user.id, companyId })}
      />
    </div>
  );
}

/*
 * Edition-dependent parts of the page (08/10/2026): the portal and sales
 * monitor roles and the ticket projects exist with their modules; hours per
 * week (productivity) and calendar aliases (absences) with the commercial
 * timesheet.
 */
const CON_TICKET = edizione.moduli.has("ticket");
const CON_INVESTITORI = edizione.moduli.has("area-investitori");
const CON_TIMESHEET_COMPLETO = edizione.moduli.has("timesheet");

export function UsersPage({ perimetro = "tutti" }: { perimetro?: PerimetroUtenti }) {
  const { t } = useTranslation();
  const currentUser = useCurrentUser();
  // Due finestre sullo stesso elenco: «tutti» è la pagina Utenti
  // dell'amministratore, «portale» è l'area customer care, aperta anche ai
  // manager di gruppo. A filtrare è comunque il server.
  const soloClienti = perimetro === "portale";
  const { data: users, isLoading } = useUsers(perimetro);
  const updateUser = useUpdateUser();
  const unlockUser = useUnlockUser();
  const [createOpen, setCreateOpen] = useState(false);
  const [resetUser, setResetUser] = useState<UserDto | null>(null);
  const [deleteUser, setDeleteUser] = useState<UserDto | null>(null);

  if (isLoading) {
    return <p className="text-sm text-muted-foreground">{t("Caricamento utenti…")}</p>;
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          {soloClienti
            ? t(
                "{{count}} utenti del portale clienti — gli altri utenti si gestiscono da Utenti.",
                { count: users?.length ?? 0 },
              )
            : t("{{count}} utenti — gli utenti disattivati non possono accedere.", {
                count: users?.length ?? 0,
              })}
        </p>
        <Button onClick={() => setCreateOpen(true)}>
          <Plus className="size-4" /> {soloClienti ? t("Nuovo cliente") : t("Nuovo utente")}
        </Button>
      </div>

      <div className="overflow-x-auto rounded-lg border">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b bg-muted/50 text-left text-xs uppercase text-muted-foreground">
              <th className="px-4 py-3 font-medium">{t("Nome")}</th>
              <th className="px-4 py-3 font-medium">{t("Email")}</th>
              <th className="px-4 py-3 font-medium">{t("Ruolo")}</th>
              <th
                className={`px-4 py-3 font-medium ${WIDE_ONLY}`}
                title={t(
                  "Gruppi di appartenenza e progetti su cui può aprire richieste di supporto",
                )}
              >
                {CON_TICKET ? t("Gruppi e ticket") : t("Gruppi")}
              </th>
              {!soloClienti && (
                <th
                  className={`px-4 py-3 font-medium ${WIDE_ONLY}`}
                  title={t("Chi riceve i task delle offerte vinte da questo utente")}
                >
                  {t("Amministrativo")}
                </th>
              )}
              {!soloClienti && CON_TIMESHEET_COMPLETO && (
                <th
                  className={`px-4 py-3 text-right font-medium ${WIDE_ONLY}`}
                  title={t("Ore settimanali da contratto: il metro dei riepiloghi di produttività")}
                >
                  {t("Ore/sett.")}
                </th>
              )}
              {!soloClienti && CON_TIMESHEET_COMPLETO && (
                <th
                  className={`px-4 py-3 font-medium ${WIDE_ONLY}`}
                  title={t("Soprannomi usati sul calendario delle assenze")}
                >
                  {t("Sul calendario")}
                </th>
              )}
              {!soloClienti && (
                <th
                  className={`px-4 py-3 text-center font-medium ${WIDE_ONLY}`}
                  title={t("Vede i timesheet di tutti; per un monitor vendite, tutte le offerte")}
                >
                  {t("Timesheet team")}
                </th>
              )}
              <th
                className={`px-4 py-3 font-medium ${WIDE_ONLY}`}
                title={t("Ultima autenticazione riuscita")}
              >
                {t("Ultimo accesso")}
              </th>
              <th
                className={`px-4 py-3 font-medium ${WIDE_ONLY}`}
                title={t(
                  "Ultima volta che ha usato l'applicazione: la sessione dura giorni, quindi è un'altra cosa dall'accesso",
                )}
              >
                {t("Ultima attività")}
              </th>
              <th className="px-4 py-3 font-medium">{t("Stato")}</th>
              <th className="px-4 py-3 text-right font-medium">{t("Azioni")}</th>
            </tr>
          </thead>
          <tbody>
            {users?.map((user) => (
              <tr key={user.id} className="border-b last:border-0 hover:bg-muted/30">
                <td className="px-4 py-3 font-medium">
                  <NomeCell user={user} />
                </td>
                <td className="px-4 py-3 text-muted-foreground">{user.email}</td>
                <td className="px-4 py-3">
                  {soloClienti ? (
                    // Qui vivono solo clienti del portale: il ruolo non è una
                    // scelta, e a farlo rispettare è il server, non questa riga.
                    <span className="text-muted-foreground">{t("Portale (cliente)")}</span>
                  ) : (
                    <select
                      className="rounded-md border bg-background px-2 py-1 text-sm disabled:opacity-50"
                      value={user.role}
                      disabled={user.id === currentUser.id || updateUser.isPending}
                      onChange={(e) =>
                        updateUser.mutate({ id: user.id, role: e.target.value as UserRole })
                      }
                    >
                      <option value={UserRole.ADMIN}>{t("Admin")}</option>
                      <option value={UserRole.MEMBER}>{t("Membro")}</option>
                      {CON_TICKET && (
                        <option value={UserRole.PORTAL}>{t("Portale (cliente)")}</option>
                      )}
                      {CON_INVESTITORI && (
                        <option value={UserRole.SALES_MONITOR}>{t("Monitor vendite")}</option>
                      )}
                    </select>
                  )}
                </td>
                <td className={`px-4 py-3 ${WIDE_ONLY}`}>
                  {user.role === UserRole.PORTAL ? (
                    // Un cliente non sta nei gruppi interni: quello che conta è
                    // l'azienda — senza, il portale gli è vuoto — e su quali
                    // progetti può aprire richieste.
                    <div className="flex flex-col gap-2">
                      <AziendaCell user={user} />
                      <TicketProjectsCell user={user} />
                    </div>
                  ) : (
                    <div className="flex flex-col gap-1.5">
                      <div className="flex flex-wrap gap-1">
                        {user.groups.map((group) => (
                          <Badge key={group.id} variant="secondary">
                            {group.name}
                          </Badge>
                        ))}
                        {user.groups.length === 0 && (
                          <span className="text-xs text-muted-foreground">
                            {t("nessun gruppo")}
                          </span>
                        )}
                      </div>
                      {/* Anche un interno può aprire richieste senza tenere il
                          desk: qui si dice su quali progetti (12/08/2026). */}
                      {CON_TICKET && !user.isSystem && user.role !== UserRole.SALES_MONITOR && (
                        <TicketProjectsCell user={user} compact />
                      )}
                    </div>
                  )}
                </td>
                {/* Offerta vinta → il task va a questo amministrativo, con il
                    commerciale come supervisore. */}
                {!soloClienti && (
                  <td className={`px-4 py-3 ${WIDE_ONLY}`}>
                    {user.role === UserRole.SALES_MONITOR ? (
                      // Il portale investitori: di serie vede solo le offerte
                      // spuntate come da mostrare; qui l'admin gliele apre tutte
                      // (01/10/2026). Un'etichetta visibile, perché la colonna
                      // parla d'altro.
                      <label className="inline-flex cursor-pointer items-center gap-1.5 text-xs">
                        <input
                          type="checkbox"
                          className="size-4 cursor-pointer accent-primary disabled:opacity-50"
                          checked={user.salesMonitorAllDeals}
                          disabled={updateUser.isPending}
                          title={t(
                            "Vede tutte le offerte, non solo quelle spuntate come da mostrare",
                          )}
                          onChange={(e) =>
                            updateUser.mutate({
                              id: user.id,
                              salesMonitorAllDeals: e.target.checked,
                            })
                          }
                        />
                        {t("Tutte le offerte")}
                      </label>
                    ) : user.isSystem || user.role === UserRole.PORTAL ? (
                      <span className="text-muted-foreground">—</span>
                    ) : (
                      <select
                        className="max-w-44 rounded-md border bg-background px-2 py-1 text-sm disabled:opacity-50"
                        value={user.billingAssignee?.id ?? ""}
                        disabled={updateUser.isPending}
                        title={t("Amministrativo a cui assegnare i task delle offerte vinte")}
                        onChange={(e) =>
                          updateUser.mutate({
                            id: user.id,
                            billingAssigneeId: e.target.value || null,
                          })
                        }
                      >
                        <option value="">{t("— nessuno")}</option>
                        {(users ?? [])
                          .filter(
                            (candidate) =>
                              candidate.id !== user.id &&
                              candidate.isActive &&
                              !candidate.isSystem &&
                              candidate.role !== UserRole.PORTAL &&
                              candidate.role !== UserRole.SALES_MONITOR,
                          )
                          .map((candidate) => (
                            <option key={candidate.id} value={candidate.id}>
                              {candidate.name}
                            </option>
                          ))}
                      </select>
                    )}
                  </td>
                )}
                {/* Ore da contratto: il denominatore dei riepiloghi di
                    produttività. Si scrive solo per chi lavora qui — un cliente
                    del portale non ha ore nostre da confrontare. */}
                {!soloClienti && CON_TIMESHEET_COMPLETO && (
                  <td className={`px-4 py-3 text-right ${WIDE_ONLY}`}>
                    {user.isSystem ||
                    user.role === UserRole.PORTAL ||
                    user.role === UserRole.SALES_MONITOR ? (
                      <span className="text-muted-foreground">—</span>
                    ) : (
                      <input
                        type="number"
                        min={0}
                        max={80}
                        className="w-16 rounded-md border bg-background px-2 py-1 text-right text-sm tabular-nums disabled:opacity-50"
                        defaultValue={user.weeklyHours}
                        disabled={updateUser.isPending}
                        title={t(
                          "Ore settimanali da contratto; zero per i collaboratori senza monte ore",
                        )}
                        onBlur={(e) => {
                          const ore = Number(e.target.value);
                          // Zero è valido: è il collaboratore senza monte ore.
                          if (!Number.isFinite(ore) || ore < 0 || ore > 80) {
                            e.target.value = String(user.weeklyHours);
                            return;
                          }
                          if (ore !== user.weeklyHours) {
                            updateUser.mutate({ id: user.id, weeklyHours: ore });
                          }
                        }}
                      />
                    )}
                  </td>
                )}
                {/* Come questa persona è chiamata sul calendario delle assenze.
                    Nome e cognome si riconoscono da soli: qui va solo il
                    soprannome — «Manu», «Franci» (21/08/2026). */}
                {!soloClienti && CON_TIMESHEET_COMPLETO && (
                  <td className={`px-4 py-3 ${WIDE_ONLY}`}>
                    {user.isSystem ||
                    user.role === UserRole.PORTAL ||
                    user.role === UserRole.SALES_MONITOR ? (
                      <span className="text-muted-foreground">—</span>
                    ) : (
                      <input
                        className="w-28 rounded-md border bg-background px-2 py-1 text-sm disabled:opacity-50"
                        defaultValue={user.calendarAliases ?? ""}
                        placeholder={t("Manu, Emi")}
                        disabled={updateUser.isPending}
                        title={t("Soprannomi usati sul calendario delle assenze")}
                        onBlur={(e) => {
                          const valore = e.target.value.trim();
                          if (valore !== (user.calendarAliases ?? "")) {
                            updateUser.mutate({ id: user.id, calendarAliases: valore || null });
                          }
                        }}
                      />
                    )}
                  </td>
                )}
                {!soloClienti && (
                  <td className={`px-4 py-3 text-center ${WIDE_ONLY}`}>
                    {user.isSystem ||
                    user.role === UserRole.PORTAL ||
                    user.role === UserRole.SALES_MONITOR ? (
                      <span className="text-muted-foreground">—</span>
                    ) : (
                      <input
                        type="checkbox"
                        className="size-4 cursor-pointer accent-primary disabled:opacity-50"
                        checked={user.canViewAllTimesheets}
                        disabled={updateUser.isPending}
                        title={t("Vede i timesheet di tutti (solo timesheet, non tocca gli scope)")}
                        onChange={(e) =>
                          updateUser.mutate({ id: user.id, canViewAllTimesheets: e.target.checked })
                        }
                      />
                    )}
                  </td>
                )}
                <td className={`px-4 py-3 text-muted-foreground ${WIDE_ONLY}`}>
                  <QuandoCell value={user.lastLoginAt} />
                </td>
                <td className={`px-4 py-3 text-muted-foreground ${WIDE_ONLY}`}>
                  <QuandoCell value={user.lastSeenAt} />
                </td>
                <td className="px-4 py-3">
                  {user.isSystem ? (
                    <Badge variant="secondary">{t("Sistema")}</Badge>
                  ) : user.lockedUntil ? (
                    // Il freno sulle password sbagliate (vedi auth/lockout.ts):
                    // si azzera dal lucchetto qui accanto, o reimpostando la password.
                    <Badge
                      variant="destructive"
                      title={t("{{n}} password sbagliate di fila", {
                        n: user.failedPasswordAttempts,
                      })}
                    >
                      {t("Bloccato fino alle {{time}}", { time: oraDi(user.lockedUntil) })}
                    </Badge>
                  ) : user.isActive ? (
                    <Badge variant="outline">{t("Attivo")}</Badge>
                  ) : user.authProvider === "GOOGLE" ? (
                    // Nato da un accesso Google (JIT): aspetta l'attivazione, non
                    // è stato disattivato. La distinzione conta per chi decide.
                    <Badge variant="secondary">{t("In attesa (Google)")}</Badge>
                  ) : (
                    <Badge variant="destructive">{t("Disattivato")}</Badge>
                  )}
                </td>
                <td className="px-4 py-3">
                  {/* L'utente Archivio custodisce le ore di chi è stato eliminato:
                      non si modifica, non si elimina, non accede. */}
                  {!user.isSystem && (
                    <div className="flex justify-end gap-1">
                      {(user.lockedUntil || user.failedPasswordAttempts >= 3) && (
                        <Button
                          variant="ghost"
                          size="icon"
                          title={t("Azzera il freno sui tentativi")}
                          disabled={unlockUser.isPending}
                          onClick={() => unlockUser.mutate(user.id)}
                        >
                          <LockOpen className="size-4 text-destructive" />
                        </Button>
                      )}
                      <Button
                        variant="ghost"
                        size="icon"
                        title={t("Reimposta password")}
                        onClick={() => setResetUser(user)}
                      >
                        <KeyRound className="size-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        title={user.isActive ? t("Disattiva") : t("Riattiva")}
                        disabled={user.id === currentUser.id || updateUser.isPending}
                        onClick={() => updateUser.mutate({ id: user.id, isActive: !user.isActive })}
                      >
                        {user.isActive ? (
                          <UserX className="size-4 text-destructive" />
                        ) : (
                          <UserCheck className="size-4" />
                        )}
                      </Button>
                      {/* Eliminare è irreversibile e porta via lo storico: resta
                          dell'amministratore, e il server lo ripete. */}
                      {!soloClienti && (
                        <Button
                          variant="ghost"
                          size="icon"
                          title={t("Elimina definitivamente")}
                          disabled={user.id === currentUser.id}
                          onClick={() => setDeleteUser(user)}
                        >
                          <Trash2 className="size-4 text-destructive" />
                        </Button>
                      )}
                    </div>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <CreateUserDialog
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        soloClienti={soloClienti}
      />
      <ResetPasswordDialog user={resetUser} onClose={() => setResetUser(null)} />
      <DeleteUserDialog user={deleteUser} users={users ?? []} onClose={() => setDeleteUser(null)} />
    </div>
  );
}

function CreateUserDialog({
  open,
  onClose,
  soloClienti = false,
}: {
  open: boolean;
  onClose: () => void;
  /** Nell'area customer care nasce un cliente del portale, e nient'altro. */
  soloClienti?: boolean;
}) {
  const { t } = useTranslation();
  const saveOrDiscard = useSaveOrDiscard();
  const createUser = useCreateUser();
  const { data: groups } = useGroups();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState<UserRole>(soloClienti ? UserRole.PORTAL : UserRole.MEMBER);
  const [groupIds, setGroupIds] = useState<string[]>([]);
  // L'azienda del cliente si scrive e basta: al salvataggio si trova o si crea.
  const azienda = useCampoAzienda(null);
  const [error, setError] = useState<string | null>(null);

  const reset = () => {
    setName("");
    setEmail("");
    setPassword("");
    setRole(soloClienti ? UserRole.PORTAL : UserRole.MEMBER);
    setGroupIds([]);
    azienda.reimposta(null);
    setError(null);
  };

  /**
   * Un cliente del portale senza azienda vede una pagina vuota: il bottone resta
   * spento finché l'azienda **non c'è**, e il server lo ripete a chi arriva da
   * un'altra strada. «C'è» vuol dire scelta **oppure scritta**: prima serviva
   * sceglierla dall'elenco, e un'azienda nuova andava creata a parte prima di
   * poter creare il suo cliente (16/09/2026).
   */
  const clientePronto = role !== UserRole.PORTAL || azienda.compilato;

  // Uscendo si sceglie: creare, o buttare via quel che si è scritto.
  const onSubmit = async (event?: FormEvent) => {
    event?.preventDefault();
    setError(null);
    let companyId: string | null = null;
    if (role === UserRole.PORTAL) {
      try {
        companyId = await azienda.risolvi();
      } catch (err) {
        setError(err instanceof ApiError ? err.message : t("Errore imprevisto"));
        return;
      }
    }
    createUser.mutate(
      {
        name,
        email,
        password,
        role,
        groupIds: role === UserRole.PORTAL ? [] : groupIds,
        companyId,
      },
      {
        onSuccess: () => {
          reset();
          onClose();
        },
        onError: (err) => setError(err instanceof ApiError ? err.message : t("Errore imprevisto")),
      },
    );
  };

  const requestClose = () =>
    saveOrDiscard({
      isDirty: isDirtyForm([
        [name, ""],
        [email, ""],
        [password, ""],
        [role, UserRole.MEMBER],
        [groupIds.length, 0],
        [azienda.companyId, null],
        [azienda.testo, ""],
      ]),
      canSave: name.trim() !== "" && email.trim() !== "" && password.length >= 8,
      what: t("il nuovo utente"),
      onSave: () => onSubmit(),
      onDiscard: () => {
        reset();
        onClose();
      },
    });

  return (
    <Dialog open={open} onClose={requestClose} title={t("Nuovo utente")}>
      <form onSubmit={onSubmit} className="flex flex-col gap-4">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="new-name">{t("Nome")}</Label>
          <Input id="new-name" required value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="new-email">{t("Email")}</Label>
          <Input
            id="new-email"
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="new-password">{t("Password (min. 8 caratteri)")}</Label>
          <Input
            id="new-password"
            type="password"
            required
            minLength={8}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </div>
        {/* Dall'area customer care il ruolo non si sceglie: è già deciso. */}
        {!soloClienti && (
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="new-role">{t("Ruolo")}</Label>
            <select
              id="new-role"
              className="h-9 rounded-md border bg-background px-2 text-sm"
              value={role}
              onChange={(e) => setRole(e.target.value as UserRole)}
            >
              <option value={UserRole.MEMBER}>{t("Membro")}</option>
              <option value={UserRole.ADMIN}>{t("Admin")}</option>
              {CON_TICKET && <option value={UserRole.PORTAL}>{t("Portale (cliente)")}</option>}
              {CON_INVESTITORI && (
                <option value={UserRole.SALES_MONITOR}>{t("Monitor vendite")}</option>
              )}
            </select>
            {role === UserRole.PORTAL && (
              <p className="text-xs text-muted-foreground">
                {t("Accesso limitato: può solo aprire ticket, chattare e ricevere notifiche.")}
              </p>
            )}
            {role === UserRole.SALES_MONITOR && (
              <p className="text-xs text-muted-foreground">
                {t(
                  "Accesso esterno in sola lettura alle offerte contrassegnate «Visibile ai monitor vendite»: le legge, ne consulta i documenti a schermo (senza scaricarli) e può scrivere nella chat. Non vede nient'altro.",
                )}
              </p>
            )}
          </div>
        )}
        {role === UserRole.PORTAL && (
          <div className="flex flex-col gap-1.5">
            <Label>{t("Azienda cliente")}</Label>
            <CompanyCombobox {...azienda.comboProps} />
          </div>
        )}
        <div className={role === UserRole.PORTAL ? "hidden" : "flex flex-col gap-1.5"}>
          <Label>{t("Gruppi")}</Label>
          <div className="flex flex-col gap-1 rounded-md border p-3">
            {groups?.map((group) => (
              <label key={group.id} className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={groupIds.includes(group.id)}
                  onChange={(e) =>
                    setGroupIds((prev) =>
                      e.target.checked ? [...prev, group.id] : prev.filter((id) => id !== group.id),
                    )
                  }
                />
                {group.name}
              </label>
            ))}
            {(groups?.length ?? 0) === 0 && (
              <p className="text-xs text-muted-foreground">{t("Nessun gruppo disponibile")}</p>
            )}
          </div>
        </div>
        {error && <p className="text-sm text-destructive">{error}</p>}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={requestClose}>
            {t("Annulla")}
          </Button>
          <Button
            type="submit"
            disabled={createUser.isPending || azienda.inCorso || !clientePronto}
          >
            {createUser.isPending ? t("Creazione…") : t("Crea utente")}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

/**
 * Reimpostazione rapida della password (15/08/2026).
 *
 * Prima chiedeva di inventarsi una password e la nascondeva sotto i pallini:
 * un campo del genere lo si compila con "Password123", e poi la si detta a
 * voce sperando di ricordarla. Qui la password **arriva già proposta** (robusta
 * e dettabile, `generateTempPassword`), si legge in chiaro — è provvisoria e va
 * consegnata, nasconderla serve solo a chi la deve rubare da dietro le spalle —
 * e si copia con un pulsante.
 *
 * Dopo il reset la finestra **non si chiude da sola**: mostra l'esito. Se
 * l'email è partita l'amministratore ha finito; se la posta non è configurata
 * deve consegnare lui la password, e la trova ancora lì con il pulsante per
 * copiarla. Chiudere in silenzio in quel caso vorrebbe dire lasciare fuori una
 * persona senza che nessuno lo sappia.
 */
function ResetPasswordDialog({ user, onClose }: { user: UserDto | null; onClose: () => void }) {
  const { t } = useTranslation();
  const toast = useToast();
  const saveOrDiscard = useSaveOrDiscard();
  const resetPassword = useResetPassword();
  const [password, setPassword] = useState(generateTempPassword);
  const [done, setDone] = useState<ResetPasswordResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Ogni apertura è un reset diverso: password nuova, esito pulito.
  const close = () => {
    setPassword(generateTempPassword());
    setDone(null);
    setError(null);
    onClose();
  };

  const copy = () => {
    void navigator.clipboard.writeText(password);
    toast(t("Password copiata."), "success");
  };

  const onSubmit = (event?: FormEvent) => {
    event?.preventDefault();
    if (!user) return;
    setError(null);
    resetPassword.mutate(
      { id: user.id, password },
      {
        onSuccess: (result) => setDone(result),
        onError: (err) => setError(err instanceof ApiError ? err.message : t("Errore imprevisto")),
      },
    );
  };

  // La password proposta non è "lavoro perso" se la si abbandona: la domanda
  // arriva solo se l'admin l'ha cambiata a mano e non l'ha ancora applicata.
  const requestClose = () => {
    if (done) return close();
    saveOrDiscard({
      isDirty: false,
      canSave: password.length >= 8,
      what: t("la nuova password"),
      onSave: () => onSubmit(),
      onDiscard: close,
    });
  };

  return (
    <Dialog
      open={user !== null}
      onClose={requestClose}
      title={t("Reimposta password — {{name}}", { name: user?.name ?? "" })}
    >
      <form onSubmit={onSubmit} className="flex flex-col gap-4">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="reset-password">{t("Password provvisoria")}</Label>
          <div className="flex gap-2">
            <Input
              id="reset-password"
              data-autofocus
              required
              minLength={8}
              readOnly={done !== null}
              className="font-mono"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
            <Button type="button" variant="outline" size="icon" title={t("Copia")} onClick={copy}>
              <Copy className="size-4" />
            </Button>
            {!done && (
              <Button
                type="button"
                variant="outline"
                size="icon"
                title={t("Proponine un'altra")}
                onClick={() => setPassword(generateTempPassword())}
              >
                <RefreshCw className="size-4" />
              </Button>
            )}
          </div>
        </div>
        {!done && (
          <p className="text-sm text-muted-foreground">
            {t(
              "Le sessioni attive vengono chiuse e la password arriva per email all'utente, che al primo accesso dovrà sceglierne una sua.",
            )}
          </p>
        )}
        {done &&
          (done.emailSent ? (
            <p className="text-sm text-green-600">
              {t("Password reimpostata: le credenziali sono partite verso {{email}}.", {
                email: done.email,
              })}
            </p>
          ) : (
            <p className="text-sm text-amber-700 dark:text-amber-400">
              {t(
                "Password reimpostata, ma l'email non è partita (posta non configurata o casella rifiutata): comunicala tu a {{email}}.",
                { email: done.email },
              )}
            </p>
          ))}
        {error && <p className="text-sm text-destructive">{error}</p>}
        <div className="flex justify-end gap-2">
          {done ? (
            <Button type="button" onClick={close}>
              {t("Chiudi")}
            </Button>
          ) : (
            <>
              <Button type="button" variant="outline" onClick={requestClose}>
                {t("Annulla")}
              </Button>
              <Button type="submit" disabled={resetPassword.isPending}>
                {resetPassword.isPending ? t("Salvataggio…") : t("Reimposta")}
              </Button>
            </>
          )}
        </div>
      </form>
    </Dialog>
  );
}

/**
 * Eliminazione definitiva di un utente. Mostra prima cosa comporta: se l'utente
 * ha dati collegati serve indicare a chi trasferirli, altrimenti si elimina e basta.
 * Le ore a timesheet non seguono il destinatario ma vanno all'utente Archivio, col
 * nome del vecchio intestatario nella nota: i totali dei mesi chiusi non cambiano.
 */
function DeleteUserDialog({
  user,
  users,
  onClose,
}: {
  user: UserDto | null;
  users: UserDto[];
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const { data: impact, isLoading } = useDeletionImpact(user?.id ?? null);
  const deleteUser = useDeleteUser();
  const [transferTo, setTransferTo] = useState("");
  const [error, setError] = useState<string | null>(null);

  const close = () => {
    setTransferTo("");
    setError(null);
    onClose();
  };

  // Destinatari possibili: utenti interni attivi, escluso quello da eliminare.
  const candidates = users.filter(
    (candidate) =>
      candidate.id !== user?.id &&
      candidate.isActive &&
      !candidate.isSystem &&
      candidate.role !== UserRole.PORTAL,
  );

  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    if (!user) return;
    setError(null);
    deleteUser.mutate(
      { id: user.id, transferTo: impact?.hasData ? transferTo : null },
      {
        onSuccess: close,
        onError: (err) => setError(err instanceof ApiError ? err.message : t("Errore imprevisto")),
      },
    );
  };

  const counts = impact?.counts;
  const lines = counts
    ? [
        counts.tasks > 0 && t("{{count}} task", { count: counts.tasks }),
        counts.deals > 0 && t("{{count}} offerte", { count: counts.deals }),
        counts.comments > 0 && t("{{count}} commenti", { count: counts.comments }),
        counts.recurrences > 0 && t("{{count}} ricorrenze", { count: counts.recurrences }),
        counts.projects > 0 && t("{{count}} progetti", { count: counts.projects }),
        counts.notes > 0 && t("{{count}} note CRM", { count: counts.notes }),
        counts.activities > 0 && t("{{count}} azioni nello storico", { count: counts.activities }),
      ].filter((line): line is string => typeof line === "string")
    : [];

  return (
    <Dialog
      open={user !== null}
      onClose={close}
      title={t("Elimina utente — {{name}}", { name: user?.name ?? "" })}
    >
      <form onSubmit={onSubmit} className="flex flex-col gap-4">
        {isLoading && (
          <p className="text-sm text-muted-foreground">{t("Verifica dei dati collegati…")}</p>
        )}

        {impact && !impact.hasData && (
          <p className="text-sm text-muted-foreground">
            {t(
              "L'utente non ha dati collegati: verrà eliminato definitivamente. L'operazione non è reversibile.",
            )}
          </p>
        )}

        {impact?.hasData && (
          <>
            <div className="flex flex-col gap-2 rounded-md border p-3 text-sm">
              <p className="text-muted-foreground">{t("A questo utente sono collegati:")}</p>
              <ul className="list-inside list-disc text-muted-foreground">
                {lines.map((line) => (
                  <li key={line}>{line}</li>
                ))}
                {counts && counts.hours > 0 && (
                  <li>
                    {counts.hours.toLocaleString("it-IT")} {t("ore a timesheet")} —{" "}
                    <span className="text-foreground">
                      {t(
                        "restano nei totali, intestate ad “Archivio” con il nome di {{name}} nella nota",
                        { name: user?.name ?? "" },
                      )}
                    </span>
                  </li>
                )}
              </ul>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="transfer-to">{t("Trasferisci task, offerte e storico a")}</Label>
              <select
                id="transfer-to"
                required
                className="h-9 rounded-md border bg-background px-2 text-sm"
                value={transferTo}
                onChange={(e) => setTransferTo(e.target.value)}
              >
                <option value="">{t("Scegli un utente…")}</option>
                {candidates.map((candidate) => (
                  <option key={candidate.id} value={candidate.id}>
                    {candidate.name}
                  </option>
                ))}
              </select>
              {candidates.length === 0 && (
                <p className="text-xs text-destructive">
                  {t("Nessun altro utente interno attivo a cui trasferire i dati.")}
                </p>
              )}
            </div>
          </>
        )}

        {error && <p className="text-sm text-destructive">{error}</p>}
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={close}>
            {t("Annulla")}
          </Button>
          <Button
            type="submit"
            variant="destructive"
            disabled={deleteUser.isPending || isLoading || (impact?.hasData && !transferTo)}
          >
            {deleteUser.isPending ? t("Eliminazione…") : t("Elimina definitivamente")}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
