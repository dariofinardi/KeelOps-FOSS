import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import "./styles.css";

/**
 * **Il tema è quello dell'applicazione che ospita la pagina** (07/09/2026).
 *
 * Prima si leggeva `kancrm-theme` dal localStorage, che l'interruttore in
 * barra scrive ma la scelta nel profilo no: chi teneva «chiaro» nel profilo
 * con il sistema in scuro vedeva le card nere dentro una pagina bianca. La
 * cornice è della stessa origine, quindi si guarda la classe sul documento
 * che la contiene — la verità di quello che la persona sta vedendo adesso — e
 * la si segue mentre cambia. Aperta da sola resta il sistema.
 */
function seguiIlTema() {
  const radice = document.documentElement;
  let genitore: HTMLElement | null = null;
  try {
    genitore = window.parent !== window ? window.parent.document.documentElement : null;
  } catch {
    genitore = null;
  }
  if (genitore) {
    const applica = () => {
      radice.dataset.tema = genitore!.classList.contains("dark") ? "dark" : "light";
    };
    applica();
    new MutationObserver(applica).observe(genitore, {
      attributes: true,
      attributeFilter: ["class"],
    });
    return;
  }
  const mq = window.matchMedia("(prefers-color-scheme: dark)");
  const applica = () => {
    radice.dataset.tema = mq.matches ? "dark" : "light";
  };
  applica();
  mq.addEventListener("change", applica);
}
seguiIlTema();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
