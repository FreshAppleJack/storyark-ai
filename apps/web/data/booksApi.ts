import apiClient from '../services/api';
import type { Book } from '../types';
import type { BookDto, EntityDto, ApiId } from './dto';
import { mapBooks, mapId, toBookPayload } from './mappers';

export const booksApi = {
    async list(userId: ApiId, author: string) {
        return mapBooks(await apiClient.get<unknown, BookDto[]>(`/books?userId=${userId}`), author, Date.now());
    },
    async create(userId: ApiId, title: string, coverColor: string) {
        const data = await apiClient.post<unknown, EntityDto>('/books', { userId, title, coverColor, status: 1 });
        return mapId(data.id);
    },
    update: (book: Book) => apiClient.put<unknown, void>(`/books/${book.id}`, toBookPayload(book)),
    remove: (bookId: string) => apiClient.delete<unknown, void>(`/books/${bookId}`),
};
