// Copyright (c) 2026 Jugaad s.r.l.
// SPDX-License-Identifier: AGPL-3.0-only

import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { useDebouncedValue } from "@/lib/useDebouncedValue";
import {
  Building2,
  FolderKanban,
  Globe,
  HandCoins,
  LifeBuoy,
  ListFilter,
  ListTodo,
  MessageSquare,
  Paperclip,
  Repeat,
  Search,
  UserRound,
  X,
} from "lucide-react";
import { TaskKind, type SearchResult } from "@kancrm/shared";
import { api } from "@/lib/api";
import { useFocusTrap } from "@/lib/focus-trap";
import { isTypingTarget } from "@/lib/keyboard";
import { useListPrefs } from "@/lib/useListPrefs";
import { useViewSearchTarget } from "@/lib/view-search";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useRecordOpener } from "@/features/tasks/useRecordOpener";
import { TopbarTagFilter } from "./TopbarTagFilter";

const TYPE_ICONS = {
  task: ListTodo,
  deal: HandCoins,
  ticket: LifeBuoy,
  project: FolderKanban,
  recurrence: Repeat,
  comment: MessageSquare,
  attachment: Paperclip,
  contact: UserRound,
  company: Building2,
} as const;

function ResultsList({
  results,
  onSelect,
}: {
  results: SearchResult[] | undefined;
  onSelect: (result: SearchResult) => void;
}) {
  const { t } = useTranslation();
  return (
    <ul>
      {results?.map((result) => {
        const Icon = TYPE_ICONS[result.type];
        return (
          <li key={`${result.type}-${result.id}`}>
            <button
              className="flex w-full items-center gap-2.5 px-3 py-2 text-left text-sm hover:bg-muted/50"
              onMouseDown={(e) => {
                e.preventDefault();
                onSelect(result);
              }}
            >
              <Icon className="size-4 shrink-0 text-muted-foreground" />
              <span className="min-w-0 flex-1">
                <span className="flex items-center gap-1.5">
                  <span className="min-w-0 flex-1 truncate font-medium">{result.title}</span>
                  {/* Un task chiuso si cerca eccome — completato non è
                      cancellato — ma va riconosciuto **prima** di aprirlo: su
                      un task di progetto il sottotitolo porta il progetto, non
                      lo stato, quindi "Non rinnova più" e "In sviluppo" si
                      leggevano uguali (19/08/2026). Si mostra il nome dello
                      stato, non un generico "chiuso": dice di più e usa le
                      parole che l'utente ha configurato. */}
                  {result.closed && (
                    <span className="shrink-0 rounded-full border px-1.5 py-px text-[11px] text-muted-foreground">
                      {result.statusName || t("chiuso")}
                    </span>
                  )}
                </span>
                <span className="block truncate text-xs text-muted-foreground">
                  {result.subtitle}
                </span>
              </span>
            </button>
          </li>
        );
      })}
      {results && results.length === 0 && (
        <li className="p-4 text-center text-sm text-muted-foreground">{t("Nessun risultato.")}</li>
      )}
    </ul>
  );
}

type SearchScope = "local" | "global";

/**
 * **Il filtro della vista che il campo non sta mostrando.**
 *
 * La ricerca locale si ricorda (`useListPrefs`, come ogni altro filtro), ma in
 * modo globale il campo mostra la ricerca globale: un testo rimasto nel filtro
 * della vista continua a nascondere righe **senza che si veda da nessuna
 * parte**. È esattamente come si presenta: "Nessun progetto trovato con questi
 * filtri" con 30 progetti in banca dati e nessun filtro visibile (18/08/2026).
 *
 * Sta qui e non nelle pagine perché il modo lo conosce solo la barra, ed è dove
 * l'occhio va a cercare la ricerca. La ✕ lo svuota.
 */
function ActiveViewFilter({ text, onClear }: { text: string; onClear: () => void }) {
  const { t } = useTranslation();
  return (
    <button
      type="button"
      onClick={onClear}
      title={t("Togli il filtro di questa vista")}
      className="flex max-w-48 items-center gap-1.5 rounded-full border border-primary/40 bg-primary/10 px-2.5 py-1 text-xs text-foreground hover:bg-primary/20"
    >
      <ListFilter className="size-3 shrink-0 text-primary" />
      <span className="truncate">{text}</span>
      <X className="size-3 shrink-0 text-muted-foreground" />
    </button>
  );
}

