import { describe, expect, it } from 'vitest';
import {
    EXCHANGE_LIMITS,
    parseStoryArkWorkExport,
    serializeStoryArkWorkExport,
    validateStoryArkWorkExport,
    type StoryArkWorkExport,
} from '../../../data/export/exchange';
import { preflightWorkImportText } from '../../../data/export/importPreflight';

const uuid = (value: number): string => `00000000-0000-4000-8000-${value.toString(16).padStart(12, '0')}`;

interface FixtureIds {
    book: string;
    volume: string;
    chapter: string;
    character: string;
    nodeA: string;
    nodeB: string;
    edge: string;
    asset: string;
    note: string;
}

function fixtureIds(offset: number): FixtureIds {
    return {
        book: uuid(10 + offset),
        volume: uuid(20 + offset),
        chapter: uuid(30 + offset),
        character: uuid(40 + offset),
        nodeA: uuid(60 + offset),
        nodeB: uuid(61 + offset),
        edge: uuid(62 + offset),
        asset: uuid(90 + offset),
        note: `伏笔-${offset}`,
    };
}

function chineseWork(offset: number): StoryArkWorkExport {
    const ids = fixtureIds(offset);
    const timestamp = 1_700_000_000_000 + offset;
    return {
        schemaVersion: 1,
        exportId: uuid(1 + offset),
        exportedAt: '2026-09-19T00:00:00.000Z',
        producer: { appVersion: '0.1.0', platform: 'windows' },
        snapshot: { databaseVersion: 6, contentVersion: 1 },
        book: {
            id: ids.book,
            title: '潮汐钟楼',
            author: '林默',
            status: 'serializing',
            position: 0,
            isReadOnly: false,
            databaseVersion: 4,
            createdAt: timestamp,
            updatedAt: timestamp,
            coverColor: 'bg-blue-600',
        },
        volumes: [{
            id: ids.volume,
            bookId: ids.book,
            title: '第一卷 雾港',
            status: 'draft',
            position: 0,
            isReadOnly: false,
            databaseVersion: 2,
            createdAt: timestamp,
            updatedAt: timestamp,
        }],
        chapters: [{
            id: ids.chapter,
            bookId: ids.book,
            volumeId: ids.volume,
            title: '第一章 雾中的来客',
            status: 'draft',
            position: 0,
            isReadOnly: false,
            wordCount: 18,
            databaseVersion: 3,
            createdAt: timestamp,
            updatedAt: timestamp,
            body: {
                format: 'tiptap-json',
                version: 1,
                contentState: 'pending-migration',
                content: {
                    type: 'doc',
                    content: [{
                        type: 'paragraph',
                        content: [
                            {
                                type: 'text',
                                text: '第一段写着潮声与钟声。',
                                marks: [{ type: 'bold' }, { type: 'italic' }],
                            },
                            {
                                type: 'text',
                                text: '守钟人的秘密尚未揭开。',
                                marks: [
                                    { type: 'foreshadowing', attrs: { id: ids.note } },
                                    { type: 'futureGlow', attrs: { tone: '琥珀', strength: 2 } },
                                ],
                            },
                            {
                                type: 'mention',
                                attrs: { id: ids.character, label: '沈舟', futureAlias: '守钟人' },
                            },
                        ],
                    }, {
                        type: 'paragraph',
                        content: [{ type: 'text', text: '第二段保留原有上下文。' }],
                    }],
                },
            },
            foreshadowingIds: [ids.note],
        }],
        characters: [{
            id: ids.character,
            bookId: ids.book,
            name: '沈舟',
            aliases: ['舟舟', '守钟人'],
            role: 'protagonist',
            description: '在雾港寻找旧钟真相的人。',
            color: '#2f80ed',
            tags: ['主角', '钟楼'],
            avatar: null,
            handleConfig: { top: 'target', right: 'source', bottom: 'source', left: 'target' },
            isArchived: false,
            position: 0,
            databaseVersion: 2,
            createdAt: timestamp,
            updatedAt: timestamp,
        }],
        graphs: [{
            bookId: ids.book,
            databaseVersion: 2,
            createdAt: timestamp,
            updatedAt: timestamp,
            nodes: [
                { nodeKey: ids.nodeA, characterId: ids.character, positionX: 120.5, positionY: -30, handleConfig: { right: 'source' } },
                { nodeKey: ids.nodeB, characterId: ids.character, positionX: 420, positionY: 80, handleConfig: { left: 'target' } },
            ],
            edges: [{
                id: ids.edge,
                sourceNodeKey: ids.nodeA,
                targetNodeKey: ids.nodeB,
                sourceHandle: 'right-source',
                targetHandle: 'left-target',
                label: '共同守护钟楼',
            }],
        }],
        foreshadowings: [{
            id: ids.note,
            chapterId: ids.chapter,
            excerpt: '守钟人的秘密尚未揭开。',
            note: '在终卷回收旧钟与沈舟身世的关系。',
            isRecovered: false,
            databaseVersion: 3,
            createdAt: timestamp,
            updatedAt: timestamp,
            legacyMeta: { source: 'handwritten', color: 'amber' },
        }],
        planning: {
            bookId: ids.book,
            databaseVersion: 1,
            storySummary: '沈舟在雾港追查失踪钟声，逐步发现自己的过去。',
            storyBackground: '雾港依靠潮汐钟判断航道，钟楼由守钟人世代看守。',
            chapterSummaries: [{
                chapterId: ids.chapter,
                summary: '沈舟在雾中遇到守钟人，听见不应出现的钟声。',
                sourceChapterVersion: 3,
                updatedAt: timestamp,
            }],
            plotSettings: [{
                id: 'plot-tide',
                title: '旧钟真相',
                details: '让钟声成为连接过去与现在的线索。',
                chapterIds: [ids.chapter],
                missingChapterIds: [],
                createdAt: timestamp,
                updatedAt: timestamp,
            }],
        },
        brainstormWorkspaces: [{
            bookId: ids.book,
            databaseVersion: 1,
            createdAt: timestamp,
            updatedAt: timestamp,
            selectedChapterIds: [ids.chapter],
            contextSnapshot: {
                bookId: ids.book,
                selectedChapterIds: [ids.chapter],
                selectedCharacterIds: [ids.character],
                selectedNodeKeys: [ids.nodeA, ids.nodeB],
            },
            generatedOptions: [{
                id: 'option-tide',
                title: '让钟声回应沈舟',
                conflict: '钟楼的规则不允许外人敲钟。',
                motivation: '沈舟想确认自己听到的声音。',
                consequences: '雾港的航道会暂时失效。',
                development: '守钟人必须在帮助沈舟与保护旧规之间选择。',
            }],
            selectedOptionId: 'option-tide',
            finalContent: '已保存的头脑风暴草稿：钟声在雾中回应了沈舟。',
        }],
        assets: [],
        extensions: { preserved: { importRoundTrip: true } },
    };
}

