import { useCallback, useEffect, useRef, useState } from 'react';
import { useBlocker } from 'react-router-dom';
import { aiErrorMessage, aiSettingsRepository as repo, type AiConfig, type AiConfigList, type AiConfigRecord } from '../../data/local/aiSettingsRepository';
import { useWindowCloseGuard } from '../editor/hooks/useWindowCloseGuard';

export const emptyAiConfig: AiConfig = { name: '', protocol: 'openai-responses', baseUrl: 'https://api.openai.com/v1', modelId: '', timeoutMs: 60000, maxOutputTokens: 100000 };

export function useAiSettings() {
    const [data, setData] = useState<AiConfigList | null>(null);
    const [editing, setEditing] = useState(false);
    const [selected, setSelected] = useState<AiConfigRecord | null>(null);
    const [form, setForm] = useState<AiConfig>({ ...emptyAiConfig });
    const [key, setKey] = useState('');
    const [remember, setRemember] = useState(false);
    const [dirty, setDirty] = useState(false);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState('');
    const [saved, setSaved] = useState(false);
    const [testStatus, setTestStatus] = useState('');
    const epoch = useRef(0);
    const mounted = useRef(false);
    const reload = useCallback(async () => {
        try { const next = await repo.list(); if (mounted.current) { setData(next); return next; } }
        catch (e) { if (mounted.current) setError(aiErrorMessage(e)); }
        return null;
    }, []);
    useEffect(() => {
        mounted.current = true;
        const requestEpoch = epoch;
        // Start asynchronous IPC after this mount's effect setup is complete.
        void Promise.resolve().then(() => { if (mounted.current) return reload(); });
        return () => { mounted.current = false; requestEpoch.current++; };
    }, [reload]);
    const changed = () => { epoch.current++; setDirty(true); setSaved(false); setError(''); setTestStatus(''); };
    const edit = (record: AiConfigRecord | null) => {
        epoch.current++; setSelected(record); setForm(record ? { ...record.config } : { ...emptyAiConfig });
        setKey(''); setRemember(record?.credentialMode === 'system'); setEditing(true);
        setDirty(false); setSaved(false); setError(''); setTestStatus('');
    };
    const cancel = () => {
        epoch.current++; setEditing(false); setSelected(null); setKey(''); setDirty(false); setError(''); setTestStatus(''); void reload();
    };
    const save = async () => {
        if (busy) return;
        setBusy(true); setError(''); setSaved(false); setTestStatus(''); epoch.current++;
        const supplied = key;
        setKey('');
        try {
            const ack = await repo.save({ id: selected?.id ?? null, expectedConfigVersion: selected?.configVersion ?? 0,
                config: form, credential: supplied ? { action: 'replace', key: supplied, remember } : { action: 'keep' } });
            if (!mounted.current) return;
            setDirty(false); setSaved(true); setEditing(false); setSelected(null);
            if (ack.cleanupPending) setError('Settings saved. Credential cleanup will be retried.');
            await reload();
        } catch (e) { if (mounted.current) setError(aiErrorMessage(e)); }
        finally { if (mounted.current) setBusy(false); }
    };
    const mutate = async (action: () => Promise<unknown>) => {
        if (busy) return;
        epoch.current++; setBusy(true); setError(''); setTestStatus(''); setSaved(false);
        try { await action(); if (mounted.current) { setSaved(true); await reload(); } }
        catch (e) { if (mounted.current) setError(aiErrorMessage(e)); }
        finally { if (mounted.current) setBusy(false); }
    };
    const test = async (record: AiConfigRecord) => {
        if (busy) return;
        const requestId = crypto.randomUUID(); const current = ++epoch.current;
        setBusy(true); setError(''); setTestStatus(`Testing ${record.config.name}...`);
        try {
            const result = await repo.test(record, requestId);
            if (mounted.current && current === epoch.current && result.requestId === requestId && result.configVersion === record.configVersion) {
                setTestStatus(`Connection verified: ${record.config.name}.`);
            }
        } catch (e) { if (mounted.current && current === epoch.current) { setTestStatus(''); setError(aiErrorMessage(e)); } }
        finally { if (mounted.current) setBusy(false); }
    };
    const blocked = dirty || (busy && editing);
    const blocker = useBlocker(blocked);
    useEffect(() => {
        if (blocker.state !== 'blocked') return;
        queueMicrotask(() => {
            if (!mounted.current) return;
            setError('Save or cancel the model edits before leaving.');
            blocker.reset();
        });
    }, [blocker]);
    useWindowCloseGuard({ isDirty: blocked, flush: async () => false, onFlushFailed: () => setError('Save or cancel the model edits before closing.') });
    return { data, editing, selected, form, key, remember, dirty, busy, error, saved, testStatus, reload, edit, cancel, save, test,
        change: (next: Partial<AiConfig>) => { changed(); setForm(previous => ({ ...previous, ...next })); },
        changeKey: (value: string) => { changed(); setKey(value); },
        changeRemember: (value: boolean) => { changed(); setRemember(value); },
        makeDefault: (record: AiConfigRecord | null) => mutate(() => repo.setDefault(record, data!.databaseVersion)),
        remove: (record: AiConfigRecord) => mutate(() => repo.delete(record, data!.databaseVersion)),
    };
}
