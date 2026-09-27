import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import type { ChapterSummaryFreshness } from '../../../domain/chapterSummarySource';
import type { ChapterOption } from '../../../features/planning/planningSelectors';
import { ChapterSummariesPanel } from '../../../features/planning/components/ChapterSummariesPanel';

it('lets users resize the selected summary and acknowledge a possible source change', () => {
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
    expect(textarea.className).toContain('h-48');
    expect(textarea.className).toContain('min-h-48');
    expect(textarea.className).toContain('resize-y');
    fireEvent.click(screen.getByRole('button', { name: 'Keep summary and mark reviewed' }));
    expect(acknowledge).toHaveBeenCalledWith(chapter.id);
});

it('keeps the chapter list compact while editing only the selected summary', () => {
    const first: ChapterOption = {
        id: 'chapter-1', title: 'Chapter One', volumeId: 'volume-1', volumeTitle: 'Volume One',
        summary: 'First summary', hasWrittenText: true, isReadOnly: false,
    };
    const second: ChapterOption = { ...first, id: 'chapter-2', title: 'Chapter Two', summary: 'Second summary' };
    const update = vi.fn();
    render(<ChapterSummariesPanel
        chapterOptions={[first, second]}
        targetChapterId={null}
        updateChapterSummary={update}
        acknowledgeChapterSummaryChanges={vi.fn()}
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

    expect(screen.getAllByPlaceholderText('Chapter plot summary...')).toHaveLength(1);
    expect(screen.getByPlaceholderText('Chapter plot summary...')).toHaveValue('First summary');
    fireEvent.click(screen.getByRole('button', { name: /Chapter Two/ }));
    expect(screen.getByPlaceholderText('Chapter plot summary...')).toHaveValue('Second summary');
    fireEvent.change(screen.getByPlaceholderText('Chapter plot summary...'), { target: { value: 'Edited second summary' } });
    expect(update).toHaveBeenCalledWith('chapter-2', 'Edited second summary');
    fireEvent.change(screen.getByRole('textbox', { name: 'Search chapters or summaries' }), { target: { value: 'Chapter One' } });
    expect(screen.getByPlaceholderText('Chapter plot summary...')).toHaveValue('First summary');
    expect(screen.queryByRole('button', { name: /Chapter Two/ })).toBeNull();
});
