import { describe, expect, it } from "vitest";
import { rectIntersection } from "@dnd-kit/core";
import { pointerFirstCollision } from "./dnd";

/**
 * Colonne strette affiancate, come in una bacheca con otto stati.
 * `In attesa` sta a sinistra, `Rilasciato` subito a destra.
 */
const rect = (left: number, width = 120) => ({
  top: 200,
  left,
  bottom: 800,
  right: left + width,
  width,
  height: 600,
});

const colonne = new Map([
  ["In attesa", rect(300)],
  ["Rilasciato", rect(420)],
]);

const argomenti = (pointerX: number, cardLeft: number) =>
  ({
    active: {
      id: "task",
      data: { current: undefined },
      rect: { current: { initial: null, translated: null } },
    },
    collisionRect: { ...rect(cardLeft, 380), top: 400, bottom: 520, height: 120 },
    droppableRects: colonne,
    droppableContainers: [...colonne.keys()].map((id) => ({ id })),
    pointerCoordinates: { x: pointerX, y: 460 },
  }) as unknown as Parameters<typeof pointerFirstCollision>[0];

describe("dove si lascia la card", () => {
  it("vince la colonna sotto il puntatore, non quella più coperta", () => {
    // Il caso segnalato: la freccia è su "Rilasciato" ma la card, larga, copre
    // di più "In attesa". Prima vinceva l'area — e il task finiva nello stato
    // sbagliato senza che nulla lo dicesse.
    const args = argomenti(470, 200);
    expect(rectIntersection(args)[0]?.id).toBe("In attesa");
    expect(pointerFirstCollision(args)[0]?.id).toBe("Rilasciato");
  });

  it("puntando l'altra colonna, sceglie l'altra", () => {
    expect(pointerFirstCollision(argomenti(350, 200))[0]?.id).toBe("In attesa");
  });

  it("fuori da ogni colonna resta il rettangolo, per non lasciare la card senza casa", () => {
    // Trascinando sopra le intestazioni il puntatore non è dentro niente: senza
    // riserva la card tornerebbe indietro senza motivo apparente.
    const args = argomenti(470, 200);
    const fuori = { ...args, pointerCoordinates: { x: 470, y: 50 } };
    expect(pointerFirstCollision(fuori).length).toBeGreaterThan(0);
  });
});
