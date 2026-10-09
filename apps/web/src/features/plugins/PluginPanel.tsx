import { useEffect, useRef, useState } from "react";
import { usePlugins } from "./usePlugins";

/**
 * **Un'ancora che porta contenuto.** `PluginMenu` rende collegamenti; qui la
 * pagina di un plugin entra dentro una pagina nativa — il riquadro delle
 * bacheche personali nella giornata, quando «Personale» sarà un plugin.
 *
 * La cornice è la stessa di `PluginFrame` (iframe stessa-origine: cookie,
 * tema e lingua arrivano da soli), aperta con `?ancora=<nome>` così la pagina
 * sa di essere un riquadro e non l'intera schermata. L'altezza la dice la
 * pagina stessa, con `FRAME_RESIZE_SCRIPT` dell'SDK: un iframe non sa quanto
 * è alto il suo contenuto, e un'altezza fissa lascia o un buco o una barra di
 * scorrimento dentro un'altra.
 *
 * Senza plugin che dichiarino quell'ancora non si disegna niente: la pagina
 * ospite non deve sapere se ne esistono.
 */
/** I plugin che dichiarano un'ancora: per chi vuole disporre le cornici da sé (la giornata). */
export function usePluginEntries(anchor: string) {
  return (usePlugins().data ?? []).filter((plugin) => plugin.anchors?.[anchor]);
}

export function PluginPanel({
  anchor,
  query,
  senzaTitolo,
}: {
  anchor: string;
  query?: string;
  /** Dentro un riquadro che ha già la sua intestazione: solo la cornice. */
  senzaTitolo?: boolean;
}) {
  const plugins = (usePlugins().data ?? []).filter((plugin) => plugin.anchors?.[anchor]);
  if (!plugins.length) return null;
  return (
    <>
      {plugins.map((plugin) => (
        <Cornice
          key={`${plugin.nome}:${anchor}`}
          nome={plugin.nome}
          titolo={plugin.voce}
          anchor={anchor}
          query={query}
          senzaTitolo={senzaTitolo}
        />
      ))}
    </>
  );
}

export function Cornice({
  nome,
  titolo,
  anchor,
  query,
  senzaTitolo,
  onVuoto,
  src: srcDato,
}: {
  nome: string;
  titolo: string;
  anchor: string;
  query?: string;
  senzaTitolo?: boolean;
  /** La pagina ha detto se ha qualcosa da mostrare: chi la ospita può nascondere tutto il riquadro. */
  onVuoto?: (vuoto: boolean) => void;
  /** Una pagina del plugin diversa dalla sua radice (il pannello della barra). */
  src?: string;
}) {
  const [altezza, setAltezza] = useState(160);
  // La pagina può dire di non avere niente da mostrare (`keelops:vuoto`):
  // un riquadro vuoto nella giornata è rumore, non informazione (07/09/2026).
  const [vuoto, setVuoto] = useState(false);
  // Un riferimento, non un id: lo stesso plugin può stare in più riquadri
  // della stessa pagina (i gruppi della giornata), e un id si ripeterebbe.
  const cornice = useRef<HTMLIFrameElement>(null);
  const src =
    srcDato ??
    `/plugins/${encodeURIComponent(nome)}/?ancora=${encodeURIComponent(anchor)}${
      query ? `&${query}` : ""
    }`;

  useEffect(() => {
    // Solo messaggi della nostra origine, e solo quelli della forma attesa: un
    // iframe di terzi nella stessa pagina non deve poter ridimensionare questo.
    const ascolta = (event: MessageEvent) => {
      if (event.origin !== window.location.origin) return;
      const dati = event.data as { tipo?: string; altezza?: number; vuoto?: boolean } | null;
      if (cornice.current?.contentWindow !== event.source) return;
      if (dati?.tipo === "keelops:vuoto") {
        setVuoto(dati.vuoto === true);
        onVuoto?.(dati.vuoto === true);
        return;
      }
      if (dati?.tipo !== "keelops:altezza" || typeof dati.altezza !== "number") return;
      setAltezza(Math.min(Math.max(senzaTitolo ? 40 : 80, Math.ceil(dati.altezza)), 2000));
    };
    window.addEventListener("message", ascolta);
    return () => window.removeEventListener("message", ascolta);
  }, [senzaTitolo, onVuoto]);

  return (
    <iframe
      ref={cornice}
      data-plugin-panel={nome}
      title={titolo}
      src={src}
      hidden={vuoto}
      style={{ height: altezza }}
      className={senzaTitolo ? "w-full" : "w-full rounded-lg border bg-card"}
    />
  );
}
