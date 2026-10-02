import { invoke, isTauri } from '@tauri-apps/api/core';

// Only error metadata belongs here, never command arguments, story text or AI responses.
export function redactDiagnostic(text: string): string {
    return text.split('\n').map(line => /authorization|bearer\s|api[_-]?key|password|secret|token[=:"\s]|sk-/i.test(line)
        ? '[sensitive diagnostic redacted]' : line).join('\n').slice(0, 6000);
}

export function reportError(operation: string, error: unknown, code = 'FRONTEND_ERROR'): void {
    if (code === 'CANCELLED') return;
    // Arbitrary objects can contain manuscript text or request bodies. Do not stringify them.
    const message = error instanceof Error
        ? `${error.name}: ${error.message}\n${error.stack ?? ''}`
        : typeof error === 'string' ? error : 'No diagnostic message available';
    const entry = { operation: operation.slice(0, 100), code: code.slice(0, 80), message: redactDiagnostic(message) };
    if (import.meta.env.DEV) console.warn('[StoryArk diagnostic]', entry);
    try {
        if (!isTauri()) return;
        // Use invoke directly so a logging failure cannot recurse through the storage layer.
        void Promise.resolve(invoke('diagnostic_report_error', entry)).catch(() => {
            if (import.meta.env.DEV) console.warn('StoryArk could not write the error log.');
        });
    } catch {
        if (import.meta.env.DEV) console.warn('StoryArk could not write the error log.');
    }
}

export function installErrorReporting(): () => void {
    const onError = (event: ErrorEvent) => {
        reportError('window.error', event.error instanceof Error ? event.error : 'A script or resource failed to load.');
    };
    const onRejection = (event: PromiseRejectionEvent) => reportError('unhandledrejection', event.reason);
    window.addEventListener('error', onError);
    window.addEventListener('unhandledrejection', onRejection);
    const originalConsoleError = console.error;
    console.error = (...args: unknown[]) => {
        originalConsoleError(...args);
        // Existing catch blocks often log errors here. Ignore arbitrary data objects/strings.
        reportError('console.error', args.find(arg => arg instanceof Error) ?? 'A handled error was written to the developer console.');
    };
    return () => {
        window.removeEventListener('error', onError);
        window.removeEventListener('unhandledrejection', onRejection);
        console.error = originalConsoleError;
    };
}

export interface UserFacingError extends Error { userFacing: true }

export function userErrorMessage(error: unknown, fallback: string, operation: string): string {
    if (error instanceof Error && 'userFacing' in error && error.userFacing === true) return error.message;
    reportError(operation, error);
    return fallback;
}

export function storageErrorMessage(code: string, command: string): string {
    switch (code) {
        case 'VERSION_CONFLICT': case 'CONTEXT_CHANGED':
            return 'This work changed since you opened it. Keep your draft and reopen it before trying again.';
        case 'READ_ONLY': case 'LOCKED': return 'This work is locked. Unlock it before making changes.';
        case 'NOT_FOUND': return 'This item is no longer available. Reopen the book and try again.';
        case 'CONTENT_INCOMPATIBLE': return 'This content cannot be edited in this version of StoryArk. Try updating the app.';
        case 'IMPORT_UNSUPPORTED_VERSION': return 'This file needs a different version of StoryArk. Try updating the app or choose another file.';
        case 'IMPORT_INVALID': return 'This file could not be imported. Choose another StoryArk export.';
        case 'IMPORT_CONFLICT': return 'An existing copy changed. Check it again before replacing it, or create a new copy.';
        case 'UNSUPPORTED_ASSET': return 'This file contains attachments StoryArk cannot import. Choose another export.';
        case 'BACKUP_FAILED': return 'A backup could not be created. Check available disk space and try again before replacing this work.';
        case 'CANCELLED': return 'The operation was cancelled.';
        case 'CREDENTIAL_UNAVAILABLE': return 'Your API key is unavailable. Enter it again in AI model settings.';
        case 'CREDENTIAL_REPLACEMENT_REQUIRED': return 'Enter your API key again after changing the service address or protocol.';
        case 'AUTHENTICATION_FAILED': return 'The AI service rejected your API key. Check the key and your account access.';
        case 'MODEL_NOT_FOUND': return 'The AI model could not be found. Check the model name and service address.';
        case 'RATE_LIMITED': return 'The AI service is busy or your usage limit was reached. Try again later.';
        case 'TIMEOUT': return 'The AI request took too long. Try again or increase the timeout in AI model settings.';
        case 'TRUNCATED': return 'The AI response was cut short. Request a shorter result or check the output limit in AI model settings.';
        case 'PROTOCOL_ERROR': return 'The AI response could not be read. Check the protocol in AI model settings and try again.';
        case 'UNAVAILABLE': return 'The AI service could not be reached. Check your connection and try again.';
        case 'BUSY': return 'Another AI request is still running. Wait for it to finish or stop it first.';
        case 'INVALID_INPUT': case 'VALIDATION_ERROR':
            return command.includes('config') ? 'Check your AI model settings and try again.' : 'This action could not be completed. Check your entries or reopen the book and try again.';
        case 'RETRIEVAL_INDEX_FAILURE': return 'Search could not be updated. Try refreshing it again.';
        case 'RETRIEVAL_SEARCH_FAILURE': return 'Story search is unavailable right now. Try again or use Title / Chapter search.';
        default: return 'This action could not be completed. Keep your draft, check available disk space, and try again.';
    }
}
