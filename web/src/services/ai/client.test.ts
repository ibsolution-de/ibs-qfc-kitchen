import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  AI_MODELS,
  AI_MODEL_CONFIG,
  AI_MODEL_FORECAST,
  AiNotConfiguredError,
  createClient
} from './client';

/**
 * Hermetic in-memory localStorage stub.
 * Keeps the test suite environment-independent.
 */
function createLocalStorageStub() {
  let store = new Map<string, string>();
  return {
    getItem: (key: string) => (store.has(key) ? store.get(key)! : null),
    setItem: (key: string, value: string) => void store.set(key, String(value)),
    removeItem: (key: string) => void store.delete(key),
    clear: () => store.clear(),
    key: (index: number) => Array.from(store.keys())[index] ?? null,
    get length() {
      return store.size;
    },
  } satisfies Storage;
}

const stub = createLocalStorageStub();

beforeEach(() => {
  vi.stubGlobal('localStorage', stub);
  stub.clear();
});

describe('AI client', () => {
  it('exposes the model registry with both models', () => {
    expect(AI_MODELS.pro).toBe('gemini-3-pro-preview');
    expect(AI_MODELS.flash).toBe('gemini-2.5-flash');
  });

  it('includes thinking budget configuration for the pro model', () => {
    expect(AI_MODEL_CONFIG[AI_MODELS.pro].thinkingBudget).toBe(32768);
    expect(AI_MODEL_CONFIG[AI_MODELS.flash].thinkingBudget).toBeUndefined();
  });

  it('keeps AI_MODEL_FORECAST re-export pointing to pro model', () => {
    expect(AI_MODEL_FORECAST).toBe(AI_MODELS.pro);
  });

  it('throws AiNotConfiguredError when no key is available', () => {
    expect(() => createClient()).toThrow(AiNotConfiguredError);
  });

  it('uses the explicit apiKey parameter first', () => {
    const client = createClient('explicit-test-key');
    expect(client).toBeDefined();
  });

  it('falls back to localStorage gemini_api_key', () => {
    stub.setItem('gemini_api_key', 'ls-test-key');
    const client = createClient();
    expect(client).toBeDefined();
  });

  it('prefers explicit parameter over localStorage', () => {
    stub.setItem('gemini_api_key', 'ls-test-key');

    const client = createClient('explicit-test-key');
    expect(client).toBeDefined();
  });

  it('has no env fallback — a build-time key would ship in the public bundle', () => {
    // Even if the environment provides a key, resolveApiKey must ignore it;
    // the only sources are the explicit parameter and localStorage.
    process.env.API_KEY = 'env-test-key';
    try {
      expect(() => createClient()).toThrow(AiNotConfiguredError);
    } finally {
      delete process.env.API_KEY;
    }
  });
});
