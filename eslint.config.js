import js from "@eslint/js";
import tseslint from "typescript-eslint";
import reactHooks from "eslint-plugin-react-hooks";
import prettier from "eslint-config-prettier";

export default tseslint.config(
  {
    ignores: [
      "**/node_modules/**",
      "**/dist/**",
      "apps/server/public/**",
      "apps/server/src/generated/**",
      "data/**",
      // Ambiente Python del fine tuning: dentro ci sono anche file .js di
      // libreria, che non sono codice nostro.
      "lfm/.venv/**",
      "**/*.config.js",
      "**/*.config.ts",
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ["**/*.{ts,tsx}"],
    rules: {
      /**
       * Usare una costante prima di dichiararla non è un errore di compilazione
       * quando il riferimento sta dentro una funzione — ma se quella funzione
       * viene eseguita subito (un `.filter` durante il render), a runtime è
       * "Cannot access before initialization" e la pagina non si apre. Il
       * compilatore non può saperlo, il linter sì.
       */
      "@typescript-eslint/no-use-before-define": [
        "error",
        { functions: false, classes: false, variables: true, typedefs: false },
      ],
    },
  },
  {
    files: ["apps/web/**/*.{ts,tsx}"],
    plugins: { "react-hooks": reactHooks },
    rules: { ...reactHooks.configs.recommended.rules },
  },
  {
    // Script Node lanciati a mano (E2E setup, misure, stampa del manuale):
    // girano fuori dal bundle, con i globals di Node.
    files: [
      "e2e/**/*.mjs",
      "scripts/**/*.mjs",
      "manual/**/*.mjs",
      "plugins/**/*.mjs",
      "edizioni/**/*.mjs",
    ],
    languageOptions: {
      globals: {
        process: "readonly",
        console: "readonly",
        fetch: "readonly",
        performance: "readonly",
        AbortController: "readonly",
        AbortSignal: "readonly",
        setTimeout: "readonly",
        clearTimeout: "readonly",
        URL: "readonly",
        URLSearchParams: "readonly",
        Buffer: "readonly",
      },
    },
  },
  {
    // Le pagine dei plugin: codice BROWSER servito com'è (niente bundler),
    // in file esterni perché la CSP del core vieta gli script inline.
    files: ["plugins/**/ui/*.js"],
    languageOptions: {
      globals: {
        document: "readonly",
        window: "readonly",
        navigator: "readonly",
        fetch: "readonly",
        localStorage: "readonly",
        sessionStorage: "readonly",
        matchMedia: "readonly",
        devicePixelRatio: "readonly",
        requestAnimationFrame: "readonly",
        addEventListener: "readonly",
        removeEventListener: "readonly",
        URLSearchParams: "readonly",
        setTimeout: "readonly",
        clearTimeout: "readonly",
        setInterval: "readonly",
        clearInterval: "readonly",
        performance: "readonly",
        console: "readonly",
      },
    },
  },
  {
    // Service worker: gira nel proprio scope, non nel DOM.
    files: ["apps/web/public/sw.js"],
    languageOptions: {
      globals: { self: "readonly" },
    },
  },
  prettier,
);
