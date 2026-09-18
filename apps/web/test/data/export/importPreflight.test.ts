import { describe, expect, it } from 'vitest';
import sampleExport from '../../../docs/samples/storyark-work-export-v1.json?raw';
import {
    preflightWorkImportBytes,
    preflightWorkImportSize,
    preflightWorkImportText,
} from '../../../data/export/importPreflight';
import type { StoryArkWorkExport } from '../../../data/export/exchange';

function sampleValue(): StoryArkWorkExport {
    return structuredClone(JSON.parse(sampleExport) as StoryArkWorkExport);
}

describe('work import preflight', () => {
    it('accepts a valid work in memory and returns a structural summary', () => {
        const report = preflightWorkImportBytes('Book.storyark.json', new TextEncoder().encode(sampleExport));

        expect(report.status).toBe('valid');
        if (report.status !== 'valid') return;
        expect(report.summary).toMatchObject({
            schemaVersion: 1,
            contentVersion: 1,
            volumes: 1,
            chapters: 1,
            characters: 1,
            graphNodes: 2,
            graphEdges: 1,
            foreshadowings: 1,
        });
        expect(report.warnings).toEqual([]);
    });

    it('rejects invalid UTF-8 before JSON validation', () => {
        const report = preflightWorkImportBytes('broken.storyark.json', new Uint8Array([0xff, 0xfe]));

        expect(report.status).toBe('invalid');
        if (report.status === 'invalid') expect(report.errors[0]).toMatchObject({ path: '$', code: 'INVALID_VALUE' });
    });

    it('rejects an oversized file before parsing it', () => {
        const report = preflightWorkImportSize('large.storyark.json', 128 * 1024 * 1024 + 1);

        expect(report.status).toBe('invalid');
        if (report.status === 'invalid') expect(report.errors[0].code).toBe('LIMIT_EXCEEDED');
    });

    it('keeps legacy chapter content valid but reports its safe handling state', () => {
        const value = sampleValue();
        value.chapters[0].body = {
            format: 'legacy-html',
            version: 0,
            content: '<p>Legacy</p>',
            contentState: 'read-only',
            originalContent: '<p>Legacy</p>',
            originalFormat: 'legacy-html',
        };

        const report = preflightWorkImportText('legacy.storyark.json', JSON.stringify(value));

        expect(report.status).toBe('valid');
        if (report.status !== 'valid') return;
        expect(report.summary.legacyChapters).toBe(1);
        expect(report.warnings[0]).toMatchObject({ path: 'chapters[0].body' });
    });

    it('reports cross-work references using source paths without modifying any workspace', () => {
        const value = sampleValue();
        value.graphs[0].edges[0].targetNodeKey = '00000000-0000-4000-8000-000000000099';

        const report = preflightWorkImportText('invalid.storyark.json', JSON.stringify(value));

        expect(report.status).toBe('invalid');
        if (report.status === 'invalid') {
            expect(report.errors.some(error => error.path.includes('graphs[0].edges[0]'))).toBe(true);
        }
    });

    it('rejects runtime credentials before they can enter an import flow', () => {
        const value = sampleValue();
        (value as StoryArkWorkExport & Record<string, unknown>).apiKeys = { openai: 'secret-value' };

        const report = preflightWorkImportText('credentials.storyark.json', JSON.stringify(value));

        expect(report.status).toBe('invalid');
        if (report.status === 'invalid') {
            expect(report.errors).toEqual(expect.arrayContaining([
                expect.objectContaining({ path: '$.apiKeys', code: 'FORBIDDEN_FIELD' }),
            ]));
            expect(report.errors.map(error => error.message).join(' ')).not.toContain('secret-value');
        }
    });
});
