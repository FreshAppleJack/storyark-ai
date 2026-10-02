import React from 'react';
import { Button } from '../components/ui/Button';
import { ColorSwatch, TypographySpec } from '../types';
import { Save, Trash2, PenTool, CheckCircle2, Cloud, History, Moon, Settings, SlidersHorizontal, Sun } from 'lucide-react';

const StyleLibrary: React.FC = () => {
  const colors: ColorSwatch[] = [
    { name: 'Brand Primary', class: 'bg-brand-600', hex: '#0284c7', usage: 'Primary actions, Links, Active states' },
    { name: 'Brand Light', class: 'bg-brand-100', hex: '#e0f2fe', usage: 'Background highlights, Selected states' },
    { name: 'Ink Dark', class: 'bg-slate-900', hex: '#0f172a', usage: 'Headings, Primary text' },
    { name: 'Ink Body', class: 'bg-slate-600', hex: '#475569', usage: 'Body text, Secondary information' },
    { name: 'Paper White', class: 'bg-white border border-slate-200', hex: '#ffffff', usage: 'Card backgrounds, Editor surface' },
    { name: 'Night Workspace', class: 'bg-slate-950', hex: '#020617', usage: 'Dark mode application background' },
    { name: 'Dark Surface', class: 'bg-slate-900', hex: '#0f172a', usage: 'Dark mode cards, settings panels, navigation' },
    { name: 'Success / Completed', class: 'bg-emerald-500', hex: '#10b981', usage: 'Saved indicators, Completed status' },
    { name: 'Warning / Serializing', class: 'bg-amber-500', hex: '#f59e0b', usage: 'Unsaved changes, Serializing status' },
    { name: 'Destructive / Error', class: 'bg-rose-600', hex: '#e11d48', usage: 'Delete modals, Destructive actions' },
    { name: 'Auth Accent', class: 'bg-purple-600', hex: '#9333ea', usage: 'Registration page accent color' },
  ];

  const typography: TypographySpec[] = [
    { role: 'Display Heading', font: 'Inter', size: 'Text-4xl / Bold', weight: '700', sample: 'StoryArk Editor' },
    { role: 'Section Heading', font: 'Inter', size: 'Text-xl / Semibold', weight: '600', sample: 'Chapter 1: The Beginning' },
    { role: 'Body Text (UI)', font: 'Inter', size: 'Text-sm / Regular', weight: '400', sample: 'The quick brown fox jumps over the lazy dog.' },
    { role: 'Editor Content', font: 'Serif (System)', size: 'Text-lg / Regular', weight: '400', sample: 'It was a dark and stormy night...' },
    { role: 'Code / Mono', font: 'JetBrains Mono', size: 'Text-xs / Medium', weight: '500', sample: 'word_count: 2045' },
  ];

  return (
      <div className="min-h-screen bg-slate-50 dark:bg-slate-950 p-8 pb-32 transition-colors duration-300">
        <div className="max-w-5xl mx-auto space-y-16">

          {/* Header */}
          <div className="space-y-4 border-b border-slate-200 dark:border-slate-800 pb-8">
            <h1 className="text-4xl font-bold text-slate-900 dark:text-white">Style Library</h1>
            <p className="text-xl text-slate-600 dark:text-slate-300">
              Sprint 5 Deliverable: Global User Settings & Theme Patterns
            </p>
            <div className="flex gap-2">
            <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-brand-100 text-brand-800">
              Sprint 5
            </span>
              <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-slate-100 dark:bg-slate-800 text-slate-800 dark:text-slate-200">
              v5.0.0
            </span>
            </div>
          </div>

          {/* Color Palette */}
          <section className="space-y-6">
            <h2 className="text-2xl font-bold text-slate-900 dark:text-white flex items-center gap-2">
              <div className="w-2 h-8 bg-brand-600 rounded-sm"></div>
              Color Palette
            </h2>
            <p className="text-slate-600 dark:text-slate-400 max-w-2xl">
              A focused palette designed for long-form writing. Sprint 5 extends the core brand system with dark mode surfaces and settings-specific states while preserving semantic colors for document feedback.
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-6">
              {colors.map((color) => (
                  <div key={color.name} className="bg-white dark:bg-slate-900 p-4 rounded-xl shadow-sm border border-slate-100 dark:border-slate-800 flex items-center gap-4">
                    <div className={`w-16 h-16 rounded-lg shadow-inner flex-shrink-0 ${color.class}`}></div>
                    <div className="min-w-0">
                      <h3 className="font-semibold text-slate-900 dark:text-white truncate">{color.name}</h3>
                      <p className="text-xs font-mono text-slate-500 dark:text-slate-400 uppercase">{color.hex}</p>
                      <p className="text-xs text-slate-500 dark:text-slate-400 mt-1 line-clamp-2">{color.usage}</p>
                    </div>
                  </div>
              ))}
            </div>
          </section>

          {/* Typography */}
          <section className="space-y-6">
            <h2 className="text-2xl font-bold text-slate-900 dark:text-white flex items-center gap-2">
              <div className="w-2 h-8 bg-brand-600 rounded-sm"></div>
              Typography
            </h2>
            <p className="text-slate-600 dark:text-slate-400 max-w-2xl">
              Dual typeface system: <strong>Inter</strong> (Sans-serif) for application UI elements, and a comfortable <strong>System Serif</strong> font for the main editor canvas.
            </p>
            <div className="bg-white dark:bg-slate-900 rounded-xl shadow-sm border border-slate-200 dark:border-slate-800 overflow-hidden">
              <table className="w-full text-left">
                <thead className="bg-slate-50 dark:bg-slate-950 border-b border-slate-200 dark:border-slate-800">
                <tr>
                  <th className="px-6 py-3 text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider">Role</th>
                  <th className="px-6 py-3 text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider">Spec</th>
                  <th className="px-6 py-3 text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider w-1/2">Sample</th>
                </tr>
                </thead>
                <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
                {typography.map((type) => (
                    <tr key={type.role}>
                      <td className="px-6 py-4 text-sm font-medium text-slate-900 dark:text-white">{type.role}</td>
                      <td className="px-6 py-4 text-sm text-slate-500 dark:text-slate-400">
                        <div className="flex flex-col">
                          <span>{type.font}</span>
                          <span className="text-xs opacity-75">{type.size}</span>
                        </div>
                      </td>
                      <td className={`px-6 py-4 text-slate-800 dark:text-slate-200 ${type.font.includes('Serif') ? 'font-serif text-lg' : 'font-sans'} ${type.font === 'JetBrains Mono' ? 'font-mono' : ''}`} style={{ fontWeight: type.weight }}>
                        {type.sample}
                      </td>
                    </tr>
                ))}
                </tbody>
              </table>
            </div>
          </section>

          {/* UI Components */}
          <section className="space-y-6">
            <h2 className="text-2xl font-bold text-slate-900 dark:text-white flex items-center gap-2">
              <div className="w-2 h-8 bg-brand-600 rounded-sm"></div>
              Core Components & States
            </h2>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-8">

              {/* Buttons */}
              <div className="space-y-4">
                <h3 className="text-lg font-semibold text-slate-800 dark:text-slate-200">Buttons</h3>
                <div className="p-6 bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 shadow-sm space-y-4">
                  <div className="flex flex-wrap gap-4 items-center">
                    <Button variant="primary">Primary Action</Button>
                    <Button variant="secondary">Secondary</Button>
                    <Button variant="ghost">Ghost</Button>
                  </div>
                  <div className="flex flex-wrap gap-4 items-center pt-4 border-t border-slate-100 dark:border-slate-800">
                    {/* Updated Danger button to use Rose instead of Red */}
                    <Button className="bg-rose-600 hover:bg-rose-700 text-white" icon={<Trash2 size={16} />}>Delete (Destructive)</Button>
                  </div>
                  <div className="flex flex-wrap gap-4 items-center pt-4 border-t border-slate-100 dark:border-slate-800">
                    <Button icon={<Save size={16} />}>Save Progress</Button>
                    <Button variant="secondary" icon={<PenTool size={16} />}>Edit</Button>
                  </div>
                </div>
              </div>

              {/* Document States */}
              <div className="space-y-4">
                <h3 className="text-lg font-semibold text-slate-800 dark:text-slate-200">Document Status Indicators</h3>
                <div className="p-6 bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 shadow-sm space-y-6">
                  <div className="flex items-center gap-2 text-sm font-medium">
                    <CheckCircle2 size={16} className="text-emerald-500" />
                    <span className="text-slate-400">Saved (Auto-sync)</span>
                  </div>
                  <div className="flex items-center gap-2 text-sm font-medium">
                    <History size={16} className="text-brand-500 animate-spin" />
                    <span className="text-brand-600">Saving...</span>
                  </div>
                  <div className="flex items-center gap-2 text-sm font-medium">
                    <Cloud size={16} className="text-amber-500" />
                    <span className="text-amber-600">Unsaved Changes</span>
                  </div>
                </div>
              </div>
            </div>
          </section>

          <section className="space-y-6">
            <h2 className="text-2xl font-bold text-slate-900 dark:text-white flex items-center gap-2">
              <div className="w-2 h-8 bg-brand-600 rounded-sm"></div>
              Settings & Theme Components
            </h2>
            <p className="text-slate-600 dark:text-slate-400 max-w-2xl">
              Global settings use large rounded panels, calm slate surfaces, brand-blue active states, and immediate visual feedback for theme switching.
            </p>
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
              <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-6 shadow-sm">
                <div className="flex items-start gap-4">
                  <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-brand-50 text-brand-600">
                    <Settings size={22} />
                  </div>
                  <div className="flex-1">
                    <h3 className="font-semibold text-slate-900 dark:text-white">Settings Panel</h3>
                    <p className="mt-1 text-sm leading-6 text-slate-500 dark:text-slate-400">Panels pair a clear icon, concise description, and right-aligned controls for fast scanning.</p>
                    <div className="mt-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 p-4">
                      <div className="flex items-center justify-between">
                        <div>
                          <p className="text-sm font-semibold text-slate-900 dark:text-white">Dark Mode</p>
                          <p className="text-xs text-slate-500 dark:text-slate-400">Immediate UI response</p>
                        </div>
                        <div className="relative h-8 w-14 rounded-full bg-brand-600">
                          <div className="absolute right-1 top-1 flex h-6 w-6 items-center justify-center rounded-full bg-white shadow-md">
                            <CheckCircle2 size={14} className="text-brand-600" />
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
              <div className="rounded-2xl border border-slate-800 bg-slate-950 p-6 shadow-sm">
                <div className="flex items-start gap-4">
                  <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-brand-900/40 text-brand-300">
                    <Moon size={22} />
                  </div>
                  <div className="flex-1">
                    <h3 className="font-semibold text-white">Dark Mode Surface</h3>
                    <p className="mt-1 text-sm leading-6 text-slate-400">Dark mode uses slate-950 backgrounds, slate-900 panels, softer borders, and preserved brand-blue focus states.</p>
                    <div className="mt-4 grid grid-cols-2 gap-3">
                      <div className="rounded-xl border border-slate-800 bg-slate-900 p-3">
                        <Sun size={18} className="mb-2 text-amber-400" />
                        <p className="text-xs font-medium text-slate-300">Light preview</p>
                      </div>
                      <div className="rounded-xl border border-brand-900/60 bg-brand-950/40 p-3">
                        <SlidersHorizontal size={18} className="mb-2 text-brand-300" />
                        <p className="text-xs font-medium text-brand-200">Active state</p>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </section>

          {/* Layout Patterns */}
          <section className="space-y-6">
            <h2 className="text-2xl font-bold text-slate-900 dark:text-white flex items-center gap-2">
              <div className="w-2 h-8 bg-brand-600 rounded-sm"></div>
              Layout & Spacing
            </h2>
            <div className="p-8 bg-slate-200 dark:bg-slate-900 rounded-xl border border-slate-300 dark:border-slate-700">
              <div className="grid grid-cols-12 gap-4 text-center text-xs font-mono text-slate-500 dark:text-slate-400">
                <div className="col-span-3 bg-white dark:bg-slate-900 p-4 rounded shadow-sm flex flex-col gap-2 h-48">
                  <div className="font-semibold text-slate-400 pb-2 border-b border-slate-100 dark:border-slate-800">Sidebar (Collapsible)</div>
                  <div className="bg-slate-50 dark:bg-slate-950 flex-1 rounded border border-slate-100 dark:border-slate-800 flex items-center justify-center">Chapter Tree</div>
                </div>
                <div className="col-span-9 grid grid-cols-1 gap-2">
                  <div className="bg-white dark:bg-slate-900 p-3 rounded shadow-sm flex justify-between items-center">
                    <span>Top Bar (Title & Document Status)</span>
                  </div>
                  <div className="bg-white dark:bg-slate-900 p-2 rounded shadow-sm text-left px-4 flex gap-2">
                    <span>Formatting Toolbar (B, I, U, Align)</span>
                  </div>
                  <div className="bg-white dark:bg-slate-900 p-4 rounded shadow-sm h-28 flex items-center justify-center text-slate-300 italic">
                    Centered Canvas (contentEditable)
                  </div>
                </div>
              </div>
            </div>
            <p className="text-sm text-slate-600 dark:text-slate-400">
              The layout follows a "Focused Productivity" pattern: Collapsible Sidebar for navigation, Sticky Header for status, native format Toolbar, and a constrained Canvas for reading/writing comfort.
            </p>
          </section>

        </div>
      </div>
  );
};

export default StyleLibrary;
