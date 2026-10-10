// Copyright (c) 2026 Jugaad s.r.l.
// SPDX-License-Identifier: AGPL-3.0-only

import { describe, expect, it } from "vitest";
import { withoutInlineImagesOf } from "../src/modules/rich-text/inline-images";

describe("descrizione copiata da un task", () => {
  it("toglie solo le figure incollate in quel task", () => {
    const html =
      '<p>Prima</p><p><img src="/api/tasks/abc123/inline/x.png" alt=""></p>' +
      '<p><img src="https://esterno.it/logo.png"></p><img alt="a" src="/api/tasks/altro/inline/y.png">';
    expect(withoutInlineImagesOf(html, "abc123")).toBe(
      '<p>Prima</p><p></p><p><img src="https://esterno.it/logo.png"></p><img alt="a" src="/api/tasks/altro/inline/y.png">',
    );
    expect(withoutInlineImagesOf(null, "abc123")).toBeNull();
  });
});
