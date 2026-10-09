import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import type { CurrentUser } from "@kancrm/shared";
import { CurrentUserContext } from "@/features/auth/useAuth";
import { useMoney } from "./money";

// Prova end-to-end del hook nel DOM: verifica che useMoney segua la valuta del
// CurrentUserContext (e, di riflesso, che l'ambiente jsdom + testing-library funzioni).
function Price({ value }: { value: number }) {
  const money = useMoney();
  return <span>{money.format(value)}</span>;
}

function renderWithCurrency(currency: string, value: number) {
  const user = { currency } as CurrentUser;
  return render(
    <CurrentUserContext.Provider value={user}>
      <Price value={value} />
    </CurrentUserContext.Provider>,
  );
}

describe("useMoney (DOM)", () => {
  it("formatta in euro quando l'utente ha valuta EUR", () => {
    renderWithCurrency("EUR", 1500);
    // separatore migliaia opzionale: dipende dai dati ICU (jsdom vs browser).
    expect(screen.getByText(/€/)).toBeInTheDocument();
    expect(screen.getByText(/1\.?500/)).toBeInTheDocument();
  });

  it("segue la valuta dell'utente (USD)", () => {
    renderWithCurrency("USD", 5);
    expect(screen.getByText(/USD|\$/)).toBeInTheDocument();
  });
});
