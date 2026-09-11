import { afterEach, expect, it, vi } from 'vitest';
import apiClient from '../../services/api';
import { workspaceApi } from '../../data/workspaceApi';
import { chaptersApi } from '../../data/chaptersApi';
import { booksApi } from '../../data/booksApi';
import { aiApi } from '../../data/aiApi';

afterEach(() => vi.restoreAllMocks());

it('propagates transport failures without returning empty data or successful writes', async () => {
    const failure = new Error('network down');
    vi.spyOn(apiClient, 'get').mockRejectedValue(failure);
    vi.spyOn(apiClient, 'put').mockRejectedValue(failure);
    await expect(workspaceApi.getPlanning('1')).rejects.toBe(failure);
    await expect(workspaceApi.getRelations('1')).rejects.toBe(failure);
    await expect(chaptersApi.updateChapter('1', '2', '3', {
        title: 'Chapter', content: 'Body', wordCount: 1, status: 'draft', isEditable: true, foreshadowings: [],
    })).rejects.toBe(failure);
});

it('rejects a create response without an ID instead of reporting a fake ID', async () => {
    vi.spyOn(apiClient, 'post').mockResolvedValue('Book created successfully!');
    await expect(booksApi.create('1', 'Book', 'bg-blue-600')).rejects.toThrow('valid entity ID');
});

it('rejects malformed AI content and invalid numeric write IDs', async () => {
    const post = vi.spyOn(apiClient, 'post').mockResolvedValue({ result: { content: 'wrong shape' } });
    await expect(aiApi.continueWriting({ content: 'Draft', outputLengthChars: 300 })).rejects.toThrow('AI continuation');
    post.mockClear();
    await expect(chaptersApi.createChapter('1', 'invalid', 'Chapter')).rejects.toThrow('entity ID');
    expect(post).not.toHaveBeenCalled();
});
