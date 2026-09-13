import { KeyRound } from 'lucide-react';
import { useState, type ChangeEvent } from 'react';
import { SettingShell } from './SettingControls';
import { Button } from '../../../components/ui/Button';
import { SaveStatusIndicator } from '../../../components/ui/SaveStatusIndicator';
import { useAiSettings } from '../useAiSettings';
import type { AiProtocol } from '../../../data/local/aiSettingsRepository';

const inputClass = 'mt-1 w-full rounded-lg border border-slate-300 bg-white p-2 text-sm text-slate-900 focus:border-brand-500 focus:outline-none dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100 dark:focus:bg-slate-950';
const credentialLabels = { session: 'This session only', configured: 'Configured in system credential store', unavailable: 'Credential unavailable' };
const actionButtonClass = 'h-9 w-full whitespace-nowrap';

interface NumericSettingInputProps {
    value: number;
    min: number;
    max: number;
    onChange: (value: number) => void;
}

function NumericSettingInput({ value, min, max, onChange }: NumericSettingInputProps) {
    const [draft, setDraft] = useState(() => String(value));

    const handleChange = (event: ChangeEvent<HTMLInputElement>) => {
        const next = event.currentTarget.value.replace(/[^0-9]/g, '');
        const normalized = next.replace(/^0+(?=\d)/, '');
        setDraft(normalized);
        if (normalized) onChange(Number(normalized));
    };

    const restoreValue = () => {
        if (!draft) {
            setDraft(String(value));
            return;
        }
        const parsed = Number(draft);
        if (!Number.isInteger(parsed)) return;
        const bounded = Math.min(max, Math.max(min, parsed));
        if (bounded !== parsed) {
            setDraft(String(bounded));
            onChange(bounded);
        }
    };

    return <input
        type="text"
        inputMode="numeric"
        pattern="[0-9]*"
        required
        maxLength={String(max).length}
        className={inputClass}
        value={draft}
        onChange={handleChange}
        onBlur={restoreValue}
    />;
}

