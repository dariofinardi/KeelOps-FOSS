// Copyright (c) 2026 Jugaad s.r.l.
// SPDX-License-Identifier: AGPL-3.0-only

import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { NavLink, Outlet, useLocation } from "react-router-dom";
import {
  FileText,
  ChevronDown,
  Headset,
  Mail,
  Palette,
  Kanban,
  LogOut,
  Menu,
  Moon,
  Plus,
  Sun,
  Tags,
  Trash2,
  UserCog,
  UsersRound,
  Workflow,
  Wrench,
  X,
} from "lucide-react";
import { UserRole, type CurrentUser } from "@kancrm/shared";
import { useFocusTrap } from "@/lib/focus-trap";
import { isTypingTarget } from "@/lib/keyboard";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { useCurrentUser, useLogout } from "@/features/auth/useAuth";
import { BrandMark } from "./BrandMark";

import { NotificationBell } from "@/features/notifications/NotificationBell";
import { PluginBarButtons } from "@/features/plugins/PluginBarButtons";
import { GlobalSearch } from "@/features/search/GlobalSearch";
import { AdminElevationBadge } from "@/features/auth/AdminElevation";
import { ViewSearchProvider } from "@/lib/view-search";
import { useDocumentTitle } from "@/lib/use-document-title";
import { NewTaskDialog } from "@/features/tasks/NewTaskDialog";
import { PushPrompt } from "@/features/notifications/PushPrompt";
import { DocumentReaderProvider } from "@/features/attachments/useAttachmentReader";
import { DealFromTaskProvider } from "@/features/deals/DealFromTaskDialog";
import { UpdatesToast } from "@/features/realtime/UpdatesToast";
import type { ComponentType } from "react";
import { iconaDelPlugin } from "@/features/plugins/plugin-icon";
import { AREAS } from "./areas";
import { usePlugins } from "@/features/plugins/usePlugins";
import { edizione } from "@/edition/rotte";
import { disponiVoci } from "@/features/plugins/nav-placement";

/** Voce di menù: area (rotta, etichetta, icona) più le condizioni di visibilità. */
interface NavEntry {
  to: string;
  label: string;
  icon: ComponentType<{ className?: string }>;
  end?: boolean;
  dealsOnly?: boolean;
  adminTasksOnly?: boolean;
  ticketsOnly?: boolean;
  /** Solo per chi guida un gruppo o un progetto: l'ambito non conta. */
  managerOnly?: boolean;
  /** La voce porta a una pagina di un modulo dell'edizione: c'è solo se c'è il modulo. */
  modulo?: string;
}

/** La voce c'è in questa edizione: del nucleo, o di un modulo presente. */
const nellEdizione = (item: { modulo?: string }) =>
  !item.modulo || edizione.moduli.has(item.modulo);

// Rotte e icone vengono da `AREAS` (unico punto, condiviso con i collegamenti
// sparsi per l'applicazione); qui si aggiunge solo ciò che riguarda il menù.
const navItems: NavEntry[] = [
  { ...AREAS.home, end: true },
  AREAS.tasks,
  { ...AREAS.deals, dealsOnly: true },
  AREAS.projects,
  { ...AREAS.tickets, ticketsOnly: true, modulo: "ticket" },
  AREAS.timesheet,
  AREAS.contacts,
  // Chi guida un gruppo o un progetto: la coda è una risorsa condivisa e lenta,
  // e va sorvegliata da chi guida del lavoro.
  { to: "/coda-llm", label: "Coda AI", icon: FileText, managerOnly: true },
  AREAS.help,
];

/**
 * Da un percorso alla chiave dell'area (`/bacheche` → `tasks`): è la chiave con
 * cui un manifesto dice «dopo Bacheche». Una voce senza area (la coda AI) ha
 * per chiave il suo percorso, e nessun plugin ci si aggancia.
 */
const chiaveArea = (to: string): string =>
  (Object.entries(AREAS).find(([, area]) => area.to === to)?.[0] as string | undefined) ?? to;

const adminItems: Array<NavEntry> = [
  { to: "/utenti", label: "Utenti", icon: UsersRound },
  { to: "/customer-care", label: "Utenti customer care", icon: Headset, modulo: "ticket" },
  { to: "/gruppi", label: "Gruppi", icon: Workflow },
  { to: "/stati", label: "Stati task", icon: Tags },
  { to: "/fasi", label: "Fasi pipeline", icon: Kanban },
  { to: "/aspetto", label: "Aspetto", icon: Palette },
  { to: "/email", label: "Email e Calendari", icon: Mail },
  { to: "/cestino", label: "Cestino", icon: Trash2 },
  { to: "/sistema", label: "Sistema", icon: Wrench },
];

