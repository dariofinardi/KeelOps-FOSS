import { useTranslation } from "react-i18next";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Puzzle } from "lucide-react";
import type { PluginScheda, SetPluginAttivoInput } from "@kancrm/shared";
import { ApiError, api } from "@/lib/api";
import { ColorPill } from "@/components/ui/color-pill";
import { SectionIcon } from "@/components/ui/section-icon";
import { useConfirm } from "@/components/ui/confirm";
import { useToast } from "@/components/ui/toast";

/**
 * **I plugin**, nella pagina Sistema (23/09/2026): chi c'è, in che versione,
 * di chi è, cosa fa — e l'interruttore per spegnerlo.
 *
 * Installare e accendere sono due cose diverse:
 *  - **installato** vuol dire in `PLUGINS` nel `.env` e montato all'avvio: si
 *    fa con il suo `installa.sh` e un riavvio, non da una pagina web;
 *  - **attivo** si decide da qui, a caldo: spento, le sue pagine e le sue API
 *    rispondono 404, sparisce dal menu e dal riepilogo del mattino. I dati e le
 *    tabelle restano dove sono, e i lavori in sottofondo si fermano solo al
 *    prossimo riavvio.
 *
 * La versione della struttura (`plugin_<nick>_config`) resta accanto a quella
 * del codice: è la prima cosa da guardare quando un plugin «non si vede».
 */
export function PluginsSection({ plugins }: { plugins: PluginScheda[] }) {
  const { t, i18n } = useTranslation();
  const confirm = useConfirm();
  const toast = useToast();
  const queryClient = useQueryClient();

  const toggle = useMutation({
    mutationFn: ({ nome, attivo }: { nome: string; attivo: boolean }) =>
      api<{ plugins: PluginScheda[] }>(`/api/admin/plugins/${encodeURIComponent(nome)}`, {
        method: "PUT",
        body: { attivo } satisfies SetPluginAttivoInput,
      }),
    onSuccess: (_esito, { attivo }) => {
      toast(attivo ? t("Plugin attivato.") : t("Plugin disattivato."), "success");
      void queryClient.invalidateQueries({ queryKey: ["admin-system"] });
      // Il menu e le ancore leggono l'elenco dei plugin visibili: va riletto.
      void queryClient.invalidateQueries({ queryKey: ["plugins-ui"] });
    },
    onError: (error) =>
      toast(error instanceof ApiError ? error.message : t("Errore imprevisto"), "error"),
  });

  const lingua = i18n.language.split("-")[0] ?? "it";
  const sommarioDi = (p: PluginScheda) => p.sommario[lingua] ?? p.sommario.en ?? p.sommario.it ?? "";
  // «Commerciale» da solo nei cataloghi è già la persona dell'area vendite.
  const licenzaDi = (licenza: string) =>
    licenza === "libero"
      ? t("Licenza libera")
      : licenza === "commerciale"
        ? t("Licenza commerciale")
        : t("Licenza: {{licenza}}", { licenza });

  return (
    <section className="rounded-lg border bg-card p-4">
      <h2 className="mb-1 flex items-center gap-2 font-semibold">
        <SectionIcon tone="violet">
          <Puzzle className="size-4" />
        </SectionIcon>
        {t("Plugin")}
      </h2>
      <p className="mb-3 text-sm text-muted-foreground">
        {t(
          "Un plugin spento sparisce dal menu e le sue pagine non rispondono più; i suoi dati restano. Si installa con il suo installa.sh e un riavvio.",
        )}
      </p>
      {plugins.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t("Nessun plugin in questa installazione.")}</p>
      ) : (
        <ul className="flex flex-col divide-y">
          {plugins.map((p) => {
            const inCorso = toggle.isPending && toggle.variables?.nome === p.nome;
            return (
              <li key={p.nome} className="flex flex-col gap-2 py-3 sm:flex-row sm:items-start">
                <div className="min-w-0 flex-1">
                  <p className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                    <span className="font-medium">{p.titolo}</span>
                    {p.installato && (
                      <ColorPill
                        color={p.attivo ? "#059669" : "#64748b"}
                        label={p.attivo ? t("Attivo") : t("Spento")}
                        dot="small"
                      />
                    )}
                    <span className="text-sm tabular-nums text-muted-foreground">
                      {p.schemaVersion === null
                        ? t("versione {{version}}", { version: p.versione })
                        : t("versione {{version}} · tabelle plugin_{{nick}}_* v{{schema}}", {
                            version: p.versione,
                            nick: p.nick ?? "",
                            schema: p.schemaVersion,
                          })}
                    </span>
                  </p>
                  {sommarioDi(p) && <p className="mt-0.5 text-sm">{sommarioDi(p)}</p>}
                  <p className="mt-0.5 break-words text-xs text-muted-foreground">
                    {[p.copyright, p.licenza ? licenzaDi(p.licenza) : null]
                      .filter(Boolean)
                      .join(" · ")}
                  </p>
                </div>
                <div className="shrink-0">
                  {p.installato ? (
                    <button
                      type="button"
                      disabled={inCorso}
                      className={
                        p.attivo
                          ? "min-h-10 rounded-md border border-destructive px-3 py-1.5 text-sm font-medium text-destructive sm:min-h-0"
                          : "min-h-10 rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground sm:min-h-0"
                      }
                      onClick={() => {
                        void (async () => {
                          if (p.attivo) {
                            const ok = await confirm({
                              title: t("Disattivare {{plugin}}?", { plugin: p.titolo }),
                              message: t(
                                "Chi lo sta usando si vedrà rispondere che il plugin è spento. I dati restano: lo riaccendi da qui quando vuoi.",
                              ),
                              confirmLabel: t("Disattiva"),
                              tone: "danger",
                            });
                            if (!ok) return;
                          }
                          toggle.mutate({ nome: p.nome, attivo: !p.attivo });
                        })();
                      }}
                    >
                      {p.attivo ? t("Disattiva") : t("Attiva")}
                    </button>
                  ) : p.motivo ? (
                    // Nel `PLUGINS` del server, ma questa edizione non lo prevede: il
                    // motivo esatto (edizione, funzioni mancanti) sta nel suggerimento.
                    <span className="text-xs text-muted-foreground" title={p.motivo}>
                      {t("Non disponibile in questa edizione")}
                    </span>
                  ) : (
                    <span className="text-xs text-muted-foreground">{t("Non installato")}</span>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
