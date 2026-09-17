import { StrictMode } from 'react';
import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useWorkExport } from '../../../features/editor/export/useWorkExport';

const dependencies = vi.hoisted(() => ({
    flushWorkDrafts: vi.fn(),
    readSnapshot: vi.fn(),
    buildStoryArkWorkExport: vi.fn(),
    serializeStoryArkWorkExport: vi.fn(),
    summarizeStoryArkWorkExport: vi.fn(),
}));

vi.mock('../../../services/workDraftFlushRegistry', () => ({
    flushWorkDrafts: dependencies.flushWorkDrafts,
}));
vi.mock('../../../data/local/exportRepository', () => ({
    localExportRepository: { readSnapshot: dependencies.readSnapshot },
}));
vi.mock('../../../data/export/exchange/build', () => ({
    buildStoryArkWorkExport: dependencies.buildStoryArkWorkExport,
    summarizeStoryArkWorkExport: dependencies.summarizeStoryArkWorkExport,
}));
vi.mock('../../../data/export/exchange', () => ({
    serializeStoryArkWorkExport: dependencies.serializeStoryArkWorkExport,
}));
vi.mock('../../../data/export/workFile', () => ({
    saveWorkExport: vi.fn(),
    workExportFilename: vi.fn(() => 'Book.storyark.json'),
}));

describe('useWorkExport', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        dependencies.flushWorkDrafts.mockResolvedValue(true);
        dependencies.readSnapshot.mockResolvedValue({});
        dependencies.buildStoryArkWorkExport.mockReturnValue({ book: { title: 'Book' } });
        dependencies.serializeStoryArkWorkExport.mockReturnValue('{"schemaVersion":1}');
        dependencies.summarizeStoryArkWorkExport.mockReturnValue({
            bookTitle: 'Book',
            schemaVersion: 1,
            supportedAssetCount: 0,
            counts: {},
            exclusions: [],
        });
    });

    it('keeps the prepared preview available under React StrictMode', async () => {
        const onError = vi.fn();
        const { result } = renderHook(() => useWorkExport({
            bookId: 'book-1',
            enabled: true,
            currentDraftFlush: vi.fn().mockResolvedValue(true),
            onError,
            onSaved: vi.fn(),
        }), { wrapper: StrictMode });

        await act(async () => { await result.current.prepare(); });

        await waitFor(() => expect(result.current.preview).not.toBeNull());
        expect(result.current.preview?.value).toEqual({ book: { title: 'Book' } });
        expect(onError).not.toHaveBeenCalled();
    });
});
