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

const RETRIEVAL_READ_FAILURE = 'Story search is unavailable right now. Try again later. You can keep writing.';
const RETRIEVAL_WRITE_FAILURE = 'Search could not be updated. Try refreshing it again. You can keep writing.';

export const retrievalKeys = {
    all: [...localKeys.all, 'retrieval'] as const,
    sources: (bookId: string) => [...localKeys.all, 'retrieval', 'sources', bookId] as const,
    chunks: (bookId: string) => [...localKeys.all, 'retrieval', 'chunks', bookId] as const,
    indexJobs: (bookId: string) => [...localKeys.all, 'retrieval', 'index-jobs', bookId] as const,
};

export const retrievalRepository = {
    syncSources: (bookId: string) =>
        call<RetrievalSource[]>('local_sync_retrieval_sources', { input: { bookId } }, { failureMessage: RETRIEVAL_WRITE_FAILURE }),
    listSources: (scope: RetrievalScope) =>
        call<RetrievalSource[]>('local_list_retrieval_sources', { input: { scope } }, { failureMessage: RETRIEVAL_READ_FAILURE }),
    listChunks: (scope: RetrievalScope) =>
        call<RetrievalChunk[]>('local_list_retrieval_chunks', { input: { scope } }, { failureMessage: RETRIEVAL_READ_FAILURE }),
    embeddingStatus: () => call<EmbeddingStatus>('local_embedding_status', undefined, { failureMessage: RETRIEVAL_READ_FAILURE }),
    queueIndex: (bookId: string) =>
        call<RetrievalIndexJob[]>('local_queue_retrieval_index', { input: { bookId } }, { failureMessage: RETRIEVAL_WRITE_FAILURE }),
    listIndexJobs: (bookId: string) =>
        call<RetrievalIndexJob[]>('local_list_retrieval_index_jobs', { input: { bookId } }, { failureMessage: RETRIEVAL_READ_FAILURE }),
    pauseIndexJob: (jobId: string) =>
        call<RetrievalIndexJob>('local_pause_retrieval_index_job', { input: { jobId } }, { failureMessage: RETRIEVAL_WRITE_FAILURE }),
    cancelIndexJob: (jobId: string) =>
        call<RetrievalIndexJob>('local_cancel_retrieval_index_job', { input: { jobId } }, { failureMessage: RETRIEVAL_WRITE_FAILURE }),
    retryIndexJob: (jobId: string) =>
        call<RetrievalIndexJob>('local_retry_retrieval_index_job', { input: { jobId } }, { failureMessage: RETRIEVAL_WRITE_FAILURE }),
    search: (input: RetrievalSearchRequest) =>
        call<RetrievalSearchResponse>('local_search_retrieval', { input }, { failureMessage: RETRIEVAL_READ_FAILURE }),
};
