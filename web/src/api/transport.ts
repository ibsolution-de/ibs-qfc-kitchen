import { createConnectTransport } from '@connectrpc/connect-web';
import { Code, ConnectError, type Interceptor } from '@connectrpc/connect';

/**
 * Fires a global `qfc:unauthenticated` event whenever any RPC fails with
 * UNAUTHENTICATED (e.g. the reverse proxy's session expired). AuthContext
 * listens for it and swaps the whole app for the session-expired screen;
 * the error is re-thrown so callers keep their existing error handling.
 */
const unauthenticatedInterceptor: Interceptor = next => async req => {
  try {
    return await next(req);
  } catch (err) {
    if (err instanceof ConnectError && err.code === Code.Unauthenticated) {
      window.dispatchEvent(new CustomEvent('qfc:unauthenticated'));
    }
    throw err;
  }
};

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
  interceptors: [unauthenticatedInterceptor],
});
