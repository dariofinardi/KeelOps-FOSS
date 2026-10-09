import { PROJECT_ICON_GROUPS, type ProjectIcon } from "@kancrm/shared";

export interface IconGroup {
  label: string;
  icons: ProjectIcon[];
}

/**
 * Icone che corrispondono alla ricerca, raggruppate per tema (i gruppi che
 * restano vuoti spariscono).
 *
 * Cerca sia nel nome dell'icona sia nel tema del gruppo: i nomi di lucide sono
 * in inglese e l'interfaccia è in italiano, così "sicurezza" e "shield" portano
 * entrambi allo scudo senza dover tradurre trecento nomi. La ricerca vuota
 * restituisce tutto, nell'ordine dei temi.
 */
export function filterIconGroups(query: string): IconGroup[] {
  const needle = query.trim().toLowerCase();
  const groups: IconGroup[] = [];
  for (const group of PROJECT_ICON_GROUPS) {
    if (needle === "" || group.label.toLowerCase().includes(needle)) {
      groups.push({ label: group.label, icons: [...group.icons] });
      continue;
    }
    const icons = group.icons.filter((name) => name.toLowerCase().includes(needle));
    if (icons.length > 0) groups.push({ label: group.label, icons });
  }
  return groups;
}
