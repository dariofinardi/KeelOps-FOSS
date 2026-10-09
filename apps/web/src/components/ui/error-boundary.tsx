import { Component, type ReactNode } from "react";
import i18n from "@/lib/i18n";
import { FullPageError } from "@/components/ui/full-page-error";

/**
 * L'ultima rete: un errore di rendering non deve lasciare lo schermo bianco.
 * Classe (i boundary non esistono come hook) e niente useTranslation: quando
 * scatta, l'albero sotto è compromesso — si parla direttamente con i18next.
 */
export class AppErrorBoundary extends Component<{ children: ReactNode }, { broken: boolean }> {
  state = { broken: false };

  static getDerivedStateFromError(): { broken: boolean } {
    return { broken: true };
  }

  componentDidCatch(error: unknown): void {
    // in console per la diagnosi: la pagina all'utente resta pulita
    console.error("Errore di rendering non gestito:", error);
  }

  render(): ReactNode {
    if (!this.state.broken) return this.props.children;
    return (
      <FullPageError
        title={i18n.t("Qualcosa è andato storto")}
        message={i18n.t("Un errore imprevisto ha interrotto la pagina. Ricaricando si riparte da dove eri.")}
        actionLabel={i18n.t("Ricarica")}
        onAction={() => window.location.reload()}
      />
    );
  }
}
