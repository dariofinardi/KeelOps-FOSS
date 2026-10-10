// Copyright (c) 2026 Jugaad s.r.l.
// SPDX-License-Identifier: AGPL-3.0-only

import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { SectionIcon } from "./section-icon";

describe("SectionIcon", () => {
  it("colora la pastiglia secondo il tono, in chiaro e in scuro", () => {
    render(
      <SectionIcon tone="amber">
        <svg data-testid="icona" />
      </SectionIcon>,
    );
    const badge = screen.getByTestId("icona").parentElement!;
    // Le classi devono essere per esteso: costruite a pezzi, Tailwind non le
    // troverebbe nel sorgente e la pastiglia resterebbe grigia.
    expect(badge.className).toContain("bg-amber-100");
    expect(badge.className).toContain("text-amber-600");
    expect(badge.className).toContain("dark:bg-amber-500/15");
  });

  it("è decorativa: gli screen reader la saltano, il titolo basta", () => {
    render(
      <SectionIcon tone="sky">
        <svg data-testid="icona" />
      </SectionIcon>,
    );
    expect(screen.getByTestId("icona").parentElement).toHaveAttribute("aria-hidden");
  });
});
