import * as React from 'react';
import { PASTEL_VARIANTS } from '../../constants';
import { badgeVariants } from './shadcn/badge';
import { cn } from '@/lib/utils';

interface BadgeProps {
  color: keyof typeof PASTEL_VARIANTS;
  children: React.ReactNode;
  className?: string;
  onClick?: () => void;
}

/**
 * shadcn `badge` adapter keeping the pastel color system from `constants`.
 */
export const Badge: React.FC<BadgeProps> = ({ color, children, className = '', onClick }) => {
  const styles = PASTEL_VARIANTS[color] || PASTEL_VARIANTS.gray;
  const baseClasses = cn(
    badgeVariants({ variant: 'outline' }),
    `${styles.bg} ${styles.text} ${styles.border}`,
    onClick && 'cursor-pointer hover:opacity-80',
    className
  );

  if (onClick) {
    return (
      <button type="button" onClick={onClick} className={baseClasses}>
        {children}
      </button>
    );
  }

  return <span className={baseClasses}>{children}</span>;
};
