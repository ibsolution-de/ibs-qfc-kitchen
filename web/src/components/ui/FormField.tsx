import * as React from 'react';
import { cn } from '@/lib/utils';
import { Label } from './shadcn/label';
import { Input, inputClass } from './shadcn/input';

interface FormFieldProps {
  label: string;
  htmlFor: string;
  error?: string;
  children: React.ReactNode;
  className?: string;
}

export { inputClass };

export const FormField: React.FC<FormFieldProps> = ({ label, htmlFor, error, children, className = '' }) => {
  return (
    <div className={cn(className)}>
      <Label htmlFor={htmlFor} className="mb-1.5 block text-xs font-semibold tracking-wider text-charcoal-500 uppercase">
        {label}
      </Label>
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
    <Input ref={ref} type={type} className={className} {...props} />
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
      className={cn(inputClass, 'bg-white', className)}
      {...props}
    >
      {children}
    </select>
  )
);
SelectInput.displayName = 'SelectInput';