/** L'interruttore locale/globale: compare solo dove la vista si è registrata. */
function ScopeToggle({
  scope,
  onChange,
  localLabel,
}: {
  scope: SearchScope;
  onChange: (scope: SearchScope) => void;
  localLabel: string;
}) {
  const { t } = useTranslation();
  return (
    <div className="flex rounded-md border p-0.5" role="group" aria-label={t("Dove cercare")}>
      <Button
        variant={scope === "local" ? "default" : "ghost"}
        size="sm"
        className="h-7 px-2"
        title={localLabel}
        aria-pressed={scope === "local"}
        onClick={() => onChange("local")}
      >
        <ListFilter className="size-4" />
      </Button>
      <Button
        variant={scope === "global" ? "default" : "ghost"}
        size="sm"
        className="h-7 px-2"
        title={t("Cerca ovunque")}
        aria-pressed={scope === "global"}
        onClick={() => onChange("global")}
      >
        <Globe className="size-4" />
      </Button>
    </div>
  );
}

/**
 * IL campo di ricerca dell'applicazione (topbar): unico, con due destinatari.
 *
 * In modo LOCALE (il default, dove la vista si è registrata — vedi
 * lib/view-search) la digitazione filtra in diretta l'elenco della vista
 * corrente, senza pannelli: è l'erede del "Cerca…" che stava nella barra dei
 * filtri. In modo GLOBALE si comporta come la storica "Cerca ovunque"
 * (dropdown dei risultati, minimo 2 caratteri). Ctrl+K porta SEMPRE al globale:
 * è la scorciatoia "vai alla ricerca globale", da qualunque vista.
 *
 * Il debounce vive QUI, una volta sola: prima ogni pagina aveva il suo (o non
 * ce l'aveva: Ticket e Contatti interrogavano a ogni tasto).
 */
