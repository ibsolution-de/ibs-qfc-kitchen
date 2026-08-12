import * as React from 'react';
import * as ProgressPrimitive from '@radix-ui/react-progress';
import { cn } from '@/lib/utils';

interface ProgressBarProps {
  value: number;
  status?: 'default' | 'good' | 'warning' | 'critical';
  size?: 'sm' | 'md';
  label?: string;
  className?: string;
}

const statusClasses = {
  default: 'bg-blue-600',
  good: 'bg-green-500',
  warning: 'bg-yellow-500',
  critical: 'bg-red-500'
};

const sizeClasses = {
  sm: 'h-1.5',
  md: 'h-2'
};

/**
 * Radix `progress` adapter (same API as the old hand-rolled component).
 * Radix owns the `progressbar` role and value aria-attributes.
 */
export const ProgressBar: React.FC<ProgressBarProps> = ({
  value,
  status = 'default',
  size = 'md',
  label,
  className = ''
}) => {
  const clampedValue = Math.max(0, Math.min(1, value));
  const percentage = Math.round(clampedValue * 100);

  return (
    <div className={cn(className)}>
      {label && (
        <div className="mb-1 flex justify-between text-[10px] text-charcoal-500">
          <span>{label}</span>
          <span className="font-medium text-charcoal-700">{percentage}%</span>
        </div>
      )}
      <ProgressPrimitive.Root
        value={percentage}
        className={cn('relative w-full overflow-hidden rounded-full bg-charcoal-100', sizeClasses[size])}
      >
        <ProgressPrimitive.Indicator
          className={cn('h-full w-full flex-1 rounded-full transition-all duration-500', statusClasses[status])}
          style={{ transform: `translateX(-${100 - percentage}%)` }}
        />
      </ProgressPrimitive.Root>
    </div>
  );
};
