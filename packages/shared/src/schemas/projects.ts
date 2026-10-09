import { z } from "zod";
import { weekStartOf } from "../timesheet-period";
import { weekString } from "./timesheet";
import { ProjectRole } from "../enums";

/** Come si chiamano i ruoli di progetto quando li legge una persona. */
export const PROJECT_ROLE_LABELS: Record<ProjectRole, string> = {
  MANAGER: "Manager",
  EDITOR: "Editor",
  VIEWER: "Visualizzatore",
};
import { dateOnly, userRefSchema } from "./tasks";

/**
 * Palette fissa per il bordo della card di progetto. Sono chiavi neutre: la
 * mappatura al colore effettivo (classi Tailwind) vive nel frontend, così lo
 * schema non dipende dalla UI. `null` = bordo grigio di default.
 */
export const PROJECT_COLORS = [
  "slate",
  "rose",
  "orange",
  "amber",
  "lime",
  "emerald",
  "teal",
  "sky",
  "blue",
  "violet",
  "fuchsia",
  "stone",
] as const;
export type ProjectColor = (typeof PROJECT_COLORS)[number];

/**
 * Icone selezionabili per un progetto (nomi di icone lucide-react), raggruppate
 * per tema. Il gruppo serve due volte: intesta la sezione nel picker ed è anche
 * cercabile — digitando "sicurezza" si trovano lo scudo e il lucchetto, senza
 * dover tradurre trecento nomi inglesi uno per uno. Il frontend mappa il nome al
 * componente; qui teniamo solo la stringa validata.
 */