function initialsOf(name: string): string {
  return name
    .split(/\s+/)
    .map((part) => part[0] ?? "")
    .join("")
    .slice(0, 2)
    .toUpperCase();
}

function NavItem({
  to,
  label,
  icon: Icon,
  end,
  onNavigate,
}: NavEntry & { onNavigate?: () => void }) {
  const { t } = useTranslation();
  return (
    <NavLink
      to={to}
      end={end}
      onClick={onNavigate}
      className={({ isActive }) =>
        cn(
          "flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors",
          isActive
            ? "bg-sidebar-accent text-sidebar-accent-foreground"
            : "text-muted-foreground hover:bg-sidebar-accent/60 hover:text-sidebar-accent-foreground",
        )
      }
    >
      <Icon className="size-4" />
      {t(label)}
    </NavLink>
  );
}

const ADMIN_NAV_KEY = "kancrm-admin-nav-collapsed";

/** Elenco voci di navigazione, condiviso tra sidebar desktop e slide-over mobile. */
function NavContent({ user, onNavigate }: { user: CurrentUser; onNavigate?: () => void }) {
  const { t } = useTranslation();
  const isAdmin = user.role === UserRole.ADMIN;
  const [adminCollapsed, setAdminCollapsed] = useState(
    () => localStorage.getItem(ADMIN_NAV_KEY) === "1",
  );
  const plugins = usePlugins().data ?? [];
  const toggleAdmin = () => {
    setAdminCollapsed((prev) => {
      localStorage.setItem(ADMIN_NAV_KEY, prev ? "0" : "1");
      return !prev;
    });
  };

  return (
    <nav className="flex flex-1 flex-col gap-1 p-2">
      {/*
        Native e plugin disposti insieme: un plugin dice nel manifesto dopo
        quale area stare (`dopo: "tasks"`) e chi lo vede; la regola sta in
        `nav-placement.ts`, qui si disegna soltanto. Le native che l'utente
        non può vedere spariscono prima della disposizione, così un plugin
        agganciato a un'area nascosta va in coda invece che in un buco.
      */}
      {disponiVoci(
        navItems
          .filter(nellEdizione)
          .filter(
            (item) =>
              (!("dealsOnly" in item) ||
                !item.dealsOnly ||
                user.canSeeDeals ||
                user.dealsDaysView) &&
              (!("adminTasksOnly" in item) || !item.adminTasksOnly || user.canSeeAdminTasks) &&
              (!("ticketsOnly" in item) || !item.ticketsOnly || user.canSeeTickets) &&
              (!("managerOnly" in item) || !item.managerOnly || user.isManager),
          )
          .map((item) => ({ chiave: chiaveArea(item.to), item })),
        plugins,
        "aree",
        { role: user.role, isManager: user.isManager },
      ).map((voce) =>
        voce.plugin ? (
          <NavItem
            key={`plugin-${voce.plugin.nome}`}
            to={`/estensioni/${voce.plugin.nome}`}
            label={voce.plugin.voce}
            icon={iconaDelPlugin(voce.plugin)}
            onNavigate={onNavigate}
          />
        ) : (
          <NavItem
            key={voce.nativa.item.to}
            {...voce.nativa.item}
            // Chi non vede le persone trova nella pagina solo le aziende.
            label={
              voce.nativa.item.to === "/contatti" && !user.canSeeContacts
                ? "Aziende"
                : voce.nativa.item.label
            }
            onNavigate={onNavigate}
          />
        ),
      )}
      {(isAdmin || user.isGroupManager) && (
        <>
          <button
            className="mt-4 flex items-center justify-between rounded-md px-3 pb-1 pt-1 text-xs font-medium uppercase text-muted-foreground hover:text-foreground"
            onClick={toggleAdmin}
            aria-expanded={!adminCollapsed}
          >
            {isAdmin ? t("Amministrazione") : t("Gestione")}
            <ChevronDown
              className={`size-3.5 transition-transform duration-300 motion-reduce:transition-none ${
                adminCollapsed ? "-rotate-90" : ""
              }`}
            />
          </button>
          <div
            className={`grid transition-[grid-template-rows] duration-300 ease-in-out motion-reduce:transition-none ${
              adminCollapsed ? "grid-rows-[0fr]" : "grid-rows-[1fr]"
            }`}
            aria-hidden={adminCollapsed}
          >
            <div
              className={`flex flex-col gap-1 overflow-hidden transition-[visibility] duration-300 ${
                adminCollapsed ? "invisible" : "visible"
              }`}
            >
              {/*
                Il manager di gruppo (non admin) vede Gruppi, Stati task e
                l'area customer care: è lui ad abilitare un cliente sui progetti
                su cui potrà aprire ticket (02/09/2026).
              */}
              {disponiVoci(
                adminItems
                  .filter(nellEdizione)
                  .filter(
                    (item) =>
                      isAdmin ||
                      item.to === "/gruppi" ||
                      item.to === "/stati" ||
                      item.to === "/customer-care",
                  )
                  .map((item) => ({ chiave: item.to, item })),
                plugins,
                "amministrazione",
                { role: user.role, isManager: user.isManager },
              ).map((voce) =>
                voce.plugin ? (
                  <NavItem
                    key={`plugin-${voce.plugin.nome}`}
                    to={`/estensioni/${voce.plugin.nome}`}
                    label={voce.plugin.voce}
                    icon={iconaDelPlugin(voce.plugin)}
                    onNavigate={onNavigate}
                  />
                ) : (
                  <NavItem
                    key={voce.nativa.item.to}
                    {...voce.nativa.item}
                    onNavigate={onNavigate}
                  />
                ),
              )}
            </div>
          </div>
        </>
      )}
    </nav>
  );
}

