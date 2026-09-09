import React, { forwardRef, useImperativeHandle } from 'react';
import { act, cleanup, fireEvent, render, RenderResult, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, vi } from 'vitest';
import type { ForeshadowingNote } from '../../../types';
import EditorPage from '../../../pages/EditorPrototype';

// Plain module-level fixture: mock factories below only touch it lazily
// (at render/call time), so no hoisting helper is needed or allowed here.
export const fixture = {
    save: vi.fn<(...args: unknown[]) => Promise<boolean>>(),
    toastError: vi.fn(),
    book: {
        id: 'b1', title: 'Book', author: 'Test', characters: [],
        volumes: [{ id: 'v1', title: 'Volume', chapters: [
            { id: 'c1', title: 'First chapter', content: 'stored first body', wordCount: 2, foreshadowings: [], isEditable: true },
            { id: 'c2', title: 'Second chapter', content: 'stored second body', wordCount: 3, foreshadowings: [], isEditable: true },
        ] }],
    },
};

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
vi.mock('react-hot-toast', () => ({ toast: { error: (...args: unknown[]) => fixture.toastError(...args) } }));
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
        return <>
            <button onClick={() => {
                props.onUpdate('unsaved body', 7);
                props.onForeshadowingCreate({ id: 'f1', excerpt: 'seed', note: 'unsaved note', createdAt: 1, updatedAt: 1 });
            }}>Edit draft</button>
            <button onClick={() => props.onUpdate('unsaved body v2', 9)}>Edit draft v2</button>
        </>;
    }),
}));

/** Registers the timer/localStorage lifecycle every consuming test file needs. */
export function setupEditorPageHarness() {
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
}

export async function renderPage(): Promise<RenderResult> {
    let view!: RenderResult;
    await act(async () => {
        view = render(<MemoryRouter initialEntries={['/editor/b1']}>
            <Routes><Route path="/editor/:bookId" element={<EditorPage />} /></Routes>
        </MemoryRouter>);
    });
    return view;
}

/** Renders the editor page and makes the draft dirty (content v1 + one note). */
export async function openPage(): Promise<RenderResult> {
    const view = await renderPage();
    fireEvent.click(screen.getByRole('button', { name: 'Edit draft' }));
    return view;
}

export async function renameChapter(id: string, title: string) {
    fireEvent.contextMenu(document.getElementById(`sidebar-chapter-${id}`)!);
    fireEvent.click(screen.getByText('Rename'));
    const input = document.querySelector(`#sidebar-chapter-${id} input`)!;
    fireEvent.change(input, { target: { value: title } });
    await act(async () => fireEvent.keyDown(input, { key: 'Enter' }));
}
