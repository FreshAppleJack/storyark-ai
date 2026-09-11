import axios, { AxiosError, AxiosHeaders, type AxiosAdapter } from 'axios';
import { afterEach, expect, it, vi } from 'vitest';
import apiClient from '../../services/api';
import { readClientConfig } from '../../services/config';

afterEach(() => vi.unstubAllGlobals());

it('uses configurable HTTP settings and returns only the response body', async () => {
    const adapter = vi.fn<AxiosAdapter>(async config => ({ data: { id: 7 }, status: 200, statusText: 'OK', headers: new AxiosHeaders(), config }));
    await expect(apiClient.get('/books', { adapter })).resolves.toEqual({ id: 7 });
    expect(adapter.mock.calls[0][0]).toMatchObject({ baseURL: '/api', timeout: 10000, withCredentials: true });
    expect(readClientConfig({ VITE_API_BASE_URL: 'https://example.com/api/', VITE_API_TIMEOUT_MS: '2500' }))
        .toMatchObject({ apiBaseUrl: 'https://example.com/api', apiTimeoutMs: 2500 });
    expect(() => readClientConfig({ VITE_API_TIMEOUT_MS: '-1' })).toThrow('positive integer');
    expect(() => readClientConfig({ VITE_API_BASE_URL: '//example.com' })).toThrow('protocol-relative');
});

it('propagates 401 without navigating away from an unsaved draft', async () => {
    const navigate = vi.fn();
    const location = { pathname: '/', get href() { return '/#/editor/1'; }, set href(value: string) { navigate(value); } };
    vi.stubGlobal('window', { location });
    const failure = new AxiosError('Expired session', AxiosError.ERR_BAD_REQUEST, undefined, undefined, {
        data: {}, status: 401, statusText: 'Unauthorized', headers: new AxiosHeaders(),
        config: { headers: new AxiosHeaders() },
    });
    expect(axios.isAxiosError(failure)).toBe(true);
    await expect(apiClient.put('/story/chapters/1', { content: 'Unsaved' }, {
        adapter: async () => { throw failure; },
    })).rejects.toBe(failure);
    expect(navigate).not.toHaveBeenCalled();
});
