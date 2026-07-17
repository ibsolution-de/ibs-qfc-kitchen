import React from 'react';

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'ghost' | 'outline';
  size?: 'sm' | 'md' | 'lg' | 'icon';
}

export const Button: React.FC<ButtonProps> = ({ 
  children, 
  className = '', 
  variant = 'primary', 
  size = 'md', 
  ...props 
}) => {
  const baseStyles = "inline-flex items-center justify-center rounded-lg font-medium transition-all duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-charcoal-400 disabled:pointer-events-none disabled:opacity-50 active:scale-95 transform cursor-pointer";
  
  const variants = {
    primary: "bg-charcoal-800 text-white hover:bg-charcoal-900 shadow-sm hover:shadow-lg hover:-translate-y-0.5 border border-transparent",
    secondary: "bg-white text-charcoal-900 hover:bg-charcoal-50 shadow-sm hover:shadow-md border border-charcoal-200 hover:border-charcoal-300",
    ghost: "hover:bg-charcoal-100 hover:text-charcoal-900 text-charcoal-600",
    outline: "border border-charcoal-200 bg-transparent hover:bg-charcoal-50 text-charcoal-700 hover:border-charcoal-300",
  };

  const sizes = {
    sm: "h-8 px-3 text-xs",
    md: "h-9 px-4 py-2 text-sm",
    lg: "h-10 px-8 text-base",
    icon: "h-9 w-9",
  };

  return (
    <button 
      className={`${baseStyles} ${variants[variant]} ${sizes[size]} ${className}`} 
      {...props}
    >
      {children}
    </button>
  );
};