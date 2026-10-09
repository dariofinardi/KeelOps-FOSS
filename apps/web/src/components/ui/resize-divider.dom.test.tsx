import { describe, expect, it, vi } from "vitest";
import { createEvent, fireEvent, render, screen } from "@testing-library/react";
import { ResizeDivider } from "./resize-divider";

/**
 * Il divisore trascinabile. Quel che conta: **non si scende sotto il minimo** —
 * chi trascina per sbaglio non deve ritrovarsi la chat schiacciata — e **si usa
 * da tastiera**, perché un comando solo per il mouse è un comando che metà
 * delle persone non ha.
 */
/**
 * jsdom non ha `PointerEvent`, quindi Testing Library ripiega su un evento
 * generico che **non porta `clientY`** — e senza quello il trascinamento non ha
 * niente da misurare. Gli eventi qui si costruiscono a mano con la coordinata
 * addosso: è la differenza fra provare il trascinamento e provare il ripiego.
 */
const premi = (elemento: Element, clientY: number) => {
  const evento = createEvent.pointerDown(elemento, { button: 0 });
  Object.defineProperty(evento, "clientY", { value: clientY });
  fireEvent(elemento, evento);
};

const trascina = (clientY: number) => {
  const evento = new Event("pointermove");
  Object.defineProperty(evento, "clientY", { value: clientY });
  window.dispatchEvent(evento);
};

const monta = (props: Partial<Parameters<typeof ResizeDivider>[0]> = {}) => {
  const onChange = vi.fn();
  render(
    <ResizeDivider
      value={352}
      min={352}
      max={600}
      label="Altezza della conversazione"
      onChange={onChange}
      {...props}
    />,
  );
  return { onChange, maniglia: screen.getByRole("separator") };
};

describe("il divisore trascinabile", () => {
  it("si annuncia come un separatore con i suoi limiti", () => {
    const { maniglia } = monta();
    expect(maniglia).toHaveAttribute("aria-valuenow", "352");
    expect(maniglia).toHaveAttribute("aria-valuemin", "352");
    expect(maniglia).toHaveAttribute("aria-valuemax", "600");
    expect(maniglia).toHaveAttribute("aria-orientation", "horizontal");
  });

  it("la freccia su allarga, la freccia giù stringe", () => {
    const { onChange, maniglia } = monta({ value: 400 });
    fireEvent.keyDown(maniglia, { key: "ArrowUp" });
    expect(onChange).toHaveBeenCalledWith(416);
    fireEvent.keyDown(maniglia, { key: "ArrowDown" });
    expect(onChange).toHaveBeenLastCalledWith(384);
  });

  it("con Maiusc il passo è più lungo: sessanta pixel per volta sono tanti clic", () => {
    const { onChange, maniglia } = monta({ value: 400 });
    fireEvent.keyDown(maniglia, { key: "ArrowUp", shiftKey: true });
    expect(onChange).toHaveBeenCalledWith(464);
  });

  it("sotto il minimo non si va, per quanto si insista", () => {
    const { onChange, maniglia } = monta({ value: 352 });
    fireEvent.keyDown(maniglia, { key: "ArrowDown" });
    expect(onChange).toHaveBeenCalledWith(352);
  });

  it("sopra il massimo nemmeno: al pannello devono restare i campi", () => {
    const { onChange, maniglia } = monta({ value: 600 });
    fireEvent.keyDown(maniglia, { key: "ArrowUp" });
    expect(onChange).toHaveBeenCalledWith(600);
  });

  it("Home torna al minimo, Fine va al massimo", () => {
    const { onChange, maniglia } = monta({ value: 450 });
    fireEvent.keyDown(maniglia, { key: "Home" });
    expect(onChange).toHaveBeenCalledWith(352);
    fireEvent.keyDown(maniglia, { key: "End" });
    expect(onChange).toHaveBeenLastCalledWith(600);
  });

  it("trascinando verso l'alto la regione cresce, anche fuori dalla banda", () => {
    // Il difetto del 20/08/2026: la banda è alta pochi pixel, quindi al primo
    // movimento il puntatore ne è già fuori. Se il trascinamento ascolta sé
    // stesso, lì finisce; ascoltando la finestra, prosegue.
    const { onChange, maniglia } = monta({ value: 400 });
    premi(maniglia, 500);
    trascina(460);
    expect(onChange).toHaveBeenLastCalledWith(440);
    trascina(520);
    expect(onChange).toHaveBeenLastCalledWith(380);
  });

  it("lasciato il tasto, muovere il puntatore non sposta più niente", () => {
    const { onChange, maniglia } = monta({ value: 400 });
    premi(maniglia, 500);
    window.dispatchEvent(new Event("pointerup"));
    trascina(300);
    expect(onChange).not.toHaveBeenCalled();
  });

  it("chiusa, non si trascina e non prende il fuoco", () => {
    const { onChange, maniglia } = monta({ disabled: true, value: 400 });
    expect(maniglia).toHaveAttribute("tabindex", "-1");
    premi(maniglia, 500);
    trascina(400);
    fireEvent.keyDown(maniglia, { key: "ArrowUp" });
    expect(onChange).not.toHaveBeenCalled();
  });

  it("un tasto qualunque non muove niente", () => {
    const { onChange, maniglia } = monta();
    fireEvent.keyDown(maniglia, { key: "a" });
    expect(onChange).not.toHaveBeenCalled();
  });
});
