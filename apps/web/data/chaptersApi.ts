import apiClient from '../services/api';
import type { EntityDto } from './dto';
import { mapChapter, mapVolume, toChapterPayload, type ChapterWrite } from './mappers';

// No private queue here: Context must serialize save, lock and delete together.
export const chaptersApi = {
    updateChapter: (bookId: string, volumeId: string, chapterId: string, chapter: ChapterWrite) =>
        apiClient.put<unknown, void>(`/story/chapters/${chapterId}?bookId=${bookId}`, toChapterPayload(volumeId, chapter)),
    updateVolume: (bookId: string, volumeId: string, title: string) => apiClient.put<unknown, void>(`/story/volumes/${volumeId}`, {
        id: Number(volumeId), title, bookId: Number(bookId), orderIndex: 0,
    }),
    deleteVolume: (bookId: string, volumeId: string) => apiClient.delete<unknown, void>(`/story/volumes/${volumeId}?bookId=${bookId}`),
    deleteChapter: (bookId: string, chapterId: string) => apiClient.delete<unknown, void>(`/story/chapters/${chapterId}?bookId=${bookId}`),
    async createVolume(bookId: string, title: string) {
        return mapVolume(await apiClient.post<unknown, EntityDto>('/story/volumes', { bookId: Number(bookId), title, orderIndex: 0 }));
    },
    async createChapter(bookId: string, volumeId: string, title: string) {
        const data = await apiClient.post<unknown, EntityDto>(`/story/chapters?bookId=${bookId}`, {
            volumeId: Number(volumeId), title, content: '', status: 'draft', isEditable: true, foreshadowings: '[]',
        });
        return mapChapter({ id: data.id, title: data.title });
    },
    reorderVolumes: (bookId: string, ids: string[]) => apiClient.post<unknown, void>(`/story/volumes/reorder?bookId=${bookId}`, ids.map(Number)),
    reorderChapters: (bookId: string, ids: string[]) => apiClient.post<unknown, void>(`/story/chapters/reorder?bookId=${bookId}`, ids.map(Number)),
};
