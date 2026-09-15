import { describe, expect, it } from 'vitest';
import sampleExport from '../../../docs/samples/storyark-work-export-v1.json?raw';
import {
    isStoryArkWorkExport,
    parseStoryArkWorkExport,
    serializeStoryArkWorkExport,
    validateStoryArkWorkExport,
    type StoryArkWorkExport,
} from '../../../data/export/exchange';

const bookId = '00000000-0000-4000-8000-000000000010';
const volumeId = '00000000-0000-4000-8000-000000000020';
const chapterId = '00000000-0000-4000-8000-000000000030';
const characterId = '00000000-0000-4000-8000-000000000040';
const noteId = '00000000-0000-4000-8000-000000000050';
const nodeA = '00000000-0000-4000-8000-000000000060';
const nodeB = '00000000-0000-4000-8000-000000000061';
const edgeId = '00000000-0000-4000-8000-000000000062';

function metadata(databaseVersion = 1) {
    return { databaseVersion, createdAt: 1_700_000_000_000, updatedAt: 1_700_000_001_000 };
}

function validExport(): StoryArkWorkExport {
    return {
        schemaVersion: 1,
        exportId: '00000000-0000-4000-8000-000000000001',
        exportedAt: '2026-09-15T00:00:00.000Z',
        producer: { appVersion: '0.1.0', platform: 'windows' },
        snapshot: { databaseVersion: 5, contentVersion: 1 },
        book: {
            ...metadata(3), id: bookId, title: 'Book', author: 'Author', status: 'serializing',
            position: 0, isReadOnly: false,
        },
        volumes: [{
            ...metadata(2), id: volumeId, bookId, title: 'Volume', status: 'draft',
            position: 0, isReadOnly: false,
        }],
        chapters: [{
            ...metadata(4), id: chapterId, bookId, volumeId, title: 'Chapter', status: 'draft',
            position: 0, isReadOnly: false, wordCount: 2,
            body: {
                format: 'tiptap-json', version: 1, contentState: 'editable',
                content: {
                    type: 'doc',
                    content: [{ type: 'paragraph', content: [
                        { type: 'text', text: 'Hello', marks: [{ type: 'bold' }, { type: 'foreshadowing', attrs: { id: noteId } }] },
                        { type: 'mention', attrs: { id: characterId, label: 'Author' } },
                    ] }],
                },
            },
            foreshadowingIds: [noteId],
        }],
        characters: [{
            ...metadata(2), id: characterId, bookId, name: 'Author', aliases: ['A'], role: 'protagonist',
            description: 'A character.', color: '#123456', tags: ['main'], avatar: null,
            handleConfig: null, isArchived: false, position: 0,
        }],
        graphs: [{
            ...metadata(), bookId,
            nodes: [
                { nodeKey: nodeA, characterId, positionX: 0, positionY: 0, handleConfig: null },
                { nodeKey: nodeB, characterId, positionX: 1, positionY: 0, handleConfig: null },
            ],
            edges: [{
                id: edgeId, sourceNodeKey: nodeA, targetNodeKey: nodeB,
                sourceHandle: 'right-source', targetHandle: 'left-target', label: 'knows',
            }],
        }],
        foreshadowings: [{
            ...metadata(), id: noteId, chapterId, excerpt: 'Hello', note: 'Return later',
        }],
        planning: {
            bookId, databaseVersion: 1, storySummary: 'Summary', storyBackground: 'Background',
            chapterSummaries: [{ chapterId, summary: 'Summary', sourceChapterVersion: 4, updatedAt: 1_700_000_001_000 }],
            plotSettings: [{ id: 'plot-1', title: 'Plot', details: 'Details', chapterIds: [chapterId], createdAt: 1, updatedAt: 2 }],
        },
        brainstormWorkspaces: [{
            ...metadata(), bookId, selectedChapterIds: [chapterId], contextSnapshot: { bookId, source: 'saved' },
            generatedOptions: [{ id: 'option-1', title: 'Option', conflict: 'Conflict', motivation: 'Motivation', consequences: 'Consequences', development: 'Development' }],
            selectedOptionId: 'option-1', finalContent: 'Final content',
        }],
        assets: [],
        extensions: { preserved: { oldField: true } },
    };
}

function cloneExport(): StoryArkWorkExport {
    return structuredClone(validExport());
}

function errorCodes(value: unknown): string[] {
    const result = validateStoryArkWorkExport(value);
    return result.valid ? [] : result.errors.map(error => error.code);
}

