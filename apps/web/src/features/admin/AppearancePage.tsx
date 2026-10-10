// Copyright (c) 2026 Jugaad s.r.l.
// SPDX-License-Identifier: AGPL-3.0-only

import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Palette, Upload } from "lucide-react";
import { BRANDING_TITLE_MAX, CompanyTheme, type Branding } from "@kancrm/shared";
import { api, ApiError, apiUpload } from "@/lib/api";
import { downscaleImage } from "@/lib/image";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/components/ui/toast";
import { useBranding } from "@/features/theme/useBranding";
import { SezioniAspetto } from "@/edition/slot-pagine";

const THEME_OPTIONS: Array<{ value: CompanyTheme; label: string; colors: string[] }> = [
  { value: "jugaad", label: "Jugaad (viola)", colors: ["#7c3aed", "#ec4899", "#f59e0b"] },
  { value: "radaee", label: "Radaee (blu)", colors: ["#2563eb", "#f97316"] },
  { value: "padformusician", label: "PadForMusician (teal)", colors: ["#0d9488", "#14b8a6"] },
];

/** Pannello admin: logo aziendale e palette applicata a chi usa il tema "Aziendale". */
export function AppearancePage() {
  const { t } = useTranslation();
  const toast = useToast();
  const queryClient = useQueryClient();
  const { data: branding } = useBranding();
  const fileRef = useRef<HTMLInputElement>(null);
  const refresh = () => queryClient.invalidateQueries({ queryKey: ["branding"] });

  // Titolo: bozza locale, salvata quando si conferma (bottone o blur).
  const [title, setTitle] = useState("");
  useEffect(() => setTitle(branding?.title ?? ""), [branding?.title]);

  const saveTitle = useMutation({
    mutationFn: (value: string) =>
      api<Branding>("/api/branding", { method: "PUT", body: { title: value } }),
    onSuccess: () => {
      refresh();
      toast(t("Titolo aggiornato."), "success");
    },
    onError: (error) => toast(error instanceof ApiError ? error.message : t("Errore"), "error"),
  });
  const currentTitle = branding?.title ?? "";
  const commitTitle = () => {
    const next = title.trim();
    if (next !== currentTitle) saveTitle.mutate(next);
  };

  const uploadLogo = useMutation({
    mutationFn: async (file: File) => {
      await apiUpload("/api/branding/logo", file);
    },
    onSuccess: () => {
      refresh();
      toast(t("Logo aggiornato."), "success");
    },
    onError: (error) => toast(error instanceof Error ? error.message : t("Errore"), "error"),
  });

  const removeLogo = useMutation({
    mutationFn: () => api<{ logoUrl: null }>("/api/branding/logo", { method: "DELETE" }),
    onSuccess: () => {
      refresh();
      toast(t("Logo rimosso."), "success");
    },
  });

  const setTheme = useMutation({
    mutationFn: (companyTheme: CompanyTheme) =>
      api<Branding>("/api/branding", { method: "PUT", body: { companyTheme } }),
    onSuccess: () => {
      refresh();
      toast(t("Tema aziendale aggiornato."), "success");
    },
    onError: (error) => toast(error instanceof ApiError ? error.message : t("Errore"), "error"),
  });

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-6">
      <section className="rounded-lg border bg-card p-5">
        <h2 className="mb-1 flex items-center gap-2 font-semibold">
          <Palette className="size-4" /> {t("Aspetto")}
        </h2>
        <p className="mb-4 text-sm text-muted-foreground">
          {t(
            'Logo e palette aziendale. La palette si applica agli utenti che scelgono il tema "Aziendale" dal proprio profilo.',
          )}
        </p>

        <h3 className="mb-2 text-sm font-semibold">{t("Logo")}</h3>
        <div className="mb-6 flex flex-wrap items-center gap-4">
          {branding?.logoUrl ? (
            <img
              src={branding.logoUrl}
              alt={t("Logo")}
              className="h-10 max-w-[180px] object-contain"
            />
          ) : (
            <span className="text-sm text-muted-foreground">
              {t('Nessun logo (si usa "KeelOps").')}
            </span>
          )}
          <input
            ref={fileRef}
            type="file"
            accept="image/png,image/jpeg,image/webp,image/svg+xml"
            className="hidden"
            onChange={async (e) => {
              const file = e.target.files?.[0];
              e.target.value = "";
              if (file) uploadLogo.mutate(await downscaleImage(file, 512));
            }}
          />
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={uploadLogo.isPending}
            onClick={() => fileRef.current?.click()}
          >
            <Upload className="size-4" /> {branding?.logoUrl ? t("Cambia") : t("Carica")}
          </Button>
          {branding?.logoUrl && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={removeLogo.isPending}
              onClick={() => removeLogo.mutate()}
            >
              {t("Rimuovi")}
            </Button>
          )}
        </div>

        <h3 className="mb-2 text-sm font-semibold">{t("Titolo")}</h3>
        <div className="mb-6 flex flex-wrap items-end gap-3">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="branding-title">{t("Testo accanto al logo")}</Label>
            <Input
              id="branding-title"
              value={title}
              maxLength={BRANDING_TITLE_MAX}
              placeholder="KeelOps"
              className="w-64"
              onChange={(e) => setTitle(e.target.value)}
              onBlur={commitTitle}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  commitTitle();
                }
              }}
            />
          </div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={saveTitle.isPending || title.trim() === currentTitle}
            onClick={commitTitle}
          >
            {t("Salva")}
          </Button>
        </div>
        <p className="-mt-4 mb-6 text-xs text-muted-foreground">
          {t(
            'Lascia vuoto per usare il testo predefinito "KeelOps". Il titolo compare accanto al logo nella barra laterale.',
          )}
        </p>

        <h3 className="mb-2 text-sm font-semibold">{t("Tema aziendale")}</h3>
        <div className="grid gap-3 sm:grid-cols-3">
          {THEME_OPTIONS.map((opt) => {
            const active = branding?.companyTheme === opt.value;
            return (
              <button
                key={opt.value}
                type="button"
                onClick={() => setTheme.mutate(opt.value)}
                className={cn(
                  "flex flex-col gap-2 rounded-lg border p-3 text-left transition-colors hover:bg-muted/30",
                  active && "border-ring ring-2 ring-ring",
                )}
              >
                <span className="flex gap-1">
                  {opt.colors.map((c) => (
                    <span key={c} className="size-5 rounded-full" style={{ backgroundColor: c }} />
                  ))}
                </span>
                <span className="text-sm font-medium">{t(opt.label)}</span>
                <span className="text-xs text-muted-foreground">{active ? t("Attivo") : " "}</span>
              </button>
            );
          })}
        </div>
      </section>
      {SezioniAspetto && <SezioniAspetto />}
    </div>
  );
}
