import axios, { type AxiosRequestConfig } from 'axios';
import { clientConfig } from './config';

const transport = axios.create({
    baseURL: clientConfig.apiBaseUrl,
    timeout: clientConfig.apiTimeoutMs,
    withCredentials: true,
});

// Return response bodies explicitly so TypeScript and runtime agree. Unspecified
// responses are unknown; callers must validate or name their DTO contract.
// Failures (including 401) reject without forcing a page reload that could lose
// the editor's unsaved draft. The calling UI owns failure/recovery feedback.
const apiClient = {
    async get<T = unknown>(url: string, config?: AxiosRequestConfig): Promise<T> {
        return (await transport.get<T>(url, config)).data;
    },
    async post<T = unknown>(url: string, data?: unknown, config?: AxiosRequestConfig): Promise<T> {
        return (await transport.post<T>(url, data, config)).data;
    },
    async put<T = unknown>(url: string, data?: unknown, config?: AxiosRequestConfig): Promise<T> {
        return (await transport.put<T>(url, data, config)).data;
    },
    async delete<T = unknown>(url: string, config?: AxiosRequestConfig): Promise<T> {
        return (await transport.delete<T>(url, config)).data;
    },
};
export default apiClient;
