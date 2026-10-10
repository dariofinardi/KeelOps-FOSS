// Copyright (c) 2026 Jugaad s.r.l.
// SPDX-License-Identifier: AGPL-3.0-only

import { describe, expect, it } from "vitest";
import { taskIdFromLink, taskLinkUrl } from "../src/modules/tasks/task-link";

describe("il link interno a un task", () => {
  const base = "https://crm.example.com";
  const id = "cmtlbbqrl001ku6abb7rkt0o1";

  it("si scrive con l'indirizzo generico dei task, e si rilegge", () => {
    const url = taskLinkUrl(`${base}/`, id);
    expect(url).toBe(`${base}/bacheche?task=${id}`);
    expect(taskIdFromLink(url, base)).toBe(id);
  });

  it("solo di questa istanza e solo a un task: il resto resta un link qualunque", () => {
    expect(taskIdFromLink(`https://studiorossi.keelops.it/bacheche?task=${id}`, base)).toBeNull();
    expect(taskIdFromLink(`${base}/offerte?deal=${id}`, base)).toBeNull();
    expect(taskIdFromLink("https://docs.google.com/document/d/abc", base)).toBeNull();
    expect(taskIdFromLink(`${base}/bacheche?task=../../x`, base)).toBeNull();
    expect(taskIdFromLink("non un indirizzo", base)).toBeNull();
    expect(taskIdFromLink(`${base}/bacheche?task=${id}`, "")).toBeNull();
  });
});