function roundTrip(value: StoryArkWorkExport): StoryArkWorkExport {
    const parsed = parseStoryArkWorkExport(serializeStoryArkWorkExport(value));
    expect(parsed.valid).toBe(true);
    if (!parsed.valid) throw new Error('fixture should remain valid after serialization');
    return parsed.value;
}

function withoutDerivedFields(value: StoryArkWorkExport): unknown {
    const copy = structuredClone(value) as StoryArkWorkExport & Record<string, unknown>;
    delete copy.exportId;
    delete copy.exportedAt;
    return copy;
}

describe('P0 work exchange completion gate', () => {
    it('round-trips two Chinese works without crossing same-name character references', () => {
        const first = chineseWork(0);
        const second = chineseWork(100);
        const firstIds = fixtureIds(0);
        const secondIds = fixtureIds(100);

        expect(first.characters[0].name).toBe(second.characters[0].name);
        expect(first.characters[0].id).not.toBe(second.characters[0].id);
        expect(validateStoryArkWorkExport(first).valid).toBe(true);
        expect(validateStoryArkWorkExport(second).valid).toBe(true);

        for (const [work, ids, foreignIds] of [[first, firstIds, secondIds], [second, secondIds, firstIds]] as const) {
            const result = preflightWorkImportText(`${work.book.title}.storyark.json`, serializeStoryArkWorkExport(work));
            expect(result.status).toBe('valid');
            if (result.status !== 'valid') continue;
            expect(result.summary).toMatchObject({
                volumes: 1,
                chapters: 1,
                characters: 1,
                graphNodes: 2,
                graphEdges: 1,
                foreshadowings: 1,
                planningSummaries: 1,
                plotSettings: 1,
                brainstormWorkspaces: 1,
                brainstormOptions: 1,
            });
            expect(result.summary.pendingMigrationChapters).toBe(1);

            const restored = roundTrip(result.value);
            expect(withoutDerivedFields(restored)).toEqual(withoutDerivedFields(work));
            expect(restored.chapters[0].body).toMatchObject({ contentState: 'pending-migration' });
            if (restored.chapters[0].body.format === 'tiptap-json') {
                const content = restored.chapters[0].body.content;
                const textNodes = content.content?.[0].content ?? [];
                expect(textNodes[0]).toMatchObject({ marks: [{ type: 'bold' }, { type: 'italic' }] });
                expect(textNodes[1]).toMatchObject({ marks: [
                    { type: 'foreshadowing', attrs: { id: ids.note } },
                    { type: 'futureGlow', attrs: { tone: '琥珀', strength: 2 } },
                ] });
                expect(textNodes[2]).toMatchObject({ attrs: { id: ids.character, futureAlias: '守钟人' } });
            }
            expect(restored.graphs[0].nodes.map(node => node.characterId)).toEqual([ids.character, ids.character]);
            expect(restored.graphs[0].edges[0]).toMatchObject({ sourceNodeKey: ids.nodeA, targetNodeKey: ids.nodeB });
            expect(JSON.stringify(restored)).not.toContain(foreignIds.book);
            expect(JSON.stringify(restored)).not.toContain(foreignIds.character);
        }
    });

    it('rejects every required preflight failure before an import can begin', () => {
        const cases: Array<{ name: string; mutate: (value: StoryArkWorkExport) => void; path: string; code?: string }> = [
            { name: 'missing field', mutate: value => {
                if (value.chapters[0].body.format === 'tiptap-json') delete (value.chapters[0].body as unknown as Record<string, unknown>).content;
            }, path: 'chapters[0].body.content', code: 'MISSING_FIELD' },
            { name: 'wrong type', mutate: value => (value.book.position as unknown as string) = 'first', path: 'book.position', code: 'INVALID_TYPE' },
            { name: 'old schema version', mutate: value => (value.schemaVersion as number) = 0, path: 'schemaVersion', code: 'UNSUPPORTED_VERSION' },
            { name: 'new schema version', mutate: value => (value.schemaVersion as number) = 2, path: 'schemaVersion', code: 'UNSUPPORTED_VERSION' },
            { name: 'duplicate ID', mutate: value => value.characters.push(structuredClone(value.characters[0])), path: 'characters', code: 'INVALID_VALUE' },
            { name: 'dangling graph endpoint', mutate: value => (value.graphs[0].edges[0].targetNodeKey as string) = uuid(999), path: 'graphs[0].edges[0].targetNodeKey', code: 'REFERENCE_NOT_FOUND' },
            { name: 'cross-book reference', mutate: value => (value.characters[0].bookId as string) = uuid(998), path: 'characters', code: 'REFERENCE_MISMATCH' },
            { name: 'invalid Tiptap document', mutate: value => {
                if (value.chapters[0].body.format === 'tiptap-json') value.chapters[0].body.content.type = 'not-a-doc' as 'doc';
            }, path: 'chapters[0].body.content', code: 'INVALID_VALUE' },
            { name: 'overlong context', mutate: value => {
                value.brainstormWorkspaces[0].contextSnapshot.tooLong = 'x'.repeat(EXCHANGE_LIMITS.maxContextSnapshotChars + 1);
            }, path: 'brainstormWorkspaces[0].contextSnapshot', code: 'LIMIT_EXCEEDED' },
            { name: 'unsupported asset', mutate: value => {
                value.assets = [{ id: fixtureIds(0).asset, mimeType: 'text/plain', size: 0, sha256: '0'.repeat(64), bytes: '', encoding: 'base64' }];
            }, path: 'assets', code: 'UNSUPPORTED_ASSET' },
        ];

        for (const testCase of cases) {
            const value = chineseWork(0);
            testCase.mutate(value);
            const report = preflightWorkImportText(`${testCase.name}.storyark.json`, JSON.stringify(value));
            expect(report.status, testCase.name).toBe('invalid');
            if (report.status !== 'invalid') continue;
            expect(report.errors.some(error => error.path.includes(testCase.path)), testCase.name).toBe(true);
            if (testCase.code) expect(report.errors.some(error => error.code === testCase.code), testCase.name).toBe(true);
        }
    });

    it('rejects JSON depth and object-count exhaustion before persistence', () => {
        const deep = chineseWork(0);
        let cursor: Record<string, unknown> = {};
        deep.brainstormWorkspaces[0].contextSnapshot.deep = cursor;
        for (let index = 0; index <= EXCHANGE_LIMITS.maxJsonDepth; index += 1) {
            const next: Record<string, unknown> = {};
            cursor.next = next;
            cursor = next;
        }
        const deepReport = preflightWorkImportText('too-deep.storyark.json', JSON.stringify(deep));
        expect(deepReport.status).toBe('invalid');
        if (deepReport.status === 'invalid') {
            expect(deepReport.errors.some(error => error.code === 'LIMIT_EXCEEDED' && error.path.includes('contextSnapshot'))).toBe(true);
        }

        const tooManyObjects = chineseWork(0);
        tooManyObjects.brainstormWorkspaces[0].contextSnapshot.objects = Array.from(
            { length: EXCHANGE_LIMITS.maxJsonObjects + 1 },
            () => ({}),
        );
        const objectReport = preflightWorkImportText('too-many-objects.storyark.json', JSON.stringify(tooManyObjects));
        expect(objectReport.status).toBe('invalid');
        if (objectReport.status === 'invalid') {
            expect(objectReport.errors.some(error => error.code === 'LIMIT_EXCEEDED' && error.path.includes('contextSnapshot'))).toBe(true);
        }
    });

    it('does not leak credentials in preflight errors or serialized work data', () => {
        const value = chineseWork(0) as StoryArkWorkExport & Record<string, unknown>;
        const secret = 'sk-p0-secret-must-not-appear';
        value.apiKey = secret;
        const report = preflightWorkImportText('secret.storyark.json', JSON.stringify(value));

        expect(report.status).toBe('invalid');
        if (report.status === 'invalid') {
            expect(report.errors.some(error => error.path.includes('apiKey'))).toBe(true);
            expect(report.errors.map(error => error.message).join(' ')).not.toContain(secret);
        }
        expect(() => serializeStoryArkWorkExport(value)).toThrow();
        expect(JSON.stringify(report)).not.toContain(secret);
    });
});
