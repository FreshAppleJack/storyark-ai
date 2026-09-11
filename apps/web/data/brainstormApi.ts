import apiClient from '../services/api';
import { clientConfig } from '../services/config';
import type { BrainstormWorkspace } from '../types';
import type { BrainstormDto } from './dto';
import { mapBrainstormResponse, toBrainstormPayload } from './brainstormMapping';

export const brainstormApi = {
    async get(bookId: string) {
        return mapBrainstormResponse(await apiClient.get<BrainstormDto>(`/books/${bookId}/brainstorm`));
    },
    async generate(bookId: string, selectedChapterIds: string[], contextSnapshot: Record<string, unknown>) {
        return mapBrainstormResponse(await apiClient.post<BrainstormDto>(`/books/${bookId}/brainstorm/generate`,
            { selectedChapterIds, contextSnapshot }, { timeout: clientConfig.aiTimeoutMs }));
    },
    async save(bookId: string, workspace: BrainstormWorkspace) {
        return mapBrainstormResponse(await apiClient.put<BrainstormDto>(`/books/${bookId}/brainstorm`, toBrainstormPayload(workspace)));
    },
};