export const PROJECT_ICON_GROUPS = [
  {
    label: "Sviluppo",
    icons: [
      "FolderKanban",
      "Folder",
      "Code",
      "SquareTerminal",
      "Terminal",
      "Bug",
      "BugPlay",
      "GitBranch",
      "GitMerge",
      "GitPullRequest",
      "GitCommitHorizontal",
      "GitFork",
      "Binary",
      "Braces",
      "Brackets",
      "Regex",
      "FileCode",
      "Component",
      "Blocks",
      "Workflow",
      "Bot",
      "Container",
      "Cpu",
      "Layers",
      "Puzzle",
      "Rocket",
      "Zap",
      "Bolt",
      "FlaskConical",
      "TestTube",
      "Microscope",
      "Atom",
      "Sparkles",
    ],
  },
  {
    label: "Dati e rete",
    icons: [
      "Database",
      "Server",
      "ServerCog",
      "HardDrive",
      "Cloud",
      "CloudCog",
      "CloudUpload",
      "CloudDownload",
      "Network",
      "Webhook",
      "Plug",
      "Unplug",
      "Cable",
      "Wifi",
      "Router",
      "Antenna",
      "Signal",
      "Satellite",
      "SatelliteDish",
      "Globe",
      "Link",
      "Link2",
      "Share2",
      "Rss",
      "Gauge",
      "Activity",
      "Radar",
    ],
  },
  {
    label: "Dispositivi",
    icons: [
      "Monitor",
      "MonitorPlay",
      "MonitorSmartphone",
      "Smartphone",
      "Tablet",
      "TabletSmartphone",
      "Laptop",
      "Watch",
      "Keyboard",
      "Mouse",
      "Printer",
      "Projector",
      "Tv",
      "Radio",
      "Camera",
      "Video",
      "Mic",
      "Headphones",
      "Speaker",
      "Disc",
      "Usb",
      "Battery",
      "Plug2",
    ],
  },
  {
    label: "Design e media",
    icons: [
      "Palette",
      "PenTool",
      "Brush",
      "Paintbrush",
      "PaintBucket",
      "Pipette",
      "Ruler",
      "Crop",
      "Frame",
      "Image",
      "Images",
      "Film",
      "Clapperboard",
      "Music",
      "Music2",
      "Type",
      "Shapes",
      "Figma",
      "LayoutGrid",
      "LayoutDashboard",
      "LayoutTemplate",
      "Wallpaper",
    ],
  },
  {
    label: "Business e vendite",
    icons: [
      "Briefcase",
      "Building",
      "Building2",
      "Factory",
      "Store",
      "Warehouse",
      "Landmark",
      "ShoppingCart",
      "ShoppingBag",
      "ShoppingBasket",
      "CreditCard",
      "Wallet",
      "Banknote",
      "Coins",
      "HandCoins",
      "PiggyBank",
      "Receipt",
      "Euro",
      "DollarSign",
      "Percent",
      "Calculator",
      "Scale",
      "TrendingUp",
      "TrendingDown",
      "ChartBar",
      "ChartLine",
      "ChartPie",
      "ChartColumn",
      "Handshake",
      "Ticket",
    ],
  },
  {
    label: "Persone e comunicazione",
    icons: [
      "Users",
      "UsersRound",
      "User",
      "UserCheck",
      "UserCog",
      "Contact",
      "MessageSquare",
      "MessagesSquare",
      "MessageCircle",
      "Mail",
      "MailOpen",
      "Send",
      "Phone",
      "PhoneCall",
      "Megaphone",
      "Presentation",
      "Bell",
      "BellRing",
      "Calendar",
      "CalendarDays",
      "CalendarCheck",
      "Clock",
      "Timer",
      "Hourglass",
    ],
  },
  {
    label: "Documenti e archivio",
    icons: [
      "FileText",
      "File",
      "Files",
      "FileCheck",
      "FileSpreadsheet",
      "FilePlus",
      "FileSearch",
      "FolderOpen",
      "FolderGit2",
      "Archive",
      "ArchiveRestore",
      "ClipboardList",
      "ClipboardCheck",
      "Notebook",
      "NotebookPen",
      "StickyNote",
      "Book",
      "BookOpen",
      "Library",
      "Newspaper",
      "Bookmark",
      "Paperclip",
      "Pin",
      "Tag",
      "Tags",
      "Barcode",
      "QrCode",
      "ScanLine",
      "Signature",
      "Stamp",
    ],
  },
  {
    label: "Sicurezza",
    icons: [
      "Shield",
      "ShieldCheck",
      "ShieldAlert",
      "Lock",
      "LockKeyhole",
      "Key",
      "KeyRound",
      "Fingerprint",
      "Eye",
      "EyeOff",
      "ScanFace",
      "CircleAlert",
      "TriangleAlert",
      "OctagonAlert",
      "BadgeCheck",
      "Award",
    ],
  },
  {
    label: "Strumenti",
    icons: [
      "Wrench",
      "Hammer",
      "Drill",
      "Axe",
      "Pickaxe",
      "Shovel",
      "Scissors",
      "Cog",
      "Settings",
      "Settings2",
      "Box",
      "Boxes",
      "Package",
      "PackageOpen",
      "Trash2",
      "Recycle",
      "Lamp",
      "Sofa",
      "Bed",
      "DoorOpen",
    ],
  },
  {
    label: "Luoghi e trasporti",
    icons: [
      "Map",
      "MapPin",
      "MapPinned",
      "Compass",
      "Navigation",
      "Route",
      "Plane",
      "Car",
      "Truck",
      "Ship",
      "Bike",
      "Fuel",
      "TrafficCone",
      "House",
      "Hotel",
      "School",
      "Hospital",
      "Church",
      "Tent",
      "Anchor",
      "Mountain",
      "Waves",
      "TreePine",
      "Leaf",
      "Sprout",
      "Sun",
      "Moon",
      "CloudSun",
      "Snowflake",
      "Umbrella",
      "Wind",
      "Droplet",
      "Flame",
    ],
  },
  {
    label: "Svago e varie",
    icons: [
      "Gamepad2",
      "Dices",
      "Popcorn",
      "Pizza",
      "Coffee",
      "CupSoda",
      "Utensils",
      "Cake",
      "Beer",
      "Wine",
      "Apple",
      "Carrot",
      "Dumbbell",
      "Swords",
      "Shirt",
      "Gift",
      "PartyPopper",
      "Baby",
      "Dog",
      "Cat",
      "Bird",
      "Fish",
      "Bone",
      "Stethoscope",
      "Pill",
      "Syringe",
      "Dna",
      "Brain",
      "Glasses",
      "Heart",
      "Star",
      "Flag",
      "Target",
      "Trophy",
      "Medal",
      "Crown",
      "Gem",
      "Lightbulb",
      "Hash",
      "AtSign",
      "Asterisk",
      "CircleDot",
      "Circle",
      "Square",
      "Triangle",
      "Hexagon",
      "Octagon",
      "Diamond",
      "Spade",
      "Club",
    ],
  },
] as const;

