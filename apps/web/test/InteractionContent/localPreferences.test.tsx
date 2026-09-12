import React from 'react';
import { act, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { PreferencesProvider, usePreferences } from '../../InteractionContent/PreferencesContext';
import { EDITOR_SPACING_LIMITS } from '../../types';

const native = vi.hoisted(() => ({ invoke: vi.fn(), isTauri: vi.fn() }));
const toast = vi.hoisted(() => ({ error: vi.fn(), default: vi.fn() }));
vi.mock('@tauri-apps/api/core', () => native);
vi.mock('react-hot-toast', () => ({ toast: Object.assign(vi.fn(), { error: toast.error }) }));
vi.mock('../../data/accountApi', () => ({ accountApi: { getPreferences: vi.fn(), saveDarkMode: vi.fn(), saveSpacing: vi.fn(), saveAiContinue: vi.fn(), saveAutoHighlight: vi.fn() } }));
vi.mock('../../InteractionContent/SessionContext', () => ({ useSession: () => ({ user: null }) }));

function Probe() {
    const preferences = usePreferences();
    return <div>
        <span data-testid="dark">{String(preferences.isDarkMode)}</span>
        <span data-testid="margin">{preferences.editorSpacingSettings.editorMarginPx}</span>
        <button onClick={preferences.toggleDarkMode}>toggle</button>
        <button onClick={() => preferences.updateEditorSpacingSettings({ editorMarginPx: 60 })}>margin-60</button>
    </div>;
}
const setup = () => render(<PreferencesProvider><Probe /></PreferencesProvider>);
const reply = (value: unknown) => ({ ok: true, value });
const preferencesRow = (overrides: Record<string, unknown> = {}) => ({
    databaseVersion: 5, darkMode: false, editorMarginPx: 36, editorLineHeight: 1.4,
    aiContinueContextChars: 1500, aiContinueOutputChars: 300,
    autoHighlight: { disabledRoles: ['mob'] }, updatedAt: 1, ...overrides,
});

beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    native.isTauri.mockReturnValue(true);
});

it('imports known localStorage keys exactly once when the row is missing', async () => {
    localStorage.setItem('storyark_dark_mode', 'true');
    localStorage.setItem('storyark_editor_spacing', JSON.stringify({ editorMarginPx: 64, editorLineHeight: 1.7 }));
    const calls: unknown[][] = [];
    native.invoke.mockImplementation(async (command: string, args: unknown) => {
        calls.push([command, args]);
        if (command === 'local_read_preferences') return reply(null);
        if (command === 'local_save_preferences') {
            const input = (args as { input: Record<string, unknown> }).input;
            return reply({ preferences: preferencesRow({ databaseVersion: 1, ...input }), sessionKey: input.sessionKey, revision: input.revision });
        }
        throw new Error(command);
    });
    setup();
    await waitFor(() => expect(screen.getByTestId('margin').textContent).toBe('64'));
    await waitFor(() => expect(calls.some(call => call[0] === 'local_save_preferences')).toBe(true));
    const importCall = calls.find(call => call[0] === 'local_save_preferences')!;
    const input = (importCall[1] as { input: Record<string, unknown> }).input;
    expect(input.expectedDatabaseVersion).toBe(0);
    expect(input.darkMode).toBe(true);
    expect(input.editorMarginPx).toBe(64);
    expect(input.editorLineHeight).toBe(1.7);
    expect(screen.getByTestId('dark').textContent).toBe('true');
    // localStorage originals are not deleted by the import.
    expect(localStorage.getItem('storyark_editor_spacing')).toContain('64');
});

it('adopts an existing SQLite row and never imports over it', async () => {
    localStorage.setItem('storyark_dark_mode', 'true');
    localStorage.setItem('storyark_editor_spacing', JSON.stringify({ editorMarginPx: 64, editorLineHeight: 1.7 }));
    native.invoke.mockImplementation(async (command: string) => {
        if (command === 'local_read_preferences') return reply(preferencesRow());
        throw new Error(command);
    });
    setup();
    await waitFor(() => expect(screen.getByTestId('margin').textContent).toBe('36'));
    expect(screen.getByTestId('dark').textContent).toBe('false');
    expect(native.invoke.mock.calls.filter(call => call[0] === 'local_save_preferences')).toHaveLength(0);
});

