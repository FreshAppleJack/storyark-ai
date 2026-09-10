import apiClient from '../services/api';
import type { Character } from '../types';
import type { CharacterDto } from './dto';
import { mapCharacter, toCharacterPayload } from './mappers';

export const charactersApi = {
    async create(bookId: string, data: Partial<Character>) {
        return mapCharacter(await apiClient.post<unknown, CharacterDto>(`/books/${bookId}/characters`, toCharacterPayload(data)), bookId);
    },
    update: (bookId: string, charId: string, data: Partial<Character>) => apiClient.put<unknown, void>(`/books/${bookId}/characters/${charId}`, data),
    remove: (bookId: string, charId: string) => apiClient.delete<unknown, void>(`/books/${bookId}/characters/${charId}`),
    reorder: (bookId: string, ids: string[]) => apiClient.post<unknown, void>(`/books/${bookId}/characters/reorder`, ids.map(Number)),
};
