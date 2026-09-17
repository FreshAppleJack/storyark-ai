import { afterEach, describe, expect, it } from 'vitest';
import { flushWorkDrafts, registerWorkDraftFlush, type WorkDraftKind } from '../../services/workDraftFlushRegistry';

const cleanups: Array<() => void> = [];

afterEach(() => {
    cleanups.splice(0).forEach(cleanup => cleanup());
});

describe('work draft flush registry', () => {
    it('flushes mounted work surfaces in a stable order', async () => {
        const seen: WorkDraftKind[] = [];
        const kinds: WorkDraftKind[] = ['brainstorm', 'graph', 'planning', 'characters', 'chapter'];
        kinds.forEach(kind => {
            cleanups.push(registerWorkDraftFlush('book-1', kind, async () => {
                seen.push(kind);
                return true;
            }));
        });

        await expect(flushWorkDrafts('book-1')).resolves.toBe(true);
        expect(seen).toEqual(['chapter', 'characters', 'planning', 'graph', 'brainstorm']);
    });

    it('stops at the first failed save and keeps later drafts untouched', async () => {
        const seen: WorkDraftKind[] = [];
        cleanups.push(registerWorkDraftFlush('book-2', 'chapter', async () => {
            seen.push('chapter');
            return false;
        }));
        cleanups.push(registerWorkDraftFlush('book-2', 'characters', async () => {
            seen.push('characters');
            return true;
        }));

        await expect(flushWorkDrafts('book-2')).resolves.toBe(false);
        expect(seen).toEqual(['chapter']);
    });

    it('uses an exporter fallback only when the surface is not registered', async () => {
        const seen: string[] = [];
        cleanups.push(registerWorkDraftFlush('book-3', 'chapter', async () => {
            seen.push('registered');
            return true;
        }));

        await flushWorkDrafts('book-3', [
            { kind: 'chapter', flush: async () => { seen.push('duplicate'); return true; } },
            { kind: 'planning', flush: async () => { seen.push('fallback'); return true; } },
        ]);
        expect(seen).toEqual(['registered', 'fallback']);
    });
});
