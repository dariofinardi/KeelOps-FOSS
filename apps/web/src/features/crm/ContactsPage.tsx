import { useCallback, Fragment, useEffect, useRef, useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import { ArrowUpRight, Building2, Pencil, Plus, Trash2, Upload, UserRound } from "lucide-react";
import { AREAS } from "@/components/layout/areas";
import { useUrlFilterHandoff } from "@/lib/useUrlFilterHandoff";
import {
  canManageCompanies,
  canReachDeals,
  type CompanyListItem,
  type ContactListItem,
} from "@kancrm/shared";
import { ApiError } from "@/lib/api";
import { useCurrentUser } from "@/features/auth/useAuth";
import { useListPrefs } from "@/lib/useListPrefs";
import { useViewSearch } from "@/lib/view-search";
import { PaginationBar } from "@/components/ui/pagination";
import { SkeletonRows } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { useConfirm } from "@/components/ui/confirm";
import { useContextMenu, type ContextMenuItem } from "@/components/ui/context-menu";
import { Dialog } from "@/components/ui/dialog";
import { InlineSelect } from "@/components/ui/inline-select";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { CompanyCombobox } from "./CompanyCombobox";
import { useCampoAzienda } from "./useCampoAzienda";
import { CompanyDetailDrawer, ContactDetailDrawer } from "./CrmDrawer";
import {
  useCompanies,
  useContacts,
  useDeleteCompany,
  useDeleteContact,
  useImportContacts,
  useUpsertCompany,
  useUpsertContact,
} from "./useCrm";

type Tab = "contacts" | "companies";

export function ContactsPage() {
  const { t } = useTranslation();
  // Le persone sono visibili solo con lo scope CONTACTS; le aziende a tutti gli interni.
  const canSeeContacts = useCurrentUser().canSeeContacts;
  // Filtri ricordati come in ogni altro elenco (useListPrefs): questa pagina
  // era l'unica a dimenticarli, con una persistenza artigianale per la sola tab.
  const { prefs, update } = useListPrefs<{ tab: Tab; q: string }>("kancrm-contacts", {
    tab: canSeeContacts ? "contacts" : "companies",
    q: "",
  });
  // Chi non vede i contatti non può trovarsi sulla loro tab, nemmeno per
  // una preferenza salvata quando li vedeva.
  const tab: Tab = prefs.tab === "contacts" && !canSeeContacts ? "companies" : prefs.tab;
  const q = prefs.q;
  const setTab = useCallback((value: Tab) => update({ tab: value }), [update]);
  // La ricerca vive in topbar (campo unico locale/globale), già a digitazione ferma.
  const searchSetQ = useCallback((value: string) => update({ q: value }), [update]);
  useViewSearch({ q, setQ: searchSetQ, placeholder: t("Cerca persone e aziende…") });
  const [importResult, setImportResult] = useState<string | null>(null);
  const importContacts = useImportContacts();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const showContacts = tab === "contacts" && canSeeContacts;
  // ?azienda=<id>: ci si arriva dalla freccia "Apri la scheda del cliente" nei
  // pannelli. Porta sulla tab giusta e apre il dettaglio.
  const [openCompanyId, setOpenCompanyId] = useState<string | null>(null);
  useUrlFilterHandoff(["azienda"], (values) => {
    setTab("companies");
    setOpenCompanyId(values.azienda ?? null);
  });

  return (
    <div className="flex h-full flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex rounded-md border p-0.5">
          {canSeeContacts && (
            <Button
              variant={showContacts ? "default" : "ghost"}
              size="sm"
              onClick={() => setTab("contacts")}
            >
              <UserRound className="size-4" /> {t("Contatti")}
            </Button>
          )}
          <Button
            variant={!showContacts ? "default" : "ghost"}
            size="sm"
            onClick={() => setTab("companies")}
          >
            <Building2 className="size-4" /> {t("Aziende")}
          </Button>
        </div>
        {/* La ricerca sta in TOPBAR (campo unico locale/globale). */}
        <div className="ml-auto flex items-center gap-2">
          {importResult && <span className="text-xs text-muted-foreground">{importResult}</span>}
          {canSeeContacts && (
            <Button
              variant="outline"
              disabled={importContacts.isPending}
              onClick={() => fileInputRef.current?.click()}
              title={t("Importa contatti da CSV (export Google Contacts)")}
            >
              <Upload className="size-4" />
              {importContacts.isPending ? t("Importazione…") : t("Importa CSV")}
            </Button>
          )}
          <input
            ref={fileInputRef}
            type="file"
            accept=".csv,text/csv"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) {
                setImportResult(null);
                importContacts.mutate(file, {
                  onSuccess: (result) =>
                    setImportResult(
                      t(
                        "Importati {{imported}}, saltati {{skipped}}, aziende create {{companiesCreated}}",
                        {
                          imported: result.imported,
                          skipped: result.skipped,
                          companiesCreated: result.companiesCreated,
                        },
                      ),
                    ),
                  onError: (err) =>
                    setImportResult(err instanceof ApiError ? err.message : t("Errore import")),
                });
              }
              e.target.value = "";
            }}
          />
        </div>
      </div>

      {showContacts ? (
        <ContactsTab q={q} />
      ) : (
        <CompaniesTab q={q} openCompanyId={openCompanyId} onOpened={() => setOpenCompanyId(null)} />
      )}
    </div>
  );
}

