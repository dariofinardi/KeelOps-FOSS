import { useState, type ReactNode } from "react";
import { useDocumentTitle } from "@/lib/use-document-title";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import { ArrowUpRight, Building2, X } from "lucide-react";
import { AREAS } from "@/components/layout/areas";
import { canReachDeals, type CrmNote, type LinkedDeal } from "@kancrm/shared";
import { SidePanel } from "@/components/ui/side-panel";
import { useMoney } from "@/lib/money";
import { useCurrentUser } from "@/features/auth/useAuth";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { formatDateTime } from "@/features/tasks/task-utils";
import { PanelError } from "@/components/ui/panel-error";
import { useAddCrmNote, useCompanyDetail, useContactDetail } from "./useCrm";
import { useSaveOrDiscard } from "@/lib/unsaved-changes";

function CrmDrawer({
  open,
  onClose,
  title,
  children,
}: {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  children: ReactNode;
}) {
  const { t } = useTranslation();
  return (
    <SidePanel
      open={open}
      onClose={onClose}
      label={typeof title === "string" ? title : t("Dettaglio")}
    >
      <header className="flex items-center justify-between border-b p-4">
        <h2 className="text-lg font-semibold">{title}</h2>
        <Button variant="ghost" size="icon" onClick={onClose} aria-label={t("Chiudi")}>
          <X className="size-4" />
        </Button>
      </header>
      <div className="flex-1 overflow-y-auto p-4">{children}</div>
    </SidePanel>
  );
}

function LinkedDealsList({
  deals,
  companyId,
  dealCount,
}: {
  deals: LinkedDeal[];
  /** Presente sulla scheda azienda: aggiunge il rimando all'elenco filtrato. */
  companyId?: string;
  /**
   * Quante offerte ha davvero il cliente. Con la lente "giornate" il numero
   * arriva ma le righe no: il titolo conta il dichiarato, non ciò che si vede.
   */
  dealCount?: number;
}) {
  const { t } = useTranslation();
  const money = useMoney();
  const navigate = useNavigate();
  return (
    <section className="mt-4">
      <h3 className="mb-2 flex items-center justify-between gap-2 text-sm font-semibold">
        <span className="inline-flex items-center gap-1.5">
          <AREAS.deals.icon className="size-4 text-muted-foreground" /> {t("Offerte collegate")} (
          {dealCount ?? deals.length})
        </span>
        {companyId && (dealCount ?? deals.length) > 0 && (
          <button
            type="button"
            className="inline-flex items-center gap-1 text-xs font-normal text-muted-foreground hover:text-foreground hover:underline"
            title={t("Apri le offerte di questo cliente")}
            onClick={() => navigate(`${AREAS.deals.to}?cliente=${companyId}`)}
          >
            {t("Vedi nell'elenco")} <ArrowUpRight className="size-3" />
          </button>
        )}
      </h3>
      <ul className="flex flex-col gap-1">
        {deals.map((deal) => (
          <li key={deal.id}>
            <button
              type="button"
              className="flex w-full items-center justify-between rounded-md border px-3 py-2 text-left text-sm hover:bg-muted/40"
              title={t("Apri l'offerta")}
              onClick={() => navigate(`/offerte?deal=${deal.id}`)}
            >
              <span className="truncate">{deal.title}</span>
              <span className="flex shrink-0 items-center gap-2">
                {deal.dealValue !== null && (
                  <span className="text-xs text-muted-foreground">
                    {money.format(deal.dealValue)}
                  </span>
                )}
                <Badge variant="outline" style={{ color: deal.stageColor }}>
                  {deal.stageName}
                </Badge>
                <ArrowUpRight className="size-3.5 text-muted-foreground" />
              </span>
            </button>
          </li>
        ))}
        {deals.length === 0 && (
          <p className="text-xs text-muted-foreground">
            {(dealCount ?? 0) > 0
              ? t(
                  "Gli importi e le fasi sono riservati al modulo Offerte: apri l'elenco per vederle in giornate.",
                )
              : t("Nessuna offerta collegata.")}
          </p>
        )}
      </ul>
    </section>
  );
}

