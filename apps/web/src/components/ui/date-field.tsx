import { useEffect, useState, type InputHTMLAttributes } from "react";
import { Input } from "./input";

/**
 * Campi data e ora che non si corrompono mentre si digita.
 *
 * Un `<input type="date">` nativo, mentre si scrive l'anno cifra per cifra, emette
 * date COMPLETE e quindi apparentemente valide: 0002-07-30, 0020-07-30, 0202-07-30…
 * Chi salva a ogni "change" le persiste (task con anno 0006) e il re-render riporta
 * il cursore all'inizio, rendendo impossibile finire di scrivere l'anno.
 *
 * DateField propaga il valore solo quando è **plausibile** (vuoto, oppure data
 * completa con anno 1900-2100): la digitazione intermedia resta locale, quindi non
 * si salva nulla di sbagliato e il cursore non salta. Un residuo non plausibile
 * viene annullato all'uscita dal campo (o con Esc).
 */
const MIN_YEAR = 1900;
const MAX_YEAR = 2100;

/** true se è vuoto oppure una data completa (YYYY-MM-DD) con anno tra MIN e MAX. */
export function isPlausibleDate(value: string): boolean {
  if (value === "") return true;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const year = Number(value.slice(0, 4));
  return year >= MIN_YEAR && year <= MAX_YEAR;
}

/** true se è vuoto oppure un orario completo HH:MM (24h). */
export function isPlausibleTime(value: string): boolean {
  if (value === "") return true;
  const m = /^(\d{2}):(\d{2})$/.exec(value);
  return m !== null && Number(m[1]) <= 23 && Number(m[2]) <= 59;
}

type FieldProps = {
  /** Valore corrente ("YYYY-MM-DD" / "HH:MM") o "" se assente. */
  value: string;
  /** Chiamata solo con un valore valido (null se il campo è stato svuotato). */
  onCommit: (value: string | null) => void;
} & Omit<InputHTMLAttributes<HTMLInputElement>, "value" | "onChange" | "type">;

function useDraft(value: string) {
  const [draft, setDraft] = useState(value);
  // Riallinea quando il valore cambia dall'esterno. Durante la digitazione `value`
  // non cambia (non si è ancora propagato nulla), quindi non interferisce.
  useEffect(() => setDraft(value), [value]);
  return [draft, setDraft] as const;
}

export function DateField({ value, onCommit, min, max, ...rest }: FieldProps) {
  const [draft, setDraft] = useDraft(value);

  const commit = (next: string) => {
    if (next !== value) onCommit(next === "" ? null : next);
  };

  return (
    <Input
      {...rest}
      type="date"
      min={min ?? `${MIN_YEAR}-01-01`}
      max={max ?? `${MAX_YEAR}-12-31`}
      value={draft}
      onChange={(e) => {
        const next = e.target.value;
        setDraft(next);
        // Solo i valori plausibili escono dal campo: gli anni parziali restano qui.
        if (isPlausibleDate(next)) commit(next);
      }}
      onBlur={(e) => {
        if (!isPlausibleDate(draft)) setDraft(value); // scarta il residuo non valido
        rest.onBlur?.(e);
      }}
      onKeyDown={(e) => {
        if (e.key === "Escape") setDraft(value);
        rest.onKeyDown?.(e);
      }}
    />
  );
}

/**
 * Orario: a differenza della data non si può distinguere un orario "in costruzione"
 * (09:00 mentre si scrive 09:30 è comunque valido), quindi si conferma all'uscita
 * dal campo o con Invio — così un salvataggio automatico non riporta il cursore
 * all'inizio a metà digitazione.
 */
export function TimeField({ value, onCommit, ...rest }: FieldProps) {
  const [draft, setDraft] = useDraft(value);

  const commit = () => {
    if (!isPlausibleTime(draft)) {
      setDraft(value);
      return;
    }
    if (draft !== value) onCommit(draft === "" ? null : draft);
  };

  return (
    <Input
      {...rest}
      type="time"
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={(e) => {
        commit();
        rest.onBlur?.(e);
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter") commit();
        else if (e.key === "Escape") setDraft(value);
        rest.onKeyDown?.(e);
      }}
    />
  );
}
