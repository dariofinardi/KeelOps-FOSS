import { useState } from "react";
import { useResolveCompany } from "./useCrm";

/**
 * **Il campo azienda di un modulo, morbido.**
 *
 * Chi crea un contatto scrive nome, cognome e il nome dell'azienda, e salva.
 * Prima il nome digitato contava solo se lo si confermava — un clic su «Crea
 * azienda» o Invio — e salvando senza farlo si perdeva in silenzio: il
 * contatto nasceva senza azienda (09/09/2026, visto nei log di produzione).
 *
 * Ora al salvataggio `risolvi()` fa quello che uno si aspetta: se un'azienda
 * è stata scelta la usa, se c'è solo il nome scritto la cerca — anche scritta
 * diversa, «Jugaad srl» per «Jugaad» — e se non c'è la crea. Nessun passaggio
 * obbligato, nessun doppione (16/09/2026).
 *
 * `comboProps` va passato così com'è a `CompanyCombobox`: il testo digitato
 * vive qui e non dentro la tendina, così un modulo che si riapre riparte
 * davvero vuoto.
 */
export function useCampoAzienda(iniziale: string | null = null) {
  const [companyId, setCompanyId] = useState<string | null>(iniziale);
  const [testo, setTesto] = useState("");
  const resolve = useResolveCompany();

  /** L'id dell'azienda da salvare, creandola se serve; `null` se il campo è vuoto. */
  const risolvi = async (): Promise<string | null> => {
    if (companyId) return companyId;
    const nome = testo.trim();
    if (!nome) return null;
    const azienda = await resolve.mutateAsync({ name: nome });
    setCompanyId(azienda.id);
    setTesto("");
    return azienda.id;
  };

  /** Riporta il campo a un valore, testo digitato compreso. */
  const reimposta = (id: string | null) => {
    setCompanyId(id);
    setTesto("");
  };

  return {
    companyId,
    testo,
    /** C'è un'azienda: scelta, oppure scritta e da trovare o creare al salvataggio. */
    compilato: Boolean(companyId) || testo.trim() !== "",
    risolvi,
    reimposta,
    inCorso: resolve.isPending,
    comboProps: {
      value: companyId,
      onChange: setCompanyId,
      text: testo,
      onTextChange: setTesto,
      risolviAlSalvataggio: true,
    },
  };
}
