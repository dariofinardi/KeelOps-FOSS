import { useEffect } from "react";
import { useCurrentUser } from "@/features/auth/useAuth";
import { useBranding } from "./useBranding";

// Tutte le classi-palette aziendali possibili: si rimuovono prima di applicare quella attiva.
const COMPANY_CLASSES = ["theme-jugaad", "theme-radaee", "theme-padformusician"];

/**
 * Applica il tema scelto dall'utente aggiungendo/togliendo una classe su <html>:
 *  - light  → nessuna classe (usa :root)
 *  - dark   → .dark
 *  - auto   → .dark se il sistema è in modalità scura (aggiornato dal vivo)
 *  - company→ la palette aziendale scelta dall'admin (theme-<companyTheme>)
 * Non renderizza nulla.
 */
export function ThemeManager() {
  const theme = useCurrentUser().theme;
  const companyTheme = useBranding().data?.companyTheme ?? "jugaad";

  useEffect(() => {
    const root = document.documentElement;
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const apply = () => {
      root.classList.remove("dark", ...COMPANY_CLASSES);
      if (theme === "dark" || (theme === "auto" && mq.matches)) root.classList.add("dark");
      else if (theme === "company") root.classList.add(`theme-${companyTheme}`);
    };
    apply();
    // In modalità automatica segui i cambi di preferenza del sistema in tempo reale.
    if (theme === "auto") {
      mq.addEventListener("change", apply);
      return () => mq.removeEventListener("change", apply);
    }
  }, [theme, companyTheme]);

  return null;
}
