import { lazy, type ComponentType } from "react";

// Ogni pagina è un chunk a sé (code-splitting per route): il bundle iniziale porta
// solo la shell e il login, il resto arriva alla prima visita della rotta. Le pagine
// hanno export nominati, da cui il piccolo adattatore a `default` richiesto da lazy().
export function lazyPage<T, P = Record<string, never>>(loader: () => Promise<T>, name: keyof T) {
  // T è il modulo intero (può esporre anche sotto-componenti con props proprie):
  // niente vincolo su tutti gli export, si estrae solo la pagina richiesta.
  // `P` serve alle poche pagine che una prop ce l'hanno davvero — Utenti, che
  // la stessa pagina la serve in due perimetri.
  return lazy(() =>
    loader().then((module) => ({ default: module[name] as unknown as ComponentType<P> })),
  );
}
