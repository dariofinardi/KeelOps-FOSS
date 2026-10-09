import { Extension } from "@tiptap/react";
import Suggestion, { type SuggestionOptions } from "@tiptap/suggestion";

/**
 * La chiocciola che apre l'elenco delle persone.
 *
 * Scrivendo `@` dentro una descrizione compare la lista dei colleghi, si filtra
 * digitando e si sceglie con le frecce o col mouse. Quello che finisce nel testo
 * è **testo normale** — `@Nome Cognome` — non un marcatore speciale.
 *
 * È una scelta, non una scorciatoia: le menzioni il server le riconosce
 * leggendo il testo (`findMentionedUserIds`), e la chat lo fa già così. Un nodo
 * "menzione" con i suoi attributi vorrebbe dire insegnare la stessa cosa due
 * volte — al ripulitore dell'HTML, a chi legge le notifiche, a chi esporta — e
 * poi tenerle allineate. Così invece un testo scritto a mano e uno scelto
 * dall'elenco sono indistinguibili: cambia solo la fatica di scriverlo.
 */
export interface MentionPerson {
  id: string;
  name: string;
}

export interface MentionOptions {
  /** Chi si può menzionare, filtrato da chi lo usa (perimetro dei permessi). */
  people: () => MentionPerson[];
  /** Apre/aggiorna/chiude il pannellino: la grafica sta in React, non qui. */
  render: SuggestionOptions<MentionPerson>["render"];
}

/** Filtro: per pezzi di nome, senza accenti né maiuscole di mezzo. */
export function matchPeople(people: MentionPerson[], query: string): MentionPerson[] {
  const needle = query.trim().toLowerCase();
  const scored = needle
    ? people.filter((person) => person.name.toLowerCase().includes(needle))
    : people;
  return scored.slice(0, 8);
}

export const MentionSuggestion = Extension.create<MentionOptions>({
  name: "mentionSuggestion",

  addOptions() {
    return {
      people: () => [],
      render: () => ({}),
    };
  },

  addProseMirrorPlugins() {
    return [
      Suggestion<MentionPerson>({
        editor: this.editor,
        char: "@",
        // Solo a inizio parola: una mail scritta nel testo non deve aprire
        // l'elenco a metà indirizzo.
        allowedPrefixes: [" ", "\n"],
        startOfLine: false,
        items: ({ query }) => matchPeople(this.options.people(), query),
        command: ({ editor, range, props }) => {
          // Sostituisce "@que" con "@Nome Cognome " — testo, non marcatori.
          editor.chain().focus().insertContentAt(range, `@${props.name} `).run();
        },
        render: this.options.render,
      }),
    ];
  },
});
