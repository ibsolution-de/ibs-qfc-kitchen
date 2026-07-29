import React from 'react';
import { render, screen, fireEvent, act, within } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { OneOnOneDashboard } from './OneOnOneDashboard';
import { LanguageProvider } from '../contexts/LanguageContext';
import { SettingsProvider } from '../contexts/SettingsContext';
import { Employee, OneOnOneSession } from '../types';

// jsdom in this test environment doesn't provide `localStorage` (Node's own
// experimental global shadows it as `undefined`), but LanguageProvider and
// SettingsProvider - both required to mount OneOnOneDashboard - read/write
// it on mount. Polyfill a minimal in-memory Storage so those providers
// don't crash; this is scoped to this file only.
class MemoryStorage implements Storage {
  private store = new Map<string, string>();
  get length(): number {
    return this.store.size;
  }
  clear(): void {
    this.store.clear();
  }
  getItem(key: string): string | null {
    return this.store.has(key) ? this.store.get(key)! : null;
  }
  key(index: number): string | null {
    return Array.from(this.store.keys())[index] ?? null;
  }
  removeItem(key: string): void {
    this.store.delete(key);
  }
  setItem(key: string, value: string): void {
    this.store.set(key, value);
  }
}
if (typeof window.localStorage === 'undefined') {
  vi.stubGlobal('localStorage', new MemoryStorage());
}

const NOTES_PERSIST_DEBOUNCE_MS = 700;

const employee: Employee = {
  id: 'emp-1',
  name: 'Jane Doe',
  role: 'Engineer',
  avatar: '',
  skills: [],
  availability: 100,
  location: 'DE',
  type: 'internal'
};

const makeSession = (overrides: Partial<OneOnOneSession> = {}): OneOnOneSession => ({
  id: 's1',
  employeeId: employee.id,
  date: '2026-01-15T00:00:00.000Z',
  status: 'scheduled',
  sentiment: 'unknown',
  notes: '',
  commitments: [],
  agenda: [],
  ...overrides
});

const Providers: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <LanguageProvider>
    <SettingsProvider>{children}</SettingsProvider>
  </LanguageProvider>
);

const renderDashboard = (props: {
  sessions: OneOnOneSession[];
  onUpdateSessions: (sessions: OneOnOneSession[]) => void;
  onClose?: () => void;
  isOpen?: boolean;
}) =>
  render(
    <Providers>
      <OneOnOneDashboard
        employee={employee}
        isOpen={props.isOpen ?? true}
        onClose={props.onClose ?? vi.fn()}
        sessions={props.sessions}
        onUpdateSessions={props.onUpdateSessions}
      />
    </Providers>
  );

describe('OneOnOneDashboard notes persistence', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('collapses several keystrokes into exactly one persist call after the debounce window', () => {
    const onUpdateSessions = vi.fn();
    const session = makeSession();
    const { container } = renderDashboard({ sessions: [session], onUpdateSessions });

    const textarea = container.querySelector('textarea') as HTMLTextAreaElement;
    expect(textarea).toBeInTheDocument();

    fireEvent.change(textarea, { target: { value: 'H' } });
    fireEvent.change(textarea, { target: { value: 'He' } });
    fireEvent.change(textarea, { target: { value: 'Hel' } });
    fireEvent.change(textarea, { target: { value: 'Hell' } });
    fireEvent.change(textarea, { target: { value: 'Hello' } });

    // The textarea itself stays responsive (local state), but nothing is
    // persisted yet - the store write is still debounced.
    expect(textarea.value).toBe('Hello');
    expect(onUpdateSessions).not.toHaveBeenCalled();

    act(() => {
      vi.advanceTimersByTime(NOTES_PERSIST_DEBOUNCE_MS);
    });

    expect(onUpdateSessions).toHaveBeenCalledTimes(1);
    expect(onUpdateSessions).toHaveBeenCalledWith([{ ...session, notes: 'Hello' }]);
  });

  it('does not persist again once the debounce window elapses with no further edits', () => {
    const onUpdateSessions = vi.fn();
    const session = makeSession();
    const { container } = renderDashboard({ sessions: [session], onUpdateSessions });

    const textarea = container.querySelector('textarea') as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: 'Hello' } });

    act(() => {
      vi.advanceTimersByTime(NOTES_PERSIST_DEBOUNCE_MS);
    });
    expect(onUpdateSessions).toHaveBeenCalledTimes(1);

    act(() => {
      vi.advanceTimersByTime(NOTES_PERSIST_DEBOUNCE_MS);
    });
    expect(onUpdateSessions).toHaveBeenCalledTimes(1);
  });

  it('flushes an unpersisted edit instead of dropping it when the dialog is closed', () => {
    const onUpdateSessions = vi.fn();
    const onClose = vi.fn();
    const session = makeSession();
    const { container } = renderDashboard({ sessions: [session], onUpdateSessions, onClose });

    const textarea = container.querySelector('textarea') as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: 'note typed right before closing' } });

    // Closing happens well within the debounce window - nothing has fired yet.
    expect(onUpdateSessions).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Close' }));

    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onUpdateSessions).toHaveBeenCalledTimes(1);
    expect(onUpdateSessions).toHaveBeenCalledWith([{ ...session, notes: 'note typed right before closing' }]);

    // The debounce timer that would have fired the same write was cleared by the flush.
    act(() => {
      vi.advanceTimersByTime(NOTES_PERSIST_DEBOUNCE_MS);
    });
    expect(onUpdateSessions).toHaveBeenCalledTimes(1);
  });

  it('flushes an unpersisted edit instead of dropping it when switching to a different session', () => {
    const onUpdateSessions = vi.fn();
    const recentSession = makeSession({ id: 'recent', date: '2026-02-01T00:00:00.000Z' });
    const olderSession = makeSession({ id: 'older', date: '2026-01-01T00:00:00.000Z' });
    const { container } = renderDashboard({ sessions: [recentSession, olderSession], onUpdateSessions });

    const textarea = container.querySelector('textarea') as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: 'edit before switching' } });
    expect(onUpdateSessions).not.toHaveBeenCalled();

    const sidebar = container.querySelector('.w-64') as HTMLElement;
    const sessionButtons = within(sidebar).getAllByRole('button');
    expect(sessionButtons).toHaveLength(2);

    // sessionButtons[0] is the most recently active (and edited) session; switch to the other one.
    fireEvent.click(sessionButtons[1]!);

    expect(onUpdateSessions).toHaveBeenCalledTimes(1);
    expect(onUpdateSessions).toHaveBeenCalledWith([
      { ...recentSession, notes: 'edit before switching' },
      olderSession
    ]);
  });

  it('never fires a persist for content identical to what was last persisted', () => {
    const onUpdateSessions = vi.fn();
    const session = makeSession();
    const { container } = renderDashboard({ sessions: [session], onUpdateSessions });

    const textarea = container.querySelector('textarea') as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: 'settled note' } });

    act(() => {
      vi.advanceTimersByTime(NOTES_PERSIST_DEBOUNCE_MS);
    });
    expect(onUpdateSessions).toHaveBeenCalledTimes(1);

    // Re-typing the exact same content that was just persisted should not
    // produce a second RPC, even after the debounce window elapses again.
    fireEvent.change(textarea, { target: { value: 'settled note' } });
    act(() => {
      vi.advanceTimersByTime(NOTES_PERSIST_DEBOUNCE_MS);
    });

    expect(onUpdateSessions).toHaveBeenCalledTimes(1);
  });
});
