import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import { call } from './repository';

export type GenerationTarget =
    | { kind: 'continue'; chapterId: string; databaseVersion: number }
    | { kind: 'brainstorm'; workspaceDatabaseVersion: number; planningDatabaseVersion: number; sources: SourceVersion[] };

export interface SourceVersion { chapterId: string; databaseVersion: number }
export type ContextKind = 'currentDraft' | 'writtenFact' | 'authorSetting' | 'manualSummary' | 'futurePlan';
export interface ContextSection { kind: ContextKind; label: string; text: string }
export interface ContextInput {
    bookId: string; sessionId: string; draftRevision: number; maxChars: number; sections: ContextSection[];
}
export interface ContextSnapshot extends ContextInput {
    contextSnapshotId: string; charCount: number;
}
export interface GenerationRequest {
    requestId: string; bookId: string; sessionId: string; draftRevision: number;
    config: { id: string; expectedConfigVersion: number };
    target: GenerationTarget; contextSnapshotId: string; outputChars: number;
}
export type GenerationPayload =
    | { kind: 'started' }
    | { kind: 'delta'; text: string }
    | { kind: 'completed'; text: string; usage: TokenUsage; finishReason: FinishReason }
    | { kind: 'failed'; error: GenerationError }
    | { kind: 'cancelled' };
export interface TokenUsage { inputTokens: number | null; outputTokens: number | null; totalTokens: number | null }
export type FinishReason = 'stop' | 'length' | { provider: string };
export type GenerationErrorCode =
    | 'VALIDATION_ERROR' | 'CREDENTIAL_UNAVAILABLE' | 'AUTHENTICATION_FAILED' | 'MODEL_NOT_FOUND'
    | 'RATE_LIMITED' | 'TIMEOUT' | 'CANCELLED' | 'PROTOCOL_ERROR' | 'TRUNCATED' | 'BUSY'
    | 'CONTEXT_CHANGED' | 'UNAVAILABLE' | 'STORAGE_FAILURE' | 'NOT_FOUND' | 'VERSION_CONFLICT' | 'LOCKED';
export interface GenerationError { code: GenerationErrorCode; requestId: string | null; retryAfterMs: number | null }
export interface GenerationEvent { requestId: string; sessionId: string; sequence: number; payload: GenerationPayload }

export const aiGenerationRepository = {
    prepareContext: (input: ContextInput) => call<ContextSnapshot>('ai_prepare_context', { input }),
    start: (input: GenerationRequest) => call<{ requestId: string }>('ai_start_generation', { input }),
    cancel: (requestId: string, sessionId: string) => call<{ requestId: string; outcome: 'cancelled' | 'notFound' }>('ai_cancel_generation', {
        input: { requestId, sessionId },
    }),
    subscribe: (handler: (event: GenerationEvent) => void): Promise<UnlistenFn> =>
        listen<GenerationEvent>('storyark-ai-generation', event => handler(event.payload)),
};
