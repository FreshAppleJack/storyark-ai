import { act, renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useMemo, type ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ChapterBodyCache, chapterBodyCache } from '../../../data/local/chapterBodyCache';
import type { LocalChapter } from '../../../data/local/contracts';
import { directoryChapter, localRepository } from '../../../data/local/repository';
import { useLoadedChapter } from '../../../features/editor/hooks/useLoadedChapter';
import { useChapterDraft } from '../../../features/editor/hooks/useChapterDraft';
import type { Chapter } from '../../../types';

function stored(id: string, content = id, version = 1): LocalChapter {
    return { id, bookId: 'book', volumeId: 'volume', title: id, position: 0, status: 'draft',
        isReadOnly: false, databaseVersion: version, createdAt: 1, updatedAt: version, wordCount: 1, foreshadowings: [],
        body: { format: 'tiptap-json', version: 1, content, originalContent: null, originalFormat: null } };
}
function metadata(id: string, version = 1): Chapter {
    return { id, title: id, content: '', contentLoaded: false, databaseVersion: version,
        wordCount: 1, status: 'draft', isEditable: true, foreshadowings: [] };
}
afterEach(() => vi.restoreAllMocks());

describe('bounded saved chapter bodies', () => {
    it('evicts the least recently visited chapter and rejects stale versions', () => {
        const cache = new ChapterBodyCache(2);
        cache.put(stored('a')); cache.put(stored('b'));
        expect(cache.get('book', 'a', 1)).toBeDefined();
        cache.put(stored('c'));
        expect(cache.size).toBe(2);
        expect(cache.get('book', 'b', 1)).toBeUndefined();
        cache.put(stored('a', 'new saved body', 2));
        cache.put(stored('a', 'late old read', 1));
        expect(cache.get('book', 'a', 2)?.body.content).toBe('new saved body');
        expect(cache.get('book', 'a', 3)).toBeUndefined();
    });
    it('also limits body bytes and never retains a single oversized chapter', () => {
        const cache = new ChapterBodyCache(8, 12);
        cache.put(stored('a', 'aaa')); cache.put(stored('b', 'bbb')); cache.put(stored('c', 'ccc'));
        expect(cache.size).toBe(2);
        expect(cache.get('book', 'a', 1)).toBeUndefined();
        cache.put(stored('huge', 'x'.repeat(20)));
        expect(cache.get('book', 'huge', 1)).toBeUndefined();
    });
    it('strips authored content, original bodies and notes from directory mutation echoes', () => {
        const record = { ...stored('a'), body: { ...stored('a').body, originalContent: 'original' },
            foreshadowings: [{ id: 'note', excerpt: 'secret passage', note: 'plan', createdAt: 1, updatedAt: 1 }] };
        const entry = directoryChapter(record);
        expect(entry.body.content).toBe('');
        expect(entry.body.originalContent).toBeNull();
        expect(entry.foreshadowings).toEqual([]);
        expect(record.body.content).toBe('a');
    });
    it('reads only the selected chapter, reuses recent bodies, and protects an unsaved draft during eviction', async () => {
        const read = vi.spyOn(localRepository, 'readChapter').mockImplementation(async (_book, id) => stored(id));
        const client = new QueryClient();
        const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
        const { result, rerender, unmount } = renderHook(({ id }) => {
            const entry = useMemo(() => metadata(id), [id]);
            const loaded = useLoadedChapter('book', entry);
            const draft = useChapterDraft({ bookId: 'book', volumeId: 'volume', chapterId: id, chapter: loaded.chapter });
            return { loaded, draft };
        }, { wrapper, initialProps: { id: 'a' } });
        await waitFor(() => expect(result.current.loaded.chapter?.content).toBe('a'));
        act(() => result.current.draft.applyEditorUpdate('unsaved text', 2));
        for (let index = 0; index < 12; index++) chapterBodyCache(client).put(stored(`other-${index}`));
        rerender({ id: 'a' });
        expect(result.current.draft.content).toBe('unsaved text');
        expect(result.current.draft.isDirty).toBe(true);
        expect(read).toHaveBeenCalledTimes(1);
        // The existing navigation guard flushes before this switch. Body queries
        // release inactive data; the saved LRU remains separate from dirty drafts.
        rerender({ id: 'b' });
        await waitFor(() => expect(result.current.loaded.chapter?.content).toBe('b'));
        rerender({ id: 'c' });
        await waitFor(() => expect(result.current.loaded.chapter?.content).toBe('c'));
        rerender({ id: 'b' });
        await waitFor(() => expect(result.current.loaded.chapter?.content).toBe('b'));
        expect(read.mock.calls.map(call => call[1])).toEqual(['a', 'b', 'c']);
        expect(client.getQueryCache().getAll().filter(query => query.getObserversCount() > 0)).toHaveLength(1);
        unmount();
        await waitFor(() => expect(client.getQueryCache().getAll()).toHaveLength(0));
    });
});
