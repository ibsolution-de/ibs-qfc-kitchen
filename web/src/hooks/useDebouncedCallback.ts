import { useCallback, useEffect, useRef } from 'react';

export interface DebouncedCallback<T> {
  /**
   * Schedules `callback(value)`, resetting the debounce window on every
   * call - rapid calls collapse into a single invocation carrying the most
   * recent value. If `value` is identical (`Object.is`) to whatever was
   * last actually committed, the call is dropped instead of scheduled, so
   * settling back on an already-persisted value never re-fires `callback`.
   */
  run: (value: T) => void;
  /** Runs the pending call immediately, if any, and clears the timer. No-op if nothing is pending. */
  flush: () => void;
  /** Discards any pending call without running it. */
  cancel: () => void;
}

/**
 * Debounces `callback`: repeated `run()` calls within `delayMs` of each
 * other collapse into a single invocation. Intended for turning "fires on
 * every keystroke" UI events into "fires once things settle" writes (e.g.
 * persisting a textarea to a backend instead of round-tripping per
 * character).
 *
 * A pending call is never silently dropped by the passage of time - only
 * `run`, `flush`, or `cancel` clear it, and unmount auto-flushes rather than
 * discarding, so callers that also want to flush on blur or before
 * switching away from the value just call `flush()` at those points too.
 */
export function useDebouncedCallback<T>(callback: (value: T) => void, delayMs: number): DebouncedCallback<T> {
  const callbackRef = useRef(callback);
  callbackRef.current = callback;

  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingRef = useRef<{ value: T } | null>(null);
  const lastCommittedRef = useRef<{ value: T } | null>(null);

  const clearTimer = useCallback(() => {
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const commit = useCallback((value: T) => {
    lastCommittedRef.current = { value };
    callbackRef.current(value);
  }, []);

  const run = useCallback(
    (value: T) => {
      if (lastCommittedRef.current !== null && Object.is(lastCommittedRef.current.value, value)) {
        // Back to what's already persisted: drop any pending write rather
        // than re-sending unchanged content.
        clearTimer();
        pendingRef.current = null;
        return;
      }
      pendingRef.current = { value };
      clearTimer();
      timerRef.current = setTimeout(() => {
        timerRef.current = null;
        const pending = pendingRef.current;
        pendingRef.current = null;
        if (pending) commit(pending.value);
      }, delayMs);
    },
    [clearTimer, commit, delayMs]
  );

  const flush = useCallback(() => {
    clearTimer();
    const pending = pendingRef.current;
    pendingRef.current = null;
    if (pending) commit(pending.value);
  }, [clearTimer, commit]);

  const cancel = useCallback(() => {
    clearTimer();
    pendingRef.current = null;
  }, [clearTimer]);

  // Safety net: an unmount while a call is still pending flushes it instead
  // of losing it. Callers with other "about to lose the value" moments
  // (blur, switching to a different record, ...) call `flush()` themselves.
  useEffect(() => {
    return () => flush();
  }, [flush]);

  return { run, flush, cancel };
}
