import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { installErrorReporting, redactDiagnostic, reportError, userErrorMessage } from '../../data/diagnostics';
import { call, LocalStorageError } from '../../data/local/repository';

const native = vi.hoisted(() => ({ invoke: vi.fn(), isTauri: vi.fn(() => true) }));
vi.mock('@tauri-apps/api/core', () => native);

beforeEach(() => {
    vi.clearAllMocks();
    native.isTauri.mockReturnValue(true);
    native.invoke.mockResolvedValue(undefined);
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
});
afterEach(() => vi.restoreAllMocks());

describe('local error reporting', () => {
    it('records the original storage error and command, but never its request arguments', async () => {
        native.invoke.mockImplementation(async (command: string) => command === 'local_save_chapter'
            ? { ok: false, error: { code: 'VERSION_CONFLICT', message: 'Expected database version 12; current version 13' } } : undefined);
        const args = { input: { content: 'private manuscript', credential: 'private credential' } };
        await expect(call('local_save_chapter', args)).rejects.toMatchObject({
            code: 'VERSION_CONFLICT', userFacing: true, message: expect.stringContaining('Keep your draft'),
        });
        const report = native.invoke.mock.calls.find(([command]) => command === 'diagnostic_report_error')![1];
        expect(report).toMatchObject({ operation: 'local_save_chapter', code: 'VERSION_CONFLICT' });
        expect(report.message).toContain('version 12');
        expect(JSON.stringify(report)).not.toMatch(/private manuscript|private credential/);
    });

    it('keeps transport diagnostics while returning a useful retry message', async () => {
        native.invoke.mockImplementation(async (command: string) => {
            if (command === 'local_read_book') throw new Error('IPC bridge disconnected at dispatcher.rs:77');
        });
        await expect(call('local_read_book')).rejects.toMatchObject({ code: 'IPC_FAILURE' });
        const report = native.invoke.mock.calls.find(([command]) => command === 'diagnostic_report_error')![1];
        expect(report.message).toContain('dispatcher.rs:77');
    });

    it('redacts credentials and ignores arbitrary error payload objects', () => {
        const message = redactDiagnostic('TIMEOUT\nAuthorization: Bearer private-value\napiKey: private-value\nhttps://service/?token=private-value\ntrace: dispatcher.rs:77');
        expect(message).not.toContain('private-value');
        expect(message).toContain('dispatcher.rs:77');
        expect(redactDiagnostic('x'.repeat(9000))).toHaveLength(6000);
        reportError('test', { body: 'private manuscript', apiKey: 'private-value' });
        expect(JSON.stringify(native.invoke.mock.calls)).not.toMatch(/private manuscript|private-value/);
    });

    it('does not fail or recurse if the log cannot be written', async () => {
        native.invoke.mockRejectedValue(new Error('log directory unavailable'));
        expect(() => reportError('test', new Error('original failure'))).not.toThrow();
        await Promise.resolve();
        expect(native.invoke).toHaveBeenCalledTimes(1);
    });

    it('captures browser exceptions, promise rejections and caught console errors', () => {
        vi.spyOn(console, 'error').mockImplementation(() => undefined);
        const dispose = installErrorReporting();
        try {
            window.dispatchEvent(new ErrorEvent('error', { error: new Error('script failed') }));
            const rejection = new Event('unhandledrejection');
            Object.defineProperty(rejection, 'reason', { value: new Error('promise failed') });
            window.dispatchEvent(rejection);
            console.error('save failed', new Error('disk unavailable'), { content: 'private manuscript' });
            expect(native.invoke.mock.calls.map(([, entry]) => entry.operation)).toEqual(['window.error', 'unhandledrejection', 'console.error']);
            expect(JSON.stringify(native.invoke.mock.calls)).not.toContain('private manuscript');
        } finally { dispose(); }
    });

    it('preserves approved messages but hides unknown exceptions and treats cancellation as normal', () => {
        expect(userErrorMessage(new LocalStorageError('READ_ONLY', 'Unlock this chapter.'), 'Try again.', 'save')).toBe('Unlock this chapter.');
        expect(userErrorMessage(new Error('SQLite implementation detail'), 'Try again.', 'save')).toBe('Try again.');
        native.invoke.mockClear();
        reportError('generation', 'cancelled', 'CANCELLED');
        expect(native.invoke).not.toHaveBeenCalled();
    });
});
