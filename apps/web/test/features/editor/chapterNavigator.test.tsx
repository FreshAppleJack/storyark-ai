import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { retrievalRepository } from '../../../data/local/retrievalRepository';
import { ChapterNavigator } from '../../../features/editor/components/ChapterNavigator';
import { Book } from '../../../types';

const book: Book = {
    id: 'b1',
    title: 'My Book',
    author: 'Test Author',
    status: 'serializing',
    lastModified: 0,
    characters: [],
    volumes: [
        {
            id: 'v1',
            title: 'Volume 1',
            chapters: [
                { id: 'c1', title: 'Chapter One', wordCount: 10, status: 'draft', content: '', isEditable: true, foreshadowings: [] },
                { id: 'c2', title: 'Chapter Two', wordCount: 20, status: 'draft', content: '', isEditable: true, foreshadowings: [] },
            ],
        },
        { id: 'v2', title: 'Volume 2', chapters: [] },
    ],
};

beforeAll(() => {
    // jsdom does not implement scrollIntoView.
    Element.prototype.scrollIntoView = vi.fn();
});

function createProps(overrides: Record<string, unknown> = {}) {
    return {
        book,
        activeChapterId: 'c1',
        onNavigateDashboard: vi.fn(),
        onSelectChapter: vi.fn(),
        onAddVolume: vi.fn().mockResolvedValue('new-vol'),
        onAddChapter: vi.fn().mockResolvedValue('new-chap'),
        onRenameVolume: vi.fn().mockResolvedValue(undefined),
        onRenameChapter: vi.fn().mockResolvedValue(undefined),
        onDeleteItem: vi.fn().mockResolvedValue(undefined),
        onReorderVolumes: vi.fn(),
        onReorderChapters: vi.fn(),
        onOpenPlotSetting: vi.fn(),
        onOpenChapterSummary: vi.fn(),
        ...overrides,
    };
}

