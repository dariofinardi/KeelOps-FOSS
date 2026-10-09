import { looksLikeRichText } from "@kancrm/shared";
import { cn } from "@/lib/utils";

/**
 * Una descrizione, disegnata.
 *
 * Due modi di leggere lo stesso campo, decisi dallo stesso criterio che usa il
 * server (`looksLikeRichText`): quello che è stato scritto con l'editor si
 * disegna, quello scritto prima resta testo con i suoi ritorni a capo. Nessuna
 * migrazione, nessuna descrizione che diventa una riga sola.
 *
 * L'HTML che finisce qui è già ripulito: **ogni** scrittura passa dal controllo
 * sulla strada del database (`modules/rich-text/write-guard.ts`, attivo anche su
 * `prismaRaw`), e le righe scritte prima che quel controllo esistesse sono state
 * bonificate una volta sola (`prisma/sanitize-existing-descriptions.ts`).
 * Ripulirlo di nuovo qui vorrebbe dire tenere due elenchi di cosa è permesso, e
 * due elenchi divergono.
 */
export function RichText({ value, className }: { value: string | null; className?: string }) {
  if (!value) return null;
  if (!looksLikeRichText(value)) {
    return <div className={cn("whitespace-pre-wrap break-words", className)}>{value}</div>;
  }
  return (
    <div
      className={cn("rich-text break-words", className)}
      dangerouslySetInnerHTML={{ __html: value }}
    />
  );
}
