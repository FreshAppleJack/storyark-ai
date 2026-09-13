import { call } from './repository';

export type AiProtocol = 'openai-responses' | 'openai-chat-completions' | 'anthropic-messages';
export interface AiConfig {
    name: string; protocol: AiProtocol; baseUrl: string; modelId: string;
    timeoutMs: number; maxOutputTokens: number;
}
export interface AiConfigRecord {
    id: string; config: AiConfig; configVersion: number;
    credentialMode: 'session' | 'system'; credentialStatus: 'session' | 'configured' | 'unavailable';
}
export interface AiConfigList {
    configs: AiConfigRecord[]; defaultConfigId: string | null; databaseVersion: number; cleanupPending: boolean;
}
export interface SaveAiConfig {
    id: string | null; expectedConfigVersion: number; config: AiConfig;
    credential: { action: 'keep' } | { action: 'replace'; key: string; remember: boolean };
}
const version = (config: AiConfigRecord) => ({ id: config.id, expectedConfigVersion: config.configVersion });
export const aiSettingsRepository = {
    list: () => call<AiConfigList>('ai_list_configs'),
    save: (input: SaveAiConfig) => call<{ id: string; configVersion: number; cleanupPending: boolean }>('ai_save_config', { input }),
    setDefault: (config: AiConfigRecord | null, expectedDatabaseVersion: number) => call('ai_set_default', {
        input: { config: config ? version(config) : null, expectedDatabaseVersion },
    }),
    delete: (config: AiConfigRecord, expectedDefaultDatabaseVersion: number) => call('ai_delete_config', {
        input: { config: version(config), expectedDefaultDatabaseVersion },
    }),
    test: (config: AiConfigRecord, requestId: string) => call<{ requestId: string; configVersion: number }>('ai_test_connection', {
        input: { requestId, config: version(config) },
    }),
};

export function aiErrorMessage(error: unknown): string {
    const code = error && typeof error === 'object' && 'code' in error ? String(error.code) : '';
    const messages: Record<string, string> = {
        VALIDATION_ERROR: 'Check the fields, limits, and service URL.',
        INVALID_INPUT: 'The configuration identity is invalid. Reload the list.',
        VERSION_CONFLICT: 'This configuration changed elsewhere. Your edits are kept. Cancel to reload before editing again.',
        CREDENTIAL_REPLACEMENT_REQUIRED: 'Enter a key again when changing the service address or protocol.',
        CREDENTIAL_UNAVAILABLE: 'The credential is unavailable. Enter a key or choose session-only storage and retry.',
        AUTHENTICATION_FAILED: 'The service rejected authentication. Check the saved key and account access.',
        MODEL_NOT_FOUND: 'The model or API endpoint was not found.',
        RATE_LIMITED: 'The service rate limit was reached. Try again later.',
        TIMEOUT: 'The connection test timed out.',
        TRUNCATED: 'The response reached the output limit. Connection success was not confirmed.',
        PROTOCOL_ERROR: 'The service did not return a valid completed text response for this protocol.',
        UNAVAILABLE: 'The service could not be reached.',
        NOT_FOUND: 'This configuration no longer exists. Cancel to reload the list.',
        DESKTOP_REQUIRED: 'Open the desktop app to manage model credentials.',
    };
    return messages[code] ?? 'The operation failed. Existing settings have not been replaced by empty values.';
}
