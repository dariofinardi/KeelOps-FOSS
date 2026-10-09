import {
  ActivityCategory,
  AuthProvider,
  ProjectRole,
  TaskKind,
  UserRole,
  VisibilityAccess,
  VisibilityScope,
} from "@kancrm/shared";
import { initDb, prisma } from "../src/db";
import { hashPassword } from "../src/modules/auth/password";
import { materializeTemplate } from "../src/modules/recurrence/service";

// "Amministrativo" = ufficio amministrazione (NON il ruolo admin dell'app).
// "Sviluppatori" = solo progetti, timesheet e aziende: niente offerte né persone.
const GROUPS = ["Tutti", "Amministrativo", "Commerciale", "Sviluppatori"] as const;

// Stati task di default (vedi CLAUDE.md), distinti per categoria di attività e
// configurabili poi dall'admin. Un task usa gli stati della categoria del proprio
// tipo di attività; senza tipo usa quelli GENERAL.
const TASK_STATUSES = [
  { name: "Da assegnare", category: "ADMIN", color: "#94a3b8", isClosed: false },
  { name: "Assegnato", category: "ADMIN", color: "#60a5fa", isClosed: false },
  { name: "In esecuzione", category: "ADMIN", color: "#2563eb", isClosed: false },
  // "In attesa di terzi" e "Stand-by" uniti in "In revisione" (vedi
  // scripts/_tmp-merge-admin-statuses.ts per gli ambienti già popolati).
  { name: "In revisione", category: "ADMIN", color: "#f97316", isClosed: false },
  { name: "Completato", category: "ADMIN", color: "#22c55e", isClosed: true },
  {
    name: "Annullato",
    category: "ADMIN",
    color: "#6b7280",
    isClosed: true,
    stopsRecurrence: true,
  },
  // Destinazione dei task generati dalle offerte vinte, e loro smistamento.
  {
    name: "Fatture da emettere",
    category: "ADMIN",
    color: "#0ea5e9",
    isClosed: false,
    isWonTarget: true,
  },
  { name: "Canoni e fatture ricorrenti", category: "ADMIN", color: "#8b5cf6", isClosed: false },

  { name: "Da contattare", category: "SALES", color: "#94a3b8", isClosed: false },
  { name: "Contattato", category: "SALES", color: "#60a5fa", isClosed: false },
  { name: "In attesa di risposta", category: "SALES", color: "#f59e0b", isClosed: false },
  { name: "Da richiamare", category: "SALES", color: "#a78bfa", isClosed: false },
  { name: "Completata", category: "SALES", color: "#22c55e", isClosed: true },
  {
    name: "Annullata",
    category: "SALES",
    color: "#6b7280",
    isClosed: true,
    stopsRecurrence: true,
  },

  { name: "Da fare", category: "DEV", color: "#94a3b8", isClosed: false },
  { name: "In sviluppo", category: "DEV", color: "#2563eb", isClosed: false },
  { name: "In review", category: "DEV", color: "#f97316", isClosed: false },
  { name: "Da testare", category: "DEV", color: "#a78bfa", isClosed: false },
  { name: "Bloccato", category: "DEV", color: "#f59e0b", isClosed: false },
  { name: "In attesa", category: "DEV", color: "#eab308", isClosed: false },
  { name: "Rilasciato", category: "DEV", color: "#22c55e", isClosed: true },
  {
    name: "Annullato",
    category: "DEV",
    color: "#6b7280",
    isClosed: true,
    stopsRecurrence: true,
  },

  { name: "Da fare", category: "GENERAL", color: "#94a3b8", isClosed: false },
  { name: "In corso", category: "GENERAL", color: "#2563eb", isClosed: false },
  { name: "In attesa", category: "GENERAL", color: "#f59e0b", isClosed: false },
  { name: "Completato", category: "GENERAL", color: "#22c55e", isClosed: true },
  {
    name: "Annullato",
    category: "GENERAL",
    color: "#6b7280",
    isClosed: true,
    stopsRecurrence: true,
  },
] as const;

