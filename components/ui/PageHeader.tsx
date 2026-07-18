import React from 'react';

interface PageHeaderProps {
  title: string;
  subtitle?: string;
  actions?: React.ReactNode;
}

export const PageHeader: React.FC<PageHeaderProps> = ({ title, subtitle, actions }) => {
  return (
    <div className="max-w-7xl mx-auto mb-8 flex justify-between items-end">
      <div>
        <h1 className="text-2xl font-semibold text-charcoal-900 tracking-tight">{title}</h1>
        {subtitle && <p className="text-charcoal-500 mt-1">{subtitle}</p>}
      </div>
      {actions && <div className="flex gap-3">{actions}</div>}
    </div>
  );
};
