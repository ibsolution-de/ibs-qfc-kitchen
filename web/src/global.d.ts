/** Injected at build time from package.json (see vite.config.ts `define`). */
declare const __APP_VERSION__: string;

/** Injected at build time (see vite.config.ts `define`); absent in tests. */
declare const __BUILD_DATE__: string;

// Vite injects `import.meta.env` (DEV is statically replaced with `false`
// in production builds, so the dev-only role switcher is unreachable
// there). Declare the subset this app reads; the full surface comes from
// Vite's own `vite/client` types, which this project deliberately does not
// include globally.
interface ImportMetaEnv {
  readonly DEV: boolean;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
