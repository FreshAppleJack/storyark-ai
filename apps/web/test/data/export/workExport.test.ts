import { beforeEach, describe, expect, it, vi } from 'vitest';
import sampleExport from '../../../docs/samples/storyark-work-export-v1.json?raw';
import {
    buildStoryArkWorkExport,
    summarizeStoryArkWorkExport,
    WorkExportBuildError,
} from '../../../data/export/exchange/build';
import {
    parseStoryArkWorkExport,
    serializeStoryArkWorkExport,
} from '../../../data/export/exchange';
import { saveWorkExport, workExportFilename } from '../../../data/export/workFile';
import type { LocalWorkExportSnapshot } from '../../../data/local/exportRepository';

const native = vi.hoisted(() => ({
    isTauri: vi.fn(),
    save: vi.fn(),
    writeFile: vi.fn(),
    readFile: vi.fn(),
    rename: vi.fn(),
    remove: vi.fn(),
    saveAs: vi.fn(),
}));

vi.mock('@tauri-apps/api/core', () => ({ isTauri: native.isTauri }));
vi.mock('@tauri-apps/plugin-dialog', () => ({ save: native.save }));
vi.mock('@tauri-apps/plugin-fs', () => ({
    writeFile: native.writeFile,
    readFile: native.readFile,
    rename: native.rename,
    remove: native.remove,
}));
vi.mock('file-saver', () => ({ saveAs: native.saveAs }));

const bookId = '00000000-0000-4000-8000-000000000010';
const volumeId = '00000000-0000-4000-8000-000000000020';
const chapterId = '00000000-0000-4000-8000-000000000030';
const characterId = '00000000-0000-4000-8000-000000000040';
const nodeA = '00000000-0000-4000-8000-000000000050';
const nodeB = '00000000-0000-4000-8000-000000000051';
const edgeId = '00000000-0000-4000-8000-000000000052';

