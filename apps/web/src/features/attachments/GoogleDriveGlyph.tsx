/** Triangolo di Google Drive a colori, inline: nessun asset esterno (CSP). */
export function GoogleDriveGlyph({ className = "size-4" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden="true">
      <path fill="#188038" d="M8.16 1.5 0 15.6l4.08 7.05 8.16-14.1L8.16 1.5Z" />
      <path fill="#FBBC04" d="M15.84 1.5H8.16l8.16 14.1h7.68L15.84 1.5Z" />
      <path fill="#4285F4" d="M4.08 22.65h15.84L24 15.6H8.16l-4.08 7.05Z" />
    </svg>
  );
}
