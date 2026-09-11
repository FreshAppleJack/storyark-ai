import apiClient from '../services/api';
import { clientConfig } from '../services/config';
import { asRecord } from '../utils/serialization';

export const aiApi = {
    async continueWriting(payload: { content: string; outputLengthChars: number }): Promise<string> {
        const response = asRecord(await apiClient.post('/ai/continue', payload, { timeout: clientConfig.aiTimeoutMs }));
        if (typeof response.result !== 'string') throw new Error('Invalid AI continuation response');
        return response.result;
    },
};