export function GlobalSearch() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const target = useViewSearchTarget();
  const { prefs, update } = useListPrefs<{ scope: SearchScope }>("kancrm-search-scope", {
    scope: "local",
  });
  // Senza registrazione il locale non esiste: si è globali, e il toggle sparisce.
  const scope: SearchScope = target ? prefs.scope : "global";
  const [text, setText] = useState("");
  const [open, setOpen] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const record = useRecordOpener();
  const inputRef = useRef<HTMLInputElement>(null);
  const mobileTrapRef = useFocusTrap(mobileOpen);
  const debounced = useDebouncedValue(text);

  // LOCALE → il testo (a digitazione ferma) finisce nel filtro della vista.
  const setViewQ = target?.setQ;
  const viewQ = target?.q;
  useEffect(() => {
    if (scope === "local" && setViewQ && debounced !== viewQ) setViewQ(debounced);
  }, [scope, setViewQ, viewQ, debounced]);
  // …e il campo segue la vista: un "Azzera filtri" o un cambio pagina che
  // svuotano `q` devono svuotare anche quello che si legge qui sopra.
  useEffect(() => {
    if (scope === "local") setText(viewQ ?? "");
  }, [scope, viewQ]);
  // Cambiando vista (registrazione che sparisce) il campo non porta con sé la
  // ricerca precedente: un residuo pre-compilato nel globale confonde.
  useEffect(() => {
    if (!target) setText("");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target === null]);

  // GLOBALE: identica a prima (minimo 2 caratteri, cache breve).
  const { data: results } = useQuery({
    queryKey: ["search", debounced],
    queryFn: () => api<SearchResult[]>(`/api/search?q=${encodeURIComponent(debounced)}`),
    enabled: scope === "global" && debounced.trim().length >= 2,
    retry: false,
    staleTime: 10_000,
  });

  /**
   * Due scorciatoie, due intenzioni diverse:
   *  - **Ctrl+K** = "vai alla ricerca globale": porta il fuoco **e** cambia
   *    modo, da qualunque vista;
   *  - la **barra** = "portami nel campo", lasciando il modo com'è. È la convenzione
   *    diffusa (GitHub, GitLab, Slack) ed è quella che serve nove volte su
   *    dieci, perché il campo su cui si scrive davvero è quello locale.
   *
   * `Ctrl+F` resta al browser di proposito: è il *trova nella pagina*, utile
   * proprio dove il nostro filtro non arriva, e prenderlo fa dire "questa
   * applicazione mi ha rotto il browser".
   */
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        update({ scope: "global" });
        inputRef.current?.focus();
        setOpen(true);
        return;
      }
      // Una lettera sola non è una scorciatoia mentre si scrive: "/" dentro un
      // campo è una barra, e in una data ce ne sono due.
      if (event.key === "/" && !event.ctrlKey && !event.metaKey && !event.altKey) {
        if (isTypingTarget(event.target)) return;
        event.preventDefault();
        inputRef.current?.focus();
        setOpen(true);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [update]);

  const select = (result: SearchResult) => {
    setOpen(false);
    setMobileOpen(false);
    setText("");
    if (result.type === "deal") record.open(result.id, TaskKind.DEAL);
    else if (result.type === "task") record.openTask(result.id);
    else if (result.type === "ticket") record.open(result.id, TaskKind.TICKET);
    // Il match sta DENTRO un task (messaggio, allegato): si apre quel task,
    // qualunque sia la sua natura.
    else if (result.type === "comment" || result.type === "attachment") {
      if (result.taskId) record.open(result.taskId, result.taskKind);
    } else if (result.type === "project") navigate(`/progetti/${result.id}`);
    else if (result.type === "recurrence") navigate("/bacheche?view=recurrence");
    else navigate("/contatti");
  };

  // Il segnaposto annuncia la scorciatoia che vale **in quel modo**: Ctrl+K
  // porta al globale, quindi si legge lì; "/" porta nel campo com'è, quindi si
  // legge nel locale. Annunciare una scorciatoia che cambia il modo sotto le
  // mani sarebbe peggio del silenzio.
  const placeholder =
    scope === "global"
      ? t("Cerca ovunque…  (Ctrl+K)")
      : `${target?.placeholder ?? t("Cerca in questa vista…")}  (/)`;

  return (
    <>
      {/* Desktop: tag della vista, campo, interruttore. */}
      <div className="hidden items-center gap-2 md:flex">
        <TopbarTagFilter />
        <div className="relative">
          <Search className="absolute left-2.5 top-2.5 size-4 text-muted-foreground" />
          <Input
            ref={inputRef}
            id="global-search"
            placeholder={placeholder}
            className="w-64 pl-8"
            value={text}
            onChange={(e) => {
              setText(e.target.value);
              setOpen(true);
            }}
            onFocus={() => setOpen(true)}
            onBlur={() => setTimeout(() => setOpen(false), 150)}
          />
          {scope === "global" && open && text.trim().length >= 2 && (
            <div className="absolute right-0 top-11 z-50 max-h-96 w-96 overflow-y-auto rounded-lg border bg-popover text-popover-foreground shadow-lg">
              <ResultsList results={results} onSelect={select} />
            </div>
          )}
        </div>
        {/* In globale il campo mostra altro: se la vista è ancora filtrata,
            lo si vede qui — altrimenti è un filtro invisibile. */}
        {scope === "global" && target?.q ? (
          <ActiveViewFilter text={target.q} onClear={() => target.setQ("")} />
        ) : null}
        {target && (
          <ScopeToggle
            scope={scope}
            onChange={(scope) => update({ scope })}
            localLabel={t("Cerca in questa vista")}
          />
        )}
      </div>

      {/* Mobile: icona che apre un pannello a tutto schermo. */}
      <Button
        variant="ghost"
        size="icon"
        className="md:hidden"
        title={t("Cerca")}
        onClick={() => setMobileOpen(true)}
      >
        <Search className="size-4" />
      </Button>
      {mobileOpen && (
        <div
          ref={mobileTrapRef}
          role="dialog"
          aria-modal="true"
          aria-label={t("Ricerca globale")}
          tabIndex={-1}
          className="fixed inset-0 z-50 flex flex-col bg-background outline-none md:hidden"
        >
          <div className="flex items-center gap-2 border-b p-3">
            <Search className="size-4 shrink-0 text-muted-foreground" />
            <Input
              data-autofocus
              placeholder={placeholder}
              className="flex-1"
              value={text}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => e.key === "Escape" && setMobileOpen(false)}
            />
            <Button
              variant="ghost"
              size="icon"
              onClick={() => {
                setMobileOpen(false);
                if (scope === "global") setText("");
              }}
              aria-label={t("Chiudi ricerca")}
            >
              <X className="size-4" />
            </Button>
          </div>
          {target && (
            <div className="flex items-center gap-2 border-b p-3">
              <ScopeToggle
                scope={scope}
                onChange={(scope) => update({ scope })}
                localLabel={t("Cerca in questa vista")}
              />
              <TopbarTagFilter className="flex-1" />
            </div>
          )}
          <div className="flex-1 overflow-y-auto">
            {scope === "local" ? (
              <p className="p-6 text-center text-sm text-muted-foreground">
                {t("Stai filtrando l'elenco della vista corrente: chiudi per vederlo.")}
              </p>
            ) : text.trim().length >= 2 ? (
              <ResultsList results={results} onSelect={select} />
            ) : (
              <p className="p-6 text-center text-sm text-muted-foreground">
                {t("Digita almeno 2 caratteri per cercare tra task, offerte, contatti e aziende.")}
              </p>
            )}
          </div>
        </div>
      )}

      {record.node}
    </>
  );
}
