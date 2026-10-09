import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Plus, Tag as TagIcon, X } from "lucide-react";
import type { TagRef } from "@kancrm/shared";
import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";
import { useCreateTag, useTags } from "./useTags";

/**
 * Editor dei tag di un task: mostra i tag applicati come chip removibili e permette
 * di aggiungerne cercando tra quelli esistenti o creandone di nuovi al volo.
 */
export function TagPicker({
  value,
  onChange,
}: {
  value: TagRef[];
  onChange: (tags: TagRef[]) => void;
}) {
  const { t } = useTranslation();
  const { data: allTags } = useTags();
  const createTag = useCreateTag();
  // L'ultimo valore e l'ultimo `onChange`: li legge la catena di creazione,
  // che può concludersi a componente smontato.
  const ultimoValore = useRef(value);
  const ultimoOnChange = useRef(onChange);
  ultimoValore.current = value;
  ultimoOnChange.current = onChange;
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);

  const appliedIds = new Set(value.map((t) => t.id));
  const needle = q.trim().toLowerCase();
  const suggestions = (allTags ?? [])
    .filter((t) => !appliedIds.has(t.id) && (!needle || t.name.toLowerCase().includes(needle)))
    .slice(0, 20);
  const trimmed = q.trim();
  const exact = (allTags ?? []).some((t) => t.name.toLowerCase() === trimmed.toLowerCase());

  const add = (tag: TagRef) => {
    if (!appliedIds.has(tag.id)) onChange([...value, tag]);
    setQ("");
    setOpen(false);
  };
  const remove = (id: string) => onChange(value.filter((t) => t.id !== id));

  /**
   * **Creare e applicare sono un gesto solo, e il secondo non deve dipendere
   * dal pannello ancora aperto.** Prima l'applicazione stava nell'`onSuccess`
   * passato a `mutate`, e React Query **non lo chiama** se il componente si è
   * smontato nel frattempo: chi scriveva il tag, premeva Invio e chiudeva il
   * pannello con Esc si ritrovava il tag creato ma non messo sul task —
   * senza un errore da nessuna parte (05/09/2026, visto da uno scenario e2e
   * che passava tre volte su cinque). La catena di promesse invece vive da
   * sola; `onChange` arriva dall'ultimo render tramite un ref.
   */
  const createAndAdd = () => {
    if (!trimmed || createTag.isPending) return;
    setQ("");
    setOpen(false);
    void createTag
      .mutateAsync({ name: trimmed })
      .then((tag) => {
        const attuali = ultimoValore.current;
        if (!attuali.some((x) => x.id === tag.id)) {
          ultimoOnChange.current([...attuali, { id: tag.id, name: tag.name, color: tag.color }]);
        }
      })
      .catch(() => undefined); // l'errore lo mostra la mutation (isError), non qui
  };

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex flex-wrap items-center gap-1.5">
        {value.map((tag) => (
          <span
            key={tag.id}
            className="inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs"
            style={tag.color ? { borderColor: tag.color, color: tag.color } : undefined}
          >
            <TagIcon className="size-3" />
            {tag.name}
            <button
              type="button"
              aria-label={t("Togli il tag {{name}}", { name: tag.name })}
              className="hover:text-foreground"
              onClick={() => remove(tag.id)}
            >
              <X className="size-3" />
            </button>
          </span>
        ))}
        {value.length === 0 && (
          <span className="text-xs text-muted-foreground">{t("Nessun tag")}</span>
        )}
      </div>

      <div className="relative">
        <Input
          placeholder={t("Aggiungi un tag…")}
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setOpen(true);
          }}
          data-no-autofocus
          onFocus={() => setOpen(true)}
          onBlur={() => setTimeout(() => setOpen(false), 150)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && trimmed && !exact) {
              e.preventDefault();
              createAndAdd();
            }
          }}
        />
        {open && (suggestions.length > 0 || (trimmed && !exact)) && (
          <ul className="absolute z-20 mt-1 max-h-56 w-full overflow-y-auto rounded-md border bg-popover p-1 shadow-md">
            {suggestions.map((tag) => (
              <li key={tag.id}>
                <button
                  type="button"
                  className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm hover:bg-accent"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => add({ id: tag.id, name: tag.name, color: tag.color })}
                >
                  <TagIcon
                    className={cn("size-3.5 shrink-0", !tag.color && "text-muted-foreground")}
                    style={tag.color ? { color: tag.color } : undefined}
                  />
                  <span className="flex-1 truncate">{tag.name}</span>
                  <span className="text-xs text-muted-foreground">{tag.taskCount}</span>
                </button>
              </li>
            ))}
            {trimmed && !exact && (
              <li>
                <button
                  type="button"
                  className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm hover:bg-accent"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={createAndAdd}
                >
                  <Plus className="size-3.5 shrink-0" />
                  <span>
                    {t("Crea tag")} “<span className="font-medium">{trimmed}</span>”
                  </span>
                </button>
              </li>
            )}
          </ul>
        )}
      </div>
    </div>
  );
}