it('keeps corrupted entries readable, notifies once, and lets a new value replace them', async () => {
    localStorage.setItem('storyark_editor_spacing', '{broken json');
    native.invoke.mockImplementation(async (command: string, args: unknown) => {
        if (command === 'local_read_preferences') return reply(null);
        if (command === 'local_save_preferences') {
            const input = (args as { input: Record<string, unknown> }).input;
            return reply({ preferences: preferencesRow({ databaseVersion: 1 }), sessionKey: input.sessionKey, revision: input.revision });
        }
        throw new Error(command);
    });
    setup();
    await waitFor(() => expect(screen.getByTestId('margin').textContent).toBe(String(EDITOR_SPACING_LIMITS.marginPx.default)));
    const importInput = (native.invoke.mock.calls.find(call => call[0] === 'local_save_preferences')![1] as { input: Record<string, unknown> }).input;
    expect(importInput.editorMarginPx).toBeNull();
    // The corrupted raw value survives (cache writes skip the preserved key).
    await waitFor(() => expect(localStorage.getItem('storyark_editor_spacing')).toBe('{broken json'));
    // Setting a new value through the UI clears the preservation and saves it.
    await act(async () => { screen.getByText('margin-60').click(); });
    await waitFor(() => expect(localStorage.getItem('storyark_editor_spacing')).toContain('60'));
    const saves = native.invoke.mock.calls.filter(call => call[0] === 'local_save_preferences');
    expect(saves.at(-1)![1]).toMatchObject({ input: { expectedDatabaseVersion: 1, editorMarginPx: 60 } });
});

it('never writes defaults while loading, then flushes the pending change', async () => {
    let releaseRead!: (value: unknown) => void;
    native.invoke.mockImplementation(async (command: string, args: unknown) => {
        if (command === 'local_read_preferences') return new Promise(resolve => { releaseRead = resolve; });
        if (command === 'local_save_preferences') {
            const input = (args as { input: Record<string, unknown> }).input;
            return reply({ preferences: preferencesRow({ databaseVersion: (input.expectedDatabaseVersion as number) + 1 }), sessionKey: input.sessionKey, revision: input.revision });
        }
        throw new Error(command);
    });
    setup();
    act(() => { screen.getByText('toggle').click(); });
    await act(async () => { await Promise.resolve(); });
    expect(native.invoke.mock.calls.filter(call => call[0] === 'local_save_preferences')).toHaveLength(0);
    await act(async () => { releaseRead(reply(preferencesRow())); });
    await waitFor(() => expect(native.invoke.mock.calls.filter(call => call[0] === 'local_save_preferences')).toHaveLength(1));
    expect(native.invoke.mock.calls.find(call => call[0] === 'local_save_preferences')![1]).toMatchObject({ input: { darkMode: true } });
});

it('serializes rapid updates and reports save failures honestly', async () => {
    const versions: number[] = [];
    let failNext = false;
    native.invoke.mockImplementation(async (command: string, args: unknown) => {
        if (command === 'local_read_preferences') return reply(preferencesRow());
        if (command === 'local_save_preferences') {
            const input = (args as { input: Record<string, unknown> }).input;
            if (failNext) { failNext = false; return { ok: false, error: { code: 'STORAGE_FAILURE', message: 'disk busy' } }; }
            versions.push(input.expectedDatabaseVersion as number);
            return reply({ preferences: preferencesRow({ databaseVersion: (input.expectedDatabaseVersion as number) + 1 }), sessionKey: input.sessionKey, revision: input.revision });
        }
        throw new Error(command);
    });
    setup();
    await waitFor(() => expect(screen.getByTestId('margin').textContent).toBe('36'));
    failNext = true;
    await act(async () => { screen.getByText('toggle').click(); });
    await waitFor(() => expect(toast.error).toHaveBeenCalled());
    // The visible choice is kept (not silently reverted) after a failed save.
    expect(screen.getByTestId('dark').textContent).toBe('true');
    await act(async () => { screen.getByText('toggle').click(); });
    await act(async () => { screen.getByText('margin-60').click(); });
    await waitFor(() => expect(versions.length).toBeGreaterThanOrEqual(2));
    expect(new Set(versions).size).toBe(versions.length);
});

it('stays on localStorage alone outside the desktop runtime', async () => {
    native.isTauri.mockReturnValue(false);
    localStorage.setItem('storyark_dark_mode', 'true');
    setup();
    await act(async () => { screen.getByText('toggle').click(); });
    expect(screen.getByTestId('dark').textContent).toBe('false');
    expect(localStorage.getItem('storyark_dark_mode')).toBe('false');
    expect(native.invoke).not.toHaveBeenCalled();
});