function exportSnapshot(): LocalWorkExportSnapshot {
    return {
        databaseVersion: 5,
        book: {
            id: bookId,
            title: 'Book',
            author: 'Author',
            status: 'serializing',
            position: 0,
            isReadOnly: false,
            databaseVersion: 2,
            createdAt: 1_700_000_000_000,
            updatedAt: 1_700_000_000_100,
            coverColor: '#123456',
        },
        volumes: [{
            id: volumeId,
            bookId,
            title: 'Volume',
            status: 'draft',
            position: 0,
            isReadOnly: false,
            databaseVersion: 1,
            createdAt: 1_700_000_000_000,
            updatedAt: 1_700_000_000_000,
        }],
        chapters: [{
            id: chapterId,
            bookId,
            volumeId,
            title: 'Chapter',
            status: 'draft',
            position: 0,
            isReadOnly: false,
            databaseVersion: 3,
            createdAt: 1_700_000_000_000,
            updatedAt: 1_700_000_000_200,
            wordCount: 1,
            body: {
                format: 'tiptap-json',
                version: 1,
                content: JSON.stringify({
                    type: 'doc',
                    content: [{
                        type: 'paragraph',
                        content: [{ type: 'text', text: 'Hello', marks: [{ type: 'bold' }] }],
                    }],
                }),
                originalContent: null,
                originalFormat: null,
            },
            foreshadowings: [{
                id: 'legacy-note',
                excerpt: 'Hello',
                note: 'Return later',
                createdAt: 1_700_000_000_000,
                updatedAt: 1_700_000_000_100,
                isRecovered: false,
                unknownField: { preserved: true },
            }],
        }],
        characters: [{
            id: characterId,
            bookId,
            name: 'Author',
            aliases: ['A'],
            role: 'protagonist',
            description: 'A character.',
            color: '#123456',
            tags: ['main'],
            avatar: null,
            handleConfig: null,
            isArchived: false,
            position: 0,
            databaseVersion: 1,
            createdAt: 1_700_000_000_000,
            updatedAt: 1_700_000_000_000,
        }],
        graph: {
            bookId,
            databaseVersion: 1,
            createdAt: 1_700_000_000_000,
            updatedAt: 1_700_000_000_000,
            nodes: [
                { nodeKey: nodeA, characterId, positionX: 0, positionY: 0, handleConfig: null, createdAt: 1, updatedAt: 1 },
                { nodeKey: nodeB, characterId, positionX: 1, positionY: 0, handleConfig: null, createdAt: 1, updatedAt: 1 },
            ],
            edges: [{
                id: edgeId,
                sourceNodeKey: nodeA,
                targetNodeKey: nodeB,
                sourceHandle: 'right-source',
                targetHandle: 'left-target',
                label: 'knows',
                createdAt: 1,
                updatedAt: 1,
            }],
        },
        planning: {
            bookId,
            databaseVersion: 1,
            storySummary: 'Summary',
            storyBackground: 'Background',
            chapterSummaries: [{ chapterId, summary: 'Summary', sourceChapterVersion: 3, updatedAt: 1_700_000_000_100 }],
            plotSettings: [{ id: 'plot-1', title: 'Plot', details: 'Details', chapterIds: [chapterId], createdAt: 1, updatedAt: 2 }],
        },
        brainstormWorkspace: {
            bookId,
            databaseVersion: 1,
            createdAt: 1_700_000_000_000,
            updatedAt: 1_700_000_000_100,
            selectedChapterIds: [chapterId],
            contextSnapshot: { bookId, source: 'saved' },
            generatedOptions: [{
                id: 'option-1',
                title: 'Option',
                conflict: 'Conflict',
                motivation: 'Motivation',
                consequences: 'Consequences',
                development: 'Development',
            }],
            selectedOptionId: 'option-1',
            finalContent: 'Final content',
            generationMetadata: {
                configId: '00000000-0000-4000-8000-000000000060',
                modelId: 'model-1',
                generatedAt: 1_700_000_000_100,
                promptVersion: 'brainstorm-v1',
                source: {
                    bookId,
                    workspaceDatabaseVersion: 1,
                    planningDatabaseVersion: 1,
                    graphDatabaseVersion: 1,
                    selectedChapters: [{ chapterId, databaseVersion: 3 }],
                },
            },
        },
    };
}

describe('whole-work export construction', () => {
    it('builds a validated export from the one-book snapshot and preserves rich fields', () => {
        const value = buildStoryArkWorkExport(exportSnapshot(), {
            exportId: '00000000-0000-4000-8000-000000000001',
            exportedAt: '2026-09-17T00:00:00.000Z',
            producer: { appVersion: 'test', platform: 'windows' },
        });

        expect(validateExport(value)).toBe(true);
        expect(value.foreshadowings[0]).toMatchObject({ id: 'legacy-note', chapterId, unknownField: { preserved: true } });
        expect(value.chapters[0].body).toMatchObject({ format: 'tiptap-json', content: { type: 'doc' } });
        expect(value.brainstormWorkspaces[0].generationMetadata?.source.selectedChapters[0]).toEqual({ chapterId, databaseVersion: 3 });
        expect(summarizeStoryArkWorkExport(value).counts).toMatchObject({
            volumes: 1,
            chapters: 1,
            characters: 1,
            graphNodes: 2,
            graphEdges: 1,
            foreshadowings: 1,
            brainstormOptions: 1,
        });
    });

    it('keeps a legacy body and its original source instead of converting to empty text', () => {
        const snapshot = exportSnapshot();
        snapshot.chapters[0].body = {
            format: 'legacy-html',
            version: 0,
            content: '<p>Legacy</p>',
            originalContent: '<p>Legacy</p>',
            originalFormat: 'legacy-html',
        };

        const value = buildStoryArkWorkExport(snapshot, {
            exportId: '00000000-0000-4000-8000-000000000001',
            exportedAt: '2026-09-17T00:00:00.000Z',
            producer: { appVersion: 'test', platform: 'windows' },
        });
        expect(value.chapters[0].body).toEqual({
            format: 'legacy-html',
            version: 0,
            content: '<p>Legacy</p>',
            contentState: 'pending-migration',
            originalContent: '<p>Legacy</p>',
            originalFormat: 'legacy-html',
        });
    });

    it('stops before serialization when a current chapter body is malformed', () => {
        const snapshot = exportSnapshot();
        snapshot.chapters[0].body.content = '{not-json';
        expect(() => buildStoryArkWorkExport(snapshot)).toThrow(WorkExportBuildError);
    });

    it('does not allow a persisted brainstorm snapshot to carry credentials', () => {
        const snapshot = exportSnapshot();
        snapshot.brainstormWorkspace!.contextSnapshot = { bookId, apiKey: 'must-not-export' };
        const value = buildStoryArkWorkExport(snapshot, {
            exportId: '00000000-0000-4000-8000-000000000001',
            exportedAt: '2026-09-17T00:00:00.000Z',
            producer: { appVersion: 'test', platform: 'windows' },
        });
        expect(() => serializeStoryArkWorkExport(value)).toThrow('Secrets and credential references');
    });
});

