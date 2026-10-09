import { ColorPill } from "@/components/ui/color-pill";

/**
 * Anteprima flottante di una card trascinata (dnd-kit `DragOverlay`).
 *
 * Serve perché la card **non può muoversi dove sta**: da quando ogni colonna
 * scorre per conto suo (20/08/2026) il suo riquadro ritaglia, e trascinando si
 * vedeva la card scivolare *sotto* le colonne accanto invece che sopra. Il
 * `DragOverlay` la disegna fuori da tutti i riquadri, quindi passa sopra a
 * tutto e il trascinamento fra colonne adiacenti torna continuo.
 *
 * È volutamente **più semplice della card vera**: titolo, e una o due righe
 * per dire quale card è. Quello che sta trascinando lo sa già cos'è — gli serve
 * vedere *dove sta andando* — e le parti interattive (aprire, sganciare dalla
 * catena, il menù col tasto destro) in un'anteprima non si possono usare.
 * Stessa scelta di `ColumnDragPreview`, che le colonne le riassume allo stesso
 * modo.
 *
 * Le righe sotto il titolo sono **neutre di proposito** (`subtitle`, `meta`):
 * la usano i task con l'assegnatario, le offerte col cliente e il valore, le
 * bacheche col solo titolo. Una prop chiamata `assignee` avrebbe costretto a
 * scriverne una copia per le offerte.
 */
export function CardDragPreview({
  title,
  activityType,
  subtitle,
  meta,
}: {
  title: string;
  activityType?: { name: string; color: string } | null;
  /** Riga di contesto: chi ci lavora, oppure il cliente. */
  subtitle?: string | null;
  /** Riga in fondo, per un dato secco: il valore dell'offerta. */
  meta?: string | null;
}) {
  return (
    <div className="w-72 cursor-grabbing rounded-md border bg-card p-3 text-sm shadow-lg ring-2 ring-primary">
      <p className="font-medium">{title}</p>
      {activityType && (
        <div className="mt-1.5">
          <ColorPill label={activityType.name} color={activityType.color} />
        </div>
      )}
      {subtitle && <p className="mt-1.5 truncate text-xs text-muted-foreground">{subtitle}</p>}
      {meta && <p className="mt-1.5 text-xs font-medium">{meta}</p>}
    </div>
  );
}
