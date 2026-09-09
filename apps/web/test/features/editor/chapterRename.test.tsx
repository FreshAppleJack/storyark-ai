import React, { forwardRef, useImperativeHandle } from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ForeshadowingNote } from '../../../types';
import EditorPage from '../../../pages/EditorPrototype';

const fixture = vi.hoisted(() => ({
    save: vi.fn<(...args: unknown[]) => Promise<boolean>>(),
    toastError: vi.fn(),
    book: {
        id: 'b1', title: 'Book', author: 'Test', characters: [],
        volumes: [{ id: 'v1', title: 'Volume', chapters: [
            { id: 'c1', title: 'First chapter', content: 'stored first body', wordCount: 2, foreshadowings: [], isEditable: true },
            { id: 'c2', title: 'Second chapter', content: 'stored second body', wordCount: 3, foreshadowings: [], isEditable: true },
        ] }],
    },
}));

vi.mock('../../../InteractionContent/AppContext', () => ({
    useApp: () => ({
        getBook: () => fixture.book,
        updateChapterContent: fixture.save,
        editorSpacingSettings: { editorMarginPx: 20, editorLineHeight: 1.8 },
        aiContinueSettings: { contextChars: 100, outputChars: 100 },
        autoHighlightSettings: { disabledRoles: [] },
        fetchStoryPlanning: async () => ({ plotSettings: [] }),
    }),
}));
vi.mock('../../../services/api', () => ({ default: { post: vi.fn() } }));
vi.mock('react-hot-toast', () => ({ toast: { error: fixture.toastError } }));
vi.mock('html2pdf.js', () => ({ default: vi.fn() }));
vi.mock('html-docx-js-typescript', () => ({ asBlob: vi.fn() }));
vi.mock('file-saver', () => ({ saveAs: vi.fn() }));
// Test the page's draft/request boundary; editor transactions have separate tests.
vi.mock('../../../components/TiptapEditor', () => ({
    default: forwardRef(function TestEditor(props: {
        onUpdate: (text: string, count: number) => void;
        onForeshadowingCreate: (note: ForeshadowingNote) => void;
    }, ref) {
        useImperativeHandle(ref, () => ({ forceRefreshHighlights() {} }));
        return <button onClick={() => {
            props.onUpdate('unsaved body', 7);
            props.onForeshadowingCreate({ id: 'f1', excerpt: 'seed', note: 'unsaved note', createdAt: 1, updatedAt: 1 });
        }}>Edit draft</button>;
    }),
}));

beforeEach(() => {
    vi.useFakeTimers();
    fixture.save.mockReset().mockResolvedValue(true);
    fixture.toastError.mockClear();
    vi.stubGlobal('localStorage', { getItem: () => null, setItem: vi.fn(), removeItem: vi.fn() });
});

afterEach(() => {
    cleanup();
    vi.clearAllTimers();
    vi.useRealTimers();
    vi.unstubAllGlobals();
});

async function openPage() {
    await act(async () => {
        render(<MemoryRouter initialEntries={['/editor/b1']}>
            <Routes><Route path="/editor/:bookId" element={<EditorPage />} /></Routes>
        </MemoryRouter>);
    });
    fireEvent.click(screen.getByRole('button', { name: 'Edit draft' }));
}

async function renameChapter(id: string, title: string) {
    fireEvent.contextMenu(document.getElementById(`sidebar-chapter-${id}`)!);
    fireEvent.click(screen.getByText('Rename'));
    const input = document.querySelector(`#sidebar-chapter-${id} input`)!;
    fireEvent.change(input, { target: { value: title } });
    await act(async () => fireEvent.keyDown(input, { key: 'Enter' }));
}

describe('Chapter rename and draft ownership', () => {
    it('saves the current body, word count and notes when renaming the active chapter', async () => {
        await openPage();
        await renameChapter('c1', 'Renamed first');
        expect(fixture.save).toHaveBeenCalledTimes(1);
        expect(fixture.save).toHaveBeenCalledWith('b1', 'v1', 'c1', 'Renamed first', 'unsaved body', 7,
            [expect.objectContaining({ id: 'f1', note: 'unsaved note' })]);
        // Any pending autosave must also use the renamed title and current draft.
        await act(async () => vi.advanceTimersByTimeAsync(1000));
        expect(fixture.save.mock.calls.every(call => call[3] === 'Renamed first' && call[4] === 'unsaved body')).toBe(true);
    });

    it('uses stored data when renaming a different chapter', async () => {
        await openPage();
        await renameChapter('c2', 'Renamed second');
        expect(fixture.save).toHaveBeenCalledWith('b1', 'v1', 'c2', 'Renamed second', 'stored second body', 3, []);
        expect(screen.getByPlaceholderText('Chapter Title')).toHaveValue('First chapter');
    });

    it('shows an error state and retries when autosave fails', async () => {
        fixture.save.mockResolvedValue(false);
        await openPage();
        await act(async () => vi.advanceTimersByTimeAsync(1000));

        expect(fixture.save).toHaveBeenCalledTimes(1);
        expect(screen.getByText('Save failed')).toBeInTheDocument();
        expect(screen.getByPlaceholderText('Chapter Title')).toHaveValue('First chapter');

        fixture.save.mockResolvedValue(true);
        fireEvent.click(screen.getByText('Retry'));
        await act(async () => vi.advanceTimersByTimeAsync(1000));

        expect(fixture.save).toHaveBeenCalledTimes(2);
        expect(screen.getByText('Saved')).toBeInTheDocument();
    });

    it('warns when renaming fails to save and keeps the pending title', async () => {
        fixture.save.mockResolvedValue(false);
        await openPage();
        await renameChapter('c1', 'Renamed first');

        expect(fixture.toastError).toHaveBeenCalled();
        expect(screen.getByPlaceholderText('Chapter Title')).toHaveValue('Renamed first');
    });

    it('does not overwrite another chapter title when an earlier rename completes', async () => {
        let finish!: () => void;
        fixture.save.mockImplementation(() => new Promise<boolean>(resolve => { finish = () => resolve(true); }));
        await openPage();
        await renameChapter('c1', 'Renamed first');
        fireEvent.click(document.getElementById('sidebar-chapter-c2')!);
        expect(screen.getByPlaceholderText('Chapter Title')).toHaveValue('Second chapter');
        await act(async () => finish());
        expect(screen.getByPlaceholderText('Chapter Title')).toHaveValue('Second chapter');
    });
});