function ThemeToggle() {
  const { t } = useTranslation();
  const [dark, setDark] = useState(() => document.documentElement.classList.contains("dark"));
  const toggle = () => {
    const next = !dark;
    document.documentElement.classList.toggle("dark", next);
    localStorage.setItem("kancrm-theme", next ? "dark" : "light");
    setDark(next);
  };
  return (
    <Button
      variant="ghost"
      size="icon"
      title={dark ? t("Tema chiaro") : t("Tema scuro")}
      onClick={toggle}
    >
      {dark ? <Sun className="size-4" /> : <Moon className="size-4" />}
    </Button>
  );
}

const SHORTCUTS: Array<{ keys: string; action: string }> = [
  { keys: "/", action: "Cerca (senza cambiare modo)" },
  { keys: "Ctrl + K", action: "Vai alla ricerca globale" },
  { keys: "n", action: "Nuovo task (ovunque)" },
  {
    keys: "A / R / T / K",
    action: "Scadenzario: Agenda / Ricorrenze / Tabella / Kanban",
  },
  { keys: "T / K / F", action: "Offerte: Tabella / Kanban / Forecast" },
  { keys: "E / K", action: "Progetto: Elenco / Kanban" },
  { keys: "Esc", action: "Chiude dialog e pannelli di dettaglio" },
  { keys: "Tab / Shift+Tab", action: "Naviga i campi dentro una finestra modale" },
  { keys: "Invio", action: "Conferma il campo o il form attivo" },
  { keys: "Shift + Invio", action: "Chat: va a capo invece di mandare" },
  { keys: "↑ ↓ / Invio", action: "Chat: scorre e sceglie la persona dopo la @" },
  { keys: "?", action: "Mostra questo elenco di scorciatoie" },
];

