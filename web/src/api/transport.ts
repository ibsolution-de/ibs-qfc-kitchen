import { createConnectTransport } from '@connectrpc/connect-web';

/**
 * The single Connect transport shared by every generated client in
 * `./clients`. `/api` is proxied to the Rust backend in dev (see
 * `vite.config.ts`) and served from the same origin in production, so a
 * relative base URL works in both cases.
 *
 * Binary format is used (not JSON) to match the backend's wire format and
 * avoid the extra encode/decode overhead of JSON for a data-heavy app.
 */
export const transport = createConnectTransport({
  baseUrl: '/api',
  useBinaryFormat: true,
});
