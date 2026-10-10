// Copyright (c) 2026 Jugaad s.r.l.
// SPDX-License-Identifier: AGPL-3.0-only

import { describe, expect, it } from "vitest";
import { isMyTask, selectMyTasks, visibilityReason } from "./my-tasks";

const io = "u1";

describe("quando un task è mio", () => {
  it("lo è se lo eseguo", () => {
    expect(isMyTask({ assignee: { id: io } }, io)).toBe(true);
    expect(visibilityReason({ assignee: { id: io } }, io)).toBe("assegnato");
  });

  it("lo è anche se lo seguo da referente", () => {
    // Il supervisore risponde del task quanto l'esecutore: nasconderglielo in un
    // filtro "i miei" vorrebbe dire fargli perdere di vista ciò che segue.
    expect(isMyTask({ supervisor: { id: io } }, io)).toBe(true);
    expect(visibilityReason({ supervisor: { id: io } }, io)).toBe("supervisore");
  });

  it("essere entrambi conta come esecutore: è il ruolo che fa agire", () => {
    expect(visibilityReason({ assignee: { id: io }, supervisor: { id: io } }, io)).toBe(
      "assegnato",
    );
  });

  it("i task di altri non sono miei, nemmeno se li vedo", () => {
    const altrui = { assignee: { id: "u2" }, supervisor: { id: "u3" } };
    expect(isMyTask(altrui, io)).toBe(false);
    expect(visibilityReason(altrui, io)).toBe("altro");
  });

  it("un task senza nessuno addosso non è di nessuno", () => {
    expect(isMyTask({ assignee: null, supervisor: null }, io)).toBe(false);
  });
});

describe('selezione "solo i miei" con i subtask', () => {
  const t = (id: string, over: Record<string, unknown> = {}) => ({
    id,
    parentTaskId: null,
    assignee: null,
    supervisor: null,
    ...over,
  });

  it("un mio subtask dentro il task di un altro non sparisce: resta il contenitore", () => {
    const tasks = [
      t("padre", { assignee: { id: "u2" } }),
      t("sub", { parentTaskId: "padre", supervisor: { id: io } }),
      t("estraneo", { assignee: { id: "u2" } }),
    ];
    const esito = selectMyTasks(tasks, io);
    expect(esito.visible.map((x) => x.id)).toEqual(["padre", "sub"]);
    // In piano si mostrano soltanto i miei: il padre non c'entra.
    expect(esito.mine.map((x) => x.id)).toEqual(["sub"]);
    // Il padre è lì per contenere, non perché sia mio: non si conta.
    expect(esito.mineCount).toBe(1);
    expect([...esito.containers]).toEqual(["padre"]);
  });

  it("il conteggio è dei miei task, non delle righe mostrate", () => {
    // È l'errore visto dal vivo: 85 scritto sul filtro, quattro righe a schermo.
    const tasks = [
      t("mio1", { assignee: { id: io } }),
      t("mio2", { supervisor: { id: io } }),
      t("altrui", { assignee: { id: "u2" } }),
    ];
    expect(selectMyTasks(tasks, io).mineCount).toBe(2);
  });

  it("un genitore già mio non è un contenitore da aprire per forza", () => {
    const tasks = [
      t("padre", { assignee: { id: io } }),
      t("sub", { parentTaskId: "padre", assignee: { id: io } }),
    ];
    const esito = selectMyTasks(tasks, io);
    expect(esito.mineCount).toBe(2);
    expect([...esito.containers]).toEqual([]);
  });

  it("senza task miei non resta niente, nemmeno i contenitori", () => {
    const esito = selectMyTasks([t("a", { assignee: { id: "u2" } })], io);
    expect(esito.visible).toEqual([]);
    expect(esito.mineCount).toBe(0);
  });
});
