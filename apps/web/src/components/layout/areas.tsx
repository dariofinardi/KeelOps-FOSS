import {
  CircleHelp,
  Contact,
  FolderKanban,
  HandCoins,
  Home,
  Hourglass,
  LayoutDashboard,
  LifeBuoy,
} from "lucide-react";

/**
 * Le aree dell'applicazione con la loro icona: **unico punto**.
 *
 * Le usa il menù di navigazione, e le deve usare ogni collegamento che porta a
 * un'area — per esempio i contatori sulle schede cliente ("3 progetti" → la
 * pagina Progetti). Quando l'icona era ripetuta a mano il contatore diceva
 * `</>` e il menù una cartella: la stessa destinazione con due segni diversi.
 *
 * `MODULE_META` (`features/tasks/TaskContext.tsx`) marca la **natura di un task**
 * dentro un elenco misto, e per il lavoro dei progetti prende l'icona da qui:
 * un task che arriva da un progetto e il collegamento all'area Progetti sono la
 * stessa destinazione, quindi lo stesso segno.
 */
export const AREAS = {
  home: { to: "/", label: "La mia giornata", icon: Home },
  tasks: { to: "/bacheche", label: "Bacheche", icon: LayoutDashboard },
  deals: { to: "/offerte", label: "Offerte", icon: HandCoins },
  projects: { to: "/progetti", label: "Progetti", icon: FolderKanban },
  tickets: { to: "/ticket", label: "Ticket", icon: LifeBuoy },
  timesheet: { to: "/timesheet", label: "Timesheet", icon: Hourglass },
  contacts: { to: "/contatti", label: "Contatti", icon: Contact },
  help: { to: "/guida", label: "Guida e versione", icon: CircleHelp },
} as const;

export type AreaKey = keyof typeof AREAS;
