/** Public build-time settings only. Never put provider keys in VITE_* variables. */
export function readClientConfig(env: Record<string, unknown>) {
    const apiBaseUrl = typeof env.VITE_API_BASE_URL === 'string' && env.VITE_API_BASE_URL.trim()
        ? env.VITE_API_BASE_URL.trim().replace(/\/+$/, '') : '/api';
    if (!apiBaseUrl.startsWith('/') && !/^https?:\/\//i.test(apiBaseUrl)) {
        throw new Error('VITE_API_BASE_URL must be an absolute HTTP(S) URL or a root-relative path');
    }
    if (apiBaseUrl.startsWith('//')) throw new Error('VITE_API_BASE_URL must not be protocol-relative');
    const timeout = (key: string, fallback: number) => {
        const value = env[key];
        if (value === undefined || value === '') return fallback;
        const parsed = Number(value);
        if (!Number.isSafeInteger(parsed) || parsed <= 0) throw new Error(`${key} must be a positive integer`);
        return parsed;
    };
    return {
        apiBaseUrl,
        apiTimeoutMs: timeout('VITE_API_TIMEOUT_MS', 10000),
        aiTimeoutMs: timeout('VITE_AI_TIMEOUT_MS', 60000),
    };
}

export const clientConfig = readClientConfig(import.meta.env);