// Tipi di attività di default, raggruppati per categoria. Riordinabili/estendibili.
const ACTIVITY_CATEGORY_COLORS = {
  ADMIN: "#f59e0b",
  SALES: "#0ea5e9",
  DEV: "#22c55e",
  GENERAL: "#6b7280",
} as const;
const ACTIVITY_TYPES: Array<{
  name: string;
  category: keyof typeof ACTIVITY_CATEGORY_COLORS;
  /** I task di questo tipo sono incontri e possono raccogliere note di altri task. */
  isMeeting?: boolean;
}> = [
  // Amministrative
  { name: "Scadenza fiscale", category: "ADMIN" },
  { name: "Emissione fattura", category: "ADMIN" },
  { name: "Registrazione fattura", category: "ADMIN" },
  { name: "Pagamento / F24", category: "ADMIN" },
  { name: "Adempimento", category: "ADMIN" },
  { name: "Contratto / Rinnovo", category: "ADMIN" },
  { name: "Attività amministrativa", category: "ADMIN" },
  { name: "Documento / Archiviazione", category: "ADMIN" },
  // Commerciali
  { name: "Telefonata", category: "SALES" },
  { name: "Email", category: "SALES" },
  { name: "Prendere appuntamento", category: "SALES" },
  { name: "Appuntamento / Meeting", category: "SALES", isMeeting: true },
  { name: "Invia preventivo", category: "SALES" },
  { name: "Invia offerta", category: "SALES" },
  { name: "Follow-up", category: "SALES" },
  { name: "Trattativa", category: "SALES" },
  { name: "Demo / Presentazione", category: "SALES" },
  { name: "Sopralluogo", category: "SALES" },
  // Sviluppo
  { name: "Sviluppo", category: "DEV" },
  { name: "Fix / Bug", category: "DEV" },
  { name: "Fix da ticket", category: "DEV" },
  { name: "Test", category: "DEV" },
  { name: "Code review", category: "DEV" },
  { name: "Deploy / Rilascio", category: "DEV" },
  { name: "Analisi / Specifiche", category: "DEV" },
  { name: "Documentazione", category: "DEV" },
  // Generali
  { name: "Attività generica", category: "GENERAL" },
  { name: "Riunione", category: "GENERAL", isMeeting: true },
  { name: "Da definire", category: "GENERAL" },
];

// Fasi pipeline offerte di default (vedi CLAUDE.md), riordinabili dall'admin.
const DEAL_STAGES = [
  { name: "Contatto a freddo", color: "#94a3b8", isWon: false, isLost: false },
  { name: "Lead qualificato", color: "#60a5fa", isWon: false, isLost: false },
  { name: "Appuntamento", color: "#38bdf8", isWon: false, isLost: false },
  { name: "Preventivo inviato", color: "#818cf8", isWon: false, isLost: false },
  { name: "Offerta", color: "#a78bfa", isWon: false, isLost: false },
  { name: "Trattativa", color: "#f59e0b", isWon: false, isLost: false },
  { name: "Vinta", color: "#22c55e", isWon: true, isLost: false },
  { name: "Persa", color: "#ef4444", isWon: false, isLost: true },
  // "Fatturata" rimossa: l'automazione passa da "Vinta" (che genera il task
  // amministrativo); una fase successiva duplicava il concetto senza usi.
  { name: "Sospesa", color: "#6b7280", isWon: false, isLost: false },
] as const;

const DEMO_USERS = [
  {
    email: "admin@kancrm.local",
    name: "Amministratore",
    role: UserRole.ADMIN,
    password: "admin1234",
    groups: ["Tutti", "Amministrativo"],
  },
  {
    email: "anna.bianchi@kancrm.local",
    name: "Anna Bianchi",
    role: UserRole.MEMBER,
    password: "demo1234",
    groups: ["Tutti", "Amministrativo"],
  },
  {
    email: "luca.verdi@kancrm.local",
    name: "Luca Verdi",
    role: UserRole.MEMBER,
    password: "demo1234",
    groups: ["Tutti", "Commerciale"],
  },
  {
    email: "marco.neri@kancrm.local",
    name: "Marco Neri",
    role: UserRole.MEMBER,
    password: "demo1234",
    groups: ["Sviluppatori"],
  },
] as const;

/**
 * Semina **solo la struttura**: stati, fasi, tipi di attività, gruppi.
 *
 * Serve a un'installazione nuova che deve partire vuota — l'ambiente di
 * dimostrazione, per esempio, dove i record li carica poi chi la usa. Senza
 * questa distinzione l'unico modo di avere un database funzionante sarebbe
 * prendersi anche gli utenti fittizi e le aziende di esempio, e poi cancellarli
 * a mano: una pulizia che si dimentica sempre a metà.
 */
const MINIMAL = process.env.SEED_MINIMAL === "1";

