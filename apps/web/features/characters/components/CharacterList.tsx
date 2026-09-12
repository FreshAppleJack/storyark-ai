import React, { useMemo, useRef, useState } from 'react';
import { Plus, Search, GripVertical } from 'lucide-react';
import { toast } from 'react-hot-toast';
import type { Character } from '../../../types';
import { getCharacterDisplayName } from '../characterForm';
import { searchCharacters, type CharacterSearchResult } from '../characterSearch';

interface Props {
    characters: Character[]; selectedCharId: string | null;
    handleSelect: (character: Character) => void;
    handleCreate: () => Promise<void>;
    onReorder: (characters: Character[]) => Promise<boolean>;
}
export function CharacterList({ characters, selectedCharId, handleSelect, handleCreate, onReorder }: Props) {
    const [characterSearchQuery, setCharacterSearchQuery] = useState('');
    const [characterSearchMessage, setCharacterSearchMessage] = useState('');
    const [characterSearchTargetId, setCharacterSearchTargetId] = useState<string | null>(null);
    const dragItemRef = useRef<number | null>(null);
    const dragOverItemRef = useRef<number | null>(null);
    const characterSearchResults = useMemo(() => searchCharacters(characters, characterSearchQuery), [characters, characterSearchQuery]);
    const scrollCharacterIntoView = (characterId: string) => {
        requestAnimationFrame(() => {
            document.getElementById(`character-search-${characterId}`)?.scrollIntoView({
                block: 'center',
                behavior: 'smooth'
            });
        });
    };

    const selectCharacterSearchResult = (result: CharacterSearchResult) => {
        handleSelect(result.character);
        setCharacterSearchTargetId(result.character.id);
        setCharacterSearchMessage(`Selected "${getCharacterDisplayName(result.character.name)}".`);
        scrollCharacterIntoView(result.character.id);
    };

    const handleCharacterSearchSubmit = (event: React.FormEvent) => {
        event.preventDefault();
        if (!characterSearchQuery.trim()) {
            setCharacterSearchMessage('Type a search term first.');
            return;
        }

        const firstResult = characterSearchResults[0];
        if (!firstResult) {
            setCharacterSearchMessage('No matching characters found.');
            return;
        }

        selectCharacterSearchResult(firstResult);
    };

    // --- Drag-and-drop logic ---
    const handleDragStart = (e: React.DragEvent, index: number) => {
        dragItemRef.current = index;
        // Reduce the transparency of the drag-and-drop source
        (e.currentTarget as HTMLDivElement).style.opacity = '0.5';
        e.dataTransfer.effectAllowed = 'move';
    };

    const handleDragEnter = (e: React.DragEvent, index: number) => {
        e.preventDefault();
        const dragIndex = dragItemRef.current;
        if (dragIndex === null || dragIndex === index) return;

        // Execute sorting logic
        const newCharacters = [...characters];
        const draggedItem = newCharacters[dragIndex];
        newCharacters.splice(dragIndex, 1);
        newCharacters.splice(index, 0, draggedItem);

        // Call the sorting method in the Context (optimistic update + backend request)
        void onReorder(newCharacters).then(ok => { if (!ok) toast.error('Failed to save character order.'); });

        // Update the current drag index to ensure the logic is correct when dragging continuously
        dragItemRef.current = index;
    };

    const handleDragEnd = (e: React.DragEvent) => {
        // Restore transparency
        (e.currentTarget as HTMLDivElement).style.opacity = '1';
        dragItemRef.current = null;
        dragOverItemRef.current = null;
    };

    const handleDragOver = (e: React.DragEvent) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
    };

    return (
        <aside className="w-64 bg-white dark:bg-slate-900 border-r border-slate-200 dark:border-slate-800 flex flex-col">
            <div className="p-4 border-b border-slate-100 dark:border-slate-800">
                <div className="flex justify-between items-center">
                    <h2 className="text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider">Characters</h2>
                    <button onClick={handleCreate} className="p-1 hover:bg-brand-50 dark:hover:bg-slate-800 text-brand-600 dark:text-brand-300 rounded">
                        <Plus size={18} />
                    </button>
                </div>
                <form className="mt-4 space-y-2" onSubmit={handleCharacterSearchSubmit}>
                    <div className="flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-2 py-1.5 focus-within:border-brand-400 focus-within:ring-2 focus-within:ring-brand-100 dark:border-slate-800 dark:bg-slate-900 dark:focus-within:border-brand-500 dark:focus-within:ring-brand-900/40">
                        <Search size={15} className="flex-shrink-0 text-slate-400" />
                        <input
                            value={characterSearchQuery}
                            onChange={(event) => {
                                setCharacterSearchQuery(event.target.value);
                                setCharacterSearchMessage('');
                            }}
                            placeholder="Search characters"
                            className="min-w-0 flex-1 bg-transparent text-xs text-slate-800 placeholder:text-slate-400 focus:outline-none dark:text-slate-100"
                        />
                        <button
                            type="submit"
                            className="rounded-md bg-brand-600 px-2 py-1 text-[11px] font-semibold text-white transition hover:bg-brand-700"
                        >
                            Go
                        </button>
                    </div>
                    {characterSearchQuery.trim() && characterSearchResults.length > 0 && (
                        <div className="max-h-44 overflow-y-auto rounded-lg border border-slate-200 bg-white py-1 shadow-sm dark:border-slate-800 dark:bg-slate-900">
                            {characterSearchResults.map((result) => (
                                <button
                                    key={result.character.id}
                                    type="button"
                                    onClick={() => selectCharacterSearchResult(result)}
                                    className="w-full px-3 py-2 text-left text-xs transition hover:bg-brand-50 dark:hover:bg-slate-800"
                                >
                                    <div className="truncate font-semibold text-slate-800 dark:text-slate-100">
                                        {getCharacterDisplayName(result.character.name)}
                                    </div>
                                    <div className="mt-0.5 truncate text-[11px] text-slate-400">
                                        {result.character.tags.length > 0 ? `${result.character.role} · ${result.character.tags.join(' ')}` : result.character.role}
                                    </div>
                                </button>
                            ))}
                        </div>
                    )}
                    {characterSearchMessage && (
                        <p className={`text-xs leading-5 ${characterSearchMessage.startsWith('No ') || characterSearchMessage.startsWith('Type ') ? 'text-amber-600 dark:text-amber-300' : 'text-slate-500 dark:text-slate-400'}`}>
                            {characterSearchMessage}
                        </p>
                    )}
                </form>
            </div>
            <div className="flex-1 overflow-y-auto p-2 space-y-1">
                {characters.map((char, index) => (
                    <div
                        id={`character-search-${char.id}`}
                        key={char.id}
                        draggable
                        onDragStart={(e) => handleDragStart(e, index)}
                        onDragEnter={(e) => handleDragEnter(e, index)}
                        onDragEnd={handleDragEnd}
                        onDragOver={handleDragOver}
                        onClick={() => handleSelect(char)}
                        className={`flex items-center gap-3 p-2 rounded cursor-pointer transition-colors group ${selectedCharId === char.id ? 'bg-brand-50 dark:bg-slate-800 border border-brand-200 dark:border-brand-700' : 'hover:bg-slate-100 dark:hover:bg-slate-800 border border-transparent'
                            } ${characterSearchTargetId === char.id ? 'ring-1 ring-brand-200 dark:ring-brand-800' : ''}`}
                    >
                        {/* Drag and drop handle: Hidden by default, displayed when hovering */}
                        <div className="cursor-grab active:cursor-grabbing text-slate-300 hover:text-slate-500 opacity-0 group-hover:opacity-100 transition-opacity -ml-1">
                            <GripVertical size={14} />
                        </div>

                        <div className="w-8 h-8 rounded-full flex items-center justify-center text-white text-xs font-bold flex-shrink-0" style={{ backgroundColor: char.color }}>
                            {getCharacterDisplayName(char.name).charAt(0).toUpperCase()}
                        </div>
                        <div className="flex-1 overflow-hidden">
                            <div className={`font-medium text-sm truncate flex items-center gap-2 ${selectedCharId === char.id ? 'text-brand-900 dark:text-brand-100' : 'text-slate-900 dark:text-slate-100'}`}>
                                <span className="truncate">{getCharacterDisplayName(char.name)}</span>
                                {char.isArchived && <span className="flex-shrink-0 text-[10px] font-semibold uppercase tracking-wide rounded bg-slate-200 px-1.5 py-0.5 text-slate-500 dark:bg-slate-700 dark:text-slate-300">Archived</span>}
                            </div>
                            <div className="text-xs text-slate-500 dark:text-slate-400 truncate">{char.role}</div>
                        </div>
                    </div>
                ))}
            </div>
        </aside>
    );
}
