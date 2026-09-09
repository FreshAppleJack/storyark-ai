import { act, fireEvent, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { fixture, openPage, renderPage, renameChapter, setupEditorPageHarness } from './editorPageHarness';

setupEditorPageHarness();

/**
 * Step 8.5 acceptance: the seven save-lifecycle scenarios from the contract.
 */
describe('Chapter save acceptance', () => {
    // 1. Switching before the debounce fires must flush the dirty draft first.
    it('saves the current draft before switching chapters', async () => {
        await openPage();
        fireEvent.click(document.getElementById('sidebar-chapter-c2')!);
        await act(async () => {});

        expect(fixture.save).toHaveBeenCalledTimes(1);
        expect(fixture.save).toHaveBeenCalledWith('b1', 'v1', 'c1', 'First chapter', 'unsaved body', 7,
            [expect.objectContaining({ id: 'f1' })]);
        expect(screen.getByPlaceholderText('Chapter Title')).toHaveValue('Second chapter');
    });

    it('switches without saving when the draft is clean', async () => {
        await renderPage();
        fireEvent.click(document.getElementById('sidebar-chapter-c2')!);
        await act(async () => {});

        expect(fixture.save).not.toHaveBeenCalled();
        expect(screen.getByPlaceholderText('Chapter Title')).toHaveValue('Second chapter');
    });

    // 2. Editing while a save is in flight must produce a serial follow-up round.
    it('saves the latest draft in a serial round when editing during a save', async () => {
        const resolvers: Array<() => void> = [];
        fixture.save.mockImplementation(() => new Promise<boolean>(resolve => {
            resolvers.push(() => resolve(true));
        }));
        await openPage();
        await act(async () => vi.advanceTimersByTimeAsync(1000));
        expect(fixture.save).toHaveBeenCalledTimes(1);

        // Edit again while the first request is in flight.
        fireEvent.click(screen.getByRole('button', { name: 'Edit draft v2' }));
        await act(async () => { resolvers[0](); });

        expect(screen.getByText('Unsaved Changes')).toBeInTheDocument();
        await act(async () => vi.advanceTimersByTimeAsync(1000));
        expect(fixture.save).toHaveBeenCalledTimes(2);
        expect(fixture.save).toHaveBeenLastCalledWith('b1', 'v1', 'c1', 'First chapter', 'unsaved body v2', 9,
            [expect.objectContaining({ id: 'f1' })]);

        await act(async () => { resolvers[1](); });
        expect(screen.getByText('Saved')).toBeInTheDocument();
    });

    // 3. Renaming while the autosave is in flight: every request carries a
    //    consistent title/content pair — never a mix of old and new.
    it('keeps title and content consistent when renaming overlaps an autosave', async () => {
        const resolvers: Array<() => void> = [];
        fixture.save.mockImplementation(() => new Promise<boolean>(resolve => {
            resolvers.push(() => resolve(true));
        }));
        await openPage();
        await act(async () => vi.advanceTimersByTimeAsync(1000));
        expect(fixture.save).toHaveBeenCalledWith('b1', 'v1', 'c1', 'First chapter', 'unsaved body', 7,
            [expect.objectContaining({ id: 'f1' })]);

        await renameChapter('c1', 'Renamed first');
        await act(async () => { resolvers[0](); });
        await act(async () => vi.advanceTimersByTimeAsync(1000));

        expect(fixture.save).toHaveBeenCalledTimes(2);
        expect(fixture.save).toHaveBeenLastCalledWith('b1', 'v1', 'c1', 'Renamed first', 'unsaved body', 7,
            [expect.objectContaining({ id: 'f1' })]);

        await act(async () => { resolvers[1](); });
        expect(screen.getByText('Saved')).toBeInTheDocument();
    });

    // 4. Flush failure: stay on the chapter, show the error, allow retry.
    it('stays on the current chapter when the pre-switch save fails', async () => {
        fixture.save.mockResolvedValue(false);
        await openPage();
        fireEvent.click(document.getElementById('sidebar-chapter-c2')!);
        await act(async () => {});

        expect(screen.getByPlaceholderText('Chapter Title')).toHaveValue('First chapter');
        expect(screen.getByText('Save failed')).toBeInTheDocument();

        fixture.save.mockResolvedValue(true);
        fireEvent.click(screen.getByText('Retry'));
        await act(async () => vi.advanceTimersByTimeAsync(1000));
        expect(screen.queryByText('Save failed')).not.toBeInTheDocument();

        fireEvent.click(document.getElementById('sidebar-chapter-c2')!);
        await act(async () => {});
        expect(screen.getByPlaceholderText('Chapter Title')).toHaveValue('Second chapter');
    });

    // 5. Rapid repeated switch attempts share the same in-flight round and
    //    never produce redundant saves.
    it('handles rapid repeated switch attempts without extra saves', async () => {
        const resolvers: Array<() => void> = [];
        fixture.save.mockImplementation(() => new Promise<boolean>(resolve => {
            resolvers.push(() => resolve(true));
        }));
        await openPage();

        fireEvent.click(document.getElementById('sidebar-chapter-c2')!);
        fireEvent.click(document.getElementById('sidebar-chapter-c2')!);
        await act(async () => {});
        expect(fixture.save).toHaveBeenCalledTimes(1);

        // Both flush attempts share the same round; without a new edit no
        // follow-up round is needed.
        await act(async () => { resolvers[0](); });
        expect(fixture.save).toHaveBeenCalledTimes(1);

        expect(screen.getByPlaceholderText('Chapter Title')).toHaveValue('Second chapter');
        expect(screen.getByText('Saved')).toBeInTheDocument();
    });

    // 6. A stale result completing after the switch must not corrupt the
    //    new chapter.
    it('completes the in-flight save before switching chapters', async () => {
        const resolvers: Array<() => void> = [];
        fixture.save.mockImplementation(() => new Promise<boolean>(resolve => {
            resolvers.push(() => resolve(true));
        }));
        await openPage();
        await act(async () => vi.advanceTimersByTimeAsync(1000));
        expect(fixture.save).toHaveBeenCalledTimes(1);

        // The switch waits for the in-flight save to complete.
        fireEvent.click(document.getElementById('sidebar-chapter-c2')!);
        await act(async () => {});
        expect(screen.getByPlaceholderText('Chapter Title')).toHaveValue('First chapter');

        await act(async () => { resolvers[0](); });
        expect(fixture.save).toHaveBeenCalledTimes(1);

        // The earlier request resolving must not corrupt the new chapter.
        expect(screen.getByPlaceholderText('Chapter Title')).toHaveValue('Second chapter');
    });

    // 7. Unmount: a pending debounce dies silently; an in-flight save still
    //    finishes (the PUT was already issued and AppContext outlives the page).
    it('drops the pending debounce on unmount without saving or errors', async () => {
        const view = await openPage();
        view.unmount();

        await act(async () => vi.advanceTimersByTimeAsync(2000));
        expect(fixture.save).not.toHaveBeenCalled();
    });

    it('lets the in-flight save finish after unmount', async () => {
        const resolvers: Array<() => void> = [];
        fixture.save.mockImplementation(() => new Promise<boolean>(resolve => {
            resolvers.push(() => resolve(true));
        }));
        const view = await openPage();
        await act(async () => vi.advanceTimersByTimeAsync(1000));
        expect(fixture.save).toHaveBeenCalledTimes(1);

        view.unmount();
        await act(async () => { resolvers[0](); });

        expect(fixture.save).toHaveBeenCalledTimes(1);
    });
});
