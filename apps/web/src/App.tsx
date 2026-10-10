// Copyright (c) 2026 Jugaad s.r.l.
// SPDX-License-Identifier: AGPL-3.0-only

import { Suspense, useEffect, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import {
  BrowserRouter,
  Navigate,
  Route,
  Routes,
  useLocation,
  useParams,
  useNavigate,
} from "react-router-dom";
import { canReachDeals } from "@kancrm/shared";
import { AppShell } from "./components/layout/AppShell";
import { FullPageError } from "./components/ui/full-page-error";
import { LoginPage } from "./features/auth/LoginPage";
import { ResetPasswordPage } from "./features/auth/ResetPasswordPage";
import { PluginFrame } from "./features/plugins/PluginFrame";
import { ForcePasswordChange } from "./features/auth/ForcePasswordChange";
import {
  CurrentUserContext,
  useCurrentUser,
  useForbiddenRefresh,
  useMe,
} from "./features/auth/useAuth";
import { applyLanguage, linguaSceltaAMano } from "./lib/i18n";
import { ThemeManager } from "./features/theme/ThemeManager";
import { AttachmentReaderPage } from "./features/attachments/useAttachmentReader";
import { lazyPage } from "./lib/lazy-page";
import { AdminOnly, ManagerOnly, ManagerOrAdmin } from "./components/layout/route-guards";
import { edizione } from "./edition/rotte";

/** Rimando permanente da un indirizzo storico, query compresa. */
function RedirectStorico({ a }: { a: string }) {
  const location = useLocation();
  return <Navigate to={`${a}${location.search}`} replace />;
}

// Ogni pagina è un chunk a sé (code-splitting per route): vedi `lib/lazy-page.ts`.
const TasksPage = lazyPage(() => import("./features/tasks/TasksPage"), "TasksPage");
const MailPage = lazyPage(() => import("./features/admin/MailPage"), "MailPage");
const DealsPage = lazyPage(() => import("./features/deals/DealsPage"), "DealsPage");
const ProjectsPage = lazyPage(() => import("./features/projects/ProjectsPage"), "ProjectsPage");
const ProjectDetailPage = lazyPage(
  () => import("./features/projects/ProjectDetailPage"),
  "ProjectDetailPage",
);
const LlmQueuePage = lazyPage(() => import("./features/llm/LlmQueuePage"), "LlmQueuePage");
const TimesheetPage = lazyPage(() => import("./features/timesheet/TimesheetPage"), "TimesheetPage");
const ContactsPage = lazyPage(() => import("./features/crm/ContactsPage"), "ContactsPage");
const UsersPage = lazyPage<
  typeof import("./features/users/UsersPage"),
  { perimetro?: "tutti" | "portale" }
>(() => import("./features/users/UsersPage"), "UsersPage");
const GroupsPage = lazyPage(() => import("./features/groups/GroupsPage"), "GroupsPage");
const StatusesPage = lazyPage(
  () => import("./features/task-statuses/StatusesPage"),
  "StatusesPage",
);
const DealStagesPage = lazyPage(
  () => import("./features/deal-stages/DealStagesPage"),
  "DealStagesPage",
);
const DashboardPage = lazyPage(() => import("./features/dashboard/DashboardPage"), "DashboardPage");
const SystemPage = lazyPage(() => import("./features/admin/SystemPage"), "SystemPage");
const TrashPage = lazyPage(() => import("./features/admin/TrashPage"), "TrashPage");
const AppearancePage = lazyPage(() => import("./features/admin/AppearancePage"), "AppearancePage");
import { DemoAnalytics } from "./features/analytics/DemoAnalytics";
const HelpPage = lazyPage(() => import("./features/help/HelpPage"), "HelpPage");
const ProfilePage = lazyPage(() => import("./features/profile/ProfilePage"), "ProfilePage");

function PageLoading() {
  const { t } = useTranslation();
  return (
    <div className="flex min-h-64 items-center justify-center text-sm text-muted-foreground">
      {t("Caricamento…")}
    </div>
  );
}

/**
 * Il Router avvolge **ogni** interfaccia, non solo quella interna: non è
 * "l'elenco delle pagine" (quello è `<Routes>`, più sotto) ma il contesto di
 * navigazione del browser, e lo chiedono anche i componenti condivisi che
 * finiscono nelle aree senza rotte — portale clienti e monitor vendite. La
 * campanella delle notifiche e il lettore di record navigano: da quando lo
 * fanno (`useRecordOpener`), il portale che stava fuori dal Router mostrava una
 * pagina bianca (12/08/2026).
 */
export function App() {
  return (
    <BrowserRouter>
      <AppInterface />
      {/* Solo in una demo con Google Analytics: altrove non rende niente. */}
      <DemoAnalytics />
    </BrowserRouter>
  );
}

function AppInterface() {
  const { t } = useTranslation();
  const { data: user, isLoading } = useMe();
  // Un rifiuto del server (permessi scaduti mentre si lavora) rilegge l'utente:
  // la pagina smette di offrire comandi che non valgono più.
  useForbiddenRefresh();

  // La lingua dell'interfaccia segue la preferenza salvata sull'utente
  // (`user.locale`): è il valore predefinito di chi entra, e si applica appena
  // si sa chi ha effettuato l'accesso. **Salvo che qualcuno abbia scelto a
  // mano** sulla schermata di accesso: quella è una persona che ha appena
  // deciso, e vince per questa sessione. Prima la si sovrascriveva un istante
  // dopo l'accesso, e chi aveva messo l'inglese si ritrovava l'italiano.
  useEffect(() => {
    if (user?.locale && !linguaSceltaAMano()) applyLanguage(user.locale);
  }, [user?.locale]);

  if (isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center text-sm text-muted-foreground">
        {t("Caricamento…")}
      </div>
    );
  }

  if (!user) {
    // il collegamento di reset arriva per email a chi, per definizione, non è dentro
    if (window.location.pathname === "/reimposta-password") return <ResetPasswordPage />;
    return <LoginPage />;
  }

  // Password provvisoria assegnata da un amministratore: si sceglie la propria
  // e poi si entra. Prima di ogni ramo di ruolo — vale per gli interni come per
  // il portale e i monitor vendite — e prima di qualunque pagina, perché con
  // quel segno il server risponde 403 a tutto il resto.
  if (user.mustChangePassword) {
    return (
      <CurrentUserContext.Provider value={user}>
        <ThemeManager />
        <ForcePasswordChange name={user.nickName || user.name} />
      </CurrentUserContext.Provider>
    );
  }

  // I ruoli dei moduli (clienti del portale, monitor vendite) hanno
  // un'interfaccia dedicata, che porta il modulo: si entra lì e basta.
  const AppDelRuolo = edizione.appPerRuolo[user.role];
  if (AppDelRuolo) {
    return (
      <CurrentUserContext.Provider value={user}>
        <ThemeManager />
        <Suspense fallback={<PageLoading />}>
          <AppDelRuolo />
        </Suspense>
      </CurrentUserContext.Provider>
    );
  }

  return (
    <CurrentUserContext.Provider value={user}>
      <ThemeManager />
      <Suspense fallback={<PageLoading />}>
        <Routes>
          {/*
            Lettore a schermo intero — quello che apre "Apri in una scheda" dal
            pannello del documento — **fuori dall'AppShell**: a schermo pieno si
            guarda un documento, e barra laterale, ricerca e menù utente sono
            l'applicazione che si mette in mezzo. Stava dentro il gruppo di
            rotte del guscio, quindi si portava dietro tutto il contorno e
            perfino una seconda barra di scorrimento (18/08/2026). La sessione
            e il tema restano: quelli vivono più in alto, attorno a `<Routes>`.
          */}
          <Route path="/documento/:id" element={<DocumentReaderRoute />} />
          <Route element={<AppShell />}>
            <Route index element={<DashboardPage />} />
            {/* Scadenzario accessibile a tutti gli interni: si vedono i propri task
                (chi ha lo scope ADMIN_TASKS vede tutto). */}
            {/* «Personale» è un plugin dal 05/09/2026: i segnalibri vecchi arrivano comunque. */}
            <Route path="/personale" element={<Navigate to="/estensioni/Personale" replace />} />
            <Route path="/bacheche" element={<TasksPage />} />
            {/* L'indirizzo storico dell'area (si chiamava Scadenzario, poi
                Amministrativi, oggi Bacheche): vive nei preferiti, nelle email
                di notifica già spedite e nei calendari sottoscritti, quindi il
                rimando è permanente e porta con sé la query (?task=…). */}
            <Route path="/scadenzario" element={<RedirectStorico a="/bacheche" />} />
            <Route
              path="/offerte"
              element={
                <DealsAccessOnly>
                  <DealsPage />
                </DealsAccessOnly>
              }
            />
            <Route path="/progetti" element={<ProjectsPage />} />
            <Route path="/progetti/:id" element={<ProjectDetailPage />} />
            <Route path="/guida" element={<HelpPage />} />
            <Route path="/profilo" element={<ProfilePage />} />
            {/* The AI queue: whoever leads something, whatever the scope. Core since 08/10/2026. */}
            <Route
              path="/coda-llm"
              element={
                <ManagerOnly>
                  <LlmQueuePage />
                </ManagerOnly>
              }
            />
            {/* The timesheet grid is core; its extras come with the edition (08/10/2026). */}
            <Route path="/timesheet" element={<TimesheetPage />} />
            {/* Aziende visibili a tutti gli interni; la tab Persone è gestita dalla pagina. */}
            <Route path="/contatti" element={<ContactsPage />} />
            <Route
              path="/utenti"
              element={
                <AdminOnly>
                  <UsersPage />
                </AdminOnly>
              }
            />
            <Route
              path="/gruppi"
              element={
                <ManagerOrAdmin>
                  <GroupsPage />
                </ManagerOrAdmin>
              }
            />
            <Route
              path="/stati"
              element={
                <ManagerOrAdmin>
                  <StatusesPage />
                </ManagerOrAdmin>
              }
            />
            <Route
              path="/fasi"
              element={
                <AdminOnly>
                  <DealStagesPage />
                </AdminOnly>
              }
            />
            <Route
              path="/sistema"
              element={
                <AdminOnly>
                  <SystemPage />
                </AdminOnly>
              }
            />
            <Route
              path="/cestino"
              element={
                <AdminOnly>
                  <TrashPage />
                </AdminOnly>
              }
            />
            <Route
              path="/email"
              element={
                <AdminOnly>
                  <MailPage />
                </AdminOnly>
              }
            />
            <Route
              path="/aspetto"
              element={
                <AdminOnly>
                  <AppearancePage />
                </AdminOnly>
              }
            />
            {/* Le pagine dei moduli dell'edizione (ticket, timesheet, coda AI…). */}
            {edizione.rotte.map((rotta) => (
              <Route key={rotta.path} path={rotta.path} element={rotta.element} />
            ))}
            <Route path="/estensioni/:nome" element={<PluginFrame />} />
            <Route path="*" element={<NotFoundPage />} />
          </Route>
        </Routes>
      </Suspense>
    </CurrentUserContext.Provider>
  );
}

/**
 * Lettore di un documento in una scheda sua: prende l'id dall'indirizzo, il
 * resto lo fa il lettore condiviso (stesso componente dei monitor vendite).
 */

function DocumentReaderRoute() {
  const { id } = useParams<{ id: string }>();
  return <AttachmentReaderPage attachmentId={id!} />;
}




function NotFoundPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  return (
    <FullPageError
      code="404"
      title={t("Pagina non trovata")}
      message={t("L'indirizzo non esiste o è stato spostato.")}
      actionLabel={t("Torna alla home")}
      onAction={() => void navigate("/", { replace: true })}
    />
  );
}

function DealsAccessOnly({ children }: { children: ReactNode }) {
  const user = useCurrentUser();
  // La vista in giornate degli sviluppatori passa di qui: è la stessa pagina,
  // che si spoglia da sola (vedi DealsPage, daysView). Stesso predicato dei
  // contatori nelle schede cliente: chi vede il numero ci può arrivare.
  if (!canReachDeals(user)) return <Navigate to="/progetti" replace />;
  return children;
}
