import React from 'react';

export const inputClass = "w-full px-3 py-2 border border-charcoal-200 rounded-lg text-sm focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 outline-none";

interface FormFieldProps {
  label: string;
  htmlFor: string;
  error?: string;
  children: React.ReactNode;
  className?: string;
}

export const FormField: React.FC<FormFieldProps> = ({ label, htmlFor, error, children, className = '' }) => {
  return (
    <div className={`${className}`}>
      <label htmlFor={htmlFor} className="block text-xs font-semibold text-charcoal-500 uppercase tracking-wider mb-1.5">
        {label}
      </label>
      {children}
      {error && <p className="mt-1 text-xs text-red-600">{error}</p>}
    </div>
  );
};

interface TextInputProps extends Omit<React.InputHTMLAttributes<HTMLInputElement>, 'type'> {
  type?: React.HTMLInputTypeAttribute;
}

export const TextInput = React.forwardRef<HTMLInputElement, TextInputProps>(
  ({ className = '', type = 'text', ...props }, ref) => (
    <input
      ref={ref}
      type={type}
      className={`${inputClass} ${className}`}
      {...props}
    />
  )
);
TextInput.displayName = 'TextInput';

interface SelectInputProps extends React.SelectHTMLAttributes<HTMLSelectElement> {
  children: React.ReactNode;
}

export const SelectInput = React.forwardRef<HTMLSelectElement, SelectInputProps>(
  ({ className = '', children, ...props }, ref) => (
    <select
      ref={ref}
      className={`${inputClass} bg-white ${className}`}
      {...props}
    >
      {children}
    </select>
  )
);
SelectInput.displayName = 'SelectInput';