describe('ChapterNavigator', () => {
    it('commits a rename once on blur and does not close a newer edit on completion', async () => {
        const user = userEvent.setup();
        let finish!: () => void;
        const onRenameChapter = vi.fn(() => new Promise<void>(resolve => { finish = resolve; }));
        render(<ChapterNavigator {...createProps({ onRenameChapter })} />);
        fireEvent.contextMenu(screen.getByText('Chapter One'));
        await user.click(screen.getByText('Rename'));
        fireEvent.change(screen.getByDisplayValue('Chapter One'), { target: { value: 'Renamed' } });
        await user.click(screen.getByText('Chapter Two'));
        expect(onRenameChapter).toHaveBeenCalledTimes(1);
        expect(onRenameChapter).toHaveBeenCalledWith('c1', 'Renamed');

        fireEvent.contextMenu(screen.getByText('Chapter Two'));
        await user.click(screen.getByText('Rename'));
        await act(async () => finish());
        expect(screen.getByDisplayValue('Chapter Two')).toBeInTheDocument();
    });

    it('cancels a rename with Escape without submitting on blur', async () => {
        const user = userEvent.setup();
        const props = createProps();
        render(<ChapterNavigator {...props} />);
        fireEvent.contextMenu(screen.getByText('Chapter One'));
        await user.click(screen.getByText('Rename'));
        const input = screen.getByDisplayValue('Chapter One');
        fireEvent.change(input, { target: { value: 'Cancelled' } });
        fireEvent.keyDown(input, { key: 'Escape' });
        await user.click(screen.getByText('Chapter Two'));
        expect(props.onRenameChapter).not.toHaveBeenCalled();
    });

    it('preserves collapsed volumes across content updates and reordering', async () => {
        const user = userEvent.setup();
        const props = createProps();
        const { rerender } = render(<ChapterNavigator {...props} />);
        await user.click(screen.getByText('Volume 1'));
        const updatedBook = { ...book, volumes: book.volumes.map(v => ({ ...v, chapters: v.chapters.map(c => ({ ...c, content: 'updated body' })) })).reverse() };
        rerender(<ChapterNavigator {...props} book={updatedBook} />);
        expect(screen.queryByText('Chapter One')).not.toBeInTheDocument();
    });

    it('expands new volumes and removes deleted volume preferences', async () => {
        const user = userEvent.setup();
        const props = createProps();
        const { rerender } = render(<ChapterNavigator {...props} />);
        await user.click(screen.getByText('Volume 1'));
        const newVolume = { id: 'v3', title: 'Volume 3', chapters: [{ ...book.volumes[0].chapters[0], id: 'c3', title: 'New content' }] };
        rerender(<ChapterNavigator {...props} book={{ ...book, volumes: [...book.volumes, newVolume] }} />);
        expect(screen.getByText('New content')).toBeInTheDocument();
        expect(screen.queryByText('Chapter One')).not.toBeInTheDocument();
        rerender(<ChapterNavigator {...props} book={{ ...book, volumes: [newVolume] }} />);
        rerender(<ChapterNavigator {...props} />);
        expect(screen.getByText('Chapter One')).toBeInTheDocument();
    });

    it('initializes expansion for a different book', async () => {
        const user = userEvent.setup();
        const props = createProps();
        const { rerender } = render(<ChapterNavigator {...props} />);
        await user.click(screen.getByText('Volume 1'));
        rerender(<ChapterNavigator {...props} book={{ ...book, id: 'another-book' }} />);
        expect(screen.getByText('Chapter One')).toBeInTheDocument();
    });

    it('renders the volume tree with chapters and an empty-volume hint', () => {
        render(<ChapterNavigator {...createProps()} />);

        expect(screen.getByText('Volume 1')).toBeInTheDocument();
        expect(screen.getByText('Chapter One')).toBeInTheDocument();
        expect(screen.getByText('Chapter Two')).toBeInTheDocument();
        expect(screen.getByText('Volume 2')).toBeInTheDocument();
        expect(screen.getByText('No chapters')).toBeInTheDocument();
    });

    it('delegates chapter selection', async () => {
        const user = userEvent.setup();
        const props = createProps();
        render(<ChapterNavigator {...props} />);

        await user.click(screen.getByText('Chapter Two'));

        expect(props.onSelectChapter).toHaveBeenCalledWith('c2');
    });

    it('collapses to an icon rail when toggled', () => {
        const { container } = render(<ChapterNavigator {...createProps()} />);
        const toggle = container.querySelector('aside button') as HTMLElement;

        fireEvent.click(toggle);

        expect(screen.queryByText('My Book')).not.toBeInTheDocument();
        expect(screen.queryByText('Chapter One')).not.toBeInTheDocument();
    });

    it('finds chapters through fuzzy search and selects a result', async () => {
        const user = userEvent.setup();
        const props = createProps();
        render(<ChapterNavigator {...props} />);

        fireEvent.change(screen.getByPlaceholderText('Search chapters'), { target: { value: 'Two' } });
        const result = await screen.findByRole('button', { name: /Chapter Two/ });
        await user.click(result);

        expect(props.onSelectChapter).toHaveBeenCalledWith('c2');
    });

    it('keeps the search form layout stable when a semantic search fails', async () => {
        const search = vi.spyOn(retrievalRepository, 'search').mockRejectedValue(new Error('Search probe failure'));
        const { container } = render(<ChapterNavigator {...createProps({ localMode: true })} />);
        const form = container.querySelector('form') as HTMLFormElement;
        const initialFormClass = form.className;

        fireEvent.click(screen.getByRole('button', { name: 'Semantic / Story' }));
        fireEvent.change(screen.getByPlaceholderText('Search the story'), { target: { value: '脆弱' } });
        fireEvent.click(screen.getByRole('button', { name: 'Go' }));

        await waitFor(() => expect(screen.getAllByRole('alert').some(alert => alert.textContent?.includes('Search probe failure'))).toBe(true));
        expect(form.className).toBe(initialFormClass);
        expect(form).not.toHaveClass('flex-1');
        expect(form).not.toHaveClass('overflow-hidden');
        search.mockRestore();
    });

    it('creates a volume with a generated title and starts renaming it', async () => {
        const user = userEvent.setup();
        const props = createProps();
        const { rerender } = render(<ChapterNavigator {...props} />);

        await user.click(screen.getByText('Create Volume'));

        await waitFor(() => expect(props.onAddVolume).toHaveBeenCalledWith('Volume 3'));

        // The parent would now add the new volume to the book data.
        const updatedBook: Book = { ...book, volumes: [...book.volumes, { id: 'new-vol', title: 'Volume 3', chapters: [] }] };
        rerender(<ChapterNavigator {...props} book={updatedBook} />);

        expect(await screen.findByDisplayValue('Volume 3')).toBeInTheDocument();
    });

    it('creates a chapter inside its volume', async () => {
        const user = userEvent.setup();
        const props = createProps();
        render(<ChapterNavigator {...props} />);

        await user.click(screen.getAllByTitle('Add Chapter')[0]);

        await waitFor(() => expect(props.onAddChapter).toHaveBeenCalledWith('v1', 'New Chapter'));
    });

    it('opens the context menu for a chapter', () => {
        render(<ChapterNavigator {...createProps()} />);

        fireEvent.contextMenu(screen.getByText('Chapter One'));

        expect(screen.getByText('Plot Setting')).toBeInTheDocument();
        expect(screen.getByText('Rename')).toBeInTheDocument();
        expect(screen.getByText('Delete')).toBeInTheDocument();
    });

    it('keeps the context menu inside the viewport near the bottom-right corner', async () => {
        render(<ChapterNavigator {...createProps()} />);

        const chapter = screen.getByText('Chapter One');
        fireEvent.contextMenu(chapter, { clientX: window.innerWidth - 1, clientY: window.innerHeight - 1 });

        const menu = screen.getByText('Plot Setting').parentElement as HTMLDivElement;
        Object.defineProperty(menu, 'getBoundingClientRect', {
            configurable: true,
            value: () => ({ width: 176, height: 104 }),
        });

        fireEvent.contextMenu(chapter, { clientX: window.innerWidth - 1, clientY: window.innerHeight - 1 });

        await waitFor(() => {
            expect(menu.style.left).toBe(`${window.innerWidth - 184}px`);
            expect(menu.style.top).toBe(`${window.innerHeight - 112}px`);
        });
    });

    it('renames a chapter through the context menu', async () => {
        const user = userEvent.setup();
        const props = createProps();
        render(<ChapterNavigator {...props} />);

        fireEvent.contextMenu(screen.getByText('Chapter One'));
        await user.click(screen.getByText('Rename'));

        const input = screen.getByDisplayValue('Chapter One');
        fireEvent.change(input, { target: { value: 'Renamed Chapter' } });
        fireEvent.keyDown(input, { key: 'Enter' });

        await waitFor(() => expect(props.onRenameChapter).toHaveBeenCalledWith('c1', 'Renamed Chapter'));
    });

    it('deletes a chapter through the confirmation modal', async () => {
        const user = userEvent.setup();
        const props = createProps();
        render(<ChapterNavigator {...props} />);

        fireEvent.contextMenu(screen.getByText('Chapter Two'));
        await user.click(screen.getByText('Delete'));

        expect(screen.getByText('Delete Chapter?')).toBeInTheDocument();
        await user.click(screen.getByRole('button', { name: 'Delete' }));

        await waitFor(() => expect(props.onDeleteItem).toHaveBeenCalledWith({ type: 'chapter', id: 'c2', parentId: 'v1' }));
    });

    it('navigates back to the dashboard', async () => {
        const user = userEvent.setup();
        const props = createProps();
        render(<ChapterNavigator {...props} />);

        await user.click(screen.getByText('Back to Dashboard'));

        expect(props.onNavigateDashboard).toHaveBeenCalledTimes(1);
    });
});
