import { describe, expect, it } from "vitest";
import { ActivityCategory, TaskKind } from "@kancrm/shared";
import { presentCategories } from "./useTasks";

const task = (category: string | null, kind: TaskKind = TaskKind.PROJECT) => ({
  kind,
  activityType: category ? { category } : null,
});

describe("categorie presenti in una bacheca", () => {
  it("elenca solo quelle che hanno task, con quanti", () => {
    expect(
      presentCategories([
        task(ActivityCategory.DEV),
        task(ActivityCategory.DEV),
        task(ActivityCategory.SALES),
      ]),
    ).toEqual([
      { category: ActivityCategory.SALES, count: 1 },
      { category: ActivityCategory.DEV, count: 2 },
    ]);
  });

  it("un task di sviluppo portato nello scadenzario resta contato come sviluppo", () => {
    // Il caso segnalato: due "Fix / Bug" spostati da un progetto allo
    // Scadenzario tengono il flusso di sviluppo e nella bacheca amministrativa
    // non hanno colonna. Il conteggio è ciò che permette di dirlo, invece di
    // lasciarli sparire.
    expect(
      presentCategories([
        task(null, TaskKind.ADMIN),
        task(ActivityCategory.DEV, TaskKind.ADMIN),
        task(ActivityCategory.DEV, TaskKind.ADMIN),
      ]),
    ).toEqual([
      { category: ActivityCategory.ADMIN, count: 1 },
      { category: ActivityCategory.DEV, count: 2 },
    ]);
  });

  it("un tipo Generale non fa categoria a sé: decide il modulo", () => {
    // I tipi generali ("Riunione") sono trasversali e restano nel flusso del
    // progetto, quindi non aggiungono una bacheca a parte.
    expect(presentCategories([task(ActivityCategory.DEV), task(ActivityCategory.GENERAL)])).toEqual(
      [{ category: ActivityCategory.DEV, count: 2 }],
    );
  });

  it("un progetto di soli task di sviluppo ha una categoria sola", () => {
    // È il caso di tutti i progetti in produzione: la tendina non serve, e
    // sceglierne un'altra mostrava una bacheca vuota che sembrava un guasto.
    expect(presentCategories([task(ActivityCategory.DEV)])).toHaveLength(1);
  });

  it("senza tipo di attività decide il modulo: un task di progetto è sviluppo", () => {
    expect(presentCategories([task(null)])).toEqual([{ category: ActivityCategory.DEV, count: 1 }]);
  });

  it("nessun task, nessuna categoria", () => {
    expect(presentCategories([])).toEqual([]);
  });
});
