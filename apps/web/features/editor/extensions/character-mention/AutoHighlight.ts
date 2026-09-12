import { Extension } from '@tiptap/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import type { Node as PMNode } from '@tiptap/pm/model';
import type { Character } from '../../../../types';
import {
    escapeRegex,
    getCharacterDisplayTerms,
    getCharacterMatchTerms,
    getValidNamedCharacters,
} from '../../../../domain/characters';
import { dlog } from '../../debug/editorDebug';
import { readCharacterData } from './characterData';

export interface AutoHighlightOptions {
    characters: Character[];
    allCharacters: Character[];
}

/**
 * Watches document changes and reconciles character mentions:
 *
 * PASS 1 (reconcile existing mention nodes):
 *   - character deleted      -> downgrade the mention to plain text
 *   - color drifted          -> update the attrs to the current color
 *   - label no longer known  -> fall back to the character's main name
 *
 * PASS 2 (pattern-match plain text):
 *   - replace matched character names/aliases with mention nodes,
 *     keeping the original marks on the matched text;
 *   - text carrying the ignoreAutoHighlight mark is skipped.
 *
 * Runs on any doc-changing transaction, and on meta-only transactions
 * carrying `forceRefreshHighlights` (used by the React layer after a
 * character settings save without an actual content change).
 */
export const AutoHighlight = Extension.create<AutoHighlightOptions>({
    name: 'autoHighlight',

    addOptions() {
        return {
            characters: [],
            allCharacters: [],
        };
    },

    addProseMirrorPlugins() {
        return [
            new Plugin({
                key: new PluginKey('autoHighlight'),
                appendTransaction: (transactions, oldState, newState) => {
                    const docChanged = transactions.some(t => t.docChanged);
                    const forceRefresh = transactions.some(t => t.getMeta('forceRefreshHighlights'));
                    if (!docChanged && !forceRefresh) return null;

                    // Live data comes from the shared characterData storage so
                    // character updates never rebuild the editor; options are
                    // only the initial fallback (e.g. headless test editors).
                    const shared = readCharacterData(this.editor);
                    const chars = getValidNamedCharacters(
                        shared.autoHighlightCharacters.length > 0 || shared.characters.length > 0
                            ? shared.autoHighlightCharacters
                            : this.options.characters || []
                    );
                    const allSource = shared.characters.length > 0
                        ? shared.characters
                        : this.options.allCharacters || this.options.characters || [];
                    const allChars = getValidNamedCharacters(allSource.length > 0 ? allSource : chars);
                    const charById = new Map(allChars.map(c => [c.id, c]));

                    const { tr } = newState;
                    let modified = false;

                    // PASS 1: collect first, then apply in reverse order so
                    // positions stay valid.
                    interface MentionFix {
                        pos: number;
                        node: PMNode;
                        action: 'remove' | 'update';
                        label?: string;
                    }
                    const mentionFixes: MentionFix[] = [];

                    newState.doc.descendants((node, pos) => {
                        if (node.type.name !== 'mention') return;
                        const char = charById.get(node.attrs.id);
                        if (!char) {
                            mentionFixes.push({ pos, node, action: 'remove' });
                        } else {
                            const label = typeof node.attrs.label === 'string' ? node.attrs.label : '';
                            const labelStillValid = getCharacterDisplayTerms(char).includes(label);
                            const nextLabel = labelStillValid ? label : char.name;
                            if (nextLabel !== node.attrs.label || char.color !== node.attrs.color) {
                                mentionFixes.push({ pos, node, action: 'update', label: nextLabel });
                            }
                        }
                    });

                    for (let i = mentionFixes.length - 1; i >= 0; i--) {
                        const { pos, node, action, label } = mentionFixes[i];
                        const mappedPos = tr.mapping.map(pos);
                        if (action === 'remove') {
                            // Character no longer exists -> replace with plain text.
                            const fallback = node.attrs.label || node.attrs.id || '';
                            if (!fallback) continue;
                            const textNode = newState.schema.text(fallback, node.marks);
                            tr.replaceWith(mappedPos, mappedPos + node.nodeSize, textNode);
                            modified = true;
                        } else {
                            const char = charById.get(node.attrs.id)!;
                            // setNodeMarkup updates the node attributes in place.
                            tr.setNodeMarkup(mappedPos, undefined, {
                                ...node.attrs,
                                label: label || char.name,
                                color: char.color,
                            });
                            modified = true;
                        }
                    }

                    if (mentionFixes.length > 0) {
                        dlog('AutoHighlight reconciled mention nodes', {
                            removed: mentionFixes.filter(f => f.action === 'remove').length,
                            updated: mentionFixes.filter(f => f.action === 'update').length,
                        });
                    }

                    // PASS 2: only meaningful when there are characters defined.
                    if (chars.length > 0) {
                        const highlightTerms = getCharacterMatchTerms(chars);
                        if (highlightTerms.length === 0) return modified ? tr : null;
                        const pattern = new RegExp(
                            `(${highlightTerms.map(term => escapeRegex(term.text)).join('|')})`,
                            'g'
                        );

                        interface Match {
                            from: number;
                            to: number;
                            char: Character;
                            label: string;
                            marks: readonly import('@tiptap/pm/model').Mark[];
                        }
                        const matches: Match[] = [];

                        // We use the *current* (post-reconcile) doc for scanning.
                        const docForScan = modified ? tr.doc : newState.doc;
                        docForScan.descendants((node, pos) => {
                            if (!node.isText || !node.text) return;
                            if (node.marks.find(m => m.type.name === 'ignoreAutoHighlight')) return;

                            let match;
                            pattern.lastIndex = 0;
                            while ((match = pattern.exec(node.text)) !== null) {
                                const matchedText = match[0];
                                if (!matchedText) {
                                    pattern.lastIndex += 1;
                                    continue;
                                }
                                const from = pos + match.index;
                                const to = from + matchedText.length;
                                const matchedTerm = highlightTerms.find(term => term.text === matchedText);
                                if (matchedTerm) matches.push({ from, to, char: matchedTerm.character, label: matchedText, marks: node.marks });
                            }
                        });

                        if (matches.length > 0) {
                            // When we scanned tr.doc (already-mapped positions) we must NOT
                            // re-map those positions through tr.mapping again.
                            const needsMapping = !modified;
                            matches.sort((a, b) => a.from - b.from);
                            matches.forEach(match => {
                                const from = needsMapping ? tr.mapping.map(match.from) : match.from;
                                const to = needsMapping ? tr.mapping.map(match.to) : match.to;
                                const mentionNode = newState.schema.nodes.mention.create(
                                    {
                                        id: match.char.id,
                                        label: match.label,
                                        color: match.char.color,
                                    },
                                    null,
                                    match.marks
                                );
                                tr.replaceWith(from, to, mentionNode);
                                modified = true;
                            });
                            dlog('AutoHighlight created mention nodes', { count: matches.length });
                        }
                    }

                    return modified ? tr : null;
                },
            }),
        ];
    },
});