/** Menu mobile a scomparsa con navigazione e azioni account. */
function MobileNav({
  user,
  open,
  onClose,
}: {
  user: CurrentUser;
  open: boolean;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const logout = useLogout();
  const trapRef = useFocusTrap(open);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 bg-black/50 md:hidden"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <aside
        ref={trapRef}
        role="dialog"
        aria-modal="true"
        aria-label={t("Menu di navigazione")}
        tabIndex={-1}
        className="absolute inset-y-0 left-0 flex w-72 max-w-[85vw] flex-col border-r bg-sidebar text-sidebar-foreground shadow-xl outline-none"
      >
        <div className="flex h-14 items-center justify-between border-b border-sidebar-border px-4">
          <span className="flex items-center gap-2">
            <BrandMark />
          </span>
          <Button variant="ghost" size="icon" onClick={onClose} aria-label={t("Chiudi menu")}>
            <X className="size-4" />
          </Button>
        </div>
        <div className="flex-1 overflow-y-auto">
          <NavContent user={user} onNavigate={onClose} />
        </div>
        <div className="border-t border-sidebar-border p-2">
          <div className="flex items-center gap-2 px-3 py-2">
            {user.avatarUrl ? (
              <img src={user.avatarUrl} alt="" className="size-8 rounded-full object-cover" />
            ) : (
              <div className="flex size-8 items-center justify-center rounded-full bg-secondary text-xs font-medium text-secondary-foreground">
                {initialsOf(user.name)}
              </div>
            )}
            <div className="min-w-0 text-sm">
              <p className="truncate font-medium leading-tight">{user.name}</p>
              <p className="text-xs leading-tight text-muted-foreground">
                {user.role === UserRole.ADMIN ? t("Amministratore") : t("Membro")}
              </p>
            </div>
          </div>
          <NavLink
            to="/profilo"
            onClick={onClose}
            className="flex w-full items-center gap-3 rounded-md px-3 py-2 text-sm text-muted-foreground hover:bg-sidebar-accent/60"
          >
            <UserCog className="size-4" /> {t("Il mio profilo")}
          </NavLink>
          <button
            className="flex w-full items-center gap-3 rounded-md px-3 py-2 text-sm text-muted-foreground hover:bg-sidebar-accent/60"
            disabled={logout.isPending}
            onClick={() => logout.mutate()}
          >
            <LogOut className="size-4" /> {t("Esci")}
          </button>
        </div>
      </aside>
    </div>
  );
}

