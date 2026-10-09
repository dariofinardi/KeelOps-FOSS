import { useTranslation } from "react-i18next";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArchiveRestore, Building2, FolderKanban, ListTodo, Trash2, UserRound } from "lucide-react";
import { ApiError, api } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { useConfirm } from "@/components/ui/confirm";
import { useToast } from "@/components/ui/toast";
import { formatDateTime } from "@/features/tasks/task-utils";

type TrashType = "task" | "project" | "company" | "contact";

interface TrashItem {
  type: TrashType;
  id: string;
  label: string;
  context: string;
  deletedAt: string;
}

const TYPE_ICONS: Record<TrashType, typeof ListTodo> = {
  task: ListTodo,
  project: FolderKanban,
  company: Building2,
  contact: UserRound,
};

export function TrashPage() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const confirm = useConfirm();
  const toast = useToast();
  const { data, isLoading } = useQuery({
    queryKey: ["trash"],
    queryFn: () => api<{ items: TrashItem[] }>("/api/trash"),
  });

  const invalidateAll = () => {
    // Il ripristino può toccare qualunque modulo.
    void queryClient.invalidateQueries();
  };

  const restore = useMutation({
    mutationFn: (item: TrashItem) =>
      api<void>("/api/trash/restore", {
        method: "POST",
        body: { type: item.type, id: item.id },
      }),
    onSuccess: (_data, item) => {
      invalidateAll();
      toast(t('"{{label}}" ripristinato.', { label: item.label }), "success");
    },
    onError: (error) =>
      toast(error instanceof ApiError ? error.message : t("Errore nel ripristino"), "error"),
  });

  const destroy = useMutation({
    mutationFn: (item: TrashItem) =>
      api<void>(`/api/trash/${item.type}/${item.id}`, { method: "DELETE" }),
    onSuccess: (_data, item) => {
      invalidateAll();
      toast(t('"{{label}}" eliminato definitivamente.', { label: item.label }), "success");
    },
    onError: (error) =>
      toast(error instanceof ApiError ? error.message : t("Errore nell'eliminazione"), "error"),
  });

  const emptyTrash = useMutation({
    mutationFn: () => api<{ purged: number }>("/api/trash", { method: "DELETE" }),
    onSuccess: (result) => {
      invalidateAll();
      toast(
        t("Cestino svuotato: {{count}} elementi eliminati.", { count: result.purged }),
        "success",
      );
    },
    onError: (error) =>
      toast(error instanceof ApiError ? error.message : t("Errore nello svuotamento"), "error"),
  });

  if (isLoading) {
    return <p className="text-sm text-muted-foreground">{t("Caricamento cestino…")}</p>;
  }

  const items = data?.items ?? [];

  /** Svuotamento totale: irreversibile, quindi la conferma dice quanto e cosa. */
  const onEmpty = async () => {
    const ok = await confirm({
      title: t("Svuotare il cestino?"),
      message: t(
        "{{count}} elementi verranno eliminati definitivamente, insieme ai file allegati che non sono usati altrove. L'operazione non è reversibile.",
        { count: items.length },
      ),
      confirmLabel: t("Elimina definitivamente"),
      tone: "danger",
    });
    if (ok) emptyTrash.mutate();
  };

  return (
    <div className="flex max-w-3xl flex-col gap-4">
      <div className="flex items-start justify-between gap-4">
        <p className="text-sm text-muted-foreground">
          {t(
            "Gli elementi eliminati restano qui per 30 giorni, poi vengono rimossi definitivamente in automatico. Eliminando un task vengono spostati nel cestino anche i suoi subtask; un progetto porta con sé tutti i suoi task.",
          )}
        </p>
        {items.length > 0 && (
          <Button
            variant="outline"
            className="shrink-0"
            disabled={emptyTrash.isPending}
            onClick={() => void onEmpty()}
          >
            <Trash2 className="size-4 text-destructive" />
            {emptyTrash.isPending ? t("Svuotamento…") : t("Svuota cestino")}
          </Button>
        )}
      </div>

      {items.length === 0 ? (
        <div className="rounded-lg border border-dashed p-10 text-center text-sm text-muted-foreground">
          {t("Il cestino è vuoto.")}
        </div>
      ) : (
        <ul className="flex flex-col gap-2">
          {items.map((item) => {
            const Icon = TYPE_ICONS[item.type];
            return (
              <li
                key={`${item.type}-${item.id}`}
                className="flex items-center gap-3 rounded-lg border bg-card px-4 py-2.5"
              >
                <Icon className="size-4 shrink-0 text-muted-foreground" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{item.label}</p>
                  <p className="text-xs text-muted-foreground">
                    {t("{{context}} · eliminato il {{date}}", {
                      context: item.context,
                      date: formatDateTime(item.deletedAt),
                    })}
                  </p>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={restore.isPending}
                  onClick={() => restore.mutate(item)}
                >
                  <ArchiveRestore className="size-3.5" /> {t("Ripristina")}
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  title={t("Elimina definitivamente")}
                  disabled={destroy.isPending}
                  onClick={() => {
                    void confirm({
                      title: t("Eliminare definitivamente?"),
                      message: t(
                        '"{{label}}" verrà rimosso per sempre, senza possibilità di recupero.',
                        { label: item.label },
                      ),
                      confirmLabel: t("Elimina per sempre"),
                      tone: "danger",
                    }).then((ok) => {
                      if (ok) destroy.mutate(item);
                    });
                  }}
                >
                  <Trash2 className="size-4 text-destructive" />
                </Button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
