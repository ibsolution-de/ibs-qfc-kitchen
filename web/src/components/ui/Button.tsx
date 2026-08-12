import * as React from 'react';
import { buttonVariants } from './shadcn/button';
import { cn } from '@/lib/utils';

type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'outline';
type ButtonSize = 'sm' | 'md' | 'lg' | 'icon';

const variantMap: Record<ButtonVariant, 'default' | 'secondary' | 'ghost' | 'outline'> = {
  primary: 'default',
  secondary: 'secondary',
  ghost: 'ghost',
  outline: 'outline',
};

const sizeMap: Record<ButtonSize, 'default' | 'sm' | 'lg' | 'icon'> = {
  sm: 'sm',
  md: 'default',
  lg: 'lg',
  icon: 'icon',
};

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
}

/**
 * shadcn `button` adapter. Keeps the app's historical variant/size names
 * (`primary`/`md`) so existing call sites stay untouched.
 */
export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className = '', variant = 'primary', size = 'md', type = 'button', ...props }, ref) => (
    <button
      ref={ref}
      type={type}
      className={cn(buttonVariants({ variant: variantMap[variant], size: sizeMap[size] }), className)}
      {...props}
    />
  )
);
Button.displayName = 'Button';
