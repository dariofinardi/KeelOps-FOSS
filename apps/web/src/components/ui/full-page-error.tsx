// Copyright (c) 2026 Jugaad s.r.l.
// SPDX-License-Identifier: AGPL-3.0-only

import { KeelopsLockup } from "@/components/ui/keelops-logo";

/**
 * La cornice a tutta pagina per gli errori che non hanno una pagina sotto:
 * il 404 delle rotte, il crash di rendering. Porta il marchio e una via
 * d'uscita — un vicolo cieco senza logo era due difetti in uno.
 * Niente hook qui dentro: la usa anche l'error boundary, che è una classe e
 * può montarla mentre il resto dell'app è compromesso.
 */
export function FullPageError({
  code,
  title,
  message,
  actionLabel,
  onAction,
}: {
  code?: string;
  title: string;
  message: string;
  actionLabel: string;
  onAction: () => void;
}) {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-3 bg-background p-6 text-center text-foreground">
      <KeelopsLockup className="h-20 w-auto text-foreground" />
      {code && <p className="text-5xl font-semibold tracking-tight text-muted-foreground">{code}</p>}
      <h1 className="text-xl font-semibold">{title}</h1>
      <p className="max-w-md text-sm text-muted-foreground">{message}</p>
      <button
        type="button"
        onClick={onAction}
        className="mt-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground"
      >
        {actionLabel}
      </button>
    </div>
  );
}
