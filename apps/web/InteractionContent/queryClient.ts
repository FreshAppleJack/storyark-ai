import { QueryClient } from '@tanstack/react-query';

/**
 * Shared QueryClient. The books cache is the single source of truth for
 * server data: mutations write optimistic updates straight into it, so a
 * window-focus refetch is disabled to avoid surprising mid-edit clobbers;
 * staleTime keeps navigation cheap between pages.
 */
export const queryClient = new QueryClient({
    defaultOptions: {
        queries: {
            retry: 1,
            staleTime: 30_000,
            refetchOnWindowFocus: false,
        },
    },
});