async function main(): Promise<void> {
  await initDb();

  // Installazioni esistenti: il vecchio gruppo "Amministrazione" diventa "Amministrativo".
  const legacy = await prisma.group.findUnique({ where: { name: "Amministrazione" } });
  if (legacy && !(await prisma.group.findUnique({ where: { name: "Amministrativo" } }))) {
    await prisma.group.update({ where: { id: legacy.id }, data: { name: "Amministrativo" } });
  }

  const groupIds = new Map<string, string>();
  for (const name of GROUPS) {
    const group = await prisma.group.upsert({ where: { name }, update: {}, create: { name } });
    groupIds.set(name, group.id);
  }

  for (const demo of MINIMAL ? [] : DEMO_USERS) {
    const passwordHash = await hashPassword(demo.password);
    const user = await prisma.user.upsert({
      where: { email: demo.email },
      // Non sovrascrivere la password di utenti già esistenti (seed idempotente).
      update: { name: demo.name, role: demo.role, isActive: true },
      create: {
        email: demo.email,
        name: demo.name,
        role: demo.role,
        authProvider: AuthProvider.LOCAL,
        passwordHash,
      },
    });
    for (const groupName of demo.groups) {
      const groupId = groupIds.get(groupName);
      if (!groupId) continue;
      await prisma.groupMember.upsert({
        where: { groupId_userId: { groupId, userId: user.id } },
        update: {},
        create: { groupId, userId: user.id },
      });
    }
  }

  // L'ordine è relativo alla categoria: riparte da 0 a ogni gruppo.
  const statusOrder = new Map<string, number>();
  for (const status of TASK_STATUSES) {
    const order = statusOrder.get(status.category) ?? 0;
    statusOrder.set(status.category, order + 1);
    await prisma.taskStatus.upsert({
      where: { category_name: { category: status.category, name: status.name } },
      update: { color: status.color, isClosed: status.isClosed },
      create: { ...status, order },
    });
  }

  for (const [index, type] of ACTIVITY_TYPES.entries()) {
    const color = ACTIVITY_CATEGORY_COLORS[type.category];
    await prisma.activityType.upsert({
      where: { name: type.name },
      update: { category: type.category, color, isMeeting: type.isMeeting ?? false },
      create: {
        name: type.name,
        category: type.category,
        color,
        order: index,
        isMeeting: type.isMeeting ?? false,
      },
    });
  }

  // Un paio di task demo, solo alla prima esecuzione (e mai con SEED_MINIMAL).
  const taskCount = MINIMAL ? -1 : await prisma.task.count();
  if (taskCount === 0) {
    const admin = await prisma.user.findUniqueOrThrow({ where: { email: "admin@kancrm.local" } });
    const anna = await prisma.user.findUniqueOrThrow({
      where: { email: "anna.bianchi@kancrm.local" },
    });
    const daAssegnare = await prisma.taskStatus.findUniqueOrThrow({
      where: { category_name: { category: ActivityCategory.ADMIN, name: "Da assegnare" } },
    });
    const inEsecuzione = await prisma.taskStatus.findUniqueOrThrow({
      where: { category_name: { category: ActivityCategory.ADMIN, name: "In esecuzione" } },
    });
    const inSettimana = new Date();
    inSettimana.setUTCDate(inSettimana.getUTCDate() + 7);
    inSettimana.setUTCHours(0, 0, 0, 0);

    await prisma.task.create({
      data: {
        kind: TaskKind.ADMIN,
        title: "Versamento F24 mensile",
        description: "Preparare e inviare il modello F24 per i contributi del mese.",
        statusId: inEsecuzione.id,
        creatorId: admin.id,
        assigneeId: anna.id,
        supervisorId: admin.id,
        dueDate: inSettimana,
        activities: { create: { userId: admin.id, action: "created" } },
      },
    });
    await prisma.task.create({
      data: {
        kind: TaskKind.ADMIN,
        title: "Rinnovo polizza RC aziendale",
        statusId: daAssegnare.id,
        creatorId: admin.id,
        activities: { create: { userId: admin.id, action: "created" } },
      },
    });
  }

  for (const [index, stage] of DEAL_STAGES.entries()) {
    await prisma.dealStage.upsert({
      where: { name: stage.name },
      update: {
        color: stage.color,
        isWon: stage.isWon,
        isLost: stage.isLost,
      },
      create: { ...stage, order: index },
    });
  }

  // Visibilità default per i profili aziendali (configurabile dalla pagina Gruppi):
  //  - Commerciale (= Vendite): offerte in accesso completo (crea e modifica le
  //    proprie), persone; lo scadenzario resta personale.
  //  - Amministrativo: offerte in sola lettura (READ), ticket; scadenzario personale,
  //    timesheet (sempre visibile agli interni).
  //  - Sviluppatori: nessuno scope CRM/scadenzario → vedono progetti, il proprio
  //    scadenzario e solo le aziende dei propri progetti.
  // Lo scope ADMIN_TASKS significa "vede TUTTO lo scadenzario": di default nessun
  // gruppo lo ha (ognuno vede i propri task); assegnalo a chi coordina l'ufficio.
  const FULL = VisibilityAccess.FULL;
  const READ = VisibilityAccess.READ;
  const visibilityDefaults: Array<[string, Array<[VisibilityScope, VisibilityAccess]>]> = [
    [
      "Commerciale",
      [
        [VisibilityScope.DEALS, FULL],
        [VisibilityScope.CONTACTS, FULL],
      ],
    ],
    [
      "Amministrativo",
      [
        [VisibilityScope.DEALS, READ],
        [VisibilityScope.TICKETS, FULL],
      ],
    ],
  ];
  for (const [groupName, scopes] of visibilityDefaults) {
    const groupId = groupIds.get(groupName);
    if (!groupId) continue;
    for (const [scope, access] of scopes) {
      await prisma.visibilitySetting.upsert({
        where: { scope_groupId: { scope, groupId } },
        update: { access },
        create: { scope, groupId, access },
      });
    }
  }

  // Dati CRM demo, solo alla prima esecuzione (e mai con SEED_MINIMAL).
  const companyCount = MINIMAL ? -1 : await prisma.company.count();
  if (companyCount === 0) {
    const admin = await prisma.user.findUniqueOrThrow({ where: { email: "admin@kancrm.local" } });
    const acme = await prisma.company.create({
      data: { name: "ACME S.r.l.", vatNumber: "IT01234567890", city: "Milano" },
    });
    const rossi = await prisma.contact.create({
      data: {
        firstName: "Paolo",
        lastName: "Rossi",
        email: "paolo.rossi@acme.example",
        phone: "+39 02 1234567",
        roleTitle: "Direttore acquisti",
        companyId: acme.id,
      },
    });
    const trattativa = await prisma.dealStage.findUniqueOrThrow({ where: { name: "Trattativa" } });
    const initialStatus = await prisma.taskStatus.findFirstOrThrow({
      where: { category: ActivityCategory.GENERAL },
      orderBy: { order: "asc" },
    });
    await prisma.task.create({
      data: {
        kind: TaskKind.DEAL,
        title: "Fornitura gestionale 2027",
        statusId: initialStatus.id,
        creatorId: admin.id,
        dealStageId: trattativa.id,
        companyId: acme.id,
        contactId: rossi.id,
        dealValue: 25000,
        probability: 60,
        expectedCloseDate: new Date(Date.UTC(new Date().getUTCFullYear(), 11, 15)),
        activities: { create: { userId: admin.id, action: "created" } },
      },
    });
  }

  // Progetto demo con task e subtask, solo alla prima esecuzione (mai con SEED_MINIMAL).
  const projectCount = MINIMAL ? -1 : await prisma.project.count();
  if (projectCount === 0) {
    const admin = await prisma.user.findUniqueOrThrow({ where: { email: "admin@kancrm.local" } });
    const anna = await prisma.user.findUniqueOrThrow({
      where: { email: "anna.bianchi@kancrm.local" },
    });
    const luca = await prisma.user.findUniqueOrThrow({
      where: { email: "luca.verdi@kancrm.local" },
    });
    const marco = await prisma.user.findUnique({
      where: { email: "marco.neri@kancrm.local" },
    });
    const acme = await prisma.company.findUnique({ where: { name: "ACME S.r.l." } });
    const initialStatus = await prisma.taskStatus.findFirstOrThrow({
      where: { category: ActivityCategory.GENERAL },
      orderBy: { order: "asc" },
    });
    const project = await prisma.project.create({
      data: {
        name: "Sito web aziendale",
        description: "Restyling del sito con nuovo CMS.",
        companyId: acme?.id ?? null,
        members: {
          create: [
            { userId: admin.id, role: ProjectRole.MANAGER },
            { userId: anna.id, role: ProjectRole.EDITOR },
            { userId: luca.id, role: ProjectRole.VIEWER },
            ...(marco ? [{ userId: marco.id, role: ProjectRole.EDITOR }] : []),
          ],
        },
      },
    });
    const parent = await prisma.task.create({
      data: {
        kind: TaskKind.PROJECT,
        title: "Definire la struttura dei contenuti",
        statusId: initialStatus.id,
        creatorId: admin.id,
        assigneeId: anna.id,
        projectId: project.id,
        activities: { create: { userId: admin.id, action: "created" } },
      },
    });
    for (const subtitle of ["Mappa del sito", "Bozza testi home page"]) {
      await prisma.task.create({
        data: {
          kind: TaskKind.PROJECT,
          title: subtitle,
          statusId: initialStatus.id,
          creatorId: admin.id,
          projectId: project.id,
          parentTaskId: parent.id,
          activities: { create: { userId: admin.id, action: "created" } },
        },
      });
    }
  }

  // Qualche ora demo nel timesheet di Anna, solo alla prima esecuzione (mai con SEED_MINIMAL).
  const entryCount = MINIMAL ? -1 : await prisma.timeEntry.count();
  if (entryCount === 0) {
    const anna = await prisma.user.findUniqueOrThrow({
      where: { email: "anna.bianchi@kancrm.local" },
    });
    const f24 = await prisma.task.findFirst({ where: { title: "Versamento F24 mensile" } });
    if (f24) {
      const today = new Date();
      for (const [offset, hours] of [
        [-1, 2],
        [0, 1.5],
      ] as const) {
        const date = new Date(
          Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate() + offset),
        );
        await prisma.timeEntry.create({
          data: { userId: anna.id, taskId: f24.id, date, hours },
        });
      }
    }
  }

  // Utente portale demo (cliente ACME) + un ticket, solo alla prima esecuzione.
  const portalCount = await prisma.user.count({ where: { role: UserRole.PORTAL } });
  if (portalCount === 0) {
    const acme = await prisma.company.findUnique({ where: { name: "ACME S.r.l." } });
    const portalUser = await prisma.user.create({
      data: {
        email: "cliente@acme.example",
        name: "Carla Cliente",
        role: UserRole.PORTAL,
        authProvider: AuthProvider.LOCAL,
        passwordHash: await hashPassword("cliente1234"),
        companyId: acme?.id ?? null,
      },
    });
    const initialStatus = await prisma.taskStatus.findFirstOrThrow({
      where: { category: ActivityCategory.GENERAL },
      orderBy: { order: "asc" },
    });
    await prisma.task.create({
      data: {
        kind: TaskKind.TICKET,
        title: "Errore stampa etichette dal gestionale",
        description:
          "Convertito dal nostro osTicket #4821: il cliente finale segnala errore in stampa.",
        statusId: initialStatus.id,
        creatorId: portalUser.id,
        ticketPriority: "HIGH",
        ticketRef: "osTicket #4821",
        activities: { create: { userId: portalUser.id, action: "created" } },
      },
    });
  }

  // Ricorrenza demo: "ogni 16 del mese", solo alla prima esecuzione (mai con SEED_MINIMAL).
  const templateCount = MINIMAL ? -1 : await prisma.recurrenceTemplate.count();
  if (templateCount === 0) {
    const admin = await prisma.user.findUniqueOrThrow({ where: { email: "admin@kancrm.local" } });
    const anna = await prisma.user.findUniqueOrThrow({
      where: { email: "anna.bianchi@kancrm.local" },
    });
    const startOfYear = new Date(new Date().getUTCFullYear(), 0, 1);
    const template = await prisma.recurrenceTemplate.create({
      data: {
        title: "Versamento IVA mensile",
        description: "Liquidazione e versamento IVA del mese precedente (F24 entro il 16).",
        rrule: "FREQ=MONTHLY;BYMONTHDAY=16",
        dtstart: new Date(Date.UTC(startOfYear.getFullYear(), 0, 16)),
        creatorId: admin.id,
        assigneeId: anna.id,
        supervisorId: admin.id,
      },
    });
    await materializeTemplate(template.id);
  }

  console.log(
    "Seed completato: gruppi, utenti, stati, fasi pipeline, visibilità, CRM demo, ricorrenza demo.",
  );
  console.log("Login admin: admin@kancrm.local / admin1234");
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
