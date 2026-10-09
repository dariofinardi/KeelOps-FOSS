/**
 * **Quando due nomi sono la stessa azienda.**
 *
 * «jugaad», «Jugaad» e «Jugaad srl» sono un cliente solo, e l'anagrafica non
 * deve averne tre (16/09/2026). Il vincolo sul database guarda il nome così
 * com'è scritto, quindi le tre righe passavano: qui c'è la **chiave** con cui
 * si confrontano i nomi, e ogni punto che crea un'azienda — il modulo, la
 * creazione al volo, le importazioni — la chiede prima di scrivere.
 *
 * La chiave è il nome ridotto all'osso:
 * - minuscole, senza accenti;
 * - senza punteggiatura: «S.r.l.» e «srl» sono la stessa sigla;
 * - senza la **forma societaria** in coda (srl, spa, snc, sas, «& C.», ltd,
 *   gmbh…), che dice come è costituita l'azienda e non chi è;
 * - spazi ridotti a uno.
 *
 * Non tocca le parole in mezzo al nome: «Studio Rossi Associati» e «Rossi»
 * restano due aziende. Un nome fatto solo della sigla («SRL») tiene la sigla:
 * una chiave vuota renderebbe uguali tutte le aziende senza nome.
 */

/**
 * Le forme societarie, già senza punteggiatura. Italiane per prime, poi quelle
 * che compaiono nei nomi dei clienti esteri. Anche le forme di due parole
 * («soc coop») si tolgono, parola per parola, perché stanno sempre in coda.
 */
const FORME_SOCIETARIE = new Set([
  "srl",
  "srls",
  "spa",
  "sapa",
  "snc",
  "sas",
  "ss",
  "scarl",
  "scrl",
  "scpa",
  "sc",
  "soc",
  "coop",
  "societa",
  "cooperativa",
  "semplificata",
  "unipersonale",
  "onlus",
  "ltd",
  "limited",
  "llc",
  "inc",
  "corp",
  "plc",
  "gmbh",
  "ag",
  "kg",
  "sa",
  "sl",
  "sarl",
  "bv",
  "nv",
]);

export function chiaveNomeAzienda(nome: string): string {
  const pulito = nome
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    // «& C.» e «e C.» in coda: «Rossi & C. snc» è Rossi.
    .replace(/\s*(?:&|\be)\s*c\.?(?=\s|$)/g, " ")
    // I punti delle sigle si tolgono senza lasciare spazi: «s.r.l.» → «srl».
    .replace(/\./g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
  const parole = pulito.split(" ").filter(Boolean);
  let fine = parole.length;
  while (fine > 1 && FORME_SOCIETARIE.has(parole[fine - 1]!)) fine -= 1;
  return parole.slice(0, fine).join(" ");
}

/** Due nomi indicano la stessa azienda. */
export function stessaAzienda(a: string, b: string): boolean {
  return chiaveNomeAzienda(a) === chiaveNomeAzienda(b);
}
