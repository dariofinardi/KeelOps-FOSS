import { useEffect, useRef, useState, type FormEvent } from "react";
import { useDocumentTitle } from "@/lib/use-document-title";
import { LinkedTaskLayer } from "@/features/tasks/LinkedTaskLayer";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import {
  CheckCircle2,
  ChevronRight,
  Circle,
  FolderKanban,
  ListTodo,
  Plus,
  Receipt,
  Lock,
  Trash2,
  X,
} from "lucide-react";
import { isRichTextEmpty } from "@kancrm/shared";
import type { DealDetail, LinkedTask } from "@kancrm/shared";
import { ApiError } from "@/lib/api";
import { slot } from "@/edition/slots";
import { Button } from "@/components/ui/button";
import { Combobox } from "@/components/ui/combobox";
import { Input } from "@/components/ui/input";
import { DateField } from "@/components/ui/date-field";
import { Label } from "@/components/ui/label";
import { PanelGroup } from "@/components/ui/panel-group";
import { RichTextField } from "@/components/ui/rich-text/RichTextField";
import { useCurrentUser } from "@/features/auth/useAuth";
import { useConfirm } from "@/components/ui/confirm";
import { useToast } from "@/components/ui/toast";
import { useKeepOrRevert } from "@/lib/unsaved-changes";
import { useAutosaveText } from "@/lib/useAutosaveText";
import { SidePanel } from "@/components/ui/side-panel";
import { QuickAddCompanyDialog, QuickAddContactDialog } from "@/features/crm/QuickAdd";
import { useCompanies, useContactOptions } from "@/features/crm/useCrm";
import { LostReasonDialog } from "./LostReasonDialog";
import { AttachmentsSection } from "@/features/tasks/TaskDetailDrawer";
import { CommentsSection, TaskActivitySection } from "@/features/tasks/TaskTimeline";
import { ChatDock } from "@/features/tasks/ChatDock";
import { useCreateTask } from "@/features/tasks/useTasks";
import { useOptions } from "@/features/options/useOptions";
import { formatDate } from "@/features/tasks/task-utils";
import { useDealDetail, useDealStages, useDeleteDeal, useUpdateDeal } from "./useDeals";
import {
  changedDealFields,
  dealRestorePayload,
  snapshotOfDeal,
  type DealSnapshot,
} from "./deal-snapshot";
import { edizione } from "@/edition/rotte";

/** In un'offerta la data che cambia è la chiusura prevista, non una scadenza. */
const DEAL_ACTIVITY_LABELS = {
  due_changed: "ha cambiato la chiusura prevista",
  created: "ha creato l'offerta",
};

interface DealDetailDrawerProps {
  dealId: string | null;
  onClose: () => void;
}

export function DealDetailDrawer({ dealId, onClose }: DealDetailDrawerProps) {
  const { t } = useTranslation();
  const { data: deal, error } = useDealDetail(dealId);
  useDocumentTitle(deal?.title ?? null);

  // Il contenuto (che sa cosa è cambiato) registra qui la propria chiusura
  // "protetta": Esc, la X e il clic fuori devono offrire il ripristino.
  const requestCloseRef = useRef<(() => void) | null>(null);
  const requestClose = () => (requestCloseRef.current ?? onClose)();

  return (
    // I link ai task (il «Task di origine») si aprono sopra l'offerta, e
    // chiudendoli si torna qui. La chiave azzera lo strato al cambio offerta.
    <LinkedTaskLayer key={dealId ?? "nessuna"}>
      <SidePanel
        open={dealId !== null}
        onClose={requestClose}
        label={deal?.title ?? t("Dettaglio offerta")}
      >
        {deal ? (
          <DrawerContent
            // Rimonta al cambio offerta: le bozze autosalvanti non devono
            // sopravvivere e finire sull'offerta aperta dopo.
            key={deal.id}
            deal={deal}
            onClose={onClose}
            registerRequestClose={(fn) => (requestCloseRef.current = fn)}
          />
        ) : error ? (
          <Unavailable error={error} onClose={onClose} />
        ) : (
          <div className="p-6 text-sm text-muted-foreground">{t("Caricamento…")}</div>
        )}
      </SidePanel>
    </LinkedTaskLayer>
  );
}

