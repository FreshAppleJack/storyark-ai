import { act, fireEvent, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { fixture, openPage, renameChapter, setupEditorPageHarness } from './editorPageHarness';

setupEditorPageHarness();

describe('Chapter rename and draft ownership', () => {
    it('persists the renamed title with the current draft through one unified save', async () => {
        await openPage();
        await renameChapter('c1', 'Renamed first');

        // Renaming the active chapter only updates the draft — no direct PUT,
        // so the rename cannot double-write with the autosave.
        expect(fixture.save).not.toHaveBeenCalled();

        await act(async () => vi.advanceTimersByTimeAsync(1000));
        expect(fixture.save).toHaveBeenCalledTimes(1);
        expect(fixture.save).toHaveBeenCalledWith('b1', 'v1', 'c1', 'Renamed first', 'unsaved body', 7,
            [expect.objectContaining({ id: 'f1', note: 'unsaved note' })]);
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

    it('surfaces a save error when renaming the active chapter fails and keeps the pending title', async () => {
        fixture.save.mockResolvedValue(false);
        await openPage();
        await renameChapter('c1', 'Renamed first');
        await act(async () => vi.advanceTimersByTimeAsync(1000));

        expect(screen.getByText('Save failed')).toBeInTheDocument();
        expect(screen.getByPlaceholderText('Chapter Title')).toHaveValue('Renamed first');
    });

    it('warns when renaming a different chapter fails to save', async () => {
        fixture.save.mockResolvedValue(false);
        await openPage();
        await renameChapter('c2', 'Renamed second');

        expect(fixture.toastError).toHaveBeenCalled();
    });
});
