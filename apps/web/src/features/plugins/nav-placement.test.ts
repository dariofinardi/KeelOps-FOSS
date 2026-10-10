// Copyright (c) 2026 Jugaad s.r.l.
// SPDX-License-Identifier: AGPL-3.0-only

import { describe, expect, it } from "vitest";
import { NAV_AREA_KEYS, type PluginUiEntry } from "@kancrm/shared";
import { AREAS } from "@/components/layout/areas";
import { disponiVoci, vedeIlPlugin } from "./nav-placement";

const plugin = (nome: string, extra: Partial<PluginUiEntry> = {}): PluginUiEntry => ({
  nome,
  titolo: nome,
  voce: nome,
  icona: "puzzle",
  iconaUrl: null,
  menu: true,
  anchors: {},
  sezione: "aree",
  dopo: null,
  ruoli: null,
  soloManager: false,
  soloGruppo: false,
  nelGruppo: null,
  nick: null,
  versione: "1.0.0",
  schemaVersion: null,
  barra: null,
  ...extra,
});

const native = ["home", "personal", "tasks", "deals"].map((chiave) => ({ chiave }));
const membro = { role: "MEMBER", isManager: false };
const chiavi = (voci: Array<{ chiave: string }>) => voci.map((v) => v.chiave);

/**
 * Un plugin dice nel manifesto dove stare: dopo un'area, dopo un altro plugin,
 * o in coda. Chi non lo può vedere non lo vede. Il server ha già validato i
 * valori: qui si prova che la disposizione li rispetti, e che un nome
 * sconosciuto finisca in coda senza rompere niente.
 */
describe("dove va la voce di un plugin", () => {
  it("senza indicazioni, in coda alle aree — come prima del 05/09/2026", () => {
    expect(chiavi(disponiVoci(native, [plugin("mappa")], "aree", membro))).toEqual([
      "home",
      "personal",
      "tasks",
      "deals",
      "mappa",
    ]);
  });

  it("«dopo Bacheche» lo mette esattamente lì", () => {
    const voci = disponiVoci(native, [plugin("personale", { dopo: "tasks" })], "aree", membro);
    expect(chiavi(voci)).toEqual(["home", "personal", "tasks", "personale", "deals"]);
    expect(voci[3]?.plugin?.nome).toBe("personale");
  });

  it("un aggancio sconosciuto va in coda, e la lista non si rompe", () => {
    expect(chiavi(disponiVoci(native, [plugin("x", { dopo: "marte" })], "aree", membro))).toEqual([
      "home",
      "personal",
      "tasks",
      "deals",
      "x",
    ]);
  });

  it("ci si può agganciare a un altro plugin, in qualunque ordine siano montati", () => {
    const voci = disponiVoci(
      native,
      [plugin("secondo", { dopo: "primo" }), plugin("primo", { dopo: "home" })],
      "aree",
      membro,
    );
    expect(chiavi(voci)).toEqual(["home", "primo", "secondo", "personal", "tasks", "deals"]);
  });

  it("la sezione filtra: un plugin dell'amministrazione non compare fra le aree", () => {
    const voci = disponiVoci(
      native,
      [plugin("strumenti", { sezione: "amministrazione" })],
      "aree",
      membro,
    );
    expect(chiavi(voci)).toEqual(["home", "personal", "tasks", "deals"]);
  });

  it("il gruppo del plugin toglie la voce a chi non ne fa parte", () => {
    // `nelGruppo` lo calcola il server, che ha i membri; qui si applica e basta
    expect(vedeIlPlugin(plugin("q", { soloGruppo: true, nelGruppo: false }), membro)).toBe(false);
    expect(vedeIlPlugin(plugin("q", { soloGruppo: true, nelGruppo: true }), membro)).toBe(true);
    // un core più vecchio non risponde: meglio una voce di troppo che un'area
    // che sparisce senza spiegazione
    expect(vedeIlPlugin(plugin("q", { soloGruppo: true, nelGruppo: null }), membro)).toBe(true);
    // e senza `soloGruppo` la domanda non si pone
    expect(vedeIlPlugin(plugin("q", { nelGruppo: false }), membro)).toBe(true);
  });

  it("ruoli e soloManager tolgono la voce a chi non deve vederla", () => {
    expect(vedeIlPlugin(plugin("x", { ruoli: ["ADMIN"] }), membro)).toBe(false);
    expect(
      vedeIlPlugin(plugin("x", { ruoli: ["ADMIN"] }), { role: "ADMIN", isManager: false }),
    ).toBe(true);
    expect(vedeIlPlugin(plugin("x", { soloManager: true }), membro)).toBe(false);
    expect(vedeIlPlugin(plugin("x", { soloManager: true }), { ...membro, isManager: true })).toBe(
      true,
    );
    expect(vedeIlPlugin(plugin("x", { menu: false }), membro)).toBe(false);
  });
});

/**
 * Le chiavi con cui un manifesto dice «dopo Bacheche» sono le chiavi di
 * `AREAS`: il server le valida con l'elenco in `shared`, il browser le usa da
 * `areas.tsx`. Se i due divergono, un plugin chiede un posto che il menù non
 * conosce — e finisce in coda senza che nessuno capisca perché.
 */
describe("le aree del menù e l'elenco condiviso dicono le stesse chiavi", () => {
  it("stesse chiavi, stesso ordine", () => {
    expect(Object.keys(AREAS)).toEqual([...NAV_AREA_KEYS]);
  });
});
