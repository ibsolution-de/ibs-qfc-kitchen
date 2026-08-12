import * as React from 'react';
import { X } from 'lucide-react';
import { Dialog, DialogContent, DialogTitle, DialogClose } from './shadcn/dialog';
import { cn } from '@/lib/utils';

interface ModalProps {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
  size?: 'sm' | 'md' | 'lg' | 'xl';
  variant?: 'default' | 'dark';
}

const sizeClasses = {
  sm: 'max-w-md sm:max-w-md',
  md: 'max-w-xl sm:max-w-xl',
  lg: 'max-w-2xl sm:max-w-2xl',
  xl: 'max-w-4xl sm:max-w-4xl',
};

/**
 * shadcn `dialog` adapter. Keeps the app's historical props (`isOpen`,
 * `onClose`, `size`, `variant`) so existing call sites stay untouched.
 */
export const Modal: React.FC<ModalProps> = ({ isOpen, onClose, title, children, size = 'md', variant = 'default' }) => {
  const isDark = variant === 'dark';

  return (
    <Dialog
      open={isOpen}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent
        aria-modal="true"
        className={cn(
          'flex max-h-[90vh] w-full flex-col gap-0 overflow-hidden rounded-xl border shadow-2xl',
          sizeClasses[size],
          isDark
            ? 'border-charcoal-700 bg-charcoal-900 text-charcoal-100'
            : 'border-border bg-background text-charcoal-900'
        )}
      >
        <div
          className={cn(
            'flex shrink-0 items-center justify-between border-b px-4 py-4',
            isDark ? 'border-charcoal-800' : 'border-charcoal-100'
          )}
        >
          <DialogTitle asChild>
            <h3 className={cn('text-lg font-semibold', isDark ? 'text-charcoal-100' : 'text-charcoal-900')}>
              {title}
            </h3>
          </DialogTitle>
          <DialogClose asChild>
            <button
              type="button"
              aria-label="Close"
              className={cn(
                'rounded-md p-1.5 transition-colors',
                isDark ? 'text-charcoal-400 hover:bg-charcoal-800 hover:text-white' : 'text-charcoal-400 hover:bg-charcoal-50 hover:text-charcoal-600'
              )}
            >
              <X className="h-5 w-5" />
            </button>
          </DialogClose>
        </div>
        <div className="overflow-y-auto p-6 custom-scrollbar">{children}</div>
      </DialogContent>
    </Dialog>
  );
};
