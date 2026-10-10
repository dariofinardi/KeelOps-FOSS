// Copyright (c) 2026 Jugaad s.r.l.
// SPDX-License-Identifier: AGPL-3.0-only

import { useEffect, useRef, useState } from "react";
import { useDocumentTitle } from "@/lib/use-document-title";
import { useTranslation } from "react-i18next";
import { ArrowLeftRight, CornerLeftUp, Eye, Hourglass, Trash2, X } from "lucide-react";
import type { TaskDetail } from "@kancrm/shared";
import { ActivityCategory, isRichTextEmpty, TaskKind } from "@kancrm/shared";
import { slot } from "@/edition/slots";
import { useNessunaRichiesta } from "./richiesta";
import { ApiError } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { DateField, TimeField } from "@/components/ui/date-field";
import { Label } from "@/components/ui/label";
import { PanelError } from "@/components/ui/panel-error";
import { PanelGroup } from "@/components/ui/panel-group";
import { ChatDock } from "./ChatDock";
import { cn } from "@/lib/utils";
import { useConfirm } from "@/components/ui/confirm";
import { useKeepOrRevert } from "@/lib/unsaved-changes";
import { useAutosaveText } from "@/lib/useAutosaveText";
import { RichTextField } from "@/components/ui/rich-text/RichTextField";
import { SidePanel } from "@/components/ui/side-panel";
import { useToast } from "@/components/ui/toast";
import { TaskRecurrencePanel } from "@/features/recurrence/TaskRecurrencePanel";
import { MeetingPanel } from "@/features/meetings/MeetingPanel";
import { TaskMeetingLink } from "@/features/meetings/TaskMeetingLink";
import { TagPicker } from "@/features/tags/TagPicker";
import { ActivityTypeSelect } from "./activity-types";
import { useOptions } from "@/features/options/useOptions";
import type { OptionsModule } from "@/features/options/rules";
import {
  useDeleteTask,
  useTaskDetail,
  useUpdateTask,
  useUpdateTaskWithSequenceConfirm,
} from "./useTasks";
import { CommentsSection, MeetingNotePicker, TaskActivitySection } from "./TaskTimeline";
import { UserSelect } from "./UserSelect";
import { ContextSection, SubtasksSection } from "./TaskContextSections";
import { ConvertTaskDialog } from "./ConvertTaskDialog";
import { AREAS } from "@/components/layout/areas";
import { useCreateDealFromTaskCommand } from "@/features/deals/deal-from-task-context";
import { SequenceSection } from "./SequenceSection";
import { PluginPanel } from "@/features/plugins/PluginPanel";
import { AttachmentsSection } from "./AttachmentsSection";

// Re-export: DealDetailDrawer e TicketDrawer la importano storicamente da qui.
export { AttachmentsSection } from "./AttachmentsSection";
import { changedFieldLabels, restorePayload, snapshotOf, type TaskSnapshot } from "./task-snapshot";

interface TaskDetailDrawerProps {
  /** "over": sopra un altro pannello (un link da un'offerta), che resta sotto e ricompare. */
  layer?: "panel" | "over";
  taskId: string | null;
  onClose: () => void;
  /** Apre un altro task (navigazione lungo la sequenza). */
  onOpenTask?: (id: string) => void;
}

