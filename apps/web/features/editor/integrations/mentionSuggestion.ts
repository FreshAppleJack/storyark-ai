import { ReactRenderer } from '@tiptap/react';
import type { MentionOptions } from '@tiptap/extension-mention';
import tippy from 'tippy.js';
import type { Character } from '../../../types';
import { getValidNamedCharacters } from '../../../domain/characters';
import { MentionList } from './MentionList';

/**
 * Builds the suggestion configuration for the character mention.
 *
 * Contract:
 * - items: name-prefix matches of valid characters, capped at 5;
 * - findSuggestionMatch: trigger char accepted at line start or after
 *   whitespace (including the full-width space U+3000);
 * - command: inserts the mention while preserving the marks active at the
 *   cursor, applies the CJK-aware smart-space rules, and appends a
 *   zero-width space so typing continues outside the mention;
 * - render: ReactRenderer + tippy popup lifecycle.
 */
export const createMentionSuggestion = (getCharacters: () => Character[]): MentionOptions['suggestion'] => ({
    items: ({ query }) => {
        return getValidNamedCharacters(getCharacters()).filter(item =>
            item.name.toLowerCase().startsWith(query.toLowerCase())
        ).slice(0, 5);
    },
    findSuggestionMatch: (config) => {
        const { char, $position } = config;
        const text = $position.doc.textBetween(
            Math.max(0, $position.pos - 50),
            $position.pos,
            '\n',
            '\0'
        );
        const regex = new RegExp(`(?:^|[\\s\\u3000])(${char})(.*)$`);
        const match = text.match(regex);
        if (!match) return null;
        const fullMatch = match[0];
        const query = match[2];
        const matchOffset = fullMatch.indexOf(char);
        const fromPos = $position.pos - fullMatch.length + matchOffset;
        const toPos = $position.pos;
        return { range: { from: fromPos, to: toPos }, query: query, text: query };
    },
    command: ({ editor, range, props }) => {
        const currentMarks: any[] = [];
        const textStyleAttrs = editor.getAttributes('textStyle');
        if (textStyleAttrs && Object.keys(textStyleAttrs).length > 0) {
            currentMarks.push({ type: 'textStyle', attrs: textStyleAttrs });
        }
        ['bold', 'italic', 'underline', 'strike'].forEach(markName => {
            if (editor.isActive(markName)) {
                currentMarks.push({ type: markName });
            }
        });

        // Smart space logic for inserting space before mention if necessary
        const charBefore = editor.state.doc.textBetween(Math.max(0, range.from - 1), range.from);
        const charBeforeTwo = editor.state.doc.textBetween(Math.max(0, range.from - 2), range.from - 1);
        const isChinese = (char: string) => /[\u4e00-\u9fa5\u3000-\u303f\uff00-\uffef\uff02\u2000-\u206f]/.test(char);

        let replaceFrom = range.from;
        let insertSpaceBefore = false;

        if (charBefore === ' ') {
            if (isChinese(charBeforeTwo)) {
                replaceFrom = range.from - 1;
            }
        } else {
            if (charBefore && !isChinese(charBefore)) {
                insertSpaceBefore = true;
            }
        }

        const contentToInsert: any[] = [];
        if (insertSpaceBefore) {
            contentToInsert.push({ type: 'text', text: ' ', marks: currentMarks });
        }

        contentToInsert.push({
            type: 'mention',
            attrs: props,
            marks: currentMarks
        });

        contentToInsert.push({
            type: 'text',
            text: '\u200B',
            marks: currentMarks
        });

        editor
            .chain()
            .focus()
            .insertContentAt({ from: replaceFrom, to: range.to }, contentToInsert)
            .run();
    },
    render: () => {
        let component: ReactRenderer;
        let popup: any;

        return {
            onStart: (props) => {
                component = new ReactRenderer(MentionList, {
                    props,
                    editor: props.editor,
                });

                if (!props.clientRect) return;

                popup = tippy('body', {
                    getReferenceClientRect: props.clientRect,
                    appendTo: () => document.body,
                    content: component.element,
                    showOnCreate: true,
                    interactive: true,
                    trigger: 'manual',
                    placement: 'bottom-start',
                    arrow: false,
                });
            },
            onUpdate(props) {
                component.updateProps(props);
                if (!props.clientRect) return;
                popup[0].setProps({
                    getReferenceClientRect: props.clientRect,
                });
            },
            onKeyDown(props) {
                if (props.event.key === 'Escape') {
                    popup[0].hide();
                    return true;
                }
                return (component.ref as any)?.onKeyDown(props);
            },
            onExit() {
                popup[0].destroy();
                component.destroy();
            },
        };
    },
});
