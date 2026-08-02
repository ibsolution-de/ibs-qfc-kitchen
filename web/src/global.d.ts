/** Injected at build time from package.json (see vite.config.ts `define`). */
declare const __APP_VERSION__: string;

/** Injected at build time (see vite.config.ts `define`); absent in tests. */
declare const __BUILD_DATE__: string;
