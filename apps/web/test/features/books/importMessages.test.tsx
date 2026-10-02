import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { WorkImportPreflightDialog } from '../../../features/books/components/WorkImportPreflightDialog';
import { importIssueMessage } from '../../../features/books/importMessages';

describe('user-facing import errors', () => {
    it('keeps the relevant recovery action for different failures', () => {
        expect(importIssueMessage({ path: '$.schemaVersion', code: 'UNSUPPORTED_VERSION', message: 'Only schemaVersion 1 is supported' })).toContain('updating the app');
        expect(importIssueMessage({ path: '$.chapters[0].volumeId', code: 'REFERENCE_NOT_FOUND', message: 'UUID missing' })).toContain('exporting the work again');
        expect(importIssueMessage({ path: '$', code: 'LIMIT_EXCEEDED', message: 'bytes exceeded' })).toMatch(/under \d+ MB/);
    });
    it('hides field paths and raw errors without repeating the same generic message', () => {
        const { container } = render(<WorkImportPreflightDialog
            report={{ status: 'invalid', fileName: 'work.storyark.json', byteLength: 100, errors: [
                { path: '$.chapters[0].databaseVersion', code: 'INVALID_VALUE', message: 'SQLite/raw implementation detail' },
                { path: '$.chapters[1].databaseVersion', code: 'INVALID_VALUE', message: 'Another internal rule' },
            ] }} preparation={null} importError={null} importErrorCode={null} phase="preflight" outcome={null}
            isExecuting={false} cancelRequested={false} onClose={vi.fn()} onImport={vi.fn()} onReplace={vi.fn()} onCreateCopy={vi.fn()}
        />);
        expect(screen.getByText('This file is incomplete or could not be read. Choose another StoryArk export.')).toBeInTheDocument();
        expect(container.textContent).not.toMatch(/databaseVersion|SQLite|internal rule|\$\.chapters/);
        expect(screen.getByText('Your existing work is unchanged.', { selector: 'p' })).toBeInTheDocument();
    });
});
