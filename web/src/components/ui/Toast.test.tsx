import React from 'react';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
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

describe('ToastProvider', () => {
  it('shows success message and it can be dismissed', () => {
    renderWithProvider();
    fireEvent.click(screen.getByText('Show Success'));
    expect(screen.getByText('Saved successfully')).toBeInTheDocument();

    fireEvent.click(screen.getByText('Dismiss'));
    expect(screen.queryByText('Saved successfully')).not.toBeInTheDocument();
  });

  it('auto-dismisses after timeout', () => {
    vi.useFakeTimers();
    try {
      renderWithProvider();
      fireEvent.click(screen.getByText('Show Success'));
      expect(screen.getByText('Saved successfully')).toBeInTheDocument();

      act(() => {
        vi.advanceTimersByTime(4000);
      });

      expect(screen.queryByText('Saved successfully')).not.toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });

  it('shows multiple toasts stacked', () => {
    renderWithProvider();
    fireEvent.click(screen.getByText('Show Success'));
    fireEvent.click(screen.getByText('Show Error'));
    fireEvent.click(screen.getByText('Show Info'));

    expect(screen.getByText('Saved successfully')).toBeInTheDocument();
    expect(screen.getByText('Something failed')).toBeInTheDocument();
    expect(screen.getByText('Just so you know')).toBeInTheDocument();
  });

  it('has aria-live region for accessibility', () => {
    renderWithProvider();
    expect(document.querySelector('[aria-live="polite"]')).toBeInTheDocument();
  });
});
