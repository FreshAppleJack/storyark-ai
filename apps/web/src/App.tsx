import React from 'react';
import { createHashRouter, createRoutesFromElements, RouterProvider, Route, Navigate } from 'react-router-dom';
import { QueryClientProvider } from '@tanstack/react-query';
import { Toaster } from 'react-hot-toast';
import { AppProvider } from '../InteractionContent/AppContext';
import { queryClient } from '../InteractionContent/queryClient';
import { RouteError, RouteLoading, RouteShell } from './RouteShell';
import { UnavailablePage } from '../pages/UnavailablePage';

// Hash routing and lazy data routes preserve the editor's navigation blocker.
const router = createHashRouter(createRoutesFromElements(
    <Route element={<RouteShell />} errorElement={<RouteError />} HydrateFallback={RouteLoading}>
        <Route path="/" element={<Navigate to="/dashboard" replace />} />
        <Route path="/intro" element={<Navigate to="/dashboard" replace />} />
        {/* Keep the legacy page files, but never mount their authentication flows. */}
        <Route path="/login" element={<Navigate to="/dashboard" replace />} />
        <Route path="/register" element={<Navigate to="/dashboard" replace />} />
        <Route path="/dashboard" lazy={async () => ({ Component: (await import('../pages/Dashboard')).default })} />
        <Route path="/editor/:bookId" lazy={async () => ({ Component: (await import('../pages/EditorPrototype')).default })} />
        <Route path="/style-library" lazy={async () => ({ Component: (await import('../pages/StyleLibrary')).default })} />
        <Route path="/settings" element={<UnavailablePage />} />
        <Route path="/books/:bookId/settings" lazy={async () => ({ Component: (await import('../pages/CharacterSettings')).default })} />
        <Route path="/books/:bookId/relationships" lazy={async () => ({ Component: (await import('../pages/RelationshipMap')).default })} />
        <Route path="/books/:bookId/*" element={<UnavailablePage />} />
        <Route path="*" element={<Navigate to="/dashboard" replace />} />
    </Route>
));

export default function App(): React.ReactElement {
    return <QueryClientProvider client={queryClient}>
        <AppProvider mode="local"><RouterProvider router={router} /><Toaster /></AppProvider>
    </QueryClientProvider>;
}
