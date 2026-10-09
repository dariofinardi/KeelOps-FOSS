import path from "node:path";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

/**
 * La pagina del plugin, costruita in `dist/` e servita dal plugin stesso come
 * cartella statica (`plugin.mjs` → `staticDir`). `base: "./"` perché la pagina
 * vive sotto `/plugins/Personale/` e non alla radice: i percorsi degli asset
 * devono essere relativi.
 */
export default defineConfig({
  base: "./",
  plugins: [react()],
  build: { outDir: "dist", emptyOutDir: true },
  server: {
    // in sviluppo la pagina importa `avviaRiquadro` dall'SDK, fuori dalla sua radice
    fs: { allow: [path.resolve(import.meta.dirname, "../.."), path.resolve(import.meta.dirname)] },
  },
});