export function TaskDetailDrawer({ taskId, onClose, onOpenTask, layer }: TaskDetailDrawerProps) {
  const { t } = useTranslation();
  const { data: task, error } = useTaskDetail(taskId);

  // Il contenuto (che sa quali modifiche sono state fatte) registra qui la propria
  // chiusura "protetta": Esc, la X e il clic fuori devono offrire il ripristino.
  const requestCloseRef = useRef<(() => void) | null>(null);
  const requestClose = () => (requestCloseRef.current ?? onClose)();
  useDocumentTitle(task?.title ?? null);

  return (
    <SidePanel
      open={taskId !== null}
      layer={layer}
      onClose={requestClose}
      label={task?.title ?? t("Dettaglio task")}
    >
      {task ? (
        <DrawerContent
          // Rimonta quando il pannello passa a un altro task (subtask, sequenza,
          // notifica): senza, le bozze autosalvanti del task precedente
          // sopravvivono e il flush le scrive sul task nuovo.
          key={task.id}
          task={task}
          onClose={onClose}
          onOpenTask={onOpenTask}
          registerRequestClose={(fn) => (requestCloseRef.current = fn)}
        />
      ) : error ? (
        <PanelError
          error={error}
          notFound={t("Questo task non esiste più, oppure è in un'area che non puoi vedere.")}
          forbidden={t(
            "Non hai accesso a questo task. Se dovresti averlo, chiedi al manager del progetto.",
          )}
          onClose={onClose}
        />
      ) : (
        <div className="p-6 text-sm text-muted-foreground">{t("Caricamento…")}</div>
      )}
    </SidePanel>
  );
}

