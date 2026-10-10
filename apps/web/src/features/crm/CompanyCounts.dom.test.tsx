// Copyright (c) 2026 Jugaad s.r.l.
// SPDX-License-Identifier: AGPL-3.0-only

import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import type { CompanyListItem } from "@kancrm/shared";
import { CurrentUserContext } from "@/features/auth/useAuth";
import { CompanyCounts } from "./ContactsPage";

const azienda: CompanyListItem = {
  id: "c1",
  name: "Coopselios",
  vatNumber: null,
  city: null,
  contactCount: 2,
  dealCount: 9,
  projectCount: 3,
};

type Privileges = { canSeeContacts: boolean; canSeeDeals: boolean; dealsDaysView: boolean };

const mostra = (privileges: Privileges, company: CompanyListItem = azienda) => {
  render(
    <MemoryRouter>
      <CurrentUserContext.Provider
        value={{ id: "u1", name: "Tester", role: "MEMBER", ...privileges } as never}
      >
        <CompanyCounts company={company} />
      </CurrentUserContext.Provider>
    </MemoryRouter>,
  );
};

const PIENO: Privileges = { canSeeContacts: true, canSeeDeals: true, dealsDaysView: false };

describe("contatori di una scheda cliente", () => {
  it("con i moduli pieni si vede tutto, e offerte e progetti si aprono", () => {
    mostra(PIENO);
    expect(screen.getByText(/2 contatti/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /9 offerte/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /3 progetti/ })).toBeInTheDocument();
  });

  it("chi non arriva alle offerte non legge nemmeno lo zero", () => {
    // Il server azzera il contatore per mancanza di permessi: scriverlo direbbe
    // il falso (il cliente ha nove offerte) e manderebbe a cercare l'elenco.
    mostra(
      { canSeeContacts: true, canSeeDeals: false, dealsDaysView: false },
      { ...azienda, dealCount: 0 },
    );
    expect(screen.queryByText(/offerte/)).not.toBeInTheDocument();
    expect(screen.getByText(/2 contatti/)).toBeInTheDocument();
  });

  it("a zero il contatore sparisce, anche a chi avrebbe il permesso", () => {
    // Su una scheda cliente conta dove c'è del lavoro: elencare gli zeri
    // occupa spazio per dire che non c'è niente da aprire.
    mostra(PIENO, { ...azienda, dealCount: 0, projectCount: 0 });
    expect(screen.queryByText(/offerte/)).not.toBeInTheDocument();
    expect(screen.queryByText(/progetti/)).not.toBeInTheDocument();
    expect(screen.getByText(/2 contatti/)).toBeInTheDocument();
  });

  it("senza niente da mostrare la riga non si disegna", () => {
    mostra(
      { canSeeContacts: false, canSeeDeals: false, dealsDaysView: false },
      { ...azienda, projectCount: 0 },
    );
    expect(screen.queryByText(/contatti|offerte|progetti/)).not.toBeInTheDocument();
  });

  it("la sola lente «giornate» basta a contare le offerte e ad arrivarci", () => {
    mostra({ canSeeContacts: false, canSeeDeals: false, dealsDaysView: true });
    expect(screen.getByRole("button", { name: /9 offerte/ })).toBeInTheDocument();
    // Senza il modulo Anagrafica i contatti non si contano affatto.
    expect(screen.queryByText(/contatti/)).not.toBeInTheDocument();
  });

  it("i progetti si contano per tutti: il numero è già quello che si può vedere", () => {
    mostra({ canSeeContacts: false, canSeeDeals: false, dealsDaysView: false });
    expect(screen.getByRole("button", { name: /3 progetti/ })).toBeInTheDocument();
  });
});
