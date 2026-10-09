import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { MessageInput } from "./message-input";

/**
 * Le due mosse della messaggistica: **Invio manda**, **Shift+Invio va a capo**.
 * La seconda prima non esisteva proprio — il campo era un `<input>` di una riga
 * sola — e la prima non deve lasciarsi dietro un a capo nel testo.
 */
const setup = (props: Partial<React.ComponentProps<typeof MessageInput>> = {}) => {
  const onSend = vi.fn();
  render(
    <MessageInput
      aria-label="messaggio"
      value="ciao"
      onChange={() => {}}
      onSend={onSend}
      {...props}
    />,
  );
  return { onSend, field: screen.getByLabelText("messaggio") };
};

describe("MessageInput", () => {
  it("Invio manda, e non scrive anche un a capo", () => {
    const { onSend, field } = setup();
    const prevented = !fireEvent.keyDown(field, { key: "Enter" });
    expect(onSend).toHaveBeenCalledTimes(1);
    expect(prevented).toBe(true);
  });

  it("Shift+Invio va a capo: non manda e lascia fare alla textarea", () => {
    const { onSend, field } = setup();
    const prevented = !fireEvent.keyDown(field, { key: "Enter", shiftKey: true });
    expect(onSend).not.toHaveBeenCalled();
    expect(prevented).toBe(false);
  });

  it("chi lo ospita ha la precedenza sul tasto: menzione scelta, messaggio non mandato", () => {
    // È il caso della tendina `@`: con l'elenco aperto Invio sceglie la persona.
    const { onSend, field } = setup({
      onKeyDown: (event) => {
        if (event.key === "Enter") event.preventDefault();
      },
    });
    fireEvent.keyDown(field, { key: "Enter" });
    expect(onSend).not.toHaveBeenCalled();
  });

  it("è una textarea, quindi un messaggio su più righe si può scrivere", () => {
    const { field } = setup({ value: "prima\nseconda" });
    expect(field.tagName).toBe("TEXTAREA");
    expect((field as HTMLTextAreaElement).value).toBe("prima\nseconda");
  });
});
