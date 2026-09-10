import React, { useMemo, useState } from 'react';
import { GripVertical, Search } from 'lucide-react';
import type { Character } from '../../../types';
import { searchCharacters, type CharacterSearchResult } from '../../characters/characterSearch';
interface Props { characters: Character[]; isSidebarOpen: boolean }
export function CharacterPalette({ characters, isSidebarOpen }: Props) {
    const [characterSearchQuery, setCharacterSearchQuery] = useState('');
    const [characterSearchMessage, setCharacterSearchMessage] = useState('');
    const [characterSearchTargetId, setCharacterSearchTargetId] = useState<string | null>(null);
    const characterSearchResults = useMemo(() => searchCharacters(characters, characterSearchQuery), [characters, characterSearchQuery]);
    const scrollCharacterIntoView = (characterId: string) => {
        requestAnimationFrame(() => {
            document.getElementById(`relationship-character-search-${characterId}`)?.scrollIntoView({
                block: 'center',
                behavior: 'smooth'
            });
        });
    };

    const selectCharacterSearchResult = (result: CharacterSearchResult) => {
        setCharacterSearchTargetId(result.character.id);
        setCharacterSearchMessage(`Found "${result.character.name}". Drag it onto the canvas to add another node.`);
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

    // --- Drag & Drop ---
    const onDragStart = (event: React.DragEvent, character: Character) => {
        event.dataTransfer.setData('application/reactflow', JSON.stringify(character));
        event.dataTransfer.effectAllowed = 'move';
    };

    return (
        <div
            className={`
        bg-white dark:bg-slate-900 border-r border-slate-200 dark:border-slate-800 flex flex-col z-10 shadow-sm transition-all duration-300 ease-in-out overflow-hidden
        ${isSidebarOpen ? 'w-64 opacity-100' : 'w-0 opacity-0 border-r-0'}
    `}
        >
            <div className="p-3 border-b border-slate-100 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-950/60 whitespace-nowrap">
                <div className="flex justify-between items-center">
                    <h2 className="text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider">Characters</h2>
                </div>
                <form className="mt-4 space-y-2" onSubmit={handleCharacterSearchSubmit}>
                    <div className="flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-2 py-1.5 focus-within:border-brand-400 focus-within:ring-2 focus-within:ring-brand-100 dark:border-slate-800 dark:bg-slate-900 dark:focus-within:border-brand-500 dark:focus-within:ring-brand-950/60">
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
                                    className="w-full px-3 py-2 text-left text-xs transition hover:bg-brand-50 dark:hover:bg-brand-950/40"
                                >
                                    <div className="truncate font-semibold text-slate-800 dark:text-slate-100">
                                        {result.character.name}
                                    </div>
                                    <div className="mt-0.5 truncate text-[11px] text-slate-400">
                                        {result.character.tags.length > 0 ? `${result.character.role} · ${result.character.tags.join(' ')}` : result.character.role}
                                    </div>
                                </button>
                            ))}
                        </div>
                    )}
                    {characterSearchMessage && (
                        <p className={`whitespace-normal text-xs leading-5 ${characterSearchMessage.startsWith('No ') || characterSearchMessage.startsWith('Type ') ? 'text-amber-600 dark:text-amber-300' : 'text-slate-500 dark:text-slate-400'}`}>
                            {characterSearchMessage}
                        </p>
                    )}
                </form>
            </div>
            <div className="flex-1 overflow-y-auto p-2 space-y-2 whitespace-nowrap">
                {characters.map((char) => (
                    <div
                        id={`relationship-character-search-${char.id}`}
                        key={char.id}
                        onDragStart={(event) => onDragStart(event, char)}
                        draggable
                        className={`flex items-center gap-3 p-2 bg-white dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-lg shadow-sm cursor-grab hover:border-blue-400 dark:hover:border-blue-700 hover:shadow-md transition-all active:cursor-grabbing ${characterSearchTargetId === char.id ? 'ring-1 ring-brand-200 dark:ring-brand-800' : ''
                            }`}
                    >
                        <GripVertical size={16} className="text-slate-300 shrink-0" />
                        <div className="w-8 h-8 rounded-full flex items-center justify-center text-white text-xs font-bold shrink-0" style={{ backgroundColor: char.color }}>
                            {char.name[0]}
                        </div>
                        <div className="min-w-0 flex-1">
                            <div className="text-sm font-medium text-slate-700 dark:text-slate-200 truncate">{char.name}</div>
                            <div className="text-[10px] text-slate-400 dark:text-slate-500 truncate">{char.role}</div>
                        </div>
                    </div>
                ))}
            </div>
        </div>


    );
}
