import type { RetrievalScope, RetrievalSource } from '../../domain/retrieval/contracts';
import { call, localKeys } from './repository';

export const retrievalKeys = {
    all: [...localKeys.all, 'retrieval'] as const,
    sources: (bookId: string) => [...localKeys.all, 'retrieval', 'sources', bookId] as const,
};

export const retrievalRepository = {
    syncSources: (bookId: string) =>
        call<RetrievalSource[]>('local_sync_retrieval_sources', { input: { bookId } }),
    listSources: (scope: RetrievalScope) =>
        call<RetrievalSource[]>('local_list_retrieval_sources', { input: { scope } }),
};
