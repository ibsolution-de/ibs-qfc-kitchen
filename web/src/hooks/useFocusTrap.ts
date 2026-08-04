import { useEffect, useRef } from 'react';

const FOCUSABLE_SELECTORS = [
  'a[href]',
  'button:not([disabled])',
  'textarea:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  '[tabindex]:not([tabindex="-1"])'
].join(', ');

export function useFocusTrap<T extends HTMLElement>(active: boolean) {
  const containerRef = useRef<T>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!active) return;

    previousFocusRef.current = document.activeElement as HTMLElement;

    const container = containerRef.current;
    if (!container) return;

    const focusable = Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTORS));
    const first = focusable[0];
    const last = focusable[focusable.length - 1];

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Tab' || focusable.length === 0) return;

      const activeElement = document.activeElement as HTMLElement;
      const isBackward = e.shiftKey;
      const firstEl = first;
      const lastEl = last;

      if (!firstEl || !lastEl) return;

      if (isBackward && activeElement === firstEl) {
        e.preventDefault();
        lastEl.focus();
      } else if (!isBackward && activeElement === lastEl) {
        e.preventDefault();
        firstEl.focus();
      }
    };

    container.addEventListener('keydown', handleKeyDown);
    first?.focus();

    return () => {
      container.removeEventListener('keydown', handleKeyDown);
      if (previousFocusRef.current && typeof previousFocusRef.current.focus === 'function') {
        previousFocusRef.current.focus();
      }
    };
  }, [active]);

  return containerRef;
}
