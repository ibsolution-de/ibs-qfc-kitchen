import React from 'react';
import { PASTEL_VARIANTS } from '../../constants';

interface BadgeProps {
  color: keyof typeof PASTEL_VARIANTS;
  children: React.ReactNode;
  className?: string;
  onClick?: () => void;
}

export const Badge: React.FC<BadgeProps> = ({ color, children, className = '', onClick }) => {
  const styles = PASTEL_VARIANTS[color] || PASTEL_VARIANTS.gray;
  
  return (
    <span 
      onClick={onClick}
      className={`inline-flex items-center rounded-md border px-2 py-0.5 text-xs font-medium transition-colors focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 ${styles.bg} ${styles.text} ${styles.border} ${className} ${onClick ? 'cursor-pointer hover:opacity-80' : ''}`}
    >
      {children}
    </span>
  );
};