describe('whole-work export file boundary', () => {
    beforeEach(() => {
        vi.resetAllMocks();
        native.isTauri.mockReturnValue(true);
        native.writeFile.mockResolvedValue(undefined);
        native.rename.mockResolvedValue(undefined);
        native.remove.mockResolvedValue(undefined);
    });

    it('writes a verified temporary file and atomically renames it to the selected destination', async () => {
        native.save.mockResolvedValue('C:/selected/Book.storyark.json');
        native.readFile.mockResolvedValue(new TextEncoder().encode(sampleExport));

        const result = await saveWorkExport(sampleExport, workExportFilename('Book'));

        expect(result.status).toBe('saved');
        expect(native.writeFile).toHaveBeenCalledTimes(1);
        const temporaryPath = native.writeFile.mock.calls[0][0] as string;
        expect(temporaryPath).toMatch(/^C:\/selected\/Book\.storyark\.json\.storyark-[0-9a-f-]+\.tmp$/);
        expect(native.writeFile.mock.calls[0][1]).toEqual(new TextEncoder().encode(sampleExport));
        expect(native.rename).toHaveBeenCalledWith(temporaryPath, 'C:/selected/Book.storyark.json');
        expect(native.remove).not.toHaveBeenCalled();
    });

    it('treats Save As cancellation as a normal result without writing', async () => {
        native.save.mockResolvedValue(null);

        await expect(saveWorkExport(sampleExport, 'Book.storyark.json')).resolves.toEqual({ status: 'cancelled' });
        expect(native.writeFile).not.toHaveBeenCalled();
        expect(native.rename).not.toHaveBeenCalled();
    });

    it('removes the temporary file when read-back verification fails', async () => {
        native.save.mockResolvedValue('C:/selected/Book.storyark.json');
        native.readFile.mockResolvedValue(new Uint8Array([1, 2, 3]));

        await expect(saveWorkExport(sampleExport, 'Book.storyark.json')).rejects.toThrow('size could not be verified');
        const temporaryPath = native.writeFile.mock.calls[0][0] as string;
        expect(native.remove).toHaveBeenCalledWith(temporaryPath);
        expect(native.rename).not.toHaveBeenCalled();
    });

    it('keeps the browser fallback separate from the native file path boundary', async () => {
        native.isTauri.mockReturnValue(false);

        await saveWorkExport(sampleExport, 'Book.storyark.json');

        expect(native.saveAs).toHaveBeenCalledTimes(1);
        expect(native.save).not.toHaveBeenCalled();
        expect(native.writeFile).not.toHaveBeenCalled();
    });
});

function validateExport(value: unknown): boolean {
    const result = parseStoryArkWorkExport(serializeStoryArkWorkExport(value as never));
    return result.valid;
}