export type ProjectIcon = (typeof PROJECT_ICON_GROUPS)[number]["icons"][number];

/** Tutte le icone in un elenco solo: validazione degli input e ricerca. */
export const PROJECT_ICONS = PROJECT_ICON_GROUPS.flatMap((group) => group.icons) as unknown as [
  ProjectIcon,
  ...ProjectIcon[],
];

export const projectMemberSchema = z.object({
  user: userRefSchema,
  role: z.nativeEnum(ProjectRole),
});
export type ProjectMemberInfo = z.infer<typeof projectMemberSchema>;

export const projectListItemSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  color: z.enum(PROJECT_COLORS).nullable(),
  icon: z.enum(PROJECT_ICONS).nullable(),
  isArchived: z.boolean(),
  members: z.array(projectMemberSchema),
  /** Azienda cliente collegata al progetto. */
  company: z.object({ id: z.string(), name: z.string() }).nullable(),
  /**
   * Offerta da cui il progetto nasce (o a cui è stato legato a mano). Il
   * collegamento è **uno solo**, e vive su `Task.relatedProjectId` dell'offerta:
   * qui si legge, non si duplica.
   */
  deal: z.object({ id: z.string(), title: z.string() }).nullable(),
  taskCount: z.number().int(),
  closedTaskCount: z.number().int(),
  /** Ruolo dell'utente corrente nel progetto (null per l'ADMIN non membro). */
  myRole: z.nativeEnum(ProjectRole).nullable(),
  /** Scadenza del primo task aperto del progetto assegnato all'utente (per ordinare). */
  myNextDueDate: dateOnly.nullable(),
  /** Numero di task aperti assegnati all'utente in questo progetto. */
  myOpenTaskCount: z.number().int(),
  /** Ultima volta che un task del progetto è stato assegnato all'utente (ISO), per ordinare. */
  myLastAssignedAt: z.string().nullable(),
  /**
   * Ultima volta che l'utente ci ha *lavorato*: una modifica, un commento o
   * delle ore su un task del progetto (ISO). È il segnale di "sto lavorando
   * qui", che l'assegnazione da sola non dà.
   */
  myLastActivityAt: z.string().nullable(),
  /**
   * Di questo progetto vedi **solo i tuoi task**: ci sei dentro per
   * coinvolgimento (hai lavoro qui) ma non sei membro. Lo dice il server perché
   * dal browser non si può dedurre — un admin elevato non è membro e vede
   * tutto, uno non elevato non è membro e vede i propri.
   *
   * Serve dove la differenza cambia il senso di quello che si legge: una nota
   * di rilascio ricavata da un task su quaranta non è una nota parziale, è una
   * nota sbagliata.
   */
  onlyOwnTasks: z.boolean().optional(),
  /**
   * Task più recente del progetto, di chiunque sia (ISO della creazione): dice
   * quanto è vivo un progetto dove non ho né scadenze né lavoro mio.
   */
  lastTaskCreatedAt: z.string().nullable(),
});
export type ProjectListItem = z.infer<typeof projectListItemSchema>;

