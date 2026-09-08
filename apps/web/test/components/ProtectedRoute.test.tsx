import { render, screen } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import ProtectedRoute from '../../components/ProtectedRoute';

const session = vi.hoisted(() => ({ user: null as null | { isAuthenticated: boolean } }));

// Keep real navigation; only replace session access to avoid booting the application's API effects.
vi.mock('../../InteractionContent/AppContext', () => ({ useApp: () => session }));

function renderRoute() {
  const router = createMemoryRouter([
    { path: '/intro', element: <h1>Introduction</h1> },
    { path: '/login', element: <h1>Login</h1> },
    { path: '/editor/:bookId', element: <ProtectedRoute><h1>Chapter editor</h1></ProtectedRoute> },
  ], { initialEntries: ['/intro', '/editor/book-1?chapter=2#draft'], initialIndex: 1 });
  render(<RouterProvider router={router} />);
  return router;
}

describe('ProtectedRoute', () => {
  it.each([null, { isAuthenticated: false }])('redirects an unauthenticated session (%j) to login', async (user) => {
    session.user = user;
    const router = renderRoute();

    expect(await screen.findByRole('heading', { name: 'Login' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Chapter editor' })).not.toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/login');
    expect(router.state.historyAction).toBe('REPLACE');
    expect(router.state.location.state.from).toMatchObject({
      pathname: '/editor/book-1', search: '?chapter=2', hash: '#draft',
    });
  });

  it('lets an authenticated user see the requested page', async () => {
    session.user = { isAuthenticated: true };
    const router = renderRoute();

    expect(await screen.findByRole('heading', { name: 'Chapter editor' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Login' })).not.toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/editor/book-1');
  });
});