/**
 * L'offerta non si apre: dirlo, invece di restare su "Caricamento…".
 *
 * Il caso vero è la lente **giornate** degli sviluppatori: dall'elenco vedono il
 * carico in giornate e dal task il nome dell'offerta collegata, ma il dettaglio
 * commerciale — importi, fasi, allegati — resta chiuso. Chi ci arriva non ha
 * sbagliato niente e non deve chiedersi se è rotto: si spiega cosa manca e
 * perché, e si chiude.
 */
function Unavailable({ error, onClose }: { error: unknown; onClose: () => void }) {
  const { t } = useTranslation();
  const negato = error instanceof ApiError && error.status === 403;
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 p-8 text-center">
      <Lock className="size-8 text-muted-foreground" />
      <p className="text-sm font-medium">
        {negato ? t("Informazioni non disponibili") : t("Offerta non trovata")}
      </p>
      <p className="max-w-sm text-sm text-muted-foreground">
        {negato
          ? t(
              "Di questa offerta puoi vedere il carico in giornate, non i dettagli commerciali: importi, fasi, referenti e allegati sono riservati a chi ha accesso al modulo Offerte.",
            )
          : t("L'offerta non esiste più, oppure è stata spostata nel cestino.")}
      </p>
      <Button variant="outline" size="sm" onClick={onClose}>
        {t("Chiudi")}
      </Button>
    </div>
  );
}

