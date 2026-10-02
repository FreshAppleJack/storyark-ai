import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { BrainstormShortcut } from '../../../features/brainstorm/components/BrainstormShortcut';
import { createEmptyBrainstorm } from '../../../data/brainstormMapping';

const read = vi.hoisted(() => vi.fn());
vi.mock('../../../data/local/brainstormRepository', () => ({
    localBrainstormOptions: (bookId: string) => ({ queryKey: ['local', 'brainstorm', bookId], queryFn: () => read(bookId), retry: false, staleTime: 0 }),
}));

function setup(bookId = 'book-1') {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const onOpen = vi.fn();
    const view = render(<QueryClientProvider client={client}><BrainstormShortcut bookId={bookId} localMode onOpen={onOpen} /></QueryClientProvider>);
    return { ...view, client, onOpen };
}

describe('BrainstormShortcut', () => {
    beforeAll(() => vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} }));
    afterAll(() => vi.unstubAllGlobals());
    beforeEach(() => { read.mockReset(); read.mockResolvedValue(createEmptyBrainstorm()); });

    it('waits for a sustained hover and cancels opening when the pointer leaves or the button is clicked', async () => {
        vi.useFakeTimers();
        try {
            const { onOpen, unmount } = setup();
            const button = screen.getByRole('button', { name: 'Open AI Brainstorm' });
            fireEvent.mouseEnter(button);
            await act(async () => { await vi.advanceTimersByTimeAsync(399); });
            expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
            expect(read).not.toHaveBeenCalled();
            fireEvent.mouseLeave(button);
            await act(async () => { await vi.advanceTimersByTimeAsync(500); });
            expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
            fireEvent.mouseEnter(button);
            fireEvent.click(button);
            expect(onOpen).toHaveBeenCalledOnce();
            await act(async () => { await vi.advanceTimersByTimeAsync(500); });
            expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
            expect(read).not.toHaveBeenCalled();
            fireEvent.mouseEnter(button);
            await act(async () => { await vi.advanceTimersByTimeAsync(400); });
            expect(screen.getByRole('dialog')).toBeInTheDocument();
            expect(read).toHaveBeenCalledOnce();
            unmount();
        } finally { vi.useRealTimers(); }
    });

    it('loads only on hover and keeps saved notes readable when moving into the floating panel', async () => {
        const content = 'First paragraph.\n第二段：继续探索。';
        read.mockResolvedValue({ ...createEmptyBrainstorm(), finalContent: content, generatedOptions: [{ title: 'An unchosen idea' }] });
        const user = userEvent.setup();
        setup();
        expect(read).not.toHaveBeenCalled();
        const button = screen.getByRole('button', { name: 'Open AI Brainstorm' });
        await user.hover(button);
        const text = await screen.findByText(content, { exact: true, normalizer: value => value });
        expect(text.textContent).toBe(content);
        expect(screen.queryByText('An unchosen idea')).not.toBeInTheDocument();
        await user.unhover(button);
        await user.hover(screen.getByRole('dialog'));
        await act(async () => { await new Promise(resolve => setTimeout(resolve, 300)); });
        expect(screen.getByRole('dialog')).toBeInTheDocument();
        await user.unhover(screen.getByRole('dialog'));
        await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    });

    it('shows an empty state, supports keyboard access and opens the workspace directly', async () => {
        const user = userEvent.setup();
        const { onOpen } = setup();
        const button = screen.getByRole('button', { name: 'Open AI Brainstorm' });
        fireEvent.focus(button);
        expect(await screen.findByText(/No brainstorm notes yet/)).toBeInTheDocument();
        fireEvent.keyDown(button, { key: 'ArrowDown' });
        expect(screen.getByRole('dialog')).toHaveFocus();
        await user.keyboard('{Escape}');
        expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
        expect(button).toHaveFocus();
        await user.click(button);
        expect(onOpen).toHaveBeenCalledOnce();
        expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });

    it('refreshes saved content on reopening and never shows another book’s notes', async () => {
        const user = userEvent.setup();
        const { rerender, client, onOpen } = setup();
        read.mockResolvedValue({ ...createEmptyBrainstorm(), finalContent: 'Original notes' });
        await user.hover(screen.getByRole('button', { name: 'Open AI Brainstorm' }));
        expect(await screen.findByText('Original notes')).toBeInTheDocument();
        await user.keyboard('{Escape}');
        read.mockResolvedValue({ ...createEmptyBrainstorm(), finalContent: 'Updated notes' });
        await user.unhover(screen.getByRole('button', { name: 'Open AI Brainstorm' }));
        await user.hover(screen.getByRole('button', { name: 'Open AI Brainstorm' }));
        expect(await screen.findByText('Updated notes')).toBeInTheDocument();
        read.mockResolvedValue(createEmptyBrainstorm());
        rerender(<QueryClientProvider client={client}><BrainstormShortcut bookId="book-2" localMode onOpen={onOpen} /></QueryClientProvider>);
        expect(await screen.findByText(/No brainstorm notes yet/)).toBeInTheDocument();
        expect(screen.queryByText('Updated notes')).not.toBeInTheDocument();
        expect(read).toHaveBeenLastCalledWith('book-2');
    });

    it('offers a retry without exposing a technical read error', async () => {
        read.mockRejectedValueOnce(new Error('SQLITE_BUSY: internal detail'));
        const user = userEvent.setup();
        setup();
        await user.hover(screen.getByRole('button', { name: 'Open AI Brainstorm' }));
        expect(await screen.findByRole('alert')).toHaveTextContent('Couldn’t load your brainstorm notes');
        expect(screen.queryByText(/SQLITE_BUSY/)).not.toBeInTheDocument();
        await user.click(screen.getByRole('button', { name: 'Retry' }));
        expect(await screen.findByText(/No brainstorm notes yet/)).toBeInTheDocument();
    });
});
