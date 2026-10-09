import { riprovaQuery } from "./lib/query-retry";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ConfirmProvider } from "./components/ui/confirm";
import { ToastProvider } from "./components/ui/toast";
import { App } from "./App";
import { AppErrorBoundary } from "./components/ui/error-boundary";
import { watchStaleBuild } from "./lib/stale-build";
import "./lib/i18n"; // inizializza i18next prima del primo render
import "./index.css";

// Una pagina aperta da prima di un rilascio chiede chunk che non esistono più:
// se ne accorge e si ricarica, invece di restare a metà.
watchStaleBuild();

// Tema salvato: applicalo prima del primo render per evitare il flash.
if (localStorage.getItem("kancrm-theme") === "dark") {
  document.documentElement.classList.add("dark");
}

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { retry: riprovaQuery, refetchOnWindowFocus: false },
  },
});

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <ToastProvider>
        <ConfirmProvider>
          <AppErrorBoundary>
            <App />
          </AppErrorBoundary>
        </ConfirmProvider>
      </ToastProvider>
    </QueryClientProvider>
  </StrictMode>,
);