function DrawerContent({
  deal,
  onClose,
  registerRequestClose,
}: {
  deal: DealDetail;
  onClose: () => void;
  /** Espone al contenitore la chiusura che offre il ripristino delle modifiche. */
  registerRequestClose?: (fn: () => void) => void;
}) {
  const { t } = useTranslation();
  const confirm = useConfirm();
  const keepOrRevert = useKeepOrRevert();
  const toast = useToast();
  const navigate = useNavigate();
  const updateDeal = useUpdateDeal();
  const deleteDeal = useDeleteDeal();
  const { data: stages } = useDealStages();
  const companies = useCompanies("").data?.items;
  const currentUser = useCurrentUser();
  const canSeeContacts = currentUser.canSeeContacts;
  // Il super admin (amministratore elevato) corregge la data di chiusura
  // effettiva: il server lo verifica comunque.
  const superAdmin = Boolean(
    currentUser.adminUntil && new Date(currentUser.adminUntil) > new Date(),
  );
  // Anche qui la scelta dell'azienda restringe i referenti proponibili.
  const contacts = useContactOptions(deal.company?.id ?? null, canSeeContacts);
  // Perimetro delle offerte: il server rifiuta un'offerta intestata a chi non
  // ha accesso completo, quindi qui non si propone.
  const { users } = useOptions({ module: "DEAL" });
  const [pendingLostStageId, setPendingLostStageId] = useState<string | null>(null);

  // Campi di testo e numeri: si salvano da soli mentre si scrive e comunque
  // prima di sparire (il pannello chiuso con un clic fuori non emette blur).
  const title = useAutosaveText({
    value: deal.title,
    required: true,
    singleLine: true,
    onSave: (value) => updateDeal.mutate({ id: deal.id, title: value }),
  });
  const description = useAutosaveText({
    value: deal.description,
    onSave: (value) =>
      updateDeal.mutate({ id: deal.id, description: isRichTextEmpty(value) ? null : value }),
  });
  const dealValue = useAutosaveText({
    value: deal.dealValue?.toString() ?? "",
    singleLine: true,
    onSave: (value) =>
      updateDeal.mutate({ id: deal.id, dealValue: value === "" ? null : Number(value) }),
  });
  const probability = useAutosaveText({
    value: deal.probability?.toString() ?? "",
    singleLine: true,
    onSave: (value) =>
      updateDeal.mutate({ id: deal.id, probability: value === "" ? null : Number(value) }),
  });
  const lostReason = useAutosaveText({
    value: deal.lostReason,
    onSave: (value) => updateDeal.mutate({ id: deal.id, lostReason: value === "" ? null : value }),
  });
  const [quickCompanyOpen, setQuickCompanyOpen] = useState(false);
  const [quickContactOpen, setQuickContactOpen] = useState(false);
  const corpoRef = useRef<HTMLDivElement>(null);
  const dealIdRef = useRef(deal.id);
  // Fotografia all'apertura: ogni campo si salva da solo, questa è la via per
  // tornare indietro. Si riscatta quando il pannello passa a un'altra offerta.
  const snapshotRef = useRef<DealSnapshot>(snapshotOfDeal(deal));
  if (dealIdRef.current !== deal.id) {
    dealIdRef.current = deal.id;
    snapshotRef.current = snapshotOfDeal(deal);
  }

  // Quello che è ancora nella tastiera conta come modifica: senza, il pannello si
  // chiuderebbe in silenzio buttandolo via.
  const pendingFields = [
    [title, t("Titolo")],
    [description, t("Descrizione")],
    [dealValue, t("Valore")],
    [probability, t("Probabilità")],
    [lostReason, t("Motivo della perdita")],
  ] as const;
  const changed = [
    ...new Set([
      ...changedDealFields(snapshotRef.current, deal),
      ...pendingFields.filter(([field]) => field.isDirty).map(([, label]) => label),
    ]),
  ];
  const requestClose = () =>
    keepOrRevert({
      changed,
      what: t("l'offerta"),
      onKeep: () => {
        pendingFields.forEach(([field]) => field.flush());
        onClose();
      },
      onRevert: () => {
        pendingFields.forEach(([field]) => field.discard());
        updateDeal.mutate(
          { id: deal.id, ...dealRestorePayload(snapshotRef.current) },
          {
            onSuccess: () => {
              toast(t("Modifiche annullate."), "success");
              onClose();
            },
            onError: (error) =>
              toast(
                error instanceof ApiError ? error.message : t("Ripristino non riuscito"),
                "error",
              ),
          },
        );
      },
    });
  // Registrata a ogni render: la closure deve vedere le modifiche più recenti.
  useEffect(() => {
    registerRequestClose?.(requestClose);
    return () => registerRequestClose?.(() => onClose());
  });

  // Il server autorizza solo il proprietario (o l'admin): rispecchialo nella UI.
  const canEdit = deal.canEdit;
  const canDelete = canEdit;
  /** Il valore quando non si può modificare: stessa scatola, senza comandi. */
  const valoreSolaLettura = "rounded-md border bg-muted/40 px-3 py-2 text-sm text-muted-foreground";
  const selectClass = "h-9 rounded-md border bg-background px-2 text-sm disabled:opacity-70";

  return (
    <>
      <header className="flex items-start justify-between gap-2 border-b p-4">
        <input
          className="w-full bg-transparent text-lg font-semibold outline-none focus:border-b"
          aria-label={t("Titolo")}
          readOnly={!canEdit}
          {...title.props}
        />
        <div className="flex shrink-0 gap-1">
          {canEdit && slot.LetturaAllegati && (
            <slot.LetturaAllegati dealId={deal.id} allegati={deal.attachments} />
          )}
          {canDelete && (
            <Button
              variant="ghost"
              size="icon"
              title={t("Elimina offerta")}
              onClick={() => {
                void confirm({
                  title: t("Eliminare l'offerta?"),
                  message: t(
                    '"{{title}}" verrà spostata nel cestino. L\'admin può ripristinarla entro 30 giorni.',
                    { title: deal.title },
                  ),
                  confirmLabel: t("Sposta nel cestino"),
                  tone: "danger",
                }).then((ok) => {
                  if (ok) deleteDeal.mutate(deal.id, { onSuccess: onClose });
                });
              }}
            >
              <Trash2 className="size-4 text-destructive" />
            </Button>
          )}
          <Button variant="ghost" size="icon" onClick={requestClose} aria-label={t("Chiudi")}>
            <X className="size-4" />
          </Button>
        </div>
      </header>

      <div ref={corpoRef} className="min-h-0 flex-1 overflow-y-auto p-4">
        {!canEdit && (
          <p className="mb-3 rounded-md bg-muted/60 px-3 py-2 text-xs text-muted-foreground">
            {t(
              "Offerta in sola lettura: puoi consultarla e commentarla, ma solo il proprietario può modificarla.",
            )}
          </p>
        )}
        {deal.billingTaskId && (
          <p className="mb-3 flex items-center gap-1.5 rounded-md bg-muted/60 px-3 py-2 text-xs text-muted-foreground">
            <Receipt className="size-3.5" /> {t("Task di fatturazione generato nello Scadenzario.")}
          </p>
        )}
        {deal.projectId && (
          <button
            type="button"
            onClick={() => navigate(`/progetti/${deal.projectId}`)}
            className="mb-3 flex w-full cursor-pointer items-center gap-1.5 rounded-md bg-muted/60 px-3 py-2 text-left text-xs text-muted-foreground hover:bg-muted"
          >
            <FolderKanban className="size-3.5" />{" "}
            {t("Progetto di sviluppo creato da questa offerta — aprilo.")}
          </button>
        )}
        {/* Le sezioni hanno il filo colorato come nei pannelli del task e del
          ticket (21/08/2026): un'offerta ha tre discorsi dentro — con chi si
          tratta, quanto vale, e cosa si è detto — e separarli solo con un po'
          di spazio li faceva leggere come un modulo unico. */}
        <PanelGroup tone="rose" title={t("Trattativa")} meta={t("con chi")}>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="flex flex-col gap-1.5">
              <Label>{t("Fase")}</Label>
              <select
                className={selectClass}
                value={deal.stage.id}
                disabled={!canEdit}
                onChange={(e) => {
                  const target = stages?.find((s) => s.id === e.target.value);
                  const stageId = e.target.value;
                  if (target?.isLost) setPendingLostStageId(target.id);
                  // Fase "Vinta": nessuna domanda qui, l'offerta va in lettura
                  // e la proposta arriva quando è pronta (vedi DealPipeline).
                  else updateDeal.mutate({ id: deal.id, stageId });
                }}
              >
                {stages?.map((stage) => (
                  <option key={stage.id} value={stage.id}>
                    {stage.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label>{t("Commerciale")}</Label>
              {canEdit ? (
                <Combobox
                  value={deal.assignee?.id ?? null}
                  onChange={(id) => updateDeal.mutate({ id: deal.id, assigneeId: id })}
                  items={(users ?? []).map((user) => ({ id: user.id, label: user.name }))}
                  emptyLabel={t("Nessuno")}
                  placeholder={t("Cerca un commerciale…")}
                />
              ) : (
                <p className={valoreSolaLettura}>{deal.assignee?.name ?? "—"}</p>
              )}
            </div>
            <div className="flex flex-col gap-1.5">
              <Label>{t("Azienda")}</Label>
              <div className="flex gap-1">
                {canEdit ? (
                  <Combobox
                    className="w-full"
                    value={deal.company?.id ?? null}
                    onChange={(id) =>
                      updateDeal.mutate({
                        id: deal.id,
                        companyId: id,
                        // Cambiando azienda il contatto precedente potrebbe non
                        // appartenerle più: si ripulisce e va riscelto.
                        ...(deal.contact ? { contactId: null } : {}),
                      })
                    }
                    items={(companies ?? []).map((company) => ({
                      id: company.id,
                      label: company.name,
                    }))}
                    emptyLabel={t("Nessuna")}
                    placeholder={t("Cerca un'azienda…")}
                  />
                ) : (
                  <p className={`${valoreSolaLettura} w-full`}>{deal.company?.name ?? "—"}</p>
                )}
                {canEdit && (
                  <Button
                    variant="outline"
                    size="icon"
                    title={t("Crea azienda al volo")}
                    onClick={() => setQuickCompanyOpen(true)}
                  >
                    <Plus className="size-4" />
                  </Button>
                )}
              </div>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label>{t("Contatto")}</Label>
              {canSeeContacts ? (
                <div className="flex gap-1">
                  {canEdit ? (
                    <Combobox
                      className="w-full"
                      value={deal.contact?.id ?? null}
                      onChange={(id) => updateDeal.mutate({ id: deal.id, contactId: id })}
                      items={(contacts ?? []).map((contact) => ({
                        id: contact.id,
                        label: `${contact.firstName} ${contact.lastName}`.trim(),
                      }))}
                      emptyLabel={t("Nessuno")}
                      placeholder={t("Cerca un contatto…")}
                    />
                  ) : (
                    <p className={`${valoreSolaLettura} w-full`}>{deal.contact?.name ?? "—"}</p>
                  )}
                  {canEdit && (
                    <Button
                      variant="outline"
                      size="icon"
                      title={t("Crea contatto al volo")}
                      onClick={() => setQuickContactOpen(true)}
                    >
                      <Plus className="size-4" />
                    </Button>
                  )}
                </div>
              ) : (
                // Senza scope CONTACTS: riferimento in sola lettura.
                <p className="py-2 text-sm text-muted-foreground">{deal.contact?.name ?? "—"}</p>
              )}
            </div>
          </div>
        </PanelGroup>

        <PanelGroup tone="sky" title={t("Numeri")} meta={t("quanto e quando")} className="mt-3">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="flex flex-col gap-1.5">
              <Label>{t("Valore (€)")}</Label>
              <Input type="number" min={0} step="0.01" readOnly={!canEdit} {...dealValue.props} />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label>{t("Probabilità (%)")}</Label>
              <Input type="number" min={0} max={100} readOnly={!canEdit} {...probability.props} />
            </div>
            <div className="col-span-2 flex flex-col gap-1.5">
              <Label>{t("Chiusura prevista")}</Label>
              <DateField
                value={deal.expectedCloseDate ?? ""}
                readOnly={!canEdit}
                onCommit={(value) => updateDeal.mutate({ id: deal.id, expectedCloseDate: value })}
              />
            </div>
            {/*
              La chiusura effettiva, su un'offerta vinta o persa: la scrive il
              passaggio di fase, e la corregge solo il super admin (01/10/2026)
              — un'offerta registrata a cose fatte risulta chiusa il giorno in
              cui la si è inserita, e la previsione la conta nel mese sbagliato.
            */}
            {(deal.stage.isWon || deal.stage.isLost) && (
              <div className="col-span-2 flex flex-col gap-1.5">
                <Label>{deal.stage.isWon ? t("Vinta il") : t("Persa il")}</Label>
                <DateField
                  value={deal.closedAt ?? ""}
                  readOnly={!superAdmin}
                  onCommit={(value) => {
                    // una conclusa ha sempre la sua data: svuotarla non vuol dire niente
                    if (value) updateDeal.mutate({ id: deal.id, closedAt: value });
                  }}
                />
                {superAdmin && (
                  <span className="text-xs text-muted-foreground">
                    {t(
                      "La puoi correggere perché sei super admin: la modifica resta nella cronologia.",
                    )}
                  </span>
                )}
              </div>
            )}
          </div>
        </PanelGroup>

        {/* Espone l'offerta ai monitor vendite: finché è spenta, per loro non esiste.
            C'è con l'area investitori (08/10/2026). */}
        {edizione.moduli.has("area-investitori") && (
          <label className="mt-4 flex items-start gap-2 rounded-md border p-3 text-sm">
            <input
              type="checkbox"
              className="mt-0.5"
              checked={deal.visibleToSalesMonitors}
              disabled={!canEdit}
              onChange={(e) =>
                updateDeal.mutate({ id: deal.id, visibleToSalesMonitors: e.target.checked })
              }
            />
            <span>
              <span className="font-medium">{t("Visibile ai monitor vendite")}</span>
              <span className="mt-0.5 block text-xs text-muted-foreground">
                {t(
                  "Nella loro area riservata vedranno titolo, cliente, importo, probabilità, fase, commerciale, cronologia, allegati e",
                )}{" "}
                <strong>{t("i messaggi di questa chat")}</strong>
                {t(
                  ", dove possono anche scrivere. Non possono modificare né scaricare i documenti.",
                )}
              </span>
            </span>
          </label>
        )}

        {deal.stage.isLost && (
          <div className="mt-4 flex flex-col gap-1.5">
            <Label>{t("Motivo della perdita")}</Label>
            <textarea
              className="min-h-16 rounded-md border bg-background p-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              placeholder={t("Perché è stata persa?")}
              readOnly={!canEdit}
              {...lostReason.props}
            />
          </div>
        )}

        <PanelGroup
          tone="emerald"
          title={t("Contenuto")}
          meta={t("descrizione e allegati")}
          className="mt-3"
        >
          <div className="flex flex-col gap-1.5">
            <Label>{t("Descrizione")}</Label>
            <RichTextField
              field={description}
              readOnly={!canEdit}
              taskId={deal.id}
              dialogTitle={deal.title}
              placeholder={t("Aggiungi una descrizione…")}
            />
          </div>

          <LinkedTasksSection deal={deal} />
          <AttachmentsSection task={deal} />
        </PanelGroup>

        <TaskActivitySection taskId={deal.id} labels={DEAL_ACTIVITY_LABELS} />
      </div>

      {/* La conversazione ancorata e regolabile, come nel task e nella
          richiesta: prima scorreva via insieme ai campi, e su un'offerta con
          venti messaggi la si trovava solo in fondo (24/08/2026). */}
      <ChatDock count={deal.commentCount} recordId={deal.id} bodyRef={corpoRef}>
        <CommentsSection task={deal} stickyInput />
      </ChatDock>

      <QuickAddCompanyDialog
        open={quickCompanyOpen}
        onClose={() => setQuickCompanyOpen(false)}
        onCreated={(id) => updateDeal.mutate({ id: deal.id, companyId: id })}
      />
      <QuickAddContactDialog
        open={quickContactOpen}
        onClose={() => setQuickContactOpen(false)}
        onCreated={(id, company) =>
          updateDeal.mutate({
            id: deal.id,
            contactId: id,
            // creata per un'altra azienda: l'offerta segue la persona
            ...(company && company !== deal.company?.id ? { companyId: company } : {}),
          })
        }
        defaultCompanyId={deal.company?.id ?? null}
      />
      <LostReasonDialog
        open={pendingLostStageId !== null}
        dealTitle={deal.title}
        onCancel={() => setPendingLostStageId(null)}
        onConfirm={(reason) => {
          if (pendingLostStageId) {
            updateDeal.mutate({ id: deal.id, stageId: pendingLostStageId, lostReason: reason });
          }
          setPendingLostStageId(null);
        }}
      />
    </>
  );
}

/**
 * Task dello scadenzario collegati all'offerta: il commerciale li aggiunge come
 * promemoria personali ("richiama il cliente", "invia il preventivo").
 */
function LinkedTasksSection({ deal }: { deal: DealDetail }) {
  const { t } = useTranslation();
  const createTask = useCreateTask();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [title, setTitle] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [adding, setAdding] = useState(false);

  const refreshDeal = () => queryClient.invalidateQueries({ queryKey: ["deal", deal.id] });

  const onAdd = (event: FormEvent) => {
    event.preventDefault();
    if (title.trim() === "") return;
    createTask.mutate(
      { title: title.trim(), dueDate: dueDate || null, relatedDealId: deal.id },
      {
        onSuccess: () => {
          setTitle("");
          setDueDate("");
          setAdding(false);
          void refreshDeal();
        },
      },
    );
  };

  return (
    <section className="mt-6">
      <div className="mb-2 flex items-center justify-between">
        <h3 className="flex items-center gap-1.5 text-sm font-semibold">
          <ListTodo className="size-4" /> {t("Task collegati")}
        </h3>
        {!adding && (
          <Button variant="outline" size="sm" onClick={() => setAdding(true)}>
            <Plus className="size-4" /> {t("Aggiungi task")}
          </Button>
        )}
      </div>

      {deal.linkedTasks.length === 0 && !adding && (
        <p className="text-sm text-muted-foreground">
          {t(
            "Nessun task collegato. Aggiungine uno al tuo scadenzario per ricordarti le attività su questa offerta.",
          )}
        </p>
      )}

      <ul className="flex flex-col gap-1.5">
        {deal.linkedTasks.map((task: LinkedTask) => (
          <li key={task.id}>
            <button
              type="button"
              className="flex w-full items-center gap-2 rounded-md border px-3 py-2 text-left text-sm hover:bg-muted/40"
              title={t("Apri il task nello scadenzario")}
              onClick={() => navigate(`/bacheche?task=${task.id}`)}
            >
              {task.isClosed ? (
                <CheckCircle2 className="size-4 shrink-0 text-muted-foreground" />
              ) : (
                <Circle className="size-4 shrink-0" style={{ color: task.status.color }} />
              )}
              <span
                className={task.isClosed ? "flex-1 text-muted-foreground line-through" : "flex-1"}
              >
                {task.title}
              </span>
              {task.dueDate && (
                <span className="shrink-0 text-xs text-muted-foreground">
                  {formatDate(task.dueDate)}
                </span>
              )}
              <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
            </button>
          </li>
        ))}
      </ul>

      {adding && (
        <form onSubmit={onAdd} className="mt-2 flex flex-col gap-2 rounded-md border p-3">
          <Input
            autoFocus
            placeholder={t("Cosa c'è da fare?")}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
          />
          <div className="flex items-center gap-2">
            <DateField className="w-40" value={dueDate} onCommit={(v) => setDueDate(v ?? "")} />
            <div className="ml-auto flex gap-2">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => {
                  setAdding(false);
                  setTitle("");
                  setDueDate("");
                }}
              >
                {t("Annulla")}
              </Button>
              <Button type="submit" size="sm" disabled={createTask.isPending}>
                {createTask.isPending ? "…" : t("Aggiungi")}
              </Button>
            </div>
          </div>
        </form>
      )}
    </section>
  );
}
