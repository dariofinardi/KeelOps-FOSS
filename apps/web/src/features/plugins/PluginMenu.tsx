import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { MoreHorizontal } from "lucide-react";
import { useEscapeToClose } from "@/lib/useEscapeToClose";
import { usePlugins } from "./usePlugins";
import { iconaDelPlugin } from "./plugin-icon";

/**
 * Il menu dei plugin: un bottone a tre puntini che elenca i plugin montati e
 * apre ciascuno dentro AppShell (`/estensioni/<nome>`). Dove serve il contesto
 * (`anchor` + `query`) si passano solo i plugin che dichiarano quell'ancora e
 * l'indirizzo porta il riferimento — è il canale del bottone di progetto.
 * Se non c'è nessun plugin da elencare, il bottone non esiste proprio.
 */
export function PluginMenu({
  anchor,
  query,
  label,
}: {
  /**
   * L'area di cui la pagina ospite è casa: OGNI plugin dichiara nel manifesto
   * di quale funzione è figlio (`anchors`), e qui passano solo i suoi. La
   * dichiara la pagina, non il menu: TasksMap è figlio dei progetti, il
   * connettore MCP del profilo utente.
   */
  anchor: string;
  /** Query string da portare al plugin (es. `progetto=<id>`). */
  query?: string;
  label?: string;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  useEscapeToClose(open, () => setOpen(false));

  const plugins = (usePlugins().data ?? []).filter((plugin) => plugin.anchors?.[anchor]);
  if (!plugins.length) return null;

  return (
    <div
      ref={root}
      className="relative"
      onBlur={(event) => {
        if (!root.current?.contains(event.relatedTarget as Node)) setOpen(false);
      }}
    >
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={label ?? t("Plugin")}
        title={label ?? t("Plugin")}
        onClick={() => setOpen((prev) => !prev)}
        className="flex h-9 w-9 items-center justify-center rounded-md border bg-background text-muted-foreground hover:text-foreground"
      >
        <MoreHorizontal className="size-4" />
      </button>
      {open && (
        <div
          role="menu"
          className="absolute right-0 top-full z-30 mt-1 min-w-44 rounded-md border bg-popover p-1 shadow-md"
        >
          {plugins.map((plugin) => {
            const Icon = iconaDelPlugin(plugin);
            return (
              // un link vero, non useNavigate: il menu vive anche in alberi
              // senza Router (i dom-test del profilo) e il percorso è dell'app
              <a
                key={plugin.nome}
                role="menuitem"
                href={`/estensioni/${plugin.nome}${query ? `?${query}` : ""}`}
                className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-sm hover:bg-accent"
                onClick={() => setOpen(false)}
              >
                <Icon className="size-4 text-muted-foreground" />
                {t(plugin.voce)}
              </a>
            );
          })}
        </div>
      )}
    </div>
  );
}
