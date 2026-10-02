import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { RetrievalContextPanel } from '../../../features/retrieval/components/RetrievalContextPanel';
import type { RetrievalContext } from '../../../domain/retrieval/contracts';

it('shows compact character evidence without the stored highlight color and preserves exclusion', () => {
    const onToggleHit = vi.fn();
    const context = {
        task: 'chapter_summary',
        evidence: [{
            hitId: 'character-hit', sourceKind: 'character', sourceVersion: 9,
            chapterId: null, volumeTitleSnapshot: null, chapterTitleSnapshot: null,
            text: '章卓睿\nprotagonist\n一个前厅的普通人，开启冒险。\n#10b981\n机智 略微胆小',
            quote: '章卓睿',
        }],
    } as unknown as RetrievalContext;

    render(<RetrievalContextPanel context={context} notice={null} excludedHitIds={[]} onToggleHit={onToggleHit} />);
    expect(screen.getByText('章卓睿')).toBeInTheDocument();
    expect(screen.getByText(/一个前厅的普通人/)).toBeInTheDocument();
    expect(screen.queryByText('#10b981')).toBeNull();
    expect(screen.queryByText('chapter_summary')).toBeNull();
    fireEvent.click(screen.getByRole('checkbox', { name: 'Use Character from Book context' }));
    expect(onToggleHit).toHaveBeenCalledWith('character-hit');
});
