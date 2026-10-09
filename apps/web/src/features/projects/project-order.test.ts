import { describe, expect, it } from "vitest";
import type { ProjectListItem } from "@kancrm/shared";
import { applyManualOrder, compareProjects, projectTier, tierLabel } from "./project-order";

const OGGI = "2026-08-05";

const progetto = (name: string, over: Partial<ProjectListItem> = {}): ProjectListItem =>
  ({
    id: name,
    name,
    myNextDueDate: null,
    myOpenTaskCount: 0,
    myLastAssignedAt: null,
    myLastActivityAt: null,
    lastTaskCreatedAt: null,
    ...over,
  }) as ProjectListItem;

const ordina = (progetti: ProjectListItem[]) =>
  [...progetti].sort((a, b) => compareProjects(a, b, OGGI)).map((p) => p.name);

describe("ordine automatico dei progetti", () => {
  it("prima le scadenze vicine, la più urgente in cima", () => {
    const progetti = [
      progetto("Fra dieci giorni", { myNextDueDate: "2026-08-15", myOpenTaskCount: 1 }),
      progetto("Scaduto", { myNextDueDate: "2026-07-30", myOpenTaskCount: 1 }),
      progetto("Domani", { myNextDueDate: "2026-08-06", myOpenTaskCount: 1 }),
    ];
    expect(ordina(progetti)).toEqual(["Scaduto", "Domani", "Fra dieci giorni"]);
  });

  it("oltre i 15 giorni non è più urgenza: scende sotto a dove sto lavorando", () => {
    const lontano = progetto("Fra un mese", { myNextDueDate: "2026-09-05", myOpenTaskCount: 1 });
    const attivo = progetto("KanCRM", { myLastActivityAt: "2026-08-04T18:00:00.000Z" });
    expect(ordina([lontano, attivo])).toEqual(["KanCRM", "Fra un mese"]);
  });

  it("i progetti lavorati di recente vengono per ultima lavorazione", () => {
    const progetti = [
      progetto("Settimana scorsa", { myLastActivityAt: "2026-07-29T09:00:00.000Z" }),
      progetto("Stamattina", { myLastActivityAt: "2026-08-05T08:00:00.000Z" }),
      progetto("Ieri", { myLastActivityAt: "2026-08-04T17:00:00.000Z" }),
    ];
    expect(ordina(progetti)).toEqual(["Stamattina", "Ieri", "Settimana scorsa"]);
  });

  it("in fondo: prima il lavoro mio non urgente, poi il lavorato vecchio, poi gli altri", () => {
    const mioNonUrgente = progetto("Mio", {
      myNextDueDate: "2026-10-01",
      myOpenTaskCount: 1,
      myLastAssignedAt: "2026-06-01T10:00:00.000Z",
    });
    const lavoratoVecchio = progetto("Lavorato a maggio", {
      myLastActivityAt: "2026-05-20T10:00:00.000Z",
    });
    const diAltri = progetto("Di altri", { lastTaskCreatedAt: "2026-08-01T10:00:00.000Z" });
    expect(ordina([diAltri, lavoratoVecchio, mioNonUrgente])).toEqual([
      "Mio",
      "Lavorato a maggio",
      "Di altri",
    ]);
    expect(projectTier(mioNonUrgente, OGGI)).toBe(2);
    expect(projectTier(lavoratoVecchio, OGGI)).toBe(3);
    expect(projectTier(diAltri, OGGI)).toBe(4);
  });

  it("tra i progetti di altri viene prima quello con il task più recente", () => {
    const vecchio = progetto("Fermo", { lastTaskCreatedAt: "2026-02-01T10:00:00.000Z" });
    const vivo = progetto("Vivo", { lastTaskCreatedAt: "2026-08-01T10:00:00.000Z" });
    const vuoto = progetto("Senza task");
    expect(ordina([vuoto, vecchio, vivo])).toEqual(["Vivo", "Fermo", "Senza task"]);
  });

  it("il progetto lasciato lì scende, ma non sotto a quelli mai lavorati", () => {
    const lasciato = progetto("Lasciato", { myLastActivityAt: "2026-06-20T10:00:00.000Z" });
    const maiVisto = progetto("Mai visto", { lastTaskCreatedAt: "2026-08-04T10:00:00.000Z" });
    expect(ordina([maiVisto, lasciato])).toEqual(["Lasciato", "Mai visto"]);
  });

  it("a parità di tutto conta il nome", () => {
    expect(ordina([progetto("Zeta"), progetto("Alfa")])).toEqual(["Alfa", "Zeta"]);
  });

  it("ogni fascia si spiega, l'ultima no", () => {
    expect(tierLabel(0)).toBe("Hai una scadenza vicina");
    expect(tierLabel(1)).toBe("Ci stai lavorando");
    expect(tierLabel(2)).toBe("Hai del lavoro tuo");
    expect(tierLabel(4)).toBeNull();
  });

  it("l'ordine manuale vince, e chi non c'è segue l'automatico", () => {
    const progetti = [
      progetto("Alfa"),
      progetto("Beta"),
      progetto("KanCRM", { myLastActivityAt: "2026-08-05T09:30:00.000Z" }),
    ];
    const ordinati = applyManualOrder(progetti, ["Beta"], OGGI).map((p) => p.name);
    expect(ordinati).toEqual(["Beta", "KanCRM", "Alfa"]);
  });
});
