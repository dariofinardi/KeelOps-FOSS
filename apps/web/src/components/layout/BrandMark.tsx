import { useBranding } from "@/features/theme/useBranding";
import { KeelopsMark } from "@/components/ui/keelops-logo";

/**
 * Identità aziendale in testa alle pagine: logo e titolo impostati dall'admin
 * (pagina Aspetto), oppure l'identità di default "KeelOps".
 *
 * Sta qui e non dentro AppShell perché la usano anche le aree esterne — chi entra
 * come monitor vendite deve vedere il marchio dell'azienda con cui ha a che fare,
 * non il nome del programma.
 */
export function BrandMark({ suffix }: { suffix?: string }) {
  const branding = useBranding().data;
  const title = branding?.title?.trim();
  const coda = suffix ? ` · ${suffix}` : "";
  if (branding?.logoUrl) {
    return (
      <>
        <img src={branding.logoUrl} alt="Logo" className="h-6 max-w-[140px] object-contain" />
        <span className="text-sm font-semibold tracking-tight">
          {title ? `${title}${coda}` : suffix}
        </span>
      </>
    );
  }
  return (
    <>
      <KeelopsMark className="size-6" />
      <span className="text-sm font-semibold tracking-tight">{`${title || "KeelOps"}${coda}`}</span>
    </>
  );
}
