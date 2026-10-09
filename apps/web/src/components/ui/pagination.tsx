import { ChevronLeft, ChevronRight } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "./button";

interface PaginationBarProps {
  page: number;
  pageSize: number;
  total: number;
  onPageChange: (page: number) => void;
}

export function PaginationBar({ page, pageSize, total, onPageChange }: PaginationBarProps) {
  const { t } = useTranslation();
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  if (total <= pageSize) {
    return (
      <p className="text-xs text-muted-foreground">{t("{{count}} risultato", { count: total })}</p>
    );
  }
  return (
    <div className="flex items-center gap-2 text-xs text-muted-foreground">
      <span>
        {t("{{total}} risultati · pagina {{page}} di {{pageCount}}", { total, page, pageCount })}
      </span>
      <Button
        variant="outline"
        size="icon"
        className="size-7"
        disabled={page <= 1}
        onClick={() => onPageChange(page - 1)}
        aria-label={t("Pagina precedente")}
      >
        <ChevronLeft className="size-3.5" />
      </Button>
      <Button
        variant="outline"
        size="icon"
        className="size-7"
        disabled={page >= pageCount}
        onClick={() => onPageChange(page + 1)}
        aria-label={t("Pagina successiva")}
      >
        <ChevronRight className="size-3.5" />
      </Button>
    </div>
  );
}
