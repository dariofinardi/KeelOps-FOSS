// Copyright (c) 2026 Jugaad s.r.l.
// SPDX-License-Identifier: AGPL-3.0-only

import { useCallback } from "react";
import type { Editor } from "@tiptap/react";
import { ApiError, apiUpload } from "@/lib/api";
import { useToast } from "@/components/ui/toast";

/**
 * Incollare e trascinare figure dentro una descrizione.
 *
 * Un browser, quando incolli uno scatto di schermo, non ti dà un indirizzo: ti
 * dà i byte. Vanno messi da qualche parte prima che l'editor possa
 * mostrarli, e quel posto è il nostro server, mai un servizio esterno.
 *
 * Due porte, stesse regole di tipo e dimensione:
 *  - il record c'è già → la figura nasce accanto a lui;
 *  - lo si sta ancora scrivendo (`pending`) → la figura va in **attesa** e
 *    trasloca da sé quando si salva (14/08/2026). Prima, in un dialogo di
 *    creazione, si doveva salvare, riaprire e incollare: tre gesti per uno
 *    scatto di schermo.
 *
 * Se il caricamento non riesce si dice **perché** — il server risponde "troppo
 * grande" o "solo immagini" — e non si incolla niente: meglio un'immagine
 * mancante di un riquadro rotto dentro il testo.
 */
export function useImagePaste(taskId: string | null, pending = false) {
  const toast = useToast();

  return useCallback(
    async (editor: Editor, files: File[]): Promise<boolean> => {
      const images = files.filter((file) => file.type.startsWith("image/"));
      if (!images.length) return false;
      if (!taskId && !pending) {
        toast(
          "Salva prima il record: le immagini si incollano in una descrizione che esiste già.",
          "error",
        );
        return true;
      }
      const endpoint = taskId ? `/api/tasks/${taskId}/inline-images` : "/api/inline-images";
      for (const file of images) {
        try {
          const { url } = await apiUpload<{ url: string }>(endpoint, file);
          editor.chain().focus().setImage({ src: url, alt: file.name }).run();
        } catch (error) {
          toast(error instanceof ApiError ? error.message : "Immagine non caricata", "error");
        }
      }
      return true;
    },
    [taskId, pending, toast],
  );
}
