import { chiaveNomeAzienda } from "@kancrm/shared";
import { prisma } from "../../db";
import { conflict } from "../../lib/http-errors";
import { isUniqueViolation } from "../../lib/prisma-errors";

/**
 * **Un'azienda per nome, una volta sola.**
 *
 * Il vincolo del database guarda il nome com'è scritto, e «jugaad», «Jugaad» e
 * «Jugaad srl» passavano come tre aziende (16/09/2026). Qui il confronto usa la
 * chiave di `chiaveNomeAzienda`, e **ogni punto che crea un'azienda passa di
 * qui**: il modulo, la scelta al volo, le importazioni. Una regola in tre posti
 * divergerebbe al primo ritocco.
 *
 * Le aziende si leggono tutte e si confrontano in memoria: sono decine, al più
 * qualche migliaio, e la chiave non è una colonna che il database sappia
 * cercare. Il perimetro di chi guarda non conta: l'azienda che esiste già,
 * anche se non è fra le sue, è comunque quella giusta da collegare.
 */

export interface AziendaTrovata {
  id: string;
  name: string;
}

/** L'azienda che ha, a meno di maiuscole, punteggiatura e forma societaria, questo nome. */
export async function aziendaConLoStessoNome(
  nome: string,
  { escludi }: { escludi?: string } = {},
): Promise<AziendaTrovata | null> {
  const chiave = chiaveNomeAzienda(nome);
  if (!chiave) return null;
  const aziende = await prisma.company.findMany({ select: { id: true, name: true } });
  return (
    aziende.find((azienda) => azienda.id !== escludi && chiaveNomeAzienda(azienda.name) === chiave) ??
    null
  );
}

/** Rifiuta un nome che è già di un'altra azienda, dicendo quale. */
export async function assertNomeAziendaLibero(nome: string, escludi?: string): Promise<void> {
  const esistente = await aziendaConLoStessoNome(nome, { escludi });
  if (esistente) {
    throw conflict("Esiste già l'azienda «{{name}}»", "COMPANY_EXISTS", {
      name: esistente.name,
    });
  }
}

/**
 * **Trova o crea**: la strada morbida. Chi scrive un nome e salva non deve
 * sapere se l'azienda c'era già: se c'è la si usa, se non c'è la si crea.
 * `creata` dice quale delle due è successa, perché l'interfaccia lo racconti.
 */
export async function trovaOCreaAzienda(
  nome: string,
  dati: { vatNumber?: string | null; city?: string | null; notes?: string | null } = {},
): Promise<AziendaTrovata & { creata: boolean }> {
  const pulito = nome.trim().replace(/\s+/g, " ");
  const esistente = await aziendaConLoStessoNome(pulito);
  if (esistente) return { ...esistente, creata: false };
  try {
    const creata = await prisma.company.create({
      data: {
        name: pulito,
        vatNumber: dati.vatNumber ?? null,
        city: dati.city ?? null,
        notes: dati.notes ?? null,
      },
      select: { id: true, name: true },
    });
    return { ...creata, creata: true };
  } catch (error) {
    // Due salvataggi nello stesso istante, o un'azienda con quel nome nel
    // cestino (il vincolo del database la conta, la lettura qui sopra no).
    if (!isUniqueViolation(error)) throw error;
    const arrivataNelFrattempo = await aziendaConLoStessoNome(pulito);
    if (arrivataNelFrattempo) return { ...arrivataNelFrattempo, creata: false };
    throw conflict(
      "Esiste un'azienda «{{name}}» nel cestino: ripristinala invece di crearne una nuova",
      "COMPANY_IN_TRASH",
      { name: pulito },
    );
  }
}
