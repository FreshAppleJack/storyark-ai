import apiClient from '../services/api';
import type { EntityDto } from './dto';
import { mapChapter, mapVolume, toChapterPayload, toServerId, type ChapterWrite } from './mappers';

// No private queue here: Context must serialize save, lock and delete together.
export const chaptersApi = {
    updateChapter: async (bookId: string, volumeId: string, chapterId: string, chapter: ChapterWrite) =>
        apiClient.put<void>(`/story/chapters/${chapterId}?bookId=${bookId}`, toChapterPayload(volumeId, chapter)),
    updateVolume: async (bookId: string, volumeId: string, title: string) => apiClient.put<void>(`/story/volumes/${volumeId}`, {
        id: toServerId(volumeId), title, bookId: toServerId(bookId), orderIndex: 0,
    }),
    deleteVolume: (bookId: string, volumeId: string) => apiClient.delete<void>(`/story/volumes/${volumeId}?bookId=${bookId}`),
    deleteChapter: (bookId: string, chapterId: string) => apiClient.delete<void>(`/story/chapters/${chapterId}?bookId=${bookId}`),
    async createVolume(bookId: string, title: string) {
        return mapVolume(await apiClient.post<EntityDto>('/story/volumes', { bookId: toServerId(bookId), title, orderIndex: 0 }));
    },
    async createChapter(bookId: string, volumeId: string, title: string) {
        const data = await apiClient.post<EntityDto>(`/story/chapters?bookId=${bookId}`, {
            volumeId: toServerId(volumeId), title, content: '', status: 'draft', isEditable: true, foreshadowings: '[]',
        });
        return mapChapter({ id: data.id, title: data.title });
    },
    reorderVolumes: async (bookId: string, ids: string[]) => apiClient.post<void>(`/story/volumes/reorder?bookId=${bookId}`, ids.map(toServerId)),
    reorderChapters: async (bookId: string, ids: string[]) => apiClient.post<void>(`/story/chapters/reorder?bookId=${bookId}`, ids.map(toServerId)),
};
