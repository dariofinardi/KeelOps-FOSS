// Copyright (c) 2026 Jugaad s.r.l.
// SPDX-License-Identifier: AGPL-3.0-only

import { describe, expect, it } from "vitest";
import { posizionaPannello } from "./useAnchoredPanel";

/**
 * La parte che decide dove va la tendina è pura, e si prova senza un browser:
 * il caso che ha fatto nascere questo modulo è un campo in fondo allo schermo,
 * dove aprire verso il basso vuol dire non vedere niente.
 */
const campo = (top: number, altezza = 36) => ({
  left: 100,
  right: 400,
  top,
  bottom: top + altezza,
  width: 300,
});

describe("dove si apre una tendina agganciata", () => {
  it("verso il basso quando sotto c'è spazio, larga come il campo", () => {
    const p = posizionaPannello(campo(100), 900);
    expect(p.top).toBe(140); // subito sotto il campo
    expect(p.left).toBe(100);
    expect(p.width).toBe(300);
    expect(p.maxHeight).toBe(256);
  });

  it("verso l'alto quando il campo è in fondo allo schermo", () => {
    // 36px di campo che finisce a 780 su una finestra di 800: sotto restano 12px
    const p = posizionaPannello(campo(744), 800);
    expect(p.top).toBeLessThan(744); // si ribalta sopra il campo
    expect(p.top + p.maxHeight).toBeLessThanOrEqual(744);
  });

  it("non si riduce a una fessura: sotto una certa misura si apre comunque", () => {
    // poco spazio da tutte e due le parti
    const p = posizionaPannello(campo(60), 200);
    expect(p.maxHeight).toBeGreaterThanOrEqual(120);
  });

  it("sceglie il lato che offre più spazio, non sempre il basso", () => {
    // il campo sta appena sotto la metà: sopra c'è più aria
    const sopra = posizionaPannello(campo(500), 700);
    expect(sopra.top).toBeLessThan(500);
  });
});
