import { createRef } from 'react';
import { Editor } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import { act, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Character } from '../../../types';
import { CustomMention, forceDowngradeMentions } from '../../../features/editor/extensions';
import { MentionList, MentionListHandle } from '../../../features/editor/integrations/MentionList';
import { createMentionSuggestion } from '../../../features/editor/integrations/mentionSuggestion';
import { buildCharacterTooltipContent, createCharacterTooltipHandler } from '../../../features/editor/integrations/characterTooltip';

const alice: Character = {
    id: 'c-alice', bookId: 'b-1', name: 'Alice', aliases: [],
    role: 'protagonist', description: 'Lead heroine', color: '#e11d48', tags: ['mage'],
};
const bob: Character = {
    id: 'c-bob', bookId: 'b-1', name: 'Bob', aliases: [],
    role: 'supporting', description: '', color: '#3b82f6', tags: [],
};

let editor: Editor | undefined;

afterEach(() => {
    editor?.destroy();
    editor = undefined;
    document.body.innerHTML = '';
});

describe('forceDowngradeMentions', () => {
    const mentionDoc = (attrs: Record<string, unknown>) => ({
        type: 'doc',
        content: [{ type: 'paragraph', content: [{ type: 'mention', attrs }] }],
    });

    function createMentionEditor(content: object) {
        editor = new Editor({ extensions: [StarterKit, CustomMention], content });
        return editor;
    }

    it('flattens mentions into text, keeping the label when present', () => {
        const instance = createMentionEditor(mentionDoc({ id: 'c-alice', label: 'Ali', color: '#e11d48' }));
        forceDowngradeMentions(instance, [alice]);

        expect(instance.getJSON()).toMatchObject({
            content: [{ content: [{ type: 'text', text: 'Ali' }] }],
        });
    });

    it('falls back to the current character name, then to the id', () => {
        const withKnown = createMentionEditor(mentionDoc({ id: 'c-alice', label: null, color: null }));
        forceDowngradeMentions(withKnown, [alice]);
        expect(withKnown.getText()).toBe('Alice');

        const withUnknown = createMentionEditor(mentionDoc({ id: 'c-gone', label: null, color: null }));
        forceDowngradeMentions(withUnknown, [alice]);
        expect(withUnknown.getText()).toBe('c-gone');
    });

    it('does nothing for an empty character list', () => {
        const instance = createMentionEditor(mentionDoc({ id: 'c-alice', label: 'Ali', color: '#e11d48' }));
        forceDowngradeMentions(instance, []);

        expect(instance.getJSON()).toMatchObject({
            content: [{ content: [{ type: 'mention' }] }],
        });
    });
});

describe('createMentionSuggestion', () => {
    it('filters items by name prefix and caps the result at five', () => {
        const cast = ['Ann', 'Amy', 'Abby', 'Ada', 'Aria', 'Ayla', 'Bob'].map((name, i) => ({
            ...alice, id: `c-${i}`, name,
        }));
        const suggestion = createMentionSuggestion(() => cast);
        const items = suggestion.items?.({ query: 'a' } as any) ?? [];

        expect(items).toHaveLength(5);
        expect(items.some(item => item.name === 'Bob')).toBe(false);
    });

    it('matches the trigger at the start of a line', () => {
        editor = new Editor({ extensions: [StarterKit], content: '<p>@Ali</p>' });
        const suggestion = createMentionSuggestion(() => [alice]);
        const $position = editor.state.doc.resolve(5);

        const match = suggestion.findSuggestionMatch?.({ char: '@', $position } as any);

        expect(match).toEqual({ range: { from: 1, to: 5 }, query: 'Ali', text: 'Ali' });
    });

    it('matches after a full-width space without including it in the range', () => {
        editor = new Editor({ extensions: [StarterKit], content: '<p>　@Ali</p>' });
        const suggestion = createMentionSuggestion(() => [alice]);
        const $position = editor.state.doc.resolve(6);

        const match = suggestion.findSuggestionMatch?.({ char: '@', $position } as any);

        expect(match).toEqual({ range: { from: 2, to: 6 }, query: 'Ali', text: 'Ali' });
    });
});

describe('MentionList', () => {
    // Keyboard navigation updates React state; act() flushes it before the next key.
    const keyDown = (ref: React.RefObject<MentionListHandle | null>, key: string) => {
        let handled: boolean | undefined;
        act(() => {
            handled = ref.current?.onKeyDown({ event: new KeyboardEvent('keydown', { key }) });
        });
        return handled;
    };

    it('calls command with id, label and color when clicking an item', () => {
        const command = vi.fn();
        render(<MentionList items={[alice, bob]} command={command} />);

        screen.getByText('Bob').click();

        expect(command).toHaveBeenCalledWith({ id: 'c-bob', label: 'Bob', color: '#3b82f6' });
    });

    it('navigates with arrow keys and selects with Enter', () => {
        const command = vi.fn();
        const ref = createRef<MentionListHandle>();
        render(<MentionList ref={ref} items={[alice, bob]} command={command} />);

        expect(keyDown(ref, 'ArrowDown')).toBe(true);
        expect(keyDown(ref, 'Enter')).toBe(true);

        expect(command).toHaveBeenCalledWith({ id: 'c-bob', label: 'Bob', color: '#3b82f6' });
    });

    it('wraps around when moving past the first item', () => {
        const command = vi.fn();
        const ref = createRef<MentionListHandle>();
        render(<MentionList ref={ref} items={[alice, bob]} command={command} />);

        keyDown(ref, 'ArrowUp');
        keyDown(ref, 'Enter');

        expect(command).toHaveBeenCalledWith({ id: 'c-bob', label: 'Bob', color: '#3b82f6' });
    });

    it('shows an empty state without items', () => {
        render(<MentionList items={[]} command={vi.fn()} />);

        expect(screen.getByText('No characters found')).toBeInTheDocument();
    });
});

describe('characterTooltip', () => {
    it('builds a card with name, initial, role, tags and description', () => {
        const html = buildCharacterTooltipContent(alice);

        expect(html).toContain('Alice');
        // The initial letter sits on its own indented line inside the avatar div.
        expect(html).toMatch(/>\s*A\s*</);
        expect(html).toContain('protagonist');
        expect(html).toContain('mage');
        expect(html).toContain('Lead heroine');
        expect(html).toContain(alice.color);
    });

    it('omits optional sections when the character has none', () => {
        const html = buildCharacterTooltipContent(bob);

        expect(html).toContain('Bob');
        expect(html).not.toContain('line-clamp-4');
    });

    it('attaches a tooltip to hovered mentions and respects suppression', () => {
        const target = document.createElement('span');
        target.className = 'mention';
        target.setAttribute('data-id', 'c-alice');
        document.body.appendChild(target);

        const handler = createCharacterTooltipHandler({ getCharacter: () => alice });
        handler({ target } as unknown as MouseEvent);
        expect((target as any)._tippy).toBeDefined();

        const suppressed = document.createElement('span');
        suppressed.className = 'mention';
        suppressed.setAttribute('data-id', 'c-alice');
        document.body.appendChild(suppressed);

        const suppressingHandler = createCharacterTooltipHandler({
            getCharacter: () => alice,
            shouldSuppress: () => true,
        });
        suppressingHandler({ target: suppressed } as unknown as MouseEvent);
        expect((suppressed as any)._tippy).toBeUndefined();
    });
});
