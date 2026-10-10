// Copyright (c) 2026 Jugaad s.r.l.
// SPDX-License-Identifier: AGPL-3.0-only

import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useLocation } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { useMe, useProviders } from "@/features/auth/useAuth";
import {
  caricaGoogleAnalytics,
  leggiConsensoStatistiche,
  ruoloDiChiGuarda,
  scriviConsensoStatistiche,
  vistaPagina,
} from "@/lib/analytics";

/**
 * **Le statistiche d'uso della demo** (18/09/2026): la domanda, e — dopo un sì
 * — Google Analytics sulle pagine aperte. Montato una volta sola, attorno a
 * tutte le interfacce (accesso, applicazione, portale, monitor vendite): la
 * demo si prova con utenti diversi, e ognuno apre cose diverse.
 *
 * Fuori da una demo con GA configurato non rende niente e non carica niente:
 * `demo.analytics` lo manda solo il server che ce l'ha.
 */
export function DemoAnalytics() {
  const { t } = useTranslation();
  const { data: providers } = useProviders();
  const { data: user } = useMe();
  const location = useLocation();
  const [consenso, setConsenso] = useState(leggiConsensoStatistiche);
  const measurementId = providers?.demo?.analytics?.measurementId ?? null;
  const attivo = measurementId !== null && consenso === "1";

  useEffect(() => {
    if (attivo) caricaGoogleAnalytics(measurementId);
  }, [attivo, measurementId]);
  useEffect(() => {
    if (attivo) ruoloDiChiGuarda(user?.role ?? null);
  }, [attivo, user?.role]);
  useEffect(() => {
    if (attivo) vistaPagina(location.pathname);
  }, [attivo, location.pathname]);

  if (!measurementId || consenso !== null) return null;

  const scegli = (valore: "1" | "0") => {
    scriviConsensoStatistiche(valore);
    setConsenso(valore);
  };
  return (
    <div
      role="dialog"
      aria-label={t("Statistiche d'uso")}
      className="fixed inset-x-4 bottom-4 z-50 rounded-lg border bg-card p-4 text-card-foreground shadow-lg sm:left-auto sm:max-w-sm"
    >
      <p className="text-sm">
        {t(
          "Ci aiuti a capire quali funzioni della demo vengono usate? Con il tuo consenso usiamo Google Analytics: le pagine aperte e le funzioni chiamate, senza i dati che vedi o scrivi.",
        )}
      </p>
      <p className="mt-1 text-xs text-muted-foreground">
        {t("La scelta vale anche per keelops.it.")}{" "}
        <a
          className="underline"
          href="https://keelops.it/privacy.html"
          target="_blank"
          rel="noopener noreferrer"
        >
          {t("Informativa")}
        </a>
      </p>
      <div className="mt-3 flex gap-2">
        <Button size="sm" className="flex-1" onClick={() => scegli("1")}>
          {t("Sì, va bene")}
        </Button>
        <Button size="sm" variant="outline" className="flex-1" onClick={() => scegli("0")}>
          {t("No, grazie")}
        </Button>
      </div>
    </div>
  );
}

/**
 * La scelta, da cambiare: una riga sulla pagina di accesso, dove si decide
 * anche per il resto dei cookie. Non c'è se GA non c'è o se non si è ancora
 * risposto (lì c'è la domanda).
 */
export function SceltaStatistiche() {
  const { t } = useTranslation();
  const { data: providers } = useProviders();
  const [consenso, setConsenso] = useState(leggiConsensoStatistiche);
  if (!providers?.demo?.analytics || consenso === null) return null;
  const cambia = () => {
    const nuovo = consenso === "1" ? "0" : "1";
    scriviConsensoStatistiche(nuovo);
    setConsenso(nuovo);
    // Ritirato il consenso, gtag già caricato va tolto davvero: si ricarica.
    if (nuovo === "0") window.location.reload();
  };
  return (
    <p className="mt-2 text-center text-xs text-muted-foreground">
      {consenso === "1" ? t("Statistiche d'uso: attive.") : t("Statistiche d'uso: spente.")}{" "}
      <button type="button" className="underline" onClick={cambia}>
        {consenso === "1" ? t("Spegni") : t("Accendi")}
      </button>
    </p>
  );
}