function DrawerContent({
  task,
  onClose,
  onOpenTask,
  registerRequestClose,
}: {
  task: TaskDetail;
  onClose: () => void;
  onOpenTask?: (id: string) => void;
  /** Espone al contenitore la chiusura che offre il ripristino delle modifiche. */
  registerRequestClose?: (fn: () => void) => void;
}) {
  const { t } = useTranslation();
  // La richiesta di supporto (presa in carico, richiedente): la porta il modulo
  // dei ticket. Senza, un task non è mai una richiesta e il pannello è quello di sempre.
  const richiesta = (slot.useRichiesta ?? useNessunaRichiesta)(task);
  const confirm = useConfirm();
  const keepOrRevert = useKeepOrRevert();
  const toast = useToast();
  const updateTask = useUpdateTask();
  const updateStatus = useUpdateTaskWithSequenceConfirm();
  const deleteTask = useDeleteTask();
  const [convertOpen, setConvertOpen] = useState(false);
  // Le offerte stesse no: da un'offerta non nasce un'altra offerta.
  const comandoOfferta = useCreateDealFromTaskCommand();
  const creaOfferta = task.kind === TaskKind.DEAL ? null : comandoOfferta;
  /**
   * Quale sezione si vede **sul telefono**, dove il pannello è a tutta pagina e
   * la barra in basso ne mostra una per volta. Sopra `sm` non conta niente: le
   * classi `max-sm:` che la usano non si applicano, e si vede tutto.
   *
   * Parte dal contesto e non dalla conversazione: si apre un task per leggerlo,
   * e chi arriva da una notifica di messaggio la trova a un dito di distanza.
   */
  const [sezione, setSezione] = useState<Sezione>("contesto");
  /**
   * L'incontro a cui appartiene la nota che si sta scrivendo. Lo tiene il
   * pannello perché il selettore sta in *Stato e tempo* mentre il commento si
   * scrive in fondo: due punti lontani, un valore solo.
   */
  const [incontroNota, setIncontroNota] = useState("");
  const corpoRef = useRef<HTMLDivElement>(null);
  /** La classe che nasconde un gruppo quando sul telefono se ne guarda un altro. */
  const mostra = (quale: Sezione) => (sezione === quale ? "" : "max-sm:hidden");
  const [logHoursOpen, setLogHoursOpen] = useState(false);
  // Convertibile/spostabile solo un task autonomo dello scadenzario o di un
  // progetto: un subtask, un'occorrenza ricorrente o un task con subtask restano
  // dove sono (la loro appartenenza la decide il padre o la ricorrenza).
  const canConvert =
    (task.kind === "ADMIN" || task.kind === "PROJECT") &&
    !task.recurrenceTemplateId &&
    !task.parent &&
    task.subtasks.length === 0;
  // Tutte le tendine del pannello in una chiamata, filtrate per il modulo del
  // task: stati della sua categoria, persone del perimetro giusto e — su un task
  // di progetto — la squadra in cima alle tendine delle persone.
  const { statuses, users, projectMembers } = useOptions({
    module: task.kind as OptionsModule,
    task,
    projectId: task.projectId,
  });

  // Titolo e descrizione si salvano da soli mentre si scrive, e comunque prima di
  // sparire: il pannello chiuso con un clic fuori non emette blur.
  const title = useAutosaveText({
    value: task.title,
    required: true,
    singleLine: true,
    onSave: (value) => updateTask.mutate({ id: task.id, title: value }),
  });
  const description = useAutosaveText({
    value: task.description,
    onSave: (value) =>
      updateTask.mutate({
        id: task.id,
        // L'editor lascia un paragrafo vuoto anche quando non c'è più niente.
        description: isRichTextEmpty(value) ? null : value,
      }),
  });
  const taskIdRef = useRef(task.id);
  // Fotografia del task all'apertura: serve a poter tornare indietro, dato che ogni
  // campo si salva da solo. Si riscatta quando il pannello passa a un altro task.
  const snapshotRef = useRef<TaskSnapshot>(snapshotOf(task));
  if (taskIdRef.current !== task.id) {
    taskIdRef.current = task.id;
    snapshotRef.current = snapshotOf(task);
  }

  // Chiusura protetta: se qualcosa è cambiato si può ripristinare la fotografia.
  // Il testo ancora nella tastiera conta come modifica, altrimenti si chiuderebbe
  // in silenzio buttandolo via.
  const changed = [
    ...new Set([
      ...changedFieldLabels(snapshotRef.current, task),
      ...(title.isDirty ? [t("Titolo")] : []),
      ...(description.isDirty ? [t("Descrizione")] : []),
    ]),
  ];
  const requestClose = () =>
    keepOrRevert({
      changed,
      what: t("il task"),
      onKeep: () => {
        title.flush();
        description.flush();
        onClose();
      },
      onRevert: () => {
        title.discard();
        description.discard();
        updateTask.mutate(
          { id: task.id, ...restorePayload(snapshotRef.current) },
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
  // Registrata a ogni render (la closure deve vedere le modifiche più recenti) e
  // sganciata allo smontaggio, così Esc non usa la fotografia di un altro task.
  useEffect(() => {
    registerRequestClose?.(requestClose);
    return () => registerRequestClose?.(() => onClose());
  });

  // Chi può eliminare lo dice il server: la stessa regola con cui accetta o
  // rifiuta la richiesta (qui il caso dei ticket, riservati all'admin, prima
  // mancava).
  const canDelete = task.canDelete;
  /**
   * **Il pannello di chi guarda.** Il server dice gia' chi puo' scrivere
   * (`canEdit`), ma qui i campi si offrivano a tutti e il rifiuto arrivava dopo,
   * come errore: il supervisore di un task in un progetto altrui apriva la
   * tendina del supervisore e leggeva "Progetto non trovato" (20/08/2026).
   * Vale la stessa regola del comando Elimina — compare solo se il server lo
   * accetterebbe.
   */
  const soloLettura = !task.canEdit || richiesta.inCaricoAdAltri;
  /**
   * Il selettore degli incontri **non compare sui task di progetto**: lì la
   * nota presa in riunione non è una cosa che capita, e un campo che apre un
   * elenco di appuntamenti in mezzo a stato e scadenza è solo rumore
   * (20/08/2026). Resta dove serve: scadenzario, attività amministrative,
   * task di un'offerta.
   */
  const notaDaIncontro = task.kind !== TaskKind.PROJECT;
  /**
   * Le ore di oggi si registrano da qui **sul lavoro di sviluppo dentro un
   * progetto**: è lì che le ore si imputano davvero, e il giro lungo (apri
   * Timesheet, trova il mese, trova la riga, se non c'è aggiungila) è il motivo
   * per cui si compilano il venerdì a memoria. L'area di un task è quella del
   * suo stato, come ovunque.
   */
  const canLogHours = Boolean(task.projectId) && task.status?.category === ActivityCategory.DEV;

  return (
    <>
      <header className="flex items-start justify-between gap-2 border-b p-4">
        <div className="flex min-w-0 flex-1 flex-col">
          {/**
           * **La via di ritorno al task padre, in testa.**
           *
           * Da un task si scende nel subtask con un clic; per risalire c'era
           * solo una riga "Subtask di:" sepolta sotto la descrizione, che
           * bisognava andare a cercare scorrendo (20/08/2026). Un breadcrumb
           * sta dove l'occhio lo cerca — sopra il titolo — e resta visibile
           * perché l'intestazione non scorre.
           */}
          {task.parent && (
            <button
              type="button"
              onClick={() => onOpenTask?.(task.parent!.id)}
              title={t("Torna al task padre")}
              className="mb-0.5 flex max-w-full items-center gap-1 text-xs text-muted-foreground hover:text-foreground hover:underline"
            >
              <CornerLeftUp className="size-3.5 shrink-0" />
              <span className="truncate">{task.parent.title}</span>
            </button>
          )}
          <input
            className="w-full bg-transparent text-lg font-semibold outline-none focus:border-b"
            aria-label={t("Titolo")}
            {...title.props}
            readOnly={soloLettura}
          />
        </div>
        <div className="flex shrink-0 items-center gap-1">
          {creaOfferta && (
            <Button
              variant="ghost"
              size="icon"
              title={t("Crea offerta da questo task")}
              aria-label={t("Crea offerta da questo task")}
              onClick={() => creaOfferta(task.id)}
            >
              {/* Il segno dell'area Offerte: è lì che finisce quello che crea. */}
              <AREAS.deals.icon className="size-4 text-primary" />
            </Button>
          )}
          {canConvert && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => setConvertOpen(true)}
              title={t("Converti o sposta tra offerta, progetto e scadenzario")}
            >
              <ArrowLeftRight className="size-4" /> {t("Converti/Sposta")}
            </Button>
          )}
          {/* Ore di oggi: l'icona è quella dell'area Timesheet (da `AREAS`),
              perché un comando porta il segno di dove va a finire quello che
              scrive. */}
          {canLogHours && slot.RegistraOre && (
            <Button
              variant="ghost"
              size="icon"
              title={t("Registra le ore di oggi")}
              aria-label={t("Registra le ore di oggi")}
              onClick={() => setLogHoursOpen(true)}
            >
              <Hourglass className="size-4 text-primary" />
            </Button>
          )}
          {canDelete && (
            <Button
              variant="ghost"
              size="icon"
              title={t("Elimina task")}
              onClick={() => {
                void confirm({
                  title: t("Eliminare il task?"),
                  message: t(
                    '"{{title}}" verrà spostato nel cestino (con i suoi subtask). L\'admin può ripristinarlo entro 30 giorni.',
                    { title: task.title },
                  ),
                  confirmLabel: t("Sposta nel cestino"),
                  tone: "danger",
                }).then((ok) => {
                  if (ok) deleteTask.mutate(task.id, { onSuccess: onClose });
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

      {/**
       * Il corpo è una colonna: sopra i gruppi che scorrono, sotto la
       * conversazione ancorata. `@container` perché le due colonne devono
       * guardare la larghezza del **pannello** e non della finestra — il
       * pannello è il 40% dello schermo, quindi su un monitor da 2560 sono
       * ~1024px e su un portatile 580: una media query risponderebbe alla
       * domanda sbagliata.
       */}
      <div ref={corpoRef} className="@container flex min-h-0 flex-1 flex-col">
        <div
          className={cn(
            "min-h-0 flex-1 overflow-y-auto p-4",
            sezione === "conversazione" && "max-sm:hidden",
          )}
        >
          {task.activityType?.isMeeting && <MeetingPanel task={task} />}
          {task.recurrenceTemplateId && (
            <TaskRecurrencePanel
              templateId={task.recurrenceTemplateId}
              // Ripianificando la serie, questa occorrenza è stata eliminata e
              // rigenerata con un altro id: restare aperti su di essa vuol dire
              // scrivere su un fantasma. Si chiude e lo si dice.
              onOccurrencesRegenerated={() => {
                toast(
                  t("Serie ripianificata: le occorrenze future sono state rigenerate."),
                  "success",
                );
                onClose();
              }}
            />
          )}
          {richiesta.bande}
          {soloLettura && (
            <div className="mb-4 flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm dark:border-amber-900 dark:bg-amber-950/40">
              <Eye className="mt-0.5 size-4 shrink-0 text-amber-600 dark:text-amber-400" />
              <p className="text-muted-foreground">
                {t("Segui questo task: puoi leggerlo e commentarlo, non modificarne i campi.")}
              </p>
            </div>
          )}
          {/* Ordine del pannello (06/08/2026, invariato): prima DOVE vive il task,
            poi CHI se ne occupa, COSA è, e infine come sta. Da oggi i gruppi
            sono anche visibili — filo colorato e un'etichetta — perché dodici
            sezioni separate solo da un po' di spazio non si distinguevano più
            (20/08/2026). Il tono viene da `SectionIcon`: dice di cosa parla la
            sezione, ed è lo stesso della pagina Sistema. */}
          {/* Un `fieldset` invece di dodici `disabled`: il divieto vale per
            tutti i controlli discendenti, e `contents` non tocca la griglia. */}
          <fieldset disabled={soloLettura} className="contents">
            <div className="flex flex-col gap-3 @min-[54rem]:grid @min-[54rem]:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)] @min-[54rem]:items-start @min-[54rem]:gap-5">
              {/* Colonna dei campi corti. Sotto le 54rem di PANNELLO (non di
              finestra: vedi il `@container` sopra) le due colonne tornano una. */}
              <div className="flex min-w-0 flex-col gap-3">
                <PanelGroup
                  tone="slate"
                  title={t("Contesto")}
                  meta={t("dove vive")}
                  className={mostra("contesto")}
                >
                  <ContextSection task={task} />
                  {!task.activityType?.isMeeting && <TaskMeetingLink task={task} />}
                </PanelGroup>

                <PanelGroup
                  tone="rose"
                  title={t("Persone")}
                  meta={t("chi se ne occupa")}
                  className={mostra("contesto")}
                >
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 @min-[54rem]:grid-cols-1">
                    <div className="flex flex-col gap-1.5">
                      <Label importance="recommended">{t("Assegnatario")}</Label>
                      <UserSelect
                        users={users}
                        projectMembers={projectMembers}
                        value={task.assignee?.id ?? ""}
                        onChange={(value) =>
                          updateTask.mutate({ id: task.id, assigneeId: value || null })
                        }
                      />
                    </div>
                    <div className="flex flex-col gap-1.5">
                      <Label importance="recommended">{t("Supervisore")}</Label>
                      <UserSelect
                        users={users}
                        projectMembers={projectMembers}
                        value={task.supervisor?.id ?? ""}
                        onChange={(value) =>
                          updateTask.mutate({ id: task.id, supervisorId: value || null })
                        }
                        title={t("Riceve le notifiche su cambi di stato e commenti")}
                      />
                    </div>
                  </div>
                </PanelGroup>

                <PanelGroup
                  tone="sky"
                  title={t("Stato e tempo")}
                  meta={t("come sta")}
                  className={mostra("stato")}
                >
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 @min-[54rem]:grid-cols-1">
                    <div className="flex flex-col gap-1.5 sm:col-span-2">
                      <Label importance="recommended">{t("Tipo di attività")}</Label>
                      {/* Un task collegato a un'offerta è un'attività commerciale, anche se
                vive nello scadenzario: propone i tipi commerciali. */}
                      <ActivityTypeSelect
                        kind={task.kind}
                        category={task.relatedDeal ? ActivityCategory.SALES : undefined}
                        value={task.activityType?.id ?? ""}
                        onChange={(value) =>
                          updateTask.mutate({ id: task.id, activityTypeId: value || null })
                        }
                      />
                    </div>
                    <div className="flex flex-col gap-1.5">
                      <Label importance="required">{t("Stato")}</Label>
                      <select
                        className="h-9 rounded-md border bg-background px-2 text-sm"
                        value={task.status.id}
                        onChange={(e) =>
                          updateStatus.mutateWithConfirm({ id: task.id, statusId: e.target.value })
                        }
                      >
                        {statuses.map((status) => (
                          <option key={status.id} value={status.id}>
                            {status.name}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div className="flex flex-col gap-1.5">
                      <Label importance="recommended">{t("Scadenza")}</Label>
                      <div className="flex gap-2">
                        <DateField
                          value={task.dueDate ?? ""}
                          onCommit={(value) => updateTask.mutate({ id: task.id, dueDate: value })}
                        />
                        {/* Orario solo dove serve davvero: telefonate e appuntamenti di
                un'offerta. Vuoto = scade quel giorno, senza ora. */}
                        {task.relatedDeal && (
                          <TimeField
                            className="w-32"
                            aria-label={t("Orario (facoltativo)")}
                            title={t("Orario (facoltativo)")}
                            disabled={!task.dueDate}
                            value={task.dueTime ?? ""}
                            onCommit={(value) => updateTask.mutate({ id: task.id, dueTime: value })}
                          />
                        )}
                      </div>
                    </div>
                    {/* `col-span-full` invece della coppia `sm:`/`@min-`: vale in
                      qualunque numero di colonne, e l'accoppiata precedente
                      lasciava i tag in mezza riga, con il pulsante mozzato. */}
                    <div className="flex flex-col gap-1.5 col-span-full">
                      <Label>{t("Tag")}</Label>
                      <TagPicker
                        value={task.tags}
                        onChange={(tags) =>
                          updateTask.mutate({ id: task.id, tagIds: tags.map((tag) => tag.id) })
                        }
                      />
                    </div>
                    {/* In fondo a "come sta": una nota presa in riunione è un
                      fatto del quando, e nella conversazione ancorata rubava
                      spazio proprio alla parte che si usa (20/08/2026). */}
                    {notaDaIncontro && (
                      <MeetingNotePicker
                        className="col-span-full"
                        value={incontroNota}
                        onChange={setIncontroNota}
                      />
                    )}
                  </div>
                </PanelGroup>
              </div>

              {/* Colonna del contenuto lungo: è quella che merita la larghezza. */}
              <PanelGroup
                tone="emerald"
                title={t("Contenuto")}
                meta={t("descrizione, sequenza, allegati")}
                className={cn("min-w-0", mostra("contenuto"))}
              >
                <div className="flex flex-col gap-1.5">
                  <Label>{t("Descrizione")}</Label>
                  <RichTextField
                    field={description}
                    taskId={task.id}
                    dialogTitle={task.title}
                    readOnly={soloLettura}
                    placeholder={t("Aggiungi una descrizione…")}
                  />
                </div>
                <SubtasksSection task={task} onOpenTask={onOpenTask} />
                <SequenceSection task={task} onOpenTask={onOpenTask} />
                {/*
                  **Da dove viene questo task.** Un plugin che genera lavoro —
                  un'azione correttiva, una verifica — dichiara l'ancora `task`
                  e mette qui una riga che lo dice, con il collegamento alla
                  cosa che l'ha fatto nascere. Senza plugin sull'ancora non si
                  disegna niente, e chi non ne ha non se ne accorge (22/09/2026).
                */}
                <PluginPanel anchor="task" query={`task=${task.id}`} />
                <AttachmentsSection task={task} />
              </PanelGroup>
            </div>
          </fieldset>

          <div className={cn("mt-3", mostra("conversazione"))}>
            <TaskActivitySection taskId={task.id} />
          </div>
        </div>

        {/**
         * La conversazione ancorata e regolabile: il meccanismo sta in
         * `ChatDock`, che lo condivide con richieste e offerte.
         */}
        <ChatDock
          count={task.commentCount}
          recordId={task.id}
          bodyRef={corpoRef}
          mobileVisible={sezione === "conversazione"}
        >
          <CommentsSection
            task={task}
            stickyInput
            // `meeting` si passa **sempre**, anche col selettore nascosto:
            // dichiararlo dice alla chat che l'incontro lo sceglie il pannello —
            // senza, se lo rimetterebbe sopra la casella, e sui task di progetto
            // è proprio quello che non deve comparire.
            meeting={{ id: incontroNota, onChange: setIncontroNota }}
            bloccataDa={richiesta.bloccataDa}
            onPrendiComunque={richiesta.prendiInCarico}
          />
        </ChatDock>

        <SezioniMobile valore={sezione} onChange={setSezione} commenti={task.commentCount} />
      </div>
      {convertOpen && <ConvertTaskDialog task={task} onClose={() => setConvertOpen(false)} />}
      {logHoursOpen && slot.RegistraOre && (
        <slot.RegistraOre
          taskId={task.id}
          title={task.title}
          onClose={() => setLogHoursOpen(false)}
        />
      )}
    </>
  );
}

/**
 * Spostamento di contesto: porta il task dentro/fuori un progetto o lo collega a
 * un'offerta. Compare solo sui task che si possono davvero spostare — le
 * occorrenze di una ricorrenza, i subtask, i task con subtask, le offerte e i
 * ticket restano dove sono (le stesse regole valgono sul server).
 *
 * Le due destinazioni sono esclusive: un task sta in un progetto oppure è
 * collegato a un'offerta nel proprio scadenzario.
 */

/** Le quattro sezioni della barra in basso, sul telefono. */
type Sezione = "contesto" | "stato" | "contenuto" | "conversazione";

const SEZIONI: Array<{ id: Sezione; etichetta: string; tono: string }> = [
  { id: "contesto", etichetta: "Contesto", tono: "text-rose-600 dark:text-rose-400" },
  { id: "stato", etichetta: "Stato", tono: "text-sky-600 dark:text-sky-400" },
  { id: "contenuto", etichetta: "Contenuto", tono: "text-emerald-600 dark:text-emerald-400" },
  {
    id: "conversazione",
    etichetta: "Chat",
    tono: "text-violet-600 dark:text-violet-400",
  },
];

/**
 * **La barra delle sezioni, solo sul telefono** (`sm:hidden`).
 *
 * A tutta pagina il pannello non ha spazio per due regioni, e ancorare la chat
 * lascerebbe ai campi mezzo schermo. Una barra sul bordo di sotto è l'unico
 * comando che si raggiunge senza cambiare presa — ed è dove sta in ogni
 * applicazione che si usa con una mano sola.
 *
 * Sopra `sm` sparisce del tutto e resta il pannello per intero: **non due
 * versioni da tenere allineate**, una che si richiude — la stessa scelta di
 * `mobile-filters`.
 */
function SezioniMobile({
  valore,
  onChange,
  commenti,
}: {
  valore: Sezione;
  onChange: (s: Sezione) => void;
  commenti: number;
}) {
  const { t } = useTranslation();
  return (
    <div className="flex flex-none gap-1.5 border-t px-2 py-1.5 sm:hidden" role="tablist">
      {SEZIONI.map((sezione) => {
        const attiva = sezione.id === valore;
        return (
          <button
            key={sezione.id}
            type="button"
            role="tab"
            aria-selected={attiva}
            onClick={() => onChange(sezione.id)}
            // 40px di altezza: il dito non è un puntatore (convenzione UI).
            className={cn(
              "flex h-10 flex-1 items-center justify-center gap-1.5 rounded-md text-xs font-medium",
              attiva ? cn("bg-muted", sezione.tono) : "text-muted-foreground",
            )}
          >
            {t(sezione.etichetta)}
            {sezione.id === "conversazione" && commenti > 0 && (
              <span className="text-[11px] opacity-70">{commenti}</span>
            )}
          </button>
        );
      })}
    </div>
  );
}
