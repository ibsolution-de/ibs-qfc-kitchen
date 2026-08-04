import { renderHook, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { useDebouncedCallback } from './useDebouncedCallback';

describe('useDebouncedCallback', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('collapses rapid calls into a single invocation carrying the last value', () => {
    const callback = vi.fn();
    const { result } = renderHook(() => useDebouncedCallback(callback, 700));

    act(() => {
      result.current.run('h');
      result.current.run('he');
      result.current.run('hel');
      result.current.run('hell');
      result.current.run('hello');
    });

    expect(callback).not.toHaveBeenCalled();

    act(() => {
      vi.advanceTimersByTime(700);
    });

    expect(callback).toHaveBeenCalledTimes(1);
    expect(callback).toHaveBeenCalledWith('hello');
  });

  it('does not fire before the debounce window elapses', () => {
    const callback = vi.fn();
    const { result } = renderHook(() => useDebouncedCallback(callback, 700));

    act(() => {
      result.current.run('a');
      vi.advanceTimersByTime(699);
    });

    expect(callback).not.toHaveBeenCalled();
  });

  it('flush runs a pending call immediately and clears the timer', () => {
    const callback = vi.fn();
    const { result } = renderHook(() => useDebouncedCallback(callback, 700));

    act(() => {
      result.current.run('draft');
    });
    expect(callback).not.toHaveBeenCalled();

    act(() => {
      result.current.flush();
    });
    expect(callback).toHaveBeenCalledTimes(1);
    expect(callback).toHaveBeenCalledWith('draft');

    // The timer that would have fired the same call was cleared by flush.
    act(() => {
      vi.advanceTimersByTime(700);
    });
    expect(callback).toHaveBeenCalledTimes(1);
  });

  it('flush is a no-op when nothing is pending', () => {
    const callback = vi.fn();
    const { result } = renderHook(() => useDebouncedCallback(callback, 700));

    act(() => {
      result.current.flush();
    });

    expect(callback).not.toHaveBeenCalled();
  });

  it('cancel discards a pending call without running it', () => {
    const callback = vi.fn();
    const { result } = renderHook(() => useDebouncedCallback(callback, 700));

    act(() => {
      result.current.run('discard-me');
      result.current.cancel();
      vi.advanceTimersByTime(700);
    });

    expect(callback).not.toHaveBeenCalled();
  });

  it('does not call back when the value is unchanged from what was last committed', () => {
    const callback = vi.fn();
    const { result } = renderHook(() => useDebouncedCallback(callback, 700));

    act(() => {
      result.current.run('same');
      vi.advanceTimersByTime(700);
    });
    expect(callback).toHaveBeenCalledTimes(1);

    act(() => {
      result.current.run('same');
      vi.advanceTimersByTime(700);
    });

    expect(callback).toHaveBeenCalledTimes(1);
  });

  it('still calls back when the value differs from what was last committed', () => {
    const callback = vi.fn();
    const { result } = renderHook(() => useDebouncedCallback(callback, 700));

    act(() => {
      result.current.run('first');
      vi.advanceTimersByTime(700);
    });
    expect(callback).toHaveBeenCalledTimes(1);

    act(() => {
      result.current.run('second');
      vi.advanceTimersByTime(700);
    });

    expect(callback).toHaveBeenCalledTimes(2);
    expect(callback).toHaveBeenLastCalledWith('second');
  });

  it('flushes a pending call on unmount instead of dropping it', () => {
    const callback = vi.fn();
    const { result, unmount } = renderHook(() => useDebouncedCallback(callback, 700));

    act(() => {
      result.current.run('unsaved edit');
    });
    expect(callback).not.toHaveBeenCalled();

    unmount();

    expect(callback).toHaveBeenCalledTimes(1);
    expect(callback).toHaveBeenCalledWith('unsaved edit');
  });
});