function CrmNotesSection({
  notes,
  onAdd,
  pending,
  onDraftChange,
}: {
  notes: CrmNote[];
  onAdd: (body: string) => void;
  pending: boolean;
  /** Segnala al pannello che c'è una nota scritta ma non ancora aggiunta. */
  onDraftChange?: (draft: string) => void;
}) {
  const { t } = useTranslation();
  const [body, setBody] = useState("");
  const setDraft = (value: string) => {
    setBody(value);
    onDraftChange?.(value);
  };
  return (
    <section className="mt-4">
      <h3 className="mb-2 text-sm font-semibold">
        {t("Note")} ({notes.length})
      </h3>
      <form
        className="mb-2 flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          const trimmed = body.trim();
          if (!trimmed) return;
          onAdd(trimmed);
          setDraft("");
        }}
      >
        <Input
          placeholder={t("Aggiungi una nota…")}
          value={body}
          onChange={(e) => setDraft(e.target.value)}
        />
        <Button type="submit" disabled={pending}>
          {t("Aggiungi")}
        </Button>
      </form>
      <ul className="flex flex-col gap-2">
        {notes.map((note) => (
          <li key={note.id} className="rounded-md border p-3 text-sm">
            <div className="mb-1 flex items-center justify-between text-xs text-muted-foreground">
              <span className="font-medium text-foreground">{note.author.name}</span>
              {formatDateTime(note.createdAt)}
            </div>
            <p className="whitespace-pre-wrap">{note.body}</p>
          </li>
        ))}
      </ul>
    </section>
  );
}

