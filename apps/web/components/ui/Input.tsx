import React from 'react';

interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  helperText?: string;
  error?: boolean;
}

export const Input: React.FC<InputProps> = ({ label, helperText, error, className = '', ...props }) => {
  return (
    <div className="w-full">
      {label && (
        <label className="block text-sm font-medium text-slate-700 dark:text-slate-200 mb-1.5">
          {label}
        </label>
      )}
      <input
        className={`
          w-full px-3 py-2 rounded-lg border text-sm transition-shadow
          focus:outline-none focus:ring-2 focus:ring-offset-0
          bg-white text-slate-900 dark:bg-slate-900 dark:text-slate-100
          disabled:bg-slate-50 disabled:text-slate-500 dark:disabled:bg-slate-800 dark:disabled:text-slate-500
          ${error 
            ? 'border-red-300 focus:border-red-500 focus:ring-red-200 dark:border-rose-700 dark:focus:ring-rose-900' 
            : 'border-slate-300 focus:border-brand-500 focus:ring-brand-200 hover:border-slate-400 dark:border-slate-700 dark:focus:border-brand-500 dark:focus:ring-brand-900 dark:hover:border-slate-500'
          }
          ${className}
        `}
        {...props}
      />
      {helperText && (
        <p className={`mt-1 text-xs ${error ? 'text-red-600 dark:text-rose-300' : 'text-slate-500 dark:text-slate-400'}`}>
          {helperText}
        </p>
      )}
    </div>
  );
};