import type { Node, Edge } from '@xyflow/react';
import apiClient from '../services/api';
import type { StoryPlanning } from '../types';
import type { GraphData, RelationDto } from './dto';
import { mapRelations, toGraphPayload, toPlanningPayload } from './mappers';
import { normalizeStoryPlanning } from '../domain/storyPlanning';

export const workspaceApi = {
    async getRelations(bookId: string) {
        return mapRelations(await apiClient.get<unknown, RelationDto[]>(`/books/${bookId}/relations`));
    },
    getGraph: (bookId: string) => apiClient.get<unknown, GraphData>(`/books/${bookId}/graph`),
    saveGraph: (bookId: string, nodes: Node[], edges: Edge[]) => apiClient.post<unknown, void>(`/books/${bookId}/graph`, toGraphPayload(nodes, edges)),
    async getPlanning(bookId: string) {
        return normalizeStoryPlanning(await apiClient.get<unknown, unknown>(`/books/${bookId}/planning`), Date.now());
    },
    async savePlanning(bookId: string, planning: StoryPlanning) {
        return normalizeStoryPlanning(await apiClient.put<unknown, unknown>(`/books/${bookId}/planning`, toPlanningPayload(planning)), Date.now());
    },
};