// ---------------------------------------------------------------- Contatti --

function ContactsTab({ q }: { q: string }) {
  // Nuova ricerca, prima pagina: a pagina 3 di "rossi" non esiste la pagina 3
  // di "bianchi", e si vedrebbe un elenco vuoto senza motivo.
  const { t } = useTranslation();
  const [page, setPage] = useState(1);
  useEffect(() => setPage(1), [q]);
  const { data, isLoading } = useContacts(q, page);
  const contacts = data?.items;
  const [editing, setEditing] = useState<ContactListItem | null>(null);
  const [creating, setCreating] = useState(false);
  const [detailId, setDetailId] = useState<string | null>(null);
  const removeContact = useDeleteContact();
  const confirm = useConfirm();
  const { open, menu } = useContextMenu();

  const contactMenu = (contact: ContactListItem): ContextMenuItem[] => [
    {
      label: t("Apri"),
      icon: <UserRound className="size-4" />,
      onSelect: () => setDetailId(contact.id),
    },
    {
      label: t("Modifica"),
      icon: <Pencil className="size-4" />,
      onSelect: () => setEditing(contact),
    },
    {
      label: t("Elimina"),
      icon: <Trash2 className="size-4" />,
      danger: true,
      separatorBefore: true,
      onSelect: () => {
        void confirm({
          title: t("Eliminare il contatto?"),
          message: t('"{{firstName}} {{lastName}}" verrà spostato nel cestino.', {
            firstName: contact.firstName,
            lastName: contact.lastName,
          }),
          confirmLabel: t("Sposta nel cestino"),
          tone: "danger",
        }).then((ok) => {
          if (ok) removeContact.mutate(contact.id);
        });
      },
    },
  ];

  if (isLoading) return <SkeletonRows rows={6} />;

  return (
    <div className="flex flex-col gap-3">
      <Button className="self-end" onClick={() => setCreating(true)}>
        <Plus className="size-4" /> {t("Nuovo contatto")}
      </Button>
      <div className="overflow-x-auto rounded-lg border">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b bg-muted/50 text-left text-xs uppercase text-muted-foreground">
              <th className="px-4 py-3 font-medium">{t("Nome")}</th>
              <th className="px-4 py-3 font-medium">{t("Azienda")}</th>
              <th className="hidden px-4 py-3 font-medium sm:table-cell">{t("Email")}</th>
              {/* Telefono e offerte tornano da tablet in su: su un telefono la
                  tabella si leggeva solo scorrendola di lato. */}
              <th className="hidden px-4 py-3 font-medium sm:table-cell">{t("Telefono")}</th>
              <th className="hidden px-4 py-3 text-right font-medium sm:table-cell">
                {t("Offerte")}
              </th>
              <th className="px-4 py-3 text-right font-medium">{t("Azioni")}</th>
            </tr>
          </thead>
          <tbody>
            {contacts?.map((contact) => (
              <tr
                key={contact.id}
                className="cursor-pointer border-b last:border-0 hover:bg-muted/30"
                onClick={() => setDetailId(contact.id)}
                onContextMenu={(e) => open(e, contactMenu(contact))}
              >
                <td className="px-4 py-3 font-medium">
                  {contact.firstName} {contact.lastName}
                  {contact.roleTitle && (
                    <span className="ml-2 text-xs text-muted-foreground">{contact.roleTitle}</span>
                  )}
                </td>
                <td className="px-4 py-3 text-muted-foreground">
                  <ContactCompanyCell contact={contact} />
                </td>
                <td className="hidden px-4 py-3 text-muted-foreground sm:table-cell">
                  {contact.email ?? "—"}
                </td>
                <td className="hidden px-4 py-3 text-muted-foreground sm:table-cell">
                  {contact.phone ?? "—"}
                </td>
                <td className="hidden px-4 py-3 text-right sm:table-cell">{contact.dealCount}</td>
                <td className="px-4 py-3" onClick={(e) => e.stopPropagation()}>
                  <div className="flex justify-end">
                    <Button
                      variant="ghost"
                      size="icon"
                      title={t("Modifica")}
                      onClick={() => setEditing(contact)}
                    >
                      <Pencil className="size-4" />
                    </Button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {(contacts?.length ?? 0) === 0 && (
          <p className="p-8 text-center text-sm text-muted-foreground">{t("Nessun contatto.")}</p>
        )}
      </div>
      <PaginationBar
        page={page}
        pageSize={data?.pageSize ?? 100}
        total={data?.total ?? 0}
        onPageChange={setPage}
      />

      {(creating || editing) && (
        <ContactDialog
          contact={editing}
          onClose={() => {
            setCreating(false);
            setEditing(null);
          }}
        />
      )}
      <ContactDetailDrawer contactId={detailId} onClose={() => setDetailId(null)} />
      {menu}
    </div>
  );
}

function ContactDialog({
  contact,
  onClose,
}: {
  contact: ContactListItem | null;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const upsert = useUpsertContact();
  const remove = useDeleteContact();
  const [firstName, setFirstName] = useState(contact?.firstName ?? "");
  const [lastName, setLastName] = useState(contact?.lastName ?? "");
  const [email, setEmail] = useState(contact?.email ?? "");
  const [phone, setPhone] = useState(contact?.phone ?? "");
  const [roleTitle, setRoleTitle] = useState(contact?.roleTitle ?? "");
  // L'azienda si scrive e basta: al salvataggio si trova o si crea (useCampoAzienda).
  const azienda = useCampoAzienda(contact?.company?.id ?? null);
  const [error, setError] = useState<string | null>(null);

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setError(null);
    const messaggio = (err: unknown) =>
      setError(err instanceof ApiError ? err.message : t("Errore imprevisto"));
    let companyId: string | null;
    try {
      companyId = await azienda.risolvi();
    } catch (err) {
      messaggio(err);
      return;
    }
    upsert.mutate(
      {
        id: contact?.id,
        firstName,
        lastName,
        email: email || null,
        phone: phone || null,
        roleTitle: roleTitle || null,
        companyId,
      },
      { onSuccess: onClose, onError: messaggio },
    );
  };

  return (
    <Dialog open onClose={onClose} title={contact ? t("Modifica contatto") : t("Nuovo contatto")}>
      <form onSubmit={onSubmit} className="flex flex-col gap-4">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div className="flex flex-col gap-1.5">
            <Label>{t("Nome")}</Label>
            <Input required value={firstName} onChange={(e) => setFirstName(e.target.value)} />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label>{t("Cognome")}</Label>
            <Input required value={lastName} onChange={(e) => setLastName(e.target.value)} />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label>{t("Email")}</Label>
            <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label>{t("Telefono")}</Label>
            <Input value={phone} onChange={(e) => setPhone(e.target.value)} />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label>{t("Ruolo")}</Label>
            <Input value={roleTitle} onChange={(e) => setRoleTitle(e.target.value)} />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label>{t("Azienda")}</Label>
            <CompanyCombobox {...azienda.comboProps} />
          </div>
        </div>
        {error && <p className="text-sm text-destructive">{error}</p>}
        <div className="flex justify-between">
          {contact ? (
            <Button
              variant="destructive"
              disabled={remove.isPending}
              onClick={() => remove.mutate(contact.id, { onSuccess: onClose })}
            >
              <Trash2 className="size-4" /> {t("Elimina")}
            </Button>
          ) : (
            <span />
          )}
          <div className="flex gap-2">
            <Button variant="outline" onClick={onClose}>
              {t("Annulla")}
            </Button>
            <Button type="submit" disabled={upsert.isPending}>
              {t("Salva")}
            </Button>
          </div>
        </div>
      </form>
    </Dialog>
  );
}

/**
 * Contatori di una scheda cliente: contatti, offerte, progetti.
 *
 * Offerte e progetti **portano alla loro vista già filtrata su questo cliente**
 * (`?cliente=<id>`), e lo dicono: icona del modulo — le stesse dei task, monete
 * per le offerte e `</>` per lo sviluppo — testo sottolineato al passaggio e
 * freccia. Un numero che non porta da nessuna parte fa perdere tempo a cercare
 * l'elenco che c'è già. A zero non è un link: non si manda nessuno su una
 * pagina vuota.
 */
/**
 * Contatori di una scheda cliente: contatti, offerte, progetti.
 *
 * **Si mostra solo ciò che si può vedere, e solo se c'è.** Due omissioni diverse
 * con lo stesso effetto: il contatore che i permessi azzerano non va scritto
 * ("0 offerte" a chi non le vede è falso: potrebbero essere nove), e nemmeno
 * quello davvero a zero — su una scheda cliente conta dove c'è del lavoro, non
 * l'elenco di ciò che manca. Restano quindi solo numeri che portano da qualche
 * parte, e ognuno è un collegamento.
 *
 * Offerte e progetti **aprono la loro vista già filtrata su questo cliente**
 * (`?cliente=<id>`) e lo dicono: **l'icona dell'area di destinazione**, la
 * stessa del menù (`AREAS`), sottolineatura al passaggio e freccia. Non quella
 * dei task: `</>` marca un task di sviluppo, la cartella marca l'area Progetti,
 * e un collegamento deve portare il segno di dove va a finire.
 */
export function CompanyCounts({ company }: { company: CompanyListItem }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const currentUser = useCurrentUser();

  const counters = [
    // I contatti si contano solo con il modulo Anagrafica (il server li azzera).
    // A zero il contatore sparisce, come per offerte e progetti: su una scheda
    // conta dove c'è del lavoro, non l'elenco di ciò che manca.
    currentUser.canSeeContacts &&
      company.contactCount > 0 && {
        key: "contatti",
        icon: <AREAS.contacts.icon className="size-3" />,
        label: t("{{count}} contatti", { count: company.contactCount }),
        to: null,
      },
    // Le offerte: anche la sola lente "giornate" basta ad arrivarci. A zero il
    // contatore sparisce, privilegio o no: non c'è niente da aprire.
    canReachDeals(currentUser) &&
      company.dealCount > 0 && {
        key: "offerte",
        icon: <AREAS.deals.icon className="size-3" />,
        label: t("{{count}} offerte", { count: company.dealCount }),
        to: `/offerte?cliente=${company.id}`,
      },
    // I progetti li vedono tutti gli interni: il numero è già filtrato sui propri.
    company.projectCount > 0 && {
      key: "progetti",
      icon: <AREAS.projects.icon className="size-3" />,
      label: t("{{count}} progetti", { count: company.projectCount }),
      to: `${AREAS.projects.to}?cliente=${company.id}`,
    },
  ].filter((counter): counter is Exclude<typeof counter, false> => counter !== false);

  if (counters.length === 0) return null;

  return (
    <p className="flex flex-wrap items-center gap-x-1 gap-y-1 text-xs text-muted-foreground">
      {counters.map(({ key, icon, label, to }, index) => (
        <Fragment key={key}>
          {index > 0 && <span aria-hidden>·</span>}
          {to ? (
            <button
              type="button"
              className="inline-flex items-center gap-1 rounded px-1 hover:bg-muted hover:text-foreground"
              title={t("Apri {{key}} di {{name}}", { key, name: company.name })}
              onClick={() => navigate(to)}
            >
              {icon} {label}
              <ArrowUpRight className="size-3" />
            </button>
          ) : (
            <span className="inline-flex items-center gap-1 px-1">
              {icon} {label}
            </span>
          )}
        </Fragment>
      ))}
    </p>
  );
}

// ----------------------------------------------------------------- Aziende --

function CompaniesTab({
  q,
  openCompanyId,
  onOpened,
}: {
  q: string;
  openCompanyId?: string | null;
  /** L'azienda chiesta è stata aperta: il genitore azzera il parametro. */
  onOpened?: () => void;
}) {
  const { t } = useTranslation();
  const [page, setPage] = useState(1);
  useEffect(() => setPage(1), [q]);
  const { data, isLoading } = useCompanies(q, page);
  const companies = data?.items;
  const [editing, setEditing] = useState<CompanyListItem | null>(null);
  const [creating, setCreating] = useState(false);
  const [detailId, setDetailId] = useState<string | null>(null);
  // Arrivo da un altro pannello (?azienda=<id>): apre la scheda **una volta**, e
  // avvisa il genitore di consumare il parametro. Senza, chiuso il pannello e
  // rimontata la tab (cambio scheda) il seed lo riaprirebbe da solo per sempre.
  useEffect(() => {
    if (!openCompanyId) return;
    setDetailId(openCompanyId);
    onOpened?.();
  }, [openCompanyId, onOpened]);
  const removeCompany = useDeleteCompany();
  const confirm = useConfirm();
  const { open, menu } = useContextMenu();

  // Stessa regola del server (predicato condiviso): senza il permesso CRM le
  // azioni non compaiono, invece di rispondere 403 al clic.
  const canManage = canManageCompanies(useCurrentUser());
  const companyMenu = (company: CompanyListItem): ContextMenuItem[] => [
    {
      label: t("Apri"),
      icon: <Building2 className="size-4" />,
      onSelect: () => setDetailId(company.id),
    },
    ...(canManage
      ? [
          {
            label: t("Modifica"),
            icon: <Pencil className="size-4" />,
            onSelect: () => setEditing(company),
          },
        ]
      : []),
    ...(!canManage
      ? []
      : [
          {
            label: t("Elimina"),
            icon: <Trash2 className="size-4" />,
            danger: true,
            separatorBefore: true,
            onSelect: () => {
              void confirm({
                title: t("Eliminare l'azienda?"),
                message: t(
                  '"{{name}}" verrà spostata nel cestino. Le offerte collegate resteranno con il riferimento marcato.',
                  { name: company.name },
                ),
                confirmLabel: t("Sposta nel cestino"),
                tone: "danger",
              }).then((ok) => {
                if (ok) removeCompany.mutate(company.id);
              });
            },
          },
        ]),
  ];

  if (isLoading) return <SkeletonRows rows={6} />;

  return (
    <div className="flex flex-col gap-3">
      <Button className="self-end" onClick={() => setCreating(true)}>
        <Plus className="size-4" /> {t("Nuova azienda")}
      </Button>
      <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
        {companies?.map((company) => (
          // Non più un <button> che contiene bottoni (annidamento non valido, e
          // i contatori non sarebbero cliccabili): il titolo apre il dettaglio,
          // i contatori portano ciascuno alla propria vista.
          <div
            key={company.id}
            className="flex flex-col gap-1 rounded-lg border bg-card p-4 text-left"
            onContextMenu={(e) => open(e, companyMenu(company))}
          >
            <div className="flex items-center justify-between">
              <button
                type="button"
                className="text-left font-semibold hover:underline"
                title={t("Apri la scheda del cliente")}
                onClick={() => setDetailId(company.id)}
              >
                {company.name}
              </button>
              {canManage && (
                <Button
                  variant="ghost"
                  size="icon"
                  title={t("Modifica")}
                  onClick={(e) => {
                    e.stopPropagation();
                    setEditing(company);
                  }}
                >
                  <Pencil className="size-4" />
                </Button>
              )}
            </div>
            <p className="text-xs text-muted-foreground">
              {[company.city, company.vatNumber].filter(Boolean).join(" · ") || "—"}
            </p>
            <CompanyCounts company={company} />
          </div>
        ))}
      </div>
      {(companies?.length ?? 0) === 0 && (
        <p className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
          {t("Nessuna azienda.")}
        </p>
      )}
      <PaginationBar
        page={page}
        pageSize={data?.pageSize ?? 100}
        total={data?.total ?? 0}
        onPageChange={setPage}
      />

      {(creating || editing) && (
        <CompanyDialog
          company={editing}
          onClose={() => {
            setCreating(false);
            setEditing(null);
          }}
        />
      )}
      <CompanyDetailDrawer companyId={detailId} onClose={() => setDetailId(null)} />
      {menu}
    </div>
  );
}

function CompanyDialog({
  company,
  onClose,
}: {
  company: CompanyListItem | null;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const upsert = useUpsertCompany();
  const remove = useDeleteCompany();
  const [name, setName] = useState(company?.name ?? "");
  const [vatNumber, setVatNumber] = useState(company?.vatNumber ?? "");
  const [city, setCity] = useState(company?.city ?? "");
  const [error, setError] = useState<string | null>(null);

  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    upsert.mutate(
      { id: company?.id, name, vatNumber: vatNumber || null, city: city || null },
      {
        onSuccess: onClose,
        onError: (err) => setError(err instanceof ApiError ? err.message : t("Errore imprevisto")),
      },
    );
  };

  return (
    <Dialog open onClose={onClose} title={company ? t("Modifica azienda") : t("Nuova azienda")}>
      <form onSubmit={onSubmit} className="flex flex-col gap-4">
        <div className="flex flex-col gap-1.5">
          <Label>{t("Ragione sociale")}</Label>
          <Input required value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div className="flex flex-col gap-1.5">
            <Label>{t("Partita IVA")}</Label>
            <Input value={vatNumber} onChange={(e) => setVatNumber(e.target.value)} />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label>{t("Città")}</Label>
            <Input value={city} onChange={(e) => setCity(e.target.value)} />
          </div>
        </div>
        {error && <p className="text-sm text-destructive">{error}</p>}
        <div className="flex justify-between">
          {company ? (
            <Button
              variant="destructive"
              disabled={remove.isPending}
              onClick={() => remove.mutate(company.id, { onSuccess: onClose })}
            >
              <Trash2 className="size-4" /> {t("Elimina")}
            </Button>
          ) : (
            <span />
          )}
          <div className="flex gap-2">
            <Button variant="outline" onClick={onClose}>
              {t("Annulla")}
            </Button>
            <Button type="submit" disabled={upsert.isPending}>
              {t("Salva")}
            </Button>
          </div>
        </div>
      </form>
    </Dialog>
  );
}

/**
 * Cella "Azienda" della lista contatti, modificabile al click.
 * L'upsert richiede l'anagrafica completa: i campi non toccati vengono rimandati
 * come sono, cambiando solo l'azienda collegata.
 */
function ContactCompanyCell({ contact }: { contact: ContactListItem }) {
  const { t } = useTranslation();
  const { data: companies } = useCompanies("");
  const upsert = useUpsertContact();

  return (
    <InlineSelect
      value={contact.company?.id ?? null}
      title={t("Cambia azienda")}
      className="text-sm underline-offset-2 hover:underline"
      emptyLabel={t("Nessuna azienda")}
      options={(companies?.items ?? []).map((c) => ({ value: c.id, label: c.name }))}
      onChange={(companyId) =>
        upsert.mutate({
          id: contact.id,
          firstName: contact.firstName,
          lastName: contact.lastName,
          email: contact.email,
          phone: contact.phone,
          roleTitle: contact.roleTitle,
          companyId: companyId || null,
        })
      }
    >
      {contact.company?.name ?? <span className="italic text-muted-foreground">—</span>}
    </InlineSelect>
  );
}
