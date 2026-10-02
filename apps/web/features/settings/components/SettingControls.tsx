import React from 'react';
import { Check } from 'lucide-react';
import { Card } from '../../../components/ui/Card';
export const SettingShell: React.FC<{ title: string; description: string; icon: React.ReactNode; children: React.ReactNode; badge?: string }> = ({ title, description, icon, children, badge }) => (
    <Card>
        <div className="flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
            <div className="flex gap-4">
                <div className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-xl bg-brand-50 text-brand-600 dark:bg-brand-900/30 dark:text-brand-300">
                    {icon}
                </div>
                <div>
                    <div className="flex flex-wrap items-center gap-2">
                        <h2 className="text-lg font-semibold text-slate-900 dark:text-white">{title}</h2>
                        {badge && <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-medium text-slate-500 dark:bg-slate-800 dark:text-slate-400">{badge}</span>}
                    </div>
                    <p className="mt-1 max-w-xl text-sm leading-6 text-slate-500 dark:text-slate-400">{description}</p>
                </div>
            </div>
            <div className="w-full lg:w-[360px]">{children}</div>
        </div>
    </Card>
);

export const ToggleControl: React.FC<{ enabled: boolean; onChange?: () => void; disabled?: boolean; ariaLabel?: string }> = ({ enabled, onChange, disabled, ariaLabel }) => (
    <button
        type="button"
        disabled={disabled}
        onClick={onChange}
        aria-label={ariaLabel}
        className={`relative inline-flex h-8 w-14 shrink-0 items-center overflow-hidden rounded-full transition-all duration-300 focus:outline-none focus:ring-2 focus:ring-brand-500 focus:ring-offset-2 dark:focus:ring-offset-slate-950 ${enabled ? 'bg-brand-600' : 'bg-slate-300 dark:bg-slate-700'} ${disabled ? 'cursor-not-allowed opacity-50' : 'cursor-pointer'}`}
        aria-pressed={enabled}
    >
        <span
            className="absolute top-1 inline-flex h-6 w-6 items-center justify-center rounded-full bg-white text-slate-500 shadow-md transition-[left] duration-300"
            style={{ left: enabled ? '1.75rem' : '0.25rem' }}
        >
            {enabled ? <Check size={14} className="text-brand-600" /> : null}
        </span>
    </button>
);

export const RangeControl: React.FC<{
    label: string;
    valueLabel: string;
    minLabel: string;
    maxLabel: string;
    defaultValue: number;
    value: number;
    min: number;
    max: number;
    step: number;
    onChange: (value: number) => void;
}> = ({ label, valueLabel, minLabel, maxLabel, defaultValue, value, min, max, step, onChange }) => {
    const defaultPosition = max === min
        ? 50
        : Math.min(100, Math.max(0, ((defaultValue - min) / (max - min)) * 100));

    return <div className="space-y-2">
        <div className="flex items-center justify-between gap-3">
            <label className="text-sm font-medium text-slate-700 dark:text-slate-200">{label}</label>
            <span className="font-mono text-xs font-semibold text-brand-600 dark:text-brand-300">{valueLabel}</span>
        </div>
        <input
            type="range"
            min={min}
            max={max}
            step={step}
            value={value}
            onChange={(event) => onChange(Number(event.target.value))}
            className="w-full accent-brand-600"
        />
        <div className="relative h-4 text-[11px] text-slate-400 dark:text-slate-500">
            <span>{minLabel}</span>
            <span className="absolute -translate-x-1/2" style={{ left: `${defaultPosition}%` }}>Default</span>
            <span className="absolute right-0">{maxLabel}</span>
        </div>
    </div>;
};
