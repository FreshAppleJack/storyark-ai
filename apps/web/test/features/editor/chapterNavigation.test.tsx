import { act, fireEvent, render, screen } from '@testing-library/react';
import { RouterProvider } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import { createEditorRouter, fixture, setupEditorPageHarness } from './editorPageHarness';

setupEditorPageHarness();

describe('Editor history navigation', () => {
    it('discards the last deleted chapter and permits leaving before deletion finishes', async () => {
        fixture.book.volumes[0].chapters = fixture.book.volumes[0].chapters.slice(0, 1);
        let finish!: () => void;
        fixture.deleteChapter.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
        const router = createEditorRouter(['/dashboard', '/editor/b1']);
        await act(async () => { render(<RouterProvider router={router} />); });
        fireEvent.click(screen.getByRole('button', { name: 'Edit draft' }));
        fireEvent.contextMenu(document.getElementById('sidebar-chapter-c1')!);
        fireEvent.click(screen.getAllByText('Delete').find(element => element.closest('.fixed'))!);
        await act(async () => { fireEvent.click(screen.getAllByRole('button', { name: 'Delete' }).find(element => element.closest('.fixed'))!); });
        await act(async () => { await router.navigate(-1); });
        expect(screen.getByText('Dashboard destination')).toBeInTheDocument();
        expect(fixture.save).not.toHaveBeenCalled();
        await act(async () => finish());
        expect(router.state.location.pathname).toBe('/dashboard');
    });

    it.each([-1, 1])('waits for the latest draft before history navigation (%s)', async delta => {
        const entries = delta < 0 ? ['/dashboard', '/editor/b1'] : ['/editor/b1', '/dashboard'];
        const router = createEditorRouter(entries, delta < 0 ? 1 : 0);
        const resolvers: Array<(ok: boolean) => void> = [];
        fixture.save.mockImplementation(() => new Promise(resolve => { resolvers.push(resolve); }));
        await act(async () => { render(<RouterProvider router={router} />); });
        fireEvent.click(screen.getByRole('button', { name: 'Edit draft' }));
        await act(async () => { await router.navigate(delta); });
        expect(router.state.location.pathname).toBe('/editor/b1');
        expect(fixture.save).toHaveBeenCalledTimes(1);
        fireEvent.click(screen.getByRole('button', { name: 'Edit draft v2' }));
        await act(async () => { resolvers[0](true); });
        expect(router.state.location.pathname).toBe('/editor/b1');
        expect(fixture.save).toHaveBeenCalledTimes(2);
        await act(async () => { resolvers[1](true); });
        expect(screen.getByText('Dashboard destination')).toBeInTheDocument();
    });

    it('stays on failure and permits another history attempt after retry', async () => {
        const router = createEditorRouter(['/dashboard', '/editor/b1']);
        fixture.save.mockResolvedValue(false);
        await act(async () => { render(<RouterProvider router={router} />); });
        fireEvent.click(screen.getByRole('button', { name: 'Edit draft' }));
        await act(async () => { await router.navigate(-1); });
        expect(router.state.location.pathname).toBe('/editor/b1');
        expect(screen.getByText('Save failed')).toBeInTheDocument();
        fixture.save.mockResolvedValue(true);
        await act(async () => { await router.navigate(-1); });
        expect(screen.getByText('Dashboard destination')).toBeInTheDocument();
    });
});
