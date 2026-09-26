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
    invoke: vi.fn(),
    save: vi.fn(),
    saveAs: vi.fn(),
}));

vi.mock('@tauri-apps/api/core', () => ({ isTauri: native.isTauri, invoke: native.invoke }));
vi.mock('@tauri-apps/plugin-dialog', () => ({ save: native.save }));
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
                promptVersion: 'brainstorm-v2',
                includesPlanning: true,
                retrieval: {
                    retrievalVersion: 'retrieval-v2',
                    requestedAt: 1_700_000_000_050,
                    sourceVersions: [{ sourceId: `${bookId}:character:${characterId}`, chapterId: null, sourceVersion: 2, indexVersion: 3 }],
                    includedHitIds: ['hit-1'],
                    indexVersion: 3,
                    embeddingFingerprint: 'local-e5-fingerprint',
                },
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
        expect(value.brainstormWorkspaces[0].generationMetadata).toMatchObject({
            includesPlanning: true,
            retrieval: {
                retrievalVersion: 'retrieval-v2',
                sourceVersions: [{ sourceVersion: 2, indexVersion: 3 }],
                includedHitIds: ['hit-1'],
                indexVersion: 3,
                embeddingFingerprint: 'local-e5-fingerprint',
            },
        });
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

    it('preserves summary provenance, source snapshot, and retrieval trace through JSON round-trip', () => {
        const snapshot = exportSnapshot();
        const fingerprint = '0123456789abcdef';
        snapshot.planning.chapterSummaries[0] = {
            chapterId,
            summary: 'Adopted summary',
            sourceChapterVersion: 3,
            updatedAt: 1_700_000_000_100,
            provenance: 'ai-adopted',
            sourceSnapshot: {
                chapterId,
                chapterDatabaseVersion: 3,
                chapterTitle: 'Chapter',
                contentFormat: 'tiptap-json',
                contentVersion: 1,
                fingerprintAlgorithm: 'fnv1a64-utf16-v1',
                bodyFingerprint: fingerprint,
                structuredFingerprint: 'fedcba9876543210',
                blockFingerprints: ['fedcba9876543210', 'fedcba9876543210'],
                mentionedCharacterIds: [characterId],
                foreshadowingIds: ['legacy-note'],
                foreshadowingNoteFingerprints: [{ noteId: 'legacy-note', fingerprint: 'fedcba9876543210' }],
                capturedAt: 1_700_000_000_000,
            },
            generationMetadata: {
                providerId: 'provider-a',
                configId: '00000000-0000-4000-8000-000000000060',
                protocol: 'openai-compatible',
                modelId: 'model-a',
                generatedAt: 1_700_000_000_100,
                promptVersion: 'chapter-summary-v1',
                source: {
                    bookId,
                    chapterId,
                    chapterDatabaseVersion: 3,
                    sourceBodyFingerprint: fingerprint,
                    planningDatabaseVersion: 1,
                    allowedSources: [{
                        sourceId: `${bookId}:character:${characterId}`,
                        entityId: characterId,
                        sourceKind: 'character',
                        sourceVersion: 1,
                        indexVersion: null,
                    }],
                    retrievalTrace: {
                        searchId: 'search-1',
                        retrievalVersion: 'p1-r1-v1',
                        task: 'chapter_summary',
                        requestedAt: 1_700_000_000_050,
                        scope: {
                            bookId,
                            allowedSourceKinds: ['character'],
                            allowedChapterIds: [chapterId],
                            beforeChapterOrder: null,
                            beforeAnchor: null,
                            includeFuturePlan: false,
                            includeGenerated: false,
                            includeStale: false,
                            timeRange: null,
                        },
                        excludedHitIds: [],
                        sourceVersions: [{ sourceId: `${bookId}:character:${characterId}`, chapterId: null, sourceVersion: 1, indexVersion: 1 }],
                        includedHitIds: ['hit-1'],
                        omittedHitIds: [],
                        budget: { charBudget: 6000, tokenBudget: 1500 },
                        indexVersion: 1,
                        embeddingFingerprint: 'local-e5-fingerprint',
                    },
                    includesFuturePlan: false,
                },
            },
        };

        const exported = buildStoryArkWorkExport(snapshot, {
            exportId: '00000000-0000-4000-8000-000000000001',
            exportedAt: '2026-09-17T00:00:00.000Z',
            producer: { appVersion: 'test', platform: 'windows' },
        });
        expect(validateExport(exported)).toBe(true);
        const parsed = parseStoryArkWorkExport(serializeStoryArkWorkExport(exported));
        expect(parsed.valid).toBe(true);
        if (!parsed.valid) throw new Error('The generated work export did not round-trip.');
        expect(parsed.value.planning.chapterSummaries[0]).toMatchObject({
            provenance: 'ai-adopted',
            sourceSnapshot: {
                bodyFingerprint: fingerprint,
                chapterDatabaseVersion: 3,
                blockFingerprints: ['fedcba9876543210', 'fedcba9876543210'],
            },
            generationMetadata: {
                source: {
                    allowedSources: [{ sourceVersion: 1 }],
                    retrievalTrace: { includedHitIds: ['hit-1'] },
                    includesFuturePlan: false,
                },
            },
        });

        const remappedToNewDatabase = structuredClone(exported);
        remappedToNewDatabase.chapters[0].databaseVersion = 1;
        remappedToNewDatabase.planning.chapterSummaries[0].sourceChapterVersion = 1;
        remappedToNewDatabase.brainstormWorkspaces[0].generationMetadata!.source.selectedChapters[0].databaseVersion = 1;
        expect(validateExport(remappedToNewDatabase)).toBe(true);

        exported.planning.chapterSummaries[0].generationMetadata!.source.includesFuturePlan = true;
        expect(parseStoryArkWorkExport(JSON.stringify(exported)).valid).toBe(false);
    });

    it('exports pending content with unknown marks and attributes for safe preservation', () => {
        const snapshot = exportSnapshot();
        snapshot.chapters[0].body.contentState = 'pending-migration';
        snapshot.chapters[0].body.content = JSON.stringify({
            type: 'doc',
            content: [{
                type: 'paragraph',
                content: [{
                    type: 'text',
                    text: '未来格式',
                    marks: [{ type: 'futureGlow', attrs: { tone: '琥珀' } }],
                }, {
                    type: 'mention',
                    attrs: { id: characterId, label: 'Author', futureAlias: 'A' },
                }],
            }],
        });

        const value = buildStoryArkWorkExport(snapshot, {
            exportId: '00000000-0000-4000-8000-000000000001',
            exportedAt: '2026-09-17T00:00:00.000Z',
            producer: { appVersion: 'test', platform: 'windows' },
        });
        expect(validateExport(value)).toBe(true);
        expect(value.chapters[0].body).toMatchObject({ contentState: 'pending-migration' });
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
        native.invoke.mockResolvedValue({ byteLength: new TextEncoder().encode(sampleExport).byteLength });
    });

    it('delegates verified replacement to the native writer for the selected destination', async () => {
        native.save.mockResolvedValue('C:/selected/Book.storyark.json');

        const result = await saveWorkExport(sampleExport, workExportFilename('Book'));

        expect(result.status).toBe('saved');
        expect(native.invoke).toHaveBeenCalledWith('local_save_work_export', {
            input: {
                path: 'C:/selected/Book.storyark.json',
                content: sampleExport,
            },
        });
    });

    it('treats Save As cancellation as a normal result without writing', async () => {
        native.save.mockResolvedValue(null);

        await expect(saveWorkExport(sampleExport, 'Book.storyark.json')).resolves.toEqual({ status: 'cancelled' });
        expect(native.invoke).not.toHaveBeenCalled();
    });

    it('surfaces a safe error when the native writer rejects the destination', async () => {
        native.save.mockResolvedValue('C:/selected/Book.storyark.json');
        native.invoke.mockRejectedValue({ code: 'path-forbidden' });

        await expect(saveWorkExport(sampleExport, 'Book.storyark.json')).rejects.toThrow('selected export destination could not be written');
    });

    it('keeps the browser fallback separate from the native file path boundary', async () => {
        native.isTauri.mockReturnValue(false);

        await saveWorkExport(sampleExport, 'Book.storyark.json');

        expect(native.saveAs).toHaveBeenCalledTimes(1);
        expect(native.save).not.toHaveBeenCalled();
        expect(native.invoke).not.toHaveBeenCalled();
    });
});

function validateExport(value: unknown): boolean {
    const result = parseStoryArkWorkExport(serializeStoryArkWorkExport(value as never));
    return result.valid;
}