export function AiModels() {
    const s = useAiSettings();
    return <SettingShell title="AI Models" description="Choose the model service used by AI writing features. Credentials stay on this device; connection tests send a short synthetic message, never your manuscript." icon={<KeyRound size={22} />}>
        <div className="space-y-4">
            {s.saved && <SaveStatusIndicator state="saved" savedText="Configuration saved locally" />}
            {s.editing && (s.dirty || s.busy) && <SaveStatusIndicator state={s.busy ? 'saving' : 'unsaved'} />}
            {s.error && <p role="alert" className="text-sm text-rose-600 dark:text-rose-300">{s.error}</p>}
            {s.testStatus && <p role="status" className="text-sm text-brand-600 dark:text-brand-300">{s.testStatus}</p>}
            {s.data?.cleanupPending && <p className="text-xs text-amber-600 dark:text-amber-300">Settings are saved. Old credential cleanup is pending and will be retried.</p>}
            {!s.data && <Button variant="secondary" disabled={s.busy} onClick={() => void s.reload()}>Reload model settings</Button>}
            {!s.editing && s.data && <>
                {s.data.configs.length === 0 && <p className="text-sm text-slate-500">No model configured. Local writing remains available.</p>}
                {s.data.configs.map(record => <div key={record.id} className="space-y-2 rounded-xl border border-slate-200 p-3 dark:border-slate-700">
                    <div className="flex flex-wrap items-center justify-between gap-2"><strong className="text-sm">{record.config.name}</strong>{s.data?.defaultConfigId === record.id && <span className="text-xs text-brand-600 dark:text-brand-300">Default</span>}</div>
                    <p className="break-all text-xs text-slate-500 dark:text-slate-400">{record.config.modelId}<br />{record.config.baseUrl}</p>
                    <p className="text-xs">{credentialLabels[record.credentialStatus]}</p>
                    <div className="grid grid-cols-2 gap-2">
                        <Button size="sm" variant="secondary" className={actionButtonClass} disabled={s.busy} onClick={() => s.edit(record)}>Edit</Button>
                        <Button size="sm" variant="secondary" className={actionButtonClass} disabled={s.busy || record.credentialStatus === 'unavailable'} onClick={() => void s.test(record)}>Test connection</Button>
                        <Button size="sm" variant="secondary" className={actionButtonClass} disabled={s.busy} onClick={() => void s.makeDefault(s.data?.defaultConfigId === record.id ? null : record)}>{s.data?.defaultConfigId === record.id ? 'Clear default' : 'Set default'}</Button>
                        <Button size="sm" variant="danger" className={actionButtonClass} disabled={s.busy} onClick={() => void s.remove(record)}>Delete</Button>
                    </div>
                </div>)}
                <p className="text-xs text-slate-500 dark:text-slate-400">Connection tests may incur a small API charge. Saving a configuration does not test it.</p>
                <Button disabled={s.busy} onClick={() => s.edit(null)}>Add model</Button>
            </>}
            {s.editing && <form className="space-y-3" onSubmit={event => { event.preventDefault(); void s.save(); }}>
                <fieldset disabled={s.busy} className="space-y-3">
                    <label className="block text-sm">Name<input required maxLength={120} className={inputClass} value={s.form.name} onChange={e => s.change({ name: e.target.value })} /></label>
                    <label className="block text-sm">Protocol<select className={inputClass} value={s.form.protocol} onChange={e => s.change({ protocol: e.target.value as AiProtocol })}>
                        <option value="openai-responses">OpenAI Responses</option><option value="openai-chat-completions">OpenAI-compatible Chat Completions</option><option value="anthropic-messages">Anthropic Messages</option>
                    </select></label>
                    <label className="block text-sm">Base URL<input required type="url" className={inputClass} value={s.form.baseUrl} onChange={e => s.change({ baseUrl: e.target.value })} /></label>
                    <p className="text-xs text-slate-500">Include /v1 or your proxy path; omit /responses, /messages and /chat/completions. Anthropic: https://api.anthropic.com/v1</p>
                    <label className="block text-sm">Model ID<input required maxLength={256} className={inputClass} value={s.form.modelId} onChange={e => s.change({ modelId: e.target.value })} /></label>
                    <label className="block text-sm">API key<input type="password" autoComplete="off" spellCheck={false} maxLength={8192} className={inputClass} value={s.key} onChange={e => s.changeKey(e.target.value)} placeholder={s.selected ? 'Leave blank to keep the existing credential' : 'Enter your API key'} required={!s.selected} /></label>
                    <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={s.remember} disabled={!s.key} onChange={e => s.changeRemember(e.target.checked)} />Remember replacement key on this device</label>
                    <p className="text-xs text-slate-500 dark:text-slate-400">{s.remember ? 'Uses Windows Credential Manager or macOS Keychain. Keys are not included in exports or database backups.' : 'Session keys must be entered again after restarting. Enter a new key to change its storage mode.'}</p>
                    <details><summary className="cursor-pointer text-sm">Advanced limits</summary>
                        <div className="mt-3 space-y-3">
                            <p className="text-xs leading-5 text-slate-500 dark:text-slate-400">These are technical provider safeguards. Set the author-facing AI Continue length in Writing Preferences. New configurations use a 60,000 ms timeout and a 100,000-token cap.</p>
                            <label className="block text-sm">Request timeout (milliseconds)<NumericSettingInput value={s.form.timeoutMs} min={1000} max={600000} onChange={value => s.change({ timeoutMs: value })} /></label>
                            <label className="block text-sm">Provider output cap (tokens)<NumericSettingInput value={s.form.maxOutputTokens} min={1} max={1000000} onChange={value => s.change({ maxOutputTokens: value })} /></label>
                        </div>
                    </details>
                    <div className="flex gap-2"><Button type="submit">Save configuration</Button><Button type="button" variant="secondary" onClick={s.cancel}>Cancel</Button></div>
                </fieldset>
            </form>}
        </div>
    </SettingShell>;
}
