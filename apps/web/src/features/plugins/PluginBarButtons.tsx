import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { PluginBarraStato, PluginUiEntry } from "@kancrm/shared";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";
import { useEscapeToClose } from "@/lib/useEscapeToClose";
import { Button } from "@/components/ui/button";
import { usePlugins } from "./usePlugins";
import { iconaDelPlugin } from "./plugin-icon";
import { Cornice } from "./PluginPanel";
import { chiaveBarra } from "./barra";

/**
 * **I bottoni dei plugin nella barra in alto** (23/09/2026), fra la campanella
 * e il profilo: quelli che dichiarano `ui.barra` nel manifesto — oggi il
 * connettore MCP pro, con la pseudonimizzazione.
 *
 * Il core disegna e basta: l'icona del plugin, un pallino con il colore che il
 * plugin sceglie (`tono`), il battito quando il plugin dice che c'è stata
 * attività (`lampeggia`), e al clic un pannello che è una **pagina del
 * plugin**. Cosa vogliano dire colori e battiti lo decide chi li accende.
 *
 * Lo stato si rilegge quando il plugin manda un segnale sul canale in tempo
 * reale (`ctx.segnali.invia`, evento `plugin`), alla chiusura del pannello, e
 * comunque ogni minuto: se il canale cade, il bottone resta vero.
 */
export function PluginBarButtons() {
  const plugins = (usePlugins().data ?? []).filter((p) => p.barra);
  if (plugins.length === 0) return null;
  return (
    <>
      {plugins.map((p) => (
        <PluginBarButton key={p.nome} plugin={p} />
      ))}
    </>
  );
}

/** Il colore del pallino, per tono: `nessuno` = niente pallino. */
const COLORE: Record<PluginBarraStato["tono"], string | null> = {
  acceso: "#16a34a",
  spento: "#94a3b8",
  bloccato: "#d97706",
  nessuno: null,
};

function PluginBarButton({ plugin }: { plugin: PluginUiEntry }) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const barra = plugin.barra!;
  const [aperto, setAperto] = useState(false);
  const contenitore = useRef<HTMLDivElement>(null);
  const { data } = useQuery({
    queryKey: chiaveBarra(plugin.nome),
    queryFn: () => api<PluginBarraStato>(barra.statoUrl),
    refetchInterval: 60_000,
    // un plugin che non risponde non deve riempire la barra di errori: il bottone resta, senza pallino
    retry: false,
  });

  const chiudi = () => {
    setAperto(false);
    void queryClient.invalidateQueries({ queryKey: chiaveBarra(plugin.nome) });
  };
  useEscapeToClose(aperto, chiudi);
  useEffect(() => {
    if (!aperto) return;
    const fuori = (event: MouseEvent) => {
      if (contenitore.current && !contenitore.current.contains(event.target as Node)) chiudi();
    };
    document.addEventListener("mousedown", fuori);
    return () => document.removeEventListener("mousedown", fuori);
    // `chiudi` cambia a ogni render e fa sempre la stessa cosa
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [aperto]);

  const Icona = iconaDelPlugin({ icona: barra.icona, iconaUrl: barra.iconaUrl });
  const colore = data ? COLORE[data.tono] : null;
  const titolo = data?.titolo || plugin.titolo;

  return (
    <div className="relative" ref={contenitore}>
      <Button
        variant="ghost"
        size="icon"
        title={titolo}
        aria-label={titolo}
        aria-expanded={aperto}
        data-plugin-barra={plugin.nome}
        onClick={() => (aperto ? chiudi() : setAperto(true))}
      >
        <Icona className="size-4" />
        {colore && (
          <span
            data-tono={data?.tono}
            className={cn(
              "absolute right-1 top-1 size-2 rounded-full ring-2 ring-background",
              data?.lampeggia && "pallino-lampeggia",
            )}
            // il battito alterna il colore del testo e il bianco: il colore è quello del tono
            style={{ backgroundColor: colore, color: colore }}
          />
        )}
        {data?.lampeggia && <span className="sr-only">{t("Attività recente")}</span>}
      </Button>
      {aperto && (
        <div className="absolute right-0 top-11 z-50 w-[min(24rem,calc(100vw-1.5rem))] overflow-hidden rounded-lg border bg-popover text-popover-foreground shadow-lg">
          <Cornice
            nome={plugin.nome}
            titolo={plugin.titolo}
            anchor="barra"
            src={barra.pannelloUrl}
            senzaTitolo
          />
        </div>
      )}
    </div>
  );
}
