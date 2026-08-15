import React from 'react';

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger';
  size?: 'sm' | 'md' | 'lg';
  icon?: React.ReactNode;
}

export const Button: React.FC<ButtonProps> = ({ 
  children, 
  variant = 'primary', 
  size = 'md', 
  className = '', 
  icon,
  ...props 
}) => {
  const baseStyles = "inline-flex items-center justify-center rounded-lg font-medium transition-colors focus:outline-none focus:ring-2 focus:ring-offset-1 dark:focus:ring-offset-slate-900 disabled:opacity-50 disabled:cursor-not-allowed";
  
  const variants = {
    primary: "bg-brand-600 text-white hover:bg-brand-700 focus:ring-brand-500 shadow-sm",
    secondary: "bg-white text-slate-700 border border-slate-300 hover:bg-slate-50 focus:ring-slate-400 shadow-sm dark:bg-slate-800 dark:text-slate-100 dark:border-slate-700 dark:hover:bg-slate-700",
    ghost: "bg-transparent text-slate-600 hover:bg-slate-100 focus:ring-slate-400 dark:text-slate-300 dark:hover:bg-slate-800",
    danger: "bg-red-50 text-red-600 hover:bg-red-100 focus:ring-red-500 dark:bg-rose-950/40 dark:text-rose-300 dark:hover:bg-rose-900/60",
  };

  const sizes = {
    sm: "px-3 py-1.5 text-xs",
    md: "px-4 py-2 text-sm",
    lg: "px-6 py-3 text-base",
  };

  return (
    <button 
      className={`${baseStyles} ${variants[variant]} ${sizes[size]} ${className}`}
      {...props}
    >
      {icon && <span className="mr-2 -ml-1">{icon}</span>}
      {children}
    </button>
  );
};