export function ContactDetailDrawer({
  contactId,
  onClose,
}: {
  contactId: string | null;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const { data: contact, error } = useContactDetail(contactId);
  useDocumentTitle(contact ? `${contact.firstName} ${contact.lastName}`.trim() : null);
  const addNote = useAddCrmNote();
  const saveOrDiscard = useSaveOrDiscard();
  // Una nota scritta e non ancora aggiunta non deve sparire chiudendo il pannello.
  const [noteDraft, setNoteDraft] = useState("");
  const requestClose = () =>
    saveOrDiscard({
      isDirty: noteDraft.trim() !== "",
      canSave: true,
      what: t("la nota"),
      onSave: () => {
        if (contact) addNote.mutate({ target: "contacts", id: contact.id, body: noteDraft.trim() });
        setNoteDraft("");
        onClose();
      },
      onDiscard: () => {
        setNoteDraft("");
        onClose();
      },
    });
  return (
    <CrmDrawer
      open={contactId !== null}
      onClose={requestClose}
      title={contact ? `${contact.firstName} ${contact.lastName}` : t("Caricamento…")}
    >
      {error && !contact && (
        <PanelError
          error={error}
          notFound={t("Questo contatto non esiste più: forse è stato unito a un altro.")}
          forbidden={t("Non hai accesso a questo contatto.")}
          onClose={onClose}
        />
      )}
      {contact && (
        <>
          <div className="flex flex-col gap-1 text-sm">
            {contact.roleTitle && <p className="text-muted-foreground">{contact.roleTitle}</p>}
            {contact.company && (
              <p>
                <Building2 className="mr-1.5 inline size-3.5 text-muted-foreground" />
                {contact.company.name}
              </p>
            )}
            {contact.email && (
              <a className="text-primary hover:underline" href={`mailto:${contact.email}`}>
                {contact.email}
              </a>
            )}
            {contact.phone && <p>{contact.phone}</p>}
          </div>
          <LinkedDealsList deals={contact.deals} />
          <CrmNotesSection
            notes={contact.crmNotes}
            pending={addNote.isPending}
            onAdd={(body) => addNote.mutate({ target: "contacts", id: contact.id, body })}
            onDraftChange={setNoteDraft}
          />
        </>
      )}
    </CrmDrawer>
  );
}

export function CompanyDetailDrawer({
  companyId,
  onClose,
}: {
  companyId: string | null;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const { data: company, error } = useCompanyDetail(companyId);
  useDocumentTitle(company?.name ?? null);
  const navigate = useNavigate();
  const currentUser = useCurrentUser();
  const addNote = useAddCrmNote();
  const saveOrDiscard = useSaveOrDiscard();
  // Una nota scritta e non ancora aggiunta non deve sparire chiudendo il pannello.
  const [noteDraft, setNoteDraft] = useState("");
  const requestClose = () =>
    saveOrDiscard({
      isDirty: noteDraft.trim() !== "",
      canSave: true,
      what: t("la nota"),
      onSave: () => {
        if (company)
          addNote.mutate({ target: "companies", id: company.id, body: noteDraft.trim() });
        setNoteDraft("");
        onClose();
      },
      onDiscard: () => {
        setNoteDraft("");
        onClose();
      },
    });
  return (
    <CrmDrawer
      open={companyId !== null}
      onClose={requestClose}
      title={company?.name ?? t("Caricamento…")}
    >
      {error && !company && (
        <PanelError
          error={error}
          notFound={t("Questa azienda non esiste più: forse è stata unita a un'altra.")}
          forbidden={t("Non hai accesso a questa azienda.")}
          onClose={onClose}
        />
      )}
      {company && (
        <>
          <div className="flex flex-col gap-1 text-sm text-muted-foreground">
            {company.vatNumber && (
              <p>
                {t("P.IVA")} {company.vatNumber}
              </p>
            )}
            {company.city && <p>{company.city}</p>}
            {company.notes && <p className="whitespace-pre-wrap">{company.notes}</p>}
          </div>
          {/* Sezioni solo per chi le può leggere: un "(0)" dovuto ai permessi
              dice il falso, e manda a cercare qualcosa che c'è ma non si vede. */}
          {currentUser.canSeeContacts && (
            <section className="mt-4">
              {/* Il numero solo quando c'è: "Contatti (0)" è il contatore a zero
                  che la convenzione non vuole; la sezione resta col suo vuoto. */}
              <h3 className="mb-2 text-sm font-semibold">
                {t("Contatti")}
                {company.contacts.length > 0 ? ` (${company.contacts.length})` : ""}
              </h3>
              <ul className="flex flex-col gap-1 text-sm">
                {company.contacts.map((contact) => (
                  <li key={contact.id} className="flex justify-between rounded-md border px-3 py-2">
                    <span>{contact.name}</span>
                    <span className="text-xs text-muted-foreground">{contact.email ?? ""}</span>
                  </li>
                ))}
                {company.contacts.length === 0 && (
                  <p className="text-xs text-muted-foreground">{t("Nessun contatto.")}</p>
                )}
              </ul>
            </section>
          )}
          {canReachDeals(currentUser) && (
            <LinkedDealsList
              deals={company.deals}
              companyId={company.id}
              dealCount={company.dealCount}
            />
          )}
          {/* I progetti non si elencano qui (li governa la loro pagina, con
              permessi e archiviati): si dice quanti sono e ci si arriva. A zero
              non c'è niente da dire né da aprire, quindi la sezione sparisce. */}
          {company.projectCount > 0 && (
            <section className="mt-4">
              <h3 className="flex items-center justify-between gap-2 text-sm font-semibold">
                <span className="inline-flex items-center gap-1.5">
                  <AREAS.projects.icon className="size-4 text-muted-foreground" /> {t("Progetti")} (
                  {company.projectCount})
                </span>
                <button
                  type="button"
                  className="inline-flex items-center gap-1 text-xs font-normal text-muted-foreground hover:text-foreground hover:underline"
                  title={t("Apri i progetti di questo cliente")}
                  onClick={() => navigate(`${AREAS.projects.to}?cliente=${company.id}`)}
                >
                  {t("Vedi nell'elenco")} <ArrowUpRight className="size-3" />
                </button>
              </h3>
            </section>
          )}
          <CrmNotesSection
            notes={company.crmNotes}
            pending={addNote.isPending}
            onAdd={(body) => addNote.mutate({ target: "companies", id: company.id, body })}
            onDraftChange={setNoteDraft}
          />
        </>
      )}
    </CrmDrawer>
  );
}
