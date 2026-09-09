import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Book } from '../../types';
import Foreshadowing from '../../pages/Foreshadowing';

const fixture = vi.hoisted(() => ({
    save: vi.fn<(...args: unknown[]) => Promise<boolean>>(),
    toastError: vi.fn(),
    book: {
        id: 'b1', title: 'Book', author: 'Test', status: 'serializing', lastModified: 0, characters: [],
        volumes: [{ id: 'v1', title: 'Volume 1', chapters: [
            {
                id: 'c1', title: 'Chapter One', content: '', wordCount: 0, status: 'draft', isEditable: true,
                foreshadowings: [{ id: 'f1', excerpt: 'planted text', note: 'payoff', createdAt: 1, updatedAt: 2 }],
            },
        ] }],
    } as Book,
}));

vi.mock('../../InteractionContent/AppContext', () => ({
    useApp: () => ({
        getBook: () => fixture.book,
        updateChapterContent: fixture.save,
    }),
}));
vi.mock('react-hot-toast', () => ({ toast: { error: fixture.toastError } }));

function renderPage() {
    render(
        <MemoryRouter initialEntries={['/books/b1/foreshadowing']}>
            <Routes><Route path="/books/:bookId/foreshadowing" element={<Foreshadowing />} /></Routes>
        </MemoryRouter>,
    );
}

beforeEach(() => {
    fixture.save.mockReset();
    fixture.toastError.mockReset();
});

describe('Foreshadowing board recovery saving', () => {
    it('marks a note as recovered when the save succeeds', async () => {
        fixture.save.mockResolvedValue(true);
        renderPage();

        fireEvent.click(screen.getByText('Mark Recovered'));

        await waitFor(() => expect(fixture.save).toHaveBeenCalledTimes(1));
        expect(fixture.save).toHaveBeenCalledWith('b1', 'v1', 'c1', 'Chapter One', '', 0,
            [expect.objectContaining({ id: 'f1', isRecovered: true })]);
        expect(fixture.toastError).not.toHaveBeenCalled();
        expect(screen.queryByText('Save failed.')).not.toBeInTheDocument();
    });

    it('shows an explicit retry action when the save fails', async () => {
        fixture.save.mockResolvedValue(false);
        renderPage();

        fireEvent.click(screen.getByText('Mark Recovered'));

        await screen.findByText('Save failed.');
        expect(fixture.toastError).toHaveBeenCalledTimes(1);

        fixture.save.mockResolvedValue(true);
        fireEvent.click(screen.getByText('Retry'));

        await waitFor(() => expect(fixture.save).toHaveBeenCalledTimes(2));
        expect(fixture.save).toHaveBeenLastCalledWith('b1', 'v1', 'c1', 'Chapter One', '', 0,
            [expect.objectContaining({ id: 'f1', isRecovered: true })]);
        await waitFor(() => expect(screen.queryByText('Save failed.')).not.toBeInTheDocument());
    });
});
