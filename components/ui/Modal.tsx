import React from 'react';
import { X } from 'lucide-react';

interface ModalProps {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
  size?: 'sm' | 'md' | 'lg' | 'xl';
  variant?: 'default' | 'dark';
}

export const Modal: React.FC<ModalProps> = ({ isOpen, onClose, title, children, size = 'md', variant = 'default' }) => {
  if (!isOpen) return null;

  const sizeClasses = {
    sm: 'max-w-md',
    md: 'max-w-xl',
    lg: 'max-w-2xl',
    xl: 'max-w-4xl'
  };

  const themeClasses = variant === 'dark' 
    ? 'bg-charcoal-900 border border-charcoal-700 text-charcoal-100' 
    : 'bg-white text-charcoal-900';
    
  const headerBorder = variant === 'dark' ? 'border-charcoal-800' : 'border-charcoal-100';
  const closeBtnClass = variant === 'dark' 
    ? 'text-charcoal-400 hover:text-white hover:bg-charcoal-800' 
    : 'text-charcoal-400 hover:text-charcoal-600 hover:bg-charcoal-50';
  const titleColor = variant === 'dark' ? 'text-charcoal-100' : 'text-charcoal-900';
  const backdropClass = variant === 'dark' ? 'bg-black/60' : 'bg-black/25';

  return (
    <div className={`fixed inset-0 z-50 flex items-center justify-center p-4 ${backdropClass} backdrop-blur-sm`}>
      <div 
        className={`${themeClasses} rounded-xl shadow-2xl w-full ${sizeClasses[size]} flex flex-col max-h-[90vh] animate-in fade-in zoom-in-95 duration-200`}
        onClick={e => e.stopPropagation()}
      >
        <div className={`flex items-center justify-between p-4 border-b ${headerBorder}`}>
          <h3 className={`text-lg font-semibold ${titleColor}`}>{title}</h3>
          <button 
            onClick={onClose}
            className={`p-1 rounded-md transition-colors ${closeBtnClass}`}
          >
            <X className="w-5 h-5" />
          </button>
        </div>
        <div className="p-6 overflow-y-auto custom-scrollbar">
          {children}
        </div>
      </div>
    </div>
  );
};