import { createRequire } from "node:module";
import path from "node:path";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

/**
 * Versioni delle librerie del frontend, lette al momento della build e cucite
 * dentro al bundle: a runtime il browser non ha modo di saperle, e il server non
 * può dirle perché quelle librerie non girano da lui — girano qui dentro.
 */
const require = createRequire(import.meta.url);
// Le librerie del frontend si leggono dal package.json (più gli strumenti che
// costruiscono il pacchetto): un elenco a mano resta indietro al primo `add`.
const pkg = require("./package.json") as {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
};
const BUILD_TOOLS = ["vite", "typescript", "tailwindcss", "@vitejs/plugin-react"];
const WEB_PACKAGES = [
  ...Object.keys(pkg.dependencies ?? {}).filter((name) => !name.startsWith("@kancrm/")),
  ...BUILD_TOOLS.filter((name) => name in (pkg.devDependencies ?? {})),
].sort((a, b) => a.localeCompare(b));
const webVersions = WEB_PACKAGES.flatMap((name) => {
  try {
    return [{ name, version: (require(`${name}/package.json`) as { version: string }).version }];
  } catch {
    return [];
  }
});

export default defineConfig({
  plugins: [react(), tailwindcss()],
  define: { __WEB_VERSIONS__: JSON.stringify(webVersions) },
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "src"),
    },
  },
  server: {
    port: 5173,
    proxy: {
      "/api": "http://localhost:3001",
    },
  },
  build: {
    outDir: "../server/public",
    emptyOutDir: true,
  },
});