/** Ordine manuale dei progetti nella vista dell'utente (array di projectId). */
export const updateProjectOrderSchema = z.object({
  order: z.array(z.string()).max(1000),
});
export type UpdateProjectOrderInput = z.infer<typeof updateProjectOrderSchema>;

export const createProjectSchema = z.object({
  name: z.string().min(1).max(200),
  description: z.string().max(20000).nullish(),
  companyId: z.string().nullish(),
  /** Offerta di provenienza: la sceglie chi crea il progetto a mano. */
  dealId: z.string().nullish(),
  color: z.enum(PROJECT_COLORS).nullish(),
  icon: z.enum(PROJECT_ICONS).nullish(),
});
export type CreateProjectInput = z.infer<typeof createProjectSchema>;

export const updateProjectSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  description: z.string().max(20000).nullish(),
  isArchived: z.boolean().optional(),
  companyId: z.string().nullish(),
  /** null stacca l'offerta; un id la (ri)collega, staccando le altre. */
  dealId: z.string().nullish(),
  color: z.enum(PROJECT_COLORS).nullish(),
  icon: z.enum(PROJECT_ICONS).nullish(),
});
export type UpdateProjectInput = z.infer<typeof updateProjectSchema>;

export const updateProjectMembersSchema = z.object({
  members: z
    .array(z.object({ userId: z.string(), role: z.nativeEnum(ProjectRole) }))
    .min(1, "Il progetto deve avere almeno un membro"),
});
export type UpdateProjectMembersInput = z.infer<typeof updateProjectMembersSchema>;

/** Codice errore (409): chiusura di un task padre con subtask aperti. */
export const SUBTASKS_OPEN = "SUBTASKS_OPEN";

/**
 * La richiesta di una **nota di rilascio**: stato e settimana (il progetto sta
 * nell'indirizzo). La settimana si indica con il suo lunedì — `weekString` lo
 * verifica: un mercoledì non è la settimana di nessuno.
 *
 * È una POST e non una GET perché non restituisce il documento: avvia un lavoro
 * che finirà in una casella di posta. Il verbo dice cosa succede.
 */
export const releaseNoteRequestSchema = z.object({
  statusId: z.string().min(1),
  week: weekString,
});
export type ReleaseNoteRequest = z.infer<typeof releaseNoteRequestSchema>;

/**
 * **Newsletter per gli utenti** (18/09/2026): i task **rilasciati** nella
 * settimana, riscritti per chi usa il prodotto. A differenza della nota di
 * rilascio può unire **più progetti** — un prodotto vive spesso su più di uno,
 * come «Atlante» ed «Atlante - Customer care» — e ognuno si controlla a parte.
 */
/**
 * **Quanto dura il periodo della newsletter** (22/09/2026): una settimana, due
 * settimane contigue a partire dal lunedì scelto, o un mese di calendario.
 * L'inizio si indica sempre con `week`: un lunedì per le prime due, il primo
 * del mese per la terza.
 */
export const DURATE_NEWSLETTER = ["settimana", "due-settimane", "mese"] as const;
export type DurataNewsletter = (typeof DURATE_NEWSLETTER)[number];

export const releaseNewsletterRequestSchema = z
  .object({
    projectIds: z.array(z.string().min(1)).min(1).max(10),
    statusId: z.string().min(1),
    /** L'inizio del periodo: un lunedì, o il primo del mese quando dura un mese. */
    week: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Formato data non valido (YYYY-MM-DD)"),
    durata: z.enum(DURATE_NEWSLETTER).default("settimana"),
  })
  .superRefine((valore, ctx) => {
    const lunedi = valore.durata !== "mese";
    if (lunedi && weekStartOf(valore.week) !== valore.week) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["week"], message: "La settimana si indica con il suo lunedì" });
    }
    if (!lunedi && !valore.week.endsWith("-01")) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["week"], message: "Il mese si indica con il suo primo giorno" });
    }
  });
export type ReleaseNewsletterRequest = z.infer<typeof releaseNewsletterRequestSchema>;

