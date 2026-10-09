import { useParams } from "react-router-dom";
import { useDocumentTitle } from "@/lib/use-document-title";
import { usePlugins } from "./usePlugins";

/**
 * La cornice dentro AppShell per la pagina di un plugin: un iframe a tutta
 * altezza sulla stessa origine (`/plugins/<nome>/`), così cookie, tema e
 * lingua arrivano da soli. La query string passa intatta: è il canale delle
 * ancore contestuali (es. `?progetto=<id>` per aprire la mappa su un progetto).
 */
export function PluginFrame() {
  const { nome = "" } = useParams();
  const plugins = usePlugins();
  const entry = plugins.data?.find((plugin) => plugin.nome === nome);
  useDocumentTitle(entry?.voce ?? nome);
  if (plugins.isSuccess && !entry) {
    return <p className="p-4 text-sm text-muted-foreground">Plugin non attivo.</p>;
  }
  return (
    <iframe
      title={entry?.voce ?? nome}
      src={`/plugins/${encodeURIComponent(nome)}/${window.location.search}`}
      // Riempie lo spazio sotto la barra di KeelOps, né più né meno: un minimo
      // calcolato su `100vh` superava lo schermo visibile su Android, e la
      // pagina del plugin si tagliava in fondo (29/09/2026). `block` toglie
      // lo spazio sotto un elemento in linea, che bastava a far scorrere.
      className="block h-full w-full rounded-lg border bg-card"
    />
  );
}
