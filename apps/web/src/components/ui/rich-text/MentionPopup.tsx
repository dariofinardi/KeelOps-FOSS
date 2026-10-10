// Copyright (c) 2026 Jugaad s.r.l.
// SPDX-License-Identifier: AGPL-3.0-only

import { useCallback, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { createPortal } from "react-dom";
import type {
  SuggestionKeyDownProps,
  SuggestionOptions,
  SuggestionProps,
} from "@tiptap/suggestion";
import { cn } from "@/lib/utils";
import type { MentionPerson } from "./mention";

/**
 * Il pannellino che compare scrivendo `@`.
 *
 * Sta in un portale ancorato al punto del cursore: dentro l'editor sarebbe
 * contenuto (e tagliato) dal riquadro del campo, che nel pannello laterale è
 * alto quattro righe.
 *
 * Si usa **senza staccare le mani dalla tastiera** — frecce per scegliere,
 * Invio per confermare, Esc per rinunciare — perché chi scrive una descrizione
 * sta scrivendo, non puntando. Il mouse funziona lo stesso, per chi preferisce.
 */
interface PopupState {
  items: MentionPerson[];
  rect: DOMRect | null;
  selected: number;
  onPick: (person: MentionPerson) => void;
}

export function useMentionPopup(people: () => MentionPerson[]) {
  const { t } = useTranslation();
  const [state, setState] = useState<PopupState | null>(null);
  // L'editor cattura `people` alla sua creazione e non ricostruisce le
  // estensioni: se l'elenco utenti arriva DOPO (cache fredda), la closure
  // congelata restituirebbe sempre []. Passiamo all'editor una funzione stabile
  // che legge da un ref sempre aggiornato, così il primo `@` vede la lista vera.
  const peopleRef = useRef(people);
  peopleRef.current = people;
  const stablePeople = useCallback(() => peopleRef.current(), []);
  // Le scorciatoie arrivano da ProseMirror, che non rientra nel giro di React:
  // gli serve lo stato aggiornato, non quello del render in cui è stato creato.
  const stateRef = useRef<PopupState | null>(null);
  const set = useCallback((next: PopupState | null) => {
    stateRef.current = next;
    setState(next);
  }, []);

  const render: SuggestionOptions<MentionPerson>["render"] = useCallback(
    () => ({
      onStart: (props: SuggestionProps<MentionPerson>) => {
        set({
          items: props.items,
          rect: props.clientRect?.() ?? null,
          selected: 0,
          onPick: (person) => props.command(person),
        });
      },
      onUpdate: (props: SuggestionProps<MentionPerson>) => {
        set({
          items: props.items,
          rect: props.clientRect?.() ?? null,
          // La scelta riparte dall'alto: la lista sotto è cambiata.
          selected: 0,
          onPick: (person) => props.command(person),
        });
      },
      onKeyDown: ({ event }: SuggestionKeyDownProps) => {
        const current = stateRef.current;
        if (!current || current.items.length === 0) return false;
        if (event.key === "ArrowDown") {
          set({ ...current, selected: (current.selected + 1) % current.items.length });
          return true;
        }
        if (event.key === "ArrowUp") {
          const next = (current.selected - 1 + current.items.length) % current.items.length;
          set({ ...current, selected: next });
          return true;
        }
        if (event.key === "Enter" || event.key === "Tab") {
          const person = current.items[current.selected];
          if (person) current.onPick(person);
          return true;
        }
        if (event.key === "Escape") {
          set(null);
          return true;
        }
        return false;
      },
      onExit: () => set(null),
    }),
    [set],
  );

  const node =
    state && state.items.length > 0 && state.rect
      ? createPortal(
          <ul
            role="listbox"
            aria-label={t("Persone da menzionare")}
            className="fixed z-[120] max-h-64 w-64 overflow-auto rounded-md border bg-popover p-1 text-sm shadow-lg"
            style={{ left: state.rect.left, top: state.rect.bottom + 4 }}
          >
            {state.items.map((person, index) => (
              <li key={person.id}>
                <button
                  type="button"
                  role="option"
                  aria-selected={index === state.selected}
                  className={cn(
                    "w-full rounded px-2 py-1.5 text-left",
                    index === state.selected ? "bg-accent" : "hover:bg-accent/60",
                  )}
                  // Il clic non deve togliere il fuoco all'editor: il cursore
                  // deve restare dov'era per sostituire il testo scritto.
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => state.onPick(person)}
                >
                  {person.name}
                </button>
              </li>
            ))}
          </ul>,
          document.body,
        )
      : null;

  // `people` stabile: l'editor lo cattura una volta e continua a vedere i dati freschi.
  return { render, node, people: stablePeople };
}
