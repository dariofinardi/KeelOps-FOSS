// Copyright (c) 2026 Jugaad s.r.l.
// SPDX-License-Identifier: AGPL-3.0-only

import { useEffect, useState, type InputHTMLAttributes } from "react";

/**
 * Color picker che salva SOLO alla chiusura (blur), non a ogni variazione.
 *
 * Un `<input type="color">` controllato emette "change" di continuo mentre si
 * trascina nel selettore: chi salva a ogni evento genera decine di richieste per
 * una singola scelta. Qui il trascinamento resta locale e il commit parte quando
 * si esce dal campo, cioè a scelta conclusa.
 */
export function ColorField({
  value,
  onCommit,
  ...rest
}: {
  value: string;
  onCommit: (value: string) => void;
} & Omit<InputHTMLAttributes<HTMLInputElement>, "value" | "onChange" | "type">) {
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);

  return (
    <input
      {...rest}
      type="color"
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={(e) => {
        if (draft !== value) onCommit(draft);
        rest.onBlur?.(e);
      }}
    />
  );
}