/**
 * La newsletter **dai task spuntati nel report**: niente settimana e niente
 * stato, perché la scelta l'ha già fatta una persona. Il tetto è lo stesso
 * numero di task che regge la newsletter della settimana: oltre, il modello ci
 * metterebbe più di quanto chiunque aspetti.
 */
export const newsletterDaTaskRequestSchema = z.object({
  projectId: z.string().min(1),
  taskIds: z.array(z.string().min(1)).min(1).max(60),
});
export type NewsletterDaTaskRequest = z.infer<typeof newsletterDaTaskRequestSchema>;

/**
 * Lo stato di una generazione in coda. `removing` è il tempo fra "ferma" e
 * "fermato": la richiesta in volo va interrotta e il ciclo si chiude al task
 * successivo, quindi qualche secondo passa — dirlo è meglio che fingere che il
 * pulsante sia istantaneo.
 */
export const RELEASE_NOTE_JOB_STATES = [
  "queue",
  "running",
  "generating",
  "removing",
  "done",
  "failed",
  "cancelled",
] as const;
export type ReleaseNoteJobState = (typeof RELEASE_NOTE_JOB_STATES)[number];

/** Una riga del pannello della coda. */
export const releaseNoteJobSchema = z.object({
  id: z.string(),
  state: z.enum(RELEASE_NOTE_JOB_STATES),
  userId: z.string(),
  userName: z.string(),
  projectId: z.string(),
  projectName: z.string(),
  statusName: z.string(),
  /** Il lunedì della settimana chiesta. */
  week: z.string(),
  requestedAt: z.string(),
});
export type ReleaseNoteJob = z.infer<typeof releaseNoteJobSchema>;

/**
 * **Una nota di rilascio in PDF** di un progetto (18/09/2026): il documento
 * che il cliente del portale legge e scarica accanto alle sue richieste. `id`
 * è quello dell'allegato: si apre con il lettore e i token di sempre.
 *
 * Titolo, data di pubblicazione, descrizione breve e visibilità li sceglie chi
 * la carica, e si cambiano dopo. Il portale mostra solo le note visibili la
 * cui data di pubblicazione è arrivata.
 */
export const releaseDocumentSchema = z.object({
  id: z.string(),
  title: z.string(),
  description: z.string().nullable(),
  /** Giorno di pubblicazione, YYYY-MM-DD. */
  publishedAt: dateOnly,
  isVisible: z.boolean(),
  /** Il nome del file, per chi lo scarica. */
  fileName: z.string(),
  size: z.number().nullable(),
  projectId: z.string(),
  projectName: z.string(),
});
export type ReleaseDocument = z.infer<typeof releaseDocumentSchema>;

/** I dati di una nota, al caricamento (insieme al file) e nelle modifiche. */
export const releaseDocumentInputSchema = z.object({
  title: z.string().trim().min(1, "Il titolo è obbligatorio").max(255),
  description: z
    .string()
    .trim()
    .max(1000)
    .nullable()
    .optional()
    .transform((value) => (value ? value : null)),
  publishedAt: dateOnly,
  isVisible: z.boolean(),
});
export type ReleaseDocumentInput = z.input<typeof releaseDocumentInputSchema>;

export const updateReleaseDocumentSchema = releaseDocumentInputSchema.partial();
export type UpdateReleaseDocumentInput = z.input<typeof updateReleaseDocumentSchema>;

/** Il titolo proposto dal nome del file: «Atlante_2.4.pdf» → «Atlante 2.4». */
export function releaseTitleFromFilename(filename: string): string {
  return filename
    .replace(/\.pdf$/i, "")
    .replace(/[_]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Solo PDF: è il formato in cui le note si pubblicano, e il lettore lo disegna. */
export function isReleaseDocumentPdf(filename: string, mimeType?: string | null): boolean {
  return (
    /\.pdf$/i.test(filename.trim()) &&
    (!mimeType || /^application\/(pdf|octet-stream)$/i.test(mimeType))
  );
}
