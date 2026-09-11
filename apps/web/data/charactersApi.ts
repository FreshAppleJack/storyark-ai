import apiClient from '../services/api';
import type { Character } from '../types';
import type { CharacterDto } from './dto';
import { mapCharacter, toCharacterPayload, toServerId } from './mappers';

export const charactersApi = {
    async create(bookId: string, data: Partial<Character>) {
        return mapCharacter(await apiClient.post<CharacterDto>(`/books/${bookId}/characters`, toCharacterPayload(data)), bookId);
    },
    update: (bookId: string, charId: string, data: Partial<Character>) => apiClient.put<void>(`/books/${bookId}/characters/${charId}`, data),
    remove: (bookId: string, charId: string) => apiClient.delete<void>(`/books/${bookId}/characters/${charId}`),
    reorder: async (bookId: string, ids: string[]) => apiClient.post<void>(`/books/${bookId}/characters/reorder`, ids.map(toServerId)),
};
