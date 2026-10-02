import { useMemo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { Chapter } from '../../../types';
import { localKeys, localRepository } from '../../../data/local/repository';
import { chapterBodyCache } from '../../../data/local/chapterBodyCache';

export function useLoadedChapter(bookId: string, metadata: Chapter | undefined) {
    const client = useQueryClient();
    const needsBody = metadata?.contentLoaded === false;
    const query = useQuery({
        queryKey: localKeys.chapter(bookId, metadata?.id ?? ''),
        enabled: needsBody,
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
    return { chapter, isLoading: needsBody && query.isPending, error: needsBody ? query.error : null, retry: query.refetch };
}
