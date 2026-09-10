import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { expect, it, vi } from 'vitest';
import StoryOutline from '../../pages/StoryOutline';

const mocks = vi.hoisted(() => ({ load: vi.fn(), save: vi.fn() }));
vi.mock('../../InteractionContent/BooksContext', () => ({ useBooks: () => ({
    getBook: () => ({ id: '1', title: 'Book', volumes: [], characters: [] }),
    fetchStoryPlanning: mocks.load, saveStoryPlanning: mocks.save,
}) }));

it('blocks editing after a failed planning load and allows retrying an empty workspace', async () => {
    mocks.load.mockResolvedValueOnce(null).mockResolvedValueOnce({ storySummary: '', storyBackground: '', chapterSummaries: [], plotSettings: [] });
    render(<MemoryRouter initialEntries={['/books/1/outline']}><Routes>
        <Route path="/books/:bookId/outline" element={<StoryOutline />} />
    </Routes></MemoryRouter>);
    expect(await screen.findByRole('alert')).toHaveTextContent('Could not load this workspace');
    expect(screen.getByRole('button', { name: 'Save Planning' })).toBeDisabled();
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Save Planning' })).toBeEnabled());
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(mocks.save).not.toHaveBeenCalled();
});
