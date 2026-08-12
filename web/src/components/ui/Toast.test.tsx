import React from 'react';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { toast } from 'sonner';
import { ToastProvider, useToast } from './Toast';

const TestComponent: React.FC = () => {
  const { success, error, info } = useToast();
  return (
    <div>
      <button onClick={() => success('Saved successfully')}>Show Success</button>
      <button onClick={() => error('Something failed')}>Show Error</button>
      <button onClick={() => info('Just so you know')}>Show Info</button>
    </div>
  );
};

const renderWithProvider = () =>
  render(
    <ToastProvider>
      <TestComponent />
    </ToastProvider>
  );

// sonner keeps its toast queue in a module-level store; without clearing it
// before each test, toasts from the previous test replay into the next
// Toaster mount and break text queries.
beforeEach(() => {
  toast.dismiss();
});

describe('ToastProvider (sonner)', () => {
  it('shows a message for each toast type', async () => {
    renderWithProvider();
    fireEvent.click(screen.getByText('Show Success'));
    fireEvent.click(screen.getByText('Show Error'));
    fireEvent.click(screen.getByText('Show Info'));

    // sonner batches toast creation on a 0ms timer, so the messages arrive
    // one macro-task later.
    expect(await screen.findByText('Saved successfully')).toBeInTheDocument();
    expect(await screen.findByText('Something failed')).toBeInTheDocument();
    expect(await screen.findByText('Just so you know')).toBeInTheDocument();
  });

  it('auto-dismisses after the default lifetime', () => {
    vi.useFakeTimers();
    try {
      renderWithProvider();
      fireEvent.click(screen.getByText('Show Success'));

      // Let sonner's 0ms batch timer render the toast first.
      act(() => {
        vi.advanceTimersByTime(0);
      });
      expect(screen.getByText('Saved successfully')).toBeInTheDocument();

      // 4000 ms lifetime + the exit-animation grace period sonner waits
      // before unmounting the toast.
      act(() => {
        vi.advanceTimersByTime(4200);
      });

      expect(screen.queryByText('Saved successfully')).not.toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });

  it('has an aria-live region for accessibility', async () => {
    renderWithProvider();
    fireEvent.click(screen.getByText('Show Success'));
    expect(await screen.findByText('Saved successfully')).toBeInTheDocument();
    expect(document.querySelector('[aria-live="polite"]')).toBeInTheDocument();
  });
});
