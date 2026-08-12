import * as React from 'react';
import { toast as sonner, Toaster } from 'sonner';

export type ToastType = 'success' | 'error' | 'info';

interface ToastContextValue {
  success: (message: string) => void;
  error: (message: string) => void;
  info: (message: string) => void;
}

/**
 * sonner-backed toast provider. Keeps the old `useToast()` return shape
 * ({ success, error, info }) so existing call sites stay untouched. Sonner's
 * `toast.*` helpers are stable module references, so destructured values are
 * safe in effect dependency arrays.
 */
export const ToastProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  return (
    <>
      {children}
      <Toaster position="bottom-right" />
    </>
  );
};

export const useToast = (): ToastContextValue => ({
  success: (message) => sonner.success(message),
  error: (message) => sonner.error(message),
  info: (message) => sonner.info(message),
});
