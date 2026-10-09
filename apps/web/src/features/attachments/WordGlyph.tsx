/** Il glifo di Word (deriva dall'analisi fatta per MikeRust), inline come quello di Drive: una pagina blu con la «W», nessun asset esterno (CSP). */
export function WordGlyph({ className = "size-4" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden="true">
      <path fill="#41A5EE" d="M14 2H7.5A1.5 1.5 0 0 0 6 3.5V7l8 2.5 7-2.5V7l-7-5Z" />
      <path fill="#2B7CD3" d="M6 7h15v5l-7 2.5L6 12V7Z" />
      <path fill="#185ABD" d="M6 12h15v5l-7 2.5L6 17v-5Z" />
      <path fill="#103F91" d="M6 17h15v3.5A1.5 1.5 0 0 1 19.5 22H7.5A1.5 1.5 0 0 1 6 20.5V17Z" />
      <path fill="#1E5FBF" d="M2 6.5h10a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1H2a1 1 0 0 1-1-1v-9a1 1 0 0 1 1-1Z" />
      <path fill="#fff" d="m3.8 9 1.05 6h1.1l1.02-4.2L8 15h1.1l1.1-6H9.15l-.62 4.1L7.55 9h-1.1l-.98 4.1L4.85 9H3.8Z" />
    </svg>
  );
}
