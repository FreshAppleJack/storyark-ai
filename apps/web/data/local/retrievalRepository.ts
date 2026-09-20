import type {
    EmbeddingStatus,
    RetrievalChunk,
    RetrievalIndexJob,
    RetrievalScope,
    RetrievalSearchRequest,
    RetrievalSearchResponse,
    RetrievalSource,
} from '../../domain/retrieval/contracts';
import { call, localKeys } from './repository';

export const retrievalKeys = {
    all: [...localKeys.all, 'retrieval'] as const,
    sources: (bookId: string) => [...localKeys.all, 'retrieval', 'sources', bookId] as const,
    chunks: (bookId: string) => [...localKeys.all, 'retrieval', 'chunks', bookId] as const,
    indexJobs: (bookId: string) => [...localKeys.all, 'retrieval', 'index-jobs', bookId] as const,
};

export const retrievalRepository = {
    syncSources: (bookId: string) =>
        call<RetrievalSource[]>('local_sync_retrieval_sources', { input: { bookId } }),
    listSources: (scope: RetrievalScope) =>
        call<RetrievalSource[]>('local_list_retrieval_sources', { input: { scope } }),
    listChunks: (scope: RetrievalScope) =>
        call<RetrievalChunk[]>('local_list_retrieval_chunks', { input: { scope } }),
    embeddingStatus: () => call<EmbeddingStatus>('local_embedding_status'),
    queueIndex: (bookId: string) =>
        call<RetrievalIndexJob[]>('local_queue_retrieval_index', { input: { bookId } }),
    listIndexJobs: (bookId: string) =>
        call<RetrievalIndexJob[]>('local_list_retrieval_index_jobs', { input: { bookId } }),
    pauseIndexJob: (jobId: string) =>
        call<RetrievalIndexJob>('local_pause_retrieval_index_job', { input: { jobId } }),
    cancelIndexJob: (jobId: string) =>
        call<RetrievalIndexJob>('local_cancel_retrieval_index_job', { input: { jobId } }),
    retryIndexJob: (jobId: string) =>
        call<RetrievalIndexJob>('local_retry_retrieval_index_job', { input: { jobId } }),
    search: (input: RetrievalSearchRequest) =>
        call<RetrievalSearchResponse>('local_search_retrieval', { input }),
};
