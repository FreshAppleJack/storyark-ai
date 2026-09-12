import { Extension, type Editor } from '@tiptap/core';
import type { Character } from '../../../../types';

export interface CharacterDataStorage {
    /** Every character of the book, including archived ones (mention reconcile, suggestions). */
    characters: Character[];
    /** Characters eligible for new auto-highlight matches (active roles, not archived). */
    autoHighlightCharacters: Character[];
}

declare module '@tiptap/core' {
    interface Storage {
        characterData: CharacterDataStorage;
    }
}

/**
 * Shares the latest character data with editor plugins through storage, so
 * character updates never require rebuilding the editor instance (which
 * would destroy the caret, undo history and in-flight drafts).
 */
export const CharacterData = Extension.create<object, CharacterDataStorage>({
    name: 'characterData',

    addStorage() {
        return {
            characters: [],
            autoHighlightCharacters: [],
        };
    },
});

/** Reads the shared character data, tolerating editors without the extension. */
export function readCharacterData(editor?: Editor): CharacterDataStorage {
    const storage = editor?.storage.characterData as CharacterDataStorage | undefined;
    return {
        characters: storage?.characters ?? [],
        autoHighlightCharacters: storage?.autoHighlightCharacters ?? [],
    };
}
