import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, expect, it, vi } from 'vitest';
import StoryOutline from '../../pages/StoryOutline';

const mocks = vi.hoisted(() => ({ load: vi.fn(), save: vi.fn() }));
vi.mock('../../InteractionContent/BooksContext', () => ({ useBooks: () => ({
    getBook: () => ({ id: '1', title: 'Book', volumes: [], characters: [] }),
    fetchStoryPlanning: mocks.load, saveStoryPlanning: mocks.save,
}) }));

afterEach(() => { vi.useRealTimers(); vi.clearAllMocks(); });

it('keeps a quick page load quiet and shows a notice for a slower workspace read', async () => {
    vi.useFakeTimers();
    let resolve: (value: unknown) => void = () => undefined;
    mocks.load.mockImplementationOnce(() => new Promise(done => { resolve = done; }));
    const page = <MemoryRouter initialEntries={['/books/1/outline']}><Routes>
        <Route path="/books/:bookId/outline" element={<StoryOutline />} />
    </Routes></MemoryRouter>;
    const quick = render(page);
    expect(screen.queryByText('Loading planning workspace...')).not.toBeInTheDocument();
    await act(async () => {
        await vi.advanceTimersByTimeAsync(100);
        resolve({ storySummary: '', storyBackground: '', chapterSummaries: [], plotSettings: [] });
    });
    await act(async () => { await vi.advanceTimersByTimeAsync(200); });
    expect(screen.queryByText('Loading planning workspace...')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save Planning' })).toBeEnabled();
    quick.unmount();

    mocks.load.mockImplementationOnce(() => new Promise(done => { resolve = done; }));
    render(page);
    await act(async () => { await vi.advanceTimersByTimeAsync(199); });
    expect(screen.queryByText('Loading planning workspace...')).not.toBeInTheDocument();
    await act(async () => { await vi.advanceTimersByTimeAsync(1); });
    expect(screen.getByRole('status')).toHaveTextContent('Loading planning workspace...');
    await act(async () => { resolve({ storySummary: '', storyBackground: '', chapterSummaries: [], plotSettings: [] }); });
    expect(screen.queryByText('Loading planning workspace...')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save Planning' })).toBeEnabled();
});

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