describe('StoryArk work exchange contract', () => {
    it('accepts a complete v1 work and round-trips it without dropping rich content', () => {
        const value = validExport();
        const result = validateStoryArkWorkExport(value);

        expect(result.valid).toBe(true);
        expect(isStoryArkWorkExport(value)).toBe(true);
        expect(serializeStoryArkWorkExport(value)).toContain('"schemaVersion": 1');
        expect(parseStoryArkWorkExport(serializeStoryArkWorkExport(value))).toMatchObject({ valid: true });
        expect(value.chapters[0].body).toMatchObject({ format: 'tiptap-json', version: 1 });
        expect(value.chapters[0].body.format === 'tiptap-json' && value.chapters[0].body.content.content?.[0].content?.[0]).toMatchObject({
            marks: [{ type: 'bold' }, { type: 'foreshadowing', attrs: { id: noteId } }],
        });
    });

    it('keeps the checked-in preservation sample valid', () => {
        const result = parseStoryArkWorkExport(sampleExport);

        expect(result.valid).toBe(true);
        if (result.valid) {
            expect(result.value.chapters[0].body.format).toBe('tiptap-json');
            expect(result.value.graphs[0].nodes.map(node => node.characterId)).toEqual([characterId, characterId]);
        }
    });

    it('keeps unknown Tiptap content only when it is explicitly marked for migration', () => {
        const value = cloneExport();
        const body = value.chapters[0].body;
        if (body.format === 'tiptap-json') {
            const paragraph = body.content.content?.[0];
            if (paragraph) paragraph.attrs = { futureAttribute: { keep: true } };
            expect(errorCodes(value)).toContain('UNSAFE_CONTENT');
            body.contentState = 'pending-migration';
            expect(validateStoryArkWorkExport(value).valid).toBe(true);
        }
    });

    it('requires legacy content to preserve its original source and format', () => {
        const value = cloneExport();
        value.chapters[0].body = {
            format: 'legacy-html', version: 0, content: '<p>Legacy</p>',
            contentState: 'read-only', originalContent: '<p>Legacy</p>', originalFormat: 'legacy-html',
        };
        expect(validateStoryArkWorkExport(value).valid).toBe(true);
        const damaged = cloneExport();
        damaged.chapters[0].body = { format: 'legacy-html', version: 0, content: '', contentState: 'read-only' } as never;
        expect(errorCodes(damaged)).toEqual(expect.arrayContaining(['MISSING_FIELD']));
    });

    it('rejects cross-book references, dangling node endpoints and missing foreshadowing notes', () => {
        const volumeMismatch = cloneExport();
        volumeMismatch.volumes[0].bookId = '00000000-0000-4000-8000-000000000099';
        expect(errorCodes(volumeMismatch)).toContain('REFERENCE_MISMATCH');

        const danglingEdge = cloneExport();
        danglingEdge.graphs[0].edges[0].targetNodeKey = '00000000-0000-4000-8000-000000000099';
        expect(errorCodes(danglingEdge)).toContain('REFERENCE_NOT_FOUND');

        const missingNote = cloneExport();
        missingNote.chapters[0].body = {
            ...missingNote.chapters[0].body,
            content: {
                type: 'doc',
                content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Hello', marks: [{ type: 'foreshadowing', attrs: { id: 'missing-note' } }] }] }],
            },
        };
        expect(errorCodes(missingNote)).toContain('REFERENCE_NOT_FOUND');
    });

    it('rejects unsafe top-level state, non-deterministic ordering and invalid assets', () => {
        const forbidden = cloneExport() as unknown as Record<string, unknown>;
        forbidden.preferences = { darkMode: true };
        expect(errorCodes(forbidden)).toContain('FORBIDDEN_FIELD');

        const unsorted = cloneExport();
        unsorted.characters = [unsorted.characters[0], { ...unsorted.characters[0], id: '00000000-0000-4000-8000-000000000009', position: 0 }];
        expect(errorCodes(unsorted)).toContain('UNSORTED');

        const invalidAsset = cloneExport();
        invalidAsset.assets = [{
            id: '00000000-0000-4000-8000-000000000070', mimeType: 'image/png', size: 1,
            sha256: '0'.repeat(64), bytes: '', encoding: 'base64',
        }];
        expect(errorCodes(invalidAsset)).toContain('INVALID_VALUE');
    });
});
