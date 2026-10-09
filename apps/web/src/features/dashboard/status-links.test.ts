import { describe, expect, it } from "vitest";
import { TaskKind } from "@kancrm/shared";
import { statusListLink } from "./status-links";

describe("statusListLink", () => {
  it("scadenzario: filtra per stato e limita ai propri task", () => {
    expect(statusListLink({ id: "s1", kind: TaskKind.ADMIN })).toBe("/bacheche?statusId=s1&mine=1");
  });

  it("codifica gli id con caratteri speciali", () => {
    expect(statusListLink({ id: "a b&c", kind: TaskKind.ADMIN })).toBe(
      "/bacheche?statusId=a%20b%26c&mine=1",
    );
  });

  it("porta al modulo giusto quando il filtro per stato non esiste", () => {
    // I task di progetto non sono nello scadenzario: filtrarli lì darebbe una
    // lista vuota, quindi si va dove vivono davvero.
    expect(statusListLink({ id: "s2", kind: TaskKind.PROJECT })).toBe("/progetti");
    expect(statusListLink({ id: "s3", kind: TaskKind.TICKET })).toBe("/ticket");
    expect(statusListLink({ id: "s4", kind: TaskKind.DEAL })).toBe("/offerte");
  });
});
