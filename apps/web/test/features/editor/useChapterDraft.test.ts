import { act, renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { useChapterDraft } from '../../../features/editor/hooks/useChapterDraft';
import { Chapter, ForeshadowingNote } from '../../../types';

function makeChapter(overrides: Partial<Chapter> = {}): Chapter {
    return {
        id: 'c1',
        title: 'Chapter One',
        content: 'stored body',
        wordCount: 2,
        status: 'draft',
        isEditable: true,
        foreshadowings: [],
        ...overrides,
    };
}

const note: ForeshadowingNote = { id: 'f1', excerpt: 'seed', note: 'payoff', createdAt: 1, updatedAt: 1 };

function renderDraft(chapterId = 'c1', chapter: Chapter | undefined = makeChapter()) {
    return renderHook((props: { chapterId: string; chapter?: Chapter }) => useChapterDraft(props), {
        initialProps: { chapterId, chapter },
    });
}

describe('useChapterDraft', () => {
    it('loads the chapter data on mount', () => {
        const { result } = renderDraft('c1', makeChapter({ isEditable: false, foreshadowings: [note] }));

        expect(result.current.title).toBe('Chapter One');
        expect(result.current.content).toBe('stored body');
        expect(result.current.wordCount).toBe(2);
        expect(result.current.foreshadowings).toEqual([note]);
        expect(result.current.isReadOnly).toBe(true);
        expect(result.current.revision).toBe(0);
        expect(result.current.isDirty).toBe(false);
    });

    it('reloads and resets revision and dirty state on chapter switch', () => {
        const { result, rerender } = renderDraft();
        act(() => result.current.setTitle('edited'));

        rerender({ chapterId: 'c2', chapter: makeChapter({ id: 'c2', title: 'Second', content: 'other body' }) });

        expect(result.current.title).toBe('Second');
        expect(result.current.content).toBe('other body');
        expect(result.current.revision).toBe(0);
        expect(result.current.isDirty).toBe(false);
    });

    it('syncs same-chapter updates into a clean draft', () => {
        const { result, rerender } = renderDraft();

        rerender({ chapterId: 'c1', chapter: makeChapter({ title: 'updated title', foreshadowings: [note] }) });

        expect(result.current.title).toBe('updated title');
        expect(result.current.foreshadowings).toEqual([note]);
    });

    it('never overwrites a dirty draft with same-chapter updates', () => {
        const { result, rerender } = renderDraft();
        act(() => result.current.setTitle('user title'));

        rerender({ chapterId: 'c1', chapter: makeChapter({ title: 'server title', content: 'server content' }) });

        expect(result.current.title).toBe('user title');
        expect(result.current.content).toBe('stored body');
        expect(result.current.isDirty).toBe(true);
    });

    it('bumps revision and marks dirty on title edits', () => {
        const { result } = renderDraft();
        act(() => result.current.setTitle('new title'));

        expect(result.current.title).toBe('new title');
        expect(result.current.revision).toBe(1);
        expect(result.current.isDirty).toBe(true);
    });

    it('only updates the word count when the content is unchanged', () => {
        const { result } = renderDraft();
        act(() => result.current.applyEditorUpdate('stored body', 99));

        expect(result.current.wordCount).toBe(99);
        expect(result.current.revision).toBe(0);
        expect(result.current.isDirty).toBe(false);

        act(() => result.current.applyEditorUpdate('new body', 100));
        expect(result.current.content).toBe('new body');
        expect(result.current.revision).toBe(1);
        expect(result.current.isDirty).toBe(true);
    });

    it('supports foreshadowing add, edit and remove actions', () => {
        const { result } = renderDraft();

        act(() => result.current.addForeshadowing(note));
        expect(result.current.foreshadowings[0]).toEqual(note);
        expect(result.current.revision).toBe(1);

        act(() => result.current.updateForeshadowingNote('f1', 'new note', 42));
        expect(result.current.foreshadowings[0]).toEqual({ ...note, note: 'new note', updatedAt: 42 });

        const second: ForeshadowingNote = { ...note, id: 'f2' };
        act(() => result.current.addForeshadowing(second));
        expect(result.current.foreshadowings.map(item => item.id)).toEqual(['f2', 'f1']);

        act(() => result.current.removeForeshadowing('f1'));
        expect(result.current.foreshadowings.map(item => item.id)).toEqual(['f2']);
    });

    it('captures an immutable snapshot of the current draft', () => {
        const { result } = renderDraft();
        act(() => result.current.setTitle('snap title'));

        expect(result.current.getSnapshot()).toEqual({
            chapterId: 'c1',
            revision: 1,
            title: 'snap title',
            content: 'stored body',
            wordCount: 2,
            foreshadowings: [],
        });
    });

    it('clears dirty only when the saved revision is still the latest', () => {
        const { result } = renderDraft();
        act(() => result.current.setTitle('a'));
        act(() => result.current.setTitle('b'));

        act(() => result.current.markSaved(1));
        expect(result.current.isDirty).toBe(true);

        act(() => result.current.markSaved(2));
        expect(result.current.isDirty).toBe(false);
    });

    it('toggles read-only without touching revision or dirty state', () => {
        const { result } = renderDraft();
        act(() => result.current.setReadOnly(true));

        expect(result.current.isReadOnly).toBe(true);
        expect(result.current.revision).toBe(0);
        expect(result.current.isDirty).toBe(false);
    });
});