export function AppShell() {
  const { t } = useTranslation();
  const user = useCurrentUser();
  const logout = useLogout();
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [newTaskOpen, setNewTaskOpen] = useState(false);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const location = useLocation();
  const canCreateTask = user.role !== UserRole.PORTAL;

  // Scorciatoie globali: ? → aiuto, n → nuovo task. (Ctrl+K vive nella barra
  // di ricerca, che oltre al fuoco deve anche passare in modo globale.)
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (isTypingTarget(event.target)) return;
      if (event.key === "?") {
        event.preventDefault();
        setShortcutsOpen(true);
      } else if (event.key.toLowerCase() === "n" && canCreateTask) {
        event.preventDefault();
        setNewTaskOpen(true);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [canCreateTask]);
  const current =
    location.pathname === "/"
      ? navItems[0]
      : [...navItems.slice(1), ...adminItems].find((item) => location.pathname.startsWith(item.to));
  // La scheda del browser si chiama come l'area: un punto solo per tutte le
  // pagine del guscio. I pannelli di dettaglio la raffinano da soli col nome
  // del record (vedi lib/use-document-title).
  useDocumentTitle(current ? t(current.label) : null);
  const isAdmin = user.role === UserRole.ADMIN;

  return (
    // Il provider abbraccia topbar E pagine: la vista si registra (useViewSearch)
    // e la barra di ricerca in alto la vede. Vedi lib/view-search.
    <DocumentReaderProvider>
      {/* Il dialogo «Crea offerta da questo task», uno per tutta l'app. */}
      <DealFromTaskProvider>
        <ViewSearchProvider>
          {/*
          Alta quanto lo schermo **visibile** (`dvh`), non quanto lo schermo
          senza la barra dell'indirizzo (`vh`): su Chrome Android `100vh` è
          più alto di ciò che si vede, e la pagina scorreva di quel tanto —
          la barra in basso di un plugin finiva sotto il bordo (29/09/2026).
          Chi non conosce `dvh` resta su `100vh`, come prima.
        */}
          <div className="flex h-screen supports-[height:100dvh]:h-dvh">
            {/* Sidebar fissa solo da tablet in su. */}
            <aside className="hidden w-56 shrink-0 flex-col border-r bg-sidebar text-sidebar-foreground md:flex">
              <div className="flex h-14 items-center gap-2 border-b border-sidebar-border px-4">
                <BrandMark />
              </div>
              {/*
              Il menù scorre da sé quando non ci sta — le aree, i plugin e
              l'amministrazione aperta superano una finestra da 720px — invece
              di allungare la pagina: è la pagina che non deve mai scorrere
              (le bacheche scorrono dentro, e la barra sta in fondo alla
              finestra). Lo stesso contenitore del menù sul telefono (06/09/2026).
            */}
              <div className="min-h-0 flex-1 overflow-y-auto">
                <NavContent user={user} />
              </div>
            </aside>

            <MobileNav user={user} open={mobileNavOpen} onClose={() => setMobileNavOpen(false)} />

            <div className="flex min-w-0 flex-1 flex-col">
              <header className="flex h-14 shrink-0 items-center justify-between gap-2 border-b px-3 md:px-6">
                <div className="flex min-w-0 items-center gap-1">
                  <Button
                    variant="ghost"
                    size="icon"
                    className="md:hidden"
                    title={t("Menu")}
                    onClick={() => setMobileNavOpen(true)}
                  >
                    <Menu className="size-5" />
                  </Button>
                  <h1 className="truncate text-base font-semibold">
                    {current ? t(current.label) : "KeelOps"}
                  </h1>
                </div>
                <div className="flex shrink-0 items-center gap-1 md:gap-3">
                  {/* Privilegi di amministratore attivi: si vede sempre con che
                occhi si sta guardando l'applicazione, e un clic li depone. */}
                  <AdminElevationBadge />
                  <GlobalSearch />
                  {canCreateTask && (
                    <Button
                      variant="ghost"
                      size="icon"
                      title={t("Nuovo task (scorciatoia: n)")}
                      onClick={() => setNewTaskOpen(true)}
                    >
                      <Plus className="size-5" />
                    </Button>
                  )}
                  <span className="hidden md:inline-flex">
                    <ThemeToggle />
                  </span>
                  <NotificationBell />
                  {/* i bottoni dei plugin (`ui.barra`): fra la campanella e il profilo */}
                  <PluginBarButtons />
                  <NavLink
                    to="/profilo"
                    className="hidden items-center gap-2 rounded-md px-1.5 py-1 hover:bg-accent md:flex"
                    title={t("Il mio profilo (preferenze e import)")}
                  >
                    {user.avatarUrl ? (
                      <img
                        src={user.avatarUrl}
                        alt=""
                        className="size-8 rounded-full object-cover"
                      />
                    ) : (
                      <div
                        className="flex size-8 items-center justify-center rounded-full text-xs font-medium"
                        style={
                          user.accentColor
                            ? { backgroundColor: user.accentColor, color: "#fff" }
                            : undefined
                        }
                      >
                        <span
                          className={
                            user.accentColor
                              ? ""
                              : "rounded-full bg-secondary px-2 py-1.5 text-secondary-foreground"
                          }
                        >
                          {initialsOf(user.name)}
                        </span>
                      </div>
                    )}
                    <div className="hidden text-sm lg:block">
                      <p className="font-medium leading-tight">{user.nickName ?? user.name}</p>
                      <p className="text-xs leading-tight text-muted-foreground">
                        {isAdmin ? t("Amministratore") : t("Membro")}
                      </p>
                    </div>
                  </NavLink>
                  <span className="hidden md:inline-flex">
                    <Button
                      variant="ghost"
                      size="icon"
                      title={t("Esci")}
                      disabled={logout.isPending}
                      onClick={() => logout.mutate()}
                    >
                      <LogOut className="size-4" />
                    </Button>
                  </span>
                </div>
              </header>
              <Dialog
                open={shortcutsOpen}
                onClose={() => setShortcutsOpen(false)}
                title={t("Scorciatoie da tastiera")}
              >
                <ul className="flex flex-col gap-2 text-sm">
                  {SHORTCUTS.map((shortcut) => (
                    <li key={shortcut.keys} className="flex items-center justify-between gap-4">
                      <span className="text-muted-foreground">{t(shortcut.action)}</span>
                      <kbd className="shrink-0 rounded border bg-muted px-2 py-0.5 font-mono text-xs">
                        {shortcut.keys}
                      </kbd>
                    </li>
                  ))}
                </ul>
              </Dialog>
              {canCreateTask && (
                <NewTaskDialog open={newTaskOpen} onClose={() => setNewTaskOpen(false)} />
              )}
              <main className="flex-1 overflow-auto p-4 md:p-6">
                <Outlet />
              </main>
              {/* In basso al centro: i pannelli si aprono a destra e i filtri stanno
            in alto, quindi è l'unica zona che non copre niente. */}
              <UpdatesToast />
              {/* La domanda sulle notifiche: una volta sola, per dispositivo. */}
              <PushPrompt />
            </div>
          </div>
        </ViewSearchProvider>
      </DealFromTaskProvider>
    </DocumentReaderProvider>
  );
}
