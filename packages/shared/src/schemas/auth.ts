// Copyright (c) 2026 Jugaad s.r.l.
// SPDX-License-Identifier: AGPL-3.0-only

import { z } from "zod";
import { ActivityCategory } from "../enums";
import { UserRole } from "../enums";

export const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
});
export type LoginInput = z.infer<typeof loginSchema>;

export const currentUserSchema = z.object({
  id: z.string(),
  email: z.string().email(),
  name: z.string(),
  role: z.nativeEnum(UserRole),
  /** L'utente vede il modulo Offerte/CRM (visibilità per gruppo, M4). */
  canSeeDeals: z.boolean(),
  /** Accesso FULL alle offerte: può crearle; modifica comunque solo le proprie. */
  canEditDeals: z.boolean(),
  /**
   * Interno senza privilegio commerciale (es. sviluppatore): vede l'elenco
   * offerte in sola lettura, con il valore espresso in giornate. Niente
   * dettaglio, allegati o link.
   */
  dealsDaysView: z.boolean(),
  /** L'utente vede lo Scadenzario / task amministrativi (visibilità per gruppo, M5). */
  canSeeAdminTasks: z.boolean(),
  /**
   * L'utente entra nell'area Ticket: il supporto che risponde, chi ha dei
   * progetti su cui aprire richieste (12/08/2026) e sempre i PORTAL.
   */
  canSeeTickets: z.boolean(),
  /**
   * L'utente **tiene il desk**: vede le richieste di tutti, le assegna, ne
   * cambia stato e priorità. Chi apre e basta vede solo le proprie e non ha
   * nessuna di quelle azioni. Vedi `modules/tickets/access.ts`.
   */
  canManageTickets: z.boolean(),
  /** L'utente vede le persone/contatti CRM (le aziende sono visibili a tutti gli interni). */
  canSeeContacts: z.boolean(),
  /**
   * L'utente vede il pannello **L'andamento** in "La mia giornata": chi lavora
   * nell'area tecnica (membro di un gruppo che governa DEV) o chi la governa.
   * Sta nel DTO perché il selettore in pagina non deve offrire una vista che
   * risponderebbe 403.
   */
  canSeeDevMetrics: z.boolean(),
  /**
   * **Guida qualcosa**: un gruppo o un progetto, non importa quale. Apre le
   * pagine che riguardano il ruolo e non l'ambito — oggi la coda delle note di
   * rilascio. Diverso da `isGroupManager`, che governa la configurazione.
   */
  isManager: z.boolean(),
  // Preferenze personali.
  nickName: z.string().nullable(),
  accentColor: z.string().nullable(),
  currency: z.string(),
  locale: z.string(),
  /** Tema UI scelto: auto | light | dark | company. */
  theme: z.string(),
  /** URL dell'avatar caricato (immagine), se presente. */
  avatarUrl: z.string().nullable(),
  /**
   * Il ruolo VERO è amministratore: l'utente può elevarsi (stile sudo) anche
   * se in questo momento `role` dice MEMBER. Vedi modules/auth/elevation.
   */
  /**
   * Le estensioni che questa persona può allegare aprendo un task o una
   * richiesta. Viaggia con l'utente perché la regola dipende da chi è (i
   * clienti del portale hanno un elenco chiuso) e perché il selettore di file
   * la usa subito, senza una chiamata in più.
   */
  attachmentExtensions: z.array(z.string()),
  canElevate: z.boolean(),
  /**
   * Fino a quando valgono i privilegi di amministratore (ISO), null se si sta
   * lavorando da utente normale. Il badge in topbar lo usa per il conto alla
   * rovescia e per rientrare da sé alla scadenza.
   */
  adminUntil: z.string().nullable(),
  /**
   * La password in uso è **provvisoria**: l'ha reimpostata un amministratore e
   * spedita per email. L'applicazione non si apre finché non se ne sceglie una
   * (`ForcePasswordChange`); il server la pensa allo stesso modo e lascia
   * passare solo le rotte per cambiarla.
   */
  mustChangePassword: z.boolean(),
  /** Può vedere i timesheet di altri (admin, permesso dedicato, manager, supervisore). */
  canViewTeamTimesheet: z.boolean(),
  /** Vede le ore di TUTTI (impostato dall'amministratore): apre il report per le offerte. */
  canViewAllTimesheets: z.boolean(),
  /**
   * Monitor vendite che vede **tutte** le offerte (impostato dall'admin, 01/10/2026):
   * nella previsione accanto alle perse compare anche il loro valore.
   */
  salesMonitorAllDeals: z.boolean(),
  /**
   * Manager di almeno un gruppo (o amministratore elevato): gestisce i suoi
   * membri, configura stati e tipi della sua area e, dal 07/09/2026, corregge
   * il richiedente di una richiesta. Diverso da `isManager`, che comprende
   * anche i manager di progetto.
   */
  isGroupManager: z.boolean(),
  /**
   * Aree di cui l'utente può configurare stati e tipi di attività: tutte per
   * l'admin, quelle dei gruppi che gestisce per un manager, nessuna per gli altri.
   */
  manageableCategories: z.array(z.nativeEnum(ActivityCategory)),
  /**
   * Questa installazione è una **dimostrazione**: i caricamenti di file sono
   * rifiutati dal server, e le pagine non offrono il gesto. Falso ovunque
   * altro, e in produzione non cambia niente.
   */
  demoMode: z.boolean(),
});
export type CurrentUser = z.infer<typeof currentUserSchema>;

