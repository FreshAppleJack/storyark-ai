import { useMemo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { Chapter } from '../../../types';
import { localKeys, localRepository } from '../../../data/local/repository';
import { chapterBodyCache } from '../../../data/local/chapterBodyCache';
import { useDelayedLoading } from '../../../components/hooks/useDelayedLoading';

export function useLoadedChapter(bookId: string, metadata: Chapter | undefined) {
    const client = useQueryClient();
    const needsBody = metadata?.contentLoaded === false;
    const query = useQuery({
        queryKey: localKeys.chapter(bookId, metadata?.id ?? ''),
        enabled: needsBody,
        // A recent saved chapter can render immediately without a pending frame.
        initialData: () => needsBody
            ? chapterBodyCache(client).get(bookId, metadata!.id, metadata!.databaseVersion ?? 0) : undefined,
        staleTime: Infinity, gcTime: 0, retry: false,
        refetchOnWindowFocus: false, refetchOnReconnect: false,
        queryFn: async () => {
            const cache = chapterBodyCache(client);
            const cached = cache.get(bookId, metadata!.id, metadata!.databaseVersion ?? 0);
            if (cached) return cached;
            const chapter = await localRepository.readChapter(bookId, metadata!.id);
            cache.put(chapter);
            return chapter;
        },
    });
    const chapter = useMemo(() => {
        if (!needsBody) return metadata;
        if (!query.data || query.data.id !== metadata?.id) return undefined;
        return { ...metadata, content: query.data.body.content, contentLoaded: true,
            foreshadowings: query.data.foreshadowings, wordCount: query.data.wordCount };
    }, [metadata, needsBody, query.data]);
    const isLoading = needsBody && query.isPending;
    const identity = JSON.stringify([bookId, metadata?.id]);
    const showLoading = useDelayedLoading(isLoading, identity);
    return { chapter, isLoading, showLoading,
        error: needsBody ? query.error : null, retry: query.refetch };
}
