import React from 'react';

interface ProgressBarProps {
  value: number;
  status?: 'default' | 'good' | 'warning' | 'critical';
  size?: 'sm' | 'md';
  label?: string;
  className?: string;
}

export const ProgressBar: React.FC<ProgressBarProps> = ({
  value,
  status = 'default',
  size = 'md',
  label,
  className = ''
}) => {
  const clampedValue = Math.max(0, Math.min(1, value));
  const percentage = Math.round(clampedValue * 100);

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

  return (
    <div className={className}>
      {label && (
        <div className="flex justify-between text-[10px] text-charcoal-500 mb-1">
          <span>{label}</span>
          <span className="font-medium text-charcoal-700">{percentage}%</span>
        </div>
      )}
      <div
        role="progressbar"
        aria-valuenow={percentage}
        aria-valuemin={0}
        aria-valuemax={100}
        className={`w-full bg-charcoal-100 rounded-full overflow-hidden ${sizeClasses[size]}`}
      >
        <div
          className={`h-full rounded-full transition-all duration-500 ${statusClasses[status]}`}
          style={{ width: `${percentage}%` }}
        />
      </div>
    </div>
  );
};