/**
 * Provider di autenticazione e integrazioni disponibili, letti **senza sessione**
 * dalla pagina di login (per mostrare o meno "Accedi con Google") e dagli allegati
 * (per il selettore Drive). I valori del picker sono pubblici (limitati per
 * referrer sulla console Google): mai segreti qui.
 */
export const authProvidersSchema = z.object({
  /**
   * The edition the server runs (10/10/2026). The web build has its own, decided
   * when it was built: the two must agree, and the web checks it here. A
   * commercial build served by a community server would show buttons to routes
   * that do not exist.
   */
  edizione: z.enum(["community", "commerciale"]),
  /** Le vie self-service via email: esistono solo se il mailer è configurato. */
  email: z.object({ passwordReset: z.boolean(), otp: z.boolean() }),
  google: z.object({
    /** SSO Google configurato: mostra il pulsante "Accedi con Google". */
    sso: z.boolean(),
    /** Selettore Google Drive configurato: mostra "Allega da Google Drive". */
    picker: z.object({
      enabled: z.boolean(),
      clientId: z.string(),
      apiKey: z.string(),
      appId: z.string(),
    }),
  }),
  /**
   * **Solo negli ambienti di dimostrazione.** Le credenziali di prova stampate
   * sulla pagina di accesso: sono pubbliche per scelta — la demo esiste perché
   * chiunque entri senza chiedere niente a nessuno. Il flag lo accende il
   * `.env` di quell'installazione (`DEMO_ACCOUNTS`), e in produzione non c'è.
   */
  demo: z
    .object({
      /** Password unica per tutti: è una demo, non un'anagrafica. */
      password: z.string(),
      accounts: z.array(
        z.object({
          email: z.string(),
          /** Il ruolo, come lo scrive il `.env`: «Amministratore», «Commerciale»… */
          role: z.string(),
        }),
      ),
      /**
       * Google Analytics della demo: l'identificativo GA4, se c'è. Si carica
       * solo dopo il consenso alle statistiche (cookie `kancrm_statistiche`).
       */
      analytics: z.object({ measurementId: z.string() }).nullable().optional(),
    })
    .nullable(),
});
export type AuthProviders = z.infer<typeof authProvidersSchema>;

export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1),
  newPassword: z.string().min(8).max(200),
});
export type ChangePasswordInput = z.infer<typeof changePasswordSchema>;

/** Reimpostazione password self-service: la richiesta (sempre 200, mai enumerazione). */
export const requestPasswordResetInput = z.object({
  email: z.string().email(),
});
export type RequestPasswordResetInput = z.infer<typeof requestPasswordResetInput>;

/** Reimpostazione password self-service: la conferma col token arrivato per email. */
export const confirmPasswordResetInput = z.object({
  token: z.string().min(20),
  password: z.string().min(8),
});
export type ConfirmPasswordResetInput = z.infer<typeof confirmPasswordResetInput>;

/** Accesso con codice via email: la richiesta del codice (sempre 200). */
export const requestLoginCodeInput = z.object({
  email: z.string().email(),
});
export type RequestLoginCodeInput = z.infer<typeof requestLoginCodeInput>;

/** Accesso con codice via email: la verifica delle sei cifre. */
export const verifyLoginCodeInput = z.object({
  email: z.string().email(),
  code: z.string().regex(/^\d{6}$/),
});
export type VerifyLoginCodeInput = z.infer<typeof verifyLoginCodeInput>;
