import * as React from 'react';
import { PASTEL_VARIANTS } from '../../constants';
import { badgeVariants } from './shadcn/badge';
import { cn } from '@/lib/utils';

type StatusValue = string | undefined | null;

interface StatusBadgeProps {
  status: StatusValue;
  children?: React.ReactNode;
  className?: string;
}

export const StatusBadge: React.FC<StatusBadgeProps> = ({ status, children, className = '' }) => {
  const normalized = (status || '').toLowerCase();

  const statusConfig: Record<string, { color: keyof typeof PASTEL_VARIANTS; label: string } | undefined> = {
    active: { color: 'green', label: 'Active' },
    opportunity: { color: 'orange', label: 'Opportunity' },
    completed: { color: 'gray', label: 'Completed' },
    on_hold: { color: 'orange', label: 'On Hold' },
    good: { color: 'green', label: 'Good' },
    warning: { color: 'orange', label: 'Warning' },
    critical: { color: 'pink', label: 'Critical' },
    low: { color: 'orange', label: 'Low' },
    full: { color: 'green', label: 'Full' }
  };

  const config = statusConfig[normalized] || { color: 'gray' as keyof typeof PASTEL_VARIANTS, label: status || 'Unknown' };
  const styles = PASTEL_VARIANTS[config.color];

  return (
    <span
      className={cn(
        badgeVariants({ variant: 'outline' }),
        'px-2 text-[10px] font-medium',
        `${styles.bg} ${styles.text} ${styles.border}`,
        'capitalize',
        className
      )}
    >
      {children || config.label}
    </span>
  );
};
