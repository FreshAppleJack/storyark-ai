import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import type { ChapterSummaryFreshness } from '../../../domain/chapterSummarySource';
import type { ChapterOption } from '../../../features/planning/planningSelectors';
import { ChapterSummariesPanel } from '../../../features/planning/components/ChapterSummariesPanel';

it('lets users resize summary cards and acknowledge a possible source change', () => {
    const acknowledge = vi.fn();
    const freshness: ChapterSummaryFreshness = {
        status: 'possibly-stale',
        sourceVersionChanged: true,
        changedBlocks: 0,
        addedBlocks: 1,
        removedBlocks: 0,
        addedCharacterIds: [],
        removedCharacterIds: [],
        addedForeshadowingIds: [],
        removedForeshadowingIds: [],
        changedForeshadowingNoteIds: [],
        changedAllowedSourceIds: [],
        reasons: ['paragraphs-added'],
    };
    const chapter: ChapterOption = {
        id: 'chapter-1',
        title: 'Chapter One',
        volumeId: 'volume-1',
        volumeTitle: 'Volume One',
        summary: 'Keep this summary.',
        hasWrittenText: true,
        isReadOnly: false,
        sourceChanged: true,
        summaryProvenance: 'author',
        summaryFreshness: freshness,
    };

    render(<ChapterSummariesPanel
        chapterOptions={[chapter]}
        targetChapterId={null}
        updateChapterSummary={vi.fn()}
        acknowledgeChapterSummaryChanges={acknowledge}
        suggestions={{}}
        activeSuggestionChapterId={null}
        modelAvailability="ready"
        modelNotice={null}
        isReadOnly={false}
        isSuggestionCurrent={() => true}
        generateSuggestion={vi.fn()}
        stopSuggestion={vi.fn()}
        acceptSuggestion={vi.fn()}
        keepManual={vi.fn()}
        toggleSuggestionHit={vi.fn()}
    />);

    const textarea = screen.getByPlaceholderText('Chapter plot summary...');
    expect(textarea.className).toContain('h-28');
    expect(textarea.className).toContain('min-h-28');
    expect(textarea.className).toContain('resize-y');
    fireEvent.click(screen.getByRole('button', { name: 'Ignore' }));
    expect(acknowledge).toHaveBeenCalledWith(chapter.id);
});
