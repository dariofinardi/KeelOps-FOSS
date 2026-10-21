// Copyright (c) 2026 Jugaad s.r.l.
// SPDX-License-Identifier: AGPL-3.0-only

import { useTranslation } from "react-i18next";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ToggleRight } from "lucide-react";
import type { FunzioneIstanza, SetFunzioniSpenteInput } from "@kancrm/shared";
import { api } from "@/lib/api";
import { SectionIcon } from "@/components/ui/section-icon";
import { useConfirm } from "@/components/ui/confirm";

/**
 * **Le funzioni dell'istanza** (17/10/2026): le aree del nucleo e i moduli
 * dell'edizione che questa installazione usa. Spenta, un'area sparisce per
 * tutti — menu, rotte, scope dei gruppi — e i dati restano dove sono:
 * riaccenderla la rimette com'era, senza riavvio. Vedi
 * `plan/funzioni-istanza.md`.
 */
export function FunzioniSection() {
  const { t } = useTranslation();
  const confirm = useConfirm();
  const queryClient = useQueryClient();
  const { data: funzioni } = useQuery({
    queryKey: ["admin-funzioni"],
    queryFn: () => api<FunzioneIstanza[]>("/api/admin/funzioni"),
  });
  const salva = useMutation({
    mutationFn: (input: SetFunzioniSpenteInput) =>
      api<FunzioneIstanza[]>("/api/admin/funzioni", { method: "PUT", body: input }),
    onSuccess: (stato) => {
      queryClient.setQueryData(["admin-funzioni"], stato);
      // Il menu e le pagine leggono le funzioni dall'utente corrente.
      void queryClient.invalidateQueries({ queryKey: ["me"] });
      void queryClient.invalidateQueries({ queryKey: ["auth-providers"] });
    },
  });

  if (!funzioni) return null;
  const etichetta = (chiave: string) =>
    t(funzioni.find((f) => f.chiave === chiave)?.etichetta ?? chiave);
  const spente = funzioni.filter((f) => f.spenta).map((f) => f.chiave);

  const cambia = async (funzione: FunzioneIstanza, accendi: boolean) => {
    if (!accendi) {
      const dipendenti = funzioni.filter((f) => f.richiede.includes(funzione.chiave));
      const ok = await confirm({
        title: t("Spegnere «{{nome}}»?", { nome: t(funzione.etichetta) }),
        message: [
          t(
            "Sparisce per tutti: menu, pagine e permessi dei gruppi. I dati restano, e riaccendendola torna com'era.",
          ),
          dipendenti.length > 0
            ? t("Si spengono con lei: {{elenco}}.", {
                elenco: dipendenti.map((f) => t(f.etichetta)).join(", "),
              })
            : "",
        ]
          .filter(Boolean)
          .join(" "),
        confirmLabel: t("Spegni"),
        tone: "danger",
      });
      if (!ok) return;
    }
    salva.mutate({
      spente: accendi
        ? spente.filter((chiave) => chiave !== funzione.chiave)
        : [...spente, funzione.chiave],
    });
  };

  const gruppi: Array<{ titolo: string; voci: FunzioneIstanza[] }> = [
    { titolo: t("Aree"), voci: funzioni.filter((f) => f.tipo === "nucleo") },
    { titolo: t("Moduli"), voci: funzioni.filter((f) => f.tipo === "modulo") },
  ];

  return (
    <section className="rounded-lg border bg-card p-4">
      <h2 className="mb-1 flex items-center gap-2 font-semibold">
        <SectionIcon tone="violet">
          <ToggleRight className="size-4" />
        </SectionIcon>
        {t("Funzioni")}
      </h2>
      <p className="mb-3 text-sm text-muted-foreground">
        {t(
          "Le aree e i moduli che questa installazione usa. Lo scadenzario c'è sempre. Una funzione spenta sparisce per tutti; i dati restano.",
        )}
      </p>
      {gruppi
        .filter((gruppo) => gruppo.voci.length > 0)
        .map((gruppo) => (
          <div key={gruppo.titolo} className="mt-3">
            <h3 className="mb-1 text-xs font-medium uppercase text-muted-foreground">
              {gruppo.titolo}
            </h3>
            <ul className="flex flex-col divide-y">
              {gruppo.voci.map((funzione) => {
                const bloccata = funzione.spentaDa.length > 0;
                const accesa = !funzione.spenta && !bloccata;
                return (
                  <li key={funzione.chiave} className="flex items-start gap-3 py-2">
                    <input
                      id={`funzione-${funzione.chiave}`}
                      type="checkbox"
                      className="mt-1 size-4"
                      checked={accesa}
                      disabled={bloccata || salva.isPending}
                      onChange={(event) => void cambia(funzione, event.target.checked)}
                    />
                    <label htmlFor={`funzione-${funzione.chiave}`} className="min-w-0 text-sm">
                      <span className="font-medium">{t(funzione.etichetta)}</span>
                      <span className="block text-muted-foreground">{t(funzione.descrizione)}</span>
                      {bloccata && (
                        <span className="block text-xs text-amber-700 dark:text-amber-400">
                          {t("Spenta perché lo è: {{elenco}}", {
                            elenco: funzione.spentaDa.map(etichetta).join(", "),
                          })}
                        </span>
                      )}
                    </label>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
    </section>
  );
}
