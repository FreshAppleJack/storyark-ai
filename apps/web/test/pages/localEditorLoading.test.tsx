import React, { forwardRef, useImperativeHandle } from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import { afterEach, expect, it, vi } from 'vitest';
import { AppProvider } from '../../InteractionContent/AppContext';
import Editor from '../../pages/EditorPrototype';
import { localKeys, type LocalBookDetail } from '../../data/local/repository';
import { chapterBodyCache } from '../../data/local/chapterBodyCache';
import type { TiptapEditorProps, TiptapEditorRef } from '../../components/TiptapEditor';

const native = vi.hoisted(() => ({ invoke: vi.fn(), isTauri: () => false }));
vi.mock('@tauri-apps/api/core', () => ({ ...native, isTauri: () => true }));
vi.mock('@tauri-apps/api/window', () => ({ getCurrentWindow: () => ({ onCloseRequested: async () => () => undefined }) }));
vi.mock('../../components/TiptapEditor', () => ({ default: forwardRef<TiptapEditorRef, TiptapEditorProps>((props, ref) => {
    useImperativeHandle(ref, () => ({ forceRefreshHighlights: () => undefined } as unknown as TiptapEditorRef));
    return <textarea aria-label="Draft body" value={props.content} disabled={!props.isEditable}
        onChange={event => props.onUpdate?.(event.target.value, 1)} />;
}) }));

afterEach(() => { vi.clearAllMocks(); localStorage.clear(); });

it('opens a 10,000-chapter directory with one body request and keeps dirty text on a failed switch/save', async () => {
    const book = { id: 'book', title: 'Large book', author: 'Writer', status: 'serializing' as const, coverColor: 'bg-blue-600',
        position: 0, isReadOnly: false, databaseVersion: 1, createdAt: 1, updatedAt: 1 };
    const volume = { ...book, id: 'volume', bookId: book.id, title: 'Volume', status: 'draft' as const };
    const chapters = Array.from({ length: 10000 }, (_, index) => ({ ...volume, id: `chapter-${index}`, volumeId: volume.id,
        title: `Chapter ${index}`, wordCount: 1, foreshadowings: [],
        body: { format: 'tiptap-json' as const, version: 1 as const, content: '', originalContent: null, originalFormat: null } }));
    const directory: LocalBookDetail = { book, volumes: [volume], chapters, bodyMode: 'directory' };
    let rejectSave = true;
    native.invoke.mockImplementation(async (command: string, args?: Record<string, unknown>) => {
        if (command === 'local_list_books') return { ok: true, value: [book] };
        if (command === 'local_read_book_directory') return { ok: true, value: directory };
        if (command === 'local_list_characters') return { ok: true, value: [] };
        if (command === 'local_read_chapter') {
            const chapter = chapters.find(item => item.id === args?.chapterId)!;
            return { ok: true, value: { ...chapter, body: { ...chapter.body, content: `Saved body ${chapter.id}` } } };
        }
        if (command === 'local_read_planning') return { ok: true, value: { bookId: book.id, databaseVersion: 1,
            storySummary: '', storyBackground: '', chapterSummaries: [], plotSettings: [], updatedAt: 1 } };
        if (command === 'local_save_chapter') {
            if (rejectSave) return { ok: false, error: { code: 'STORAGE_FAILURE', message: 'Test write failure' } };
            const input = args!.input as Record<string, unknown>;
            const chapter = chapters.find(item => item.id === input.chapterId)!;
            return { ok: true, value: { sessionKey: input.sessionKey, revision: input.revision,
                chapter: { ...chapter, title: input.title, databaseVersion: 2, body: { ...chapter.body, content: input.content } } } };
        }
        return { ok: true, value: {} };
    });
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const router = createMemoryRouter([{ path: '/editor/:bookId', element: <Editor /> }], { initialEntries: ['/editor/book'] });
    render(<QueryClientProvider client={client}><AppProvider mode="local"><RouterProvider router={router} /></AppProvider></QueryClientProvider>);
    await screen.findByDisplayValue('Saved body chapter-0');
    expect(native.invoke.mock.calls.filter(call => call[0] === 'local_read_chapter')).toHaveLength(1);
    expect(native.invoke.mock.calls.some(call => call[0] === 'local_read_book')).toBe(false);
    expect(client.getQueryData<LocalBookDetail>(localKeys.book(book.id))?.chapters.every(chapter => chapter.body.content === '')).toBe(true);
    fireEvent.change(screen.getByLabelText('Draft body'), { target: { value: 'My unsaved text' } });
    act(() => { for (let index = 0; index < 12; index++) chapterBodyCache(client).put({ ...chapters[index], body: { ...chapters[index].body, content: 'cached' } }); });
    fireEvent.click(screen.getByText('Chapter 1', { selector: 'span' }));
    await waitFor(() => expect(native.invoke.mock.calls.some(call => call[0] === 'local_save_chapter')).toBe(true));
    expect(screen.getByLabelText('Draft body')).toHaveValue('My unsaved text');
    expect(native.invoke.mock.calls.filter(call => call[0] === 'local_read_chapter')).toHaveLength(1);
    rejectSave = false;
    fireEvent.click(screen.getByText('Chapter 1', { selector: 'span' }));
    await screen.findByDisplayValue('Saved body chapter-1');
    expect(client.getQueryData<LocalBookDetail>(localKeys.book(book.id))?.chapters[0].body.content).toBe('');
    expect(chapterBodyCache(client).get(book.id, 'chapter-0', 2)?.body.content).toBe('My unsaved text');
});
