import React, { useState, useRef, useEffect, useMemo } from 'react';
import { useParams, useNavigate, useSearchParams } from 'react-router-dom';
import { useApp } from '../InteractionContent/AppContext';
import { ArrowLeft, Plus, Trash2, User as UserIcon, Save, Tag, AlertTriangle, GripVertical, CheckCircle2, Search, ScrollText } from 'lucide-react';
import { Button } from '../components/ui/Button';
import { Input } from '../components/ui/Input';
import { toast } from 'react-hot-toast';
import { Character } from '../types';

const COLORS = [
    { name: 'Red', value: '#ef4444' },
    { name: 'Orange', value: '#f97316' },
    { name: 'Amber', value: '#f59e0b' },
    { name: 'Green', value: '#10b981' },
    { name: 'Blue', value: '#3b82f6' },
    { name: 'Purple', value: '#8b5cf6' },
    { name: 'Pink', value: '#ec4899' },
    { name: 'Slate', value: '#64748b' },
];

interface CharacterSearchResult {
    character: Character;
    score: number;
}

const normalizeSearchText = (value: string) => value.toLowerCase().replace(/\s+/g, '');

const getFuzzyScore = (value: string, query: string) => {
    const target = normalizeSearchText(value);
    const needle = normalizeSearchText(query);
    if (!needle) return null;
    if (!target) return null;

    const exactIndex = target.indexOf(needle);
    if (exactIndex >= 0) {
        return exactIndex + Math.max(0, target.length - needle.length) * 0.01;
    }

    let targetIndex = 0;
    let gapPenalty = 0;
    for (const char of needle) {
        const foundIndex = target.indexOf(char, targetIndex);
        if (foundIndex === -1) return null;
        gapPenalty += foundIndex - targetIndex;
        targetIndex = foundIndex + 1;
    }

    return 100 + gapPenalty + Math.max(0, target.length - needle.length) * 0.02;
};

const getCharacterDisplayName = (name?: string) => {
    const trimmedName = name?.trim();
    return trimmedName || 'Unnamed';
};

const normalizeAliasInputs = (aliases: string[], primaryName: string) => {
    const primary = primaryName.trim();
    const seen = new Set<string>();
    const normalized: string[] = [];

    for (const alias of aliases) {
        const trimmed = alias.trim();
        if (!trimmed || trimmed === primary || seen.has(trimmed)) continue;
        seen.add(trimmed);
        normalized.push(trimmed);
        if (normalized.length >= 3) break;
    }

    return normalized;
};

const toAliasInputs = (aliases?: string[]) => {
    const values = Array.isArray(aliases) ? aliases.slice(0, 3) : [];
    return [...values, '', '', ''].slice(0, 3);
};

const CharacterSettings: React.FC = () => {
    const { bookId } = useParams<{ bookId: string }>();
    const navigate = useNavigate();
    const [searchParams] = useSearchParams();
    const { getBook, createCharacter, updateCharacter, deleteCharacter, reorderCharacters } = useApp();
    const book = getBook(bookId || '');

    const [selectedCharId, setSelectedCharId] = useState<string | null>(null);
    const [showDeleteModal, setShowDeleteModal] = useState(false);
    const [toastConfig, setToastConfig] = useState({ show: false, message: '' });
    const [characterSearchQuery, setCharacterSearchQuery] = useState('');
    const [characterSearchMessage, setCharacterSearchMessage] = useState('');
    const [characterSearchTargetId, setCharacterSearchTargetId] = useState<string | null>(null);

    // trag related Refs
    const dragItemRef = useRef<number | null>(null);
    const dragOverItemRef = useRef<number | null>(null);

    const [formData, setFormData] = useState({
        name: '',
        role: 'supporting' as Character['role'],
        description: '',
        color: '#3b82f6',
        tags: '',
        aliases: ['', '', '']
    });

    const characters = book?.characters || [];
    const characterSearchResults = useMemo<CharacterSearchResult[]>(() => {
        const query = characterSearchQuery.trim();
        if (!query) return [];

        return characters
            .map((character) => {
                const fields = [
                    { value: character.name, weight: 0 },
                    { value: character.role, weight: 5 },
                    { value: character.tags.join(' '), weight: 8 },
                    { value: character.description, weight: 20 },
                ];
                const bestScore = fields.reduce<number | null>((best, field) => {
                    const score = getFuzzyScore(field.value, query);
                    if (score === null) return best;
                    const weightedScore = score + field.weight;
                    return best === null ? weightedScore : Math.min(best, weightedScore);
                }, null);

                return bestScore === null ? null : { character, score: bestScore };
            })
            .filter((result): result is CharacterSearchResult => Boolean(result))
            .sort((a, b) => a.score - b.score)
            .slice(0, 8);
    }, [characters, characterSearchQuery]);

    // Automatically handle the charId parameter in the URL
    useEffect(() => {
        const charIdParam = searchParams.get('charId');
        if (charIdParam && characters.length > 0) {
            // If no character is currently selected, or the selected character does not match the parameter, switch
            if (selectedCharId !== charIdParam) {
                const targetChar = characters.find(c => c.id === charIdParam);
                if (targetChar) {
                    handleSelect(targetChar);
                }
            }
        }
    }, [searchParams, characters]); // Include characters as a dependency to ensure the correct selection after the data is loaded

    if (!book) return <div>Book not found</div>;

    const selectedChar = characters.find(c => c.id === selectedCharId);

    const handleSelect = (char: Character) => {
        setSelectedCharId(char.id);
        setFormData({
            name: char.name || '',
            role: char.role,
            description: char.description,
            color: char.color,
            tags: char.tags.join(' '),
            aliases: toAliasInputs(char.aliases)
        });
        // Silently update the URL to keep the state synchronized, preventing dragging back to the old character
        navigate(`/books/${bookId}/settings?charId=${char.id}`, { replace: true });
    };

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

    const handleCreate = async () => {
        await createCharacter(book.id, {
            name: 'New Character',
            color: COLORS[Math.floor(Math.random() * COLORS.length)].value,
            role: 'supporting'
        });
    };

    const handleSave = async () => {
        if (selectedCharId) {
            const trimmedName = formData.name.trim();
            if (!trimmedName) {
                setToastConfig({ show: true, message: 'Character name cannot be empty.' });
                setTimeout(() => setToastConfig({ show: false, message: '' }), 3000);
                return;
            }

            await updateCharacter(book.id, selectedCharId, {
                ...formData,
                name: trimmedName,
                description: formData.description.trim(),
                tags: formData.tags.split(' ').map(t => t.trim()).filter(Boolean),
                aliases: normalizeAliasInputs(formData.aliases, trimmedName)
            });

            // Trigger a custom toast message to notify the user of the successful save
            setToastConfig({ show: true, message: 'Character saved successfully!' });
            setTimeout(() => setToastConfig({ show: false, message: '' }), 3000);
        }
    };

    const handleDeleteClick = () => {
        if (selectedCharId) {
            setShowDeleteModal(true);
        }
    };

    const confirmDelete = async () => {
        if (selectedCharId) {
            await deleteCharacter(book.id, selectedCharId);
            setSelectedCharId(null);
            setShowDeleteModal(false);
            // If the currently selected character (which is also specified by the URL parameter) is deleted,
            // the URL may need to be cleaned up, though a simple handling is sufficient here
            if (searchParams.get('charId') === selectedCharId) {
                navigate(`/books/${bookId}/settings`, { replace: true });
            }
        }
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
        reorderCharacters(book.id, newCharacters);

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
        <div className="h-screen flex flex-col bg-slate-50 dark:bg-slate-950 relative transition-colors duration-300">
            {/* Header */}
            <header className="h-14 bg-white dark:bg-slate-950 border-b border-slate-200 dark:border-slate-800 flex items-center px-4 justify-between flex-shrink-0">
                <div className="flex items-center gap-4">
                    <button onClick={() => navigate(`/editor/${bookId}`)} className="p-2 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-full text-slate-500 dark:text-slate-400">
                        <ArrowLeft size={20} />
                    </button>
                    <h1 className="font-bold text-lg text-slate-800 dark:text-white">World Settings:《{book.title}》</h1>
                </div>

                <div className="flex items-center gap-2">
                    <Button
                        variant="secondary"
                        onClick={() => navigate(`/books/${bookId}/story-outline`)}
                        icon={<ScrollText size={16} />}
                    >
                        Story Outline & Plot Setting
                    </Button>
                    <Button onClick={() => navigate(`/books/${bookId}/relationships`)}>
                        Relationship Map
                    </Button>
                </div>
            </header>

            <div className="flex-1 flex overflow-hidden">
                {/* Sidebar List */}
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
                                className={`flex items-center gap-3 p-2 rounded cursor-pointer transition-colors group ${
                                    selectedCharId === char.id ? 'bg-brand-50 dark:bg-slate-800 border border-brand-200 dark:border-brand-700' : 'hover:bg-slate-100 dark:hover:bg-slate-800 border border-transparent'
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
                                    <div className={`font-medium text-sm truncate ${selectedCharId === char.id ? 'text-brand-900 dark:text-brand-100' : 'text-slate-900 dark:text-slate-100'}`}>{getCharacterDisplayName(char.name)}</div>
                                    <div className="text-xs text-slate-500 dark:text-slate-400 truncate">{char.role}</div>
                                </div>
                            </div>
                        ))}
                    </div>
                </aside>

                {/* Main Edit Area */}
                <main className="flex-1 overflow-y-auto p-8">
                    {selectedChar ? (
                        <div className="max-w-2xl mx-auto bg-white dark:bg-slate-900 p-8 rounded-xl shadow-sm border border-slate-200 dark:border-slate-800">
                            <div className="flex items-start justify-between mb-6">
                                <div className="flex items-center gap-4">
                                    <div className="w-16 h-16 rounded-full flex items-center justify-center text-white text-2xl font-bold shadow-md" style={{ backgroundColor: formData.color }}>
                                        {getCharacterDisplayName(formData.name).charAt(0).toUpperCase()}
                                    </div>
                                    <div>
                                        <h2 className="text-2xl font-bold text-slate-900 dark:text-white">{getCharacterDisplayName(formData.name)}</h2>
                                        <span className="text-xs font-medium px-2 py-0.5 rounded bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 uppercase tracking-wide">{formData.role}</span>
                                    </div>
                                </div>
                                <div className="flex gap-2">
                                    <Button variant="danger" size="sm" onClick={handleDeleteClick} icon={<Trash2 size={16} />}>Delete</Button>
                                    <Button onClick={handleSave} icon={<Save size={16} />}>Save Changes</Button>
                                </div>
                            </div>

                            <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-6">
                                <div className="space-y-4">
                                    <Input
                                        label="Name"
                                        value={formData.name}
                                        onChange={e => setFormData({ ...formData, name: e.target.value })}
                                    />
                                    <div>
                                        <label className="block text-sm font-medium text-slate-700 dark:text-slate-200 mb-1.5">Aliases for Auto-highlight</label>
                                        <div className="space-y-2">
                                            {formData.aliases.map((alias, index) => (
                                                <input
                                                    key={index}
                                                    className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 text-sm outline-none focus:border-brand-500"
                                                    value={alias}
                                                    onChange={e => {
                                                        const nextAliases = [...formData.aliases];
                                                        nextAliases[index] = e.target.value;
                                                        setFormData({ ...formData, aliases: nextAliases });
                                                    }}
                                                    placeholder={`Alias ${index + 1}`}
                                                    maxLength={100}
                                                />
                                            ))}
                                        </div>
                                        <p className="mt-2 text-xs leading-5 text-slate-500 dark:text-slate-400">
                                            Up to 3 aliases. They are only used to auto-highlight this character in editor text.
                                        </p>
                                    </div>
                                    <div>
                                        <label className="block text-sm font-medium text-slate-700 dark:text-slate-200 mb-1.5">Role</label>
                                        <select
                                            className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 text-sm focus:ring-2 focus:ring-brand-200 dark:focus:ring-brand-900 outline-none"
                                            value={formData.role}
                                            onChange={e => setFormData({ ...formData, role: e.target.value as Character['role'] })}
                                        >
                                            <option value="protagonist">Protagonist</option>
                                            <option value="antagonist">Antagonist</option>
                                            <option value="supporting">Supporting</option>
                                            <option value="mob">Mob</option>
                                        </select>
                                    </div>
                                </div>
                                <div>
                                    <label className="block text-sm font-medium text-slate-700 dark:text-slate-200 mb-1.5">Theme Color</label>
                                    <div className="grid grid-cols-4 gap-2">
                                        {COLORS.map(c => (
                                            <button
                                                key={c.value}
                                                onClick={() => setFormData({ ...formData, color: c.value })}
                                                className={`h-8 rounded-md transition-transform hover:scale-105 ${formData.color === c.value ? 'ring-2 ring-offset-2 ring-slate-400 dark:ring-offset-slate-900' : ''}`}
                                                style={{ backgroundColor: c.value }}
                                                title={c.name}
                                            />
                                        ))}
                                    </div>
                                </div>
                            </div>

                            <div className="mb-6">
                                <label className="block text-sm font-medium text-slate-700 dark:text-slate-200 mb-1.5">Tags (space separated)</label>
                                <div className="relative">
                                    <Tag className="absolute left-3 top-2.5 text-slate-400" size={16} />
                                    <input
                                        className="w-full pl-10 pr-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 text-sm outline-none focus:border-brand-500"
                                        value={formData.tags}
                                        onChange={e => setFormData({ ...formData, tags: e.target.value })}
                                        placeholder="e.g. Brave, Sword Master, Fire Magic"
                                    />
                                </div>
                            </div>

                            <div>
                                <label className="block text-sm font-medium text-slate-700 dark:text-slate-200 mb-1.5">Biography & Notes</label>
                                <textarea
                                    className="w-full h-40 px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 text-sm outline-none focus:border-brand-500 resize-none"
                                    value={formData.description}
                                    onChange={e => setFormData({ ...formData, description: e.target.value })}
                                    placeholder="Enter character description, personality, backstory..."
                                />
                            </div>
                        </div>
                    ) : (
                        <div className="h-full flex flex-col items-center justify-center text-slate-400 dark:text-slate-500">
                            <UserIcon size={48} className="mb-4 text-slate-200 dark:text-slate-700" />
                            <p>Select a character to edit or create a new one.</p>
                        </div>
                    )}
                </main>
            </div>

            {/* Delete Confirmation Modal */}
            {showDeleteModal && (
                <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[100] backdrop-blur-sm">
                    <div className="bg-white dark:bg-slate-900 p-6 rounded-lg shadow-xl max-w-sm w-full mx-4 border border-slate-200 dark:border-slate-800 animate-in fade-in zoom-in duration-200">
                        <div className="flex items-center gap-3 mb-4 text-rose-600">
                            <div className="p-2 bg-rose-100 rounded-full"><AlertTriangle size={24} /></div>
                            <h3 className="text-lg font-bold text-slate-900 dark:text-white">Delete Character?</h3>
                        </div>
                        <p className="text-slate-600 dark:text-slate-300 mb-6 text-sm leading-relaxed">
                            Are you sure you want to delete the character of <span className="font-bold text-slate-800 dark:text-white">{getCharacterDisplayName(formData.name)}</span>? <br/>
                            This action cannot be undone.
                        </p>
                        <div className="flex justify-end gap-3">
                            <Button variant="ghost" onClick={() => setShowDeleteModal(false)}>Cancel</Button>
                            <Button variant="primary" className="bg-rose-600 hover:bg-rose-700 text-white border-none shadow-md shadow-rose-200" onClick={confirmDelete}>Delete</Button>
                        </div>
                    </div>
                </div>
            )}
            {/* Custom Tailwind Toast Notification */}
            {toastConfig.show && (
                <div className="fixed top-6 left-1/2 -translate-x-1/2 z-[200] bg-slate-800/95 backdrop-blur text-white px-5 py-3 rounded-full shadow-2xl flex items-center gap-3 animate-in fade-in slide-in-from-top-8 duration-300">
                    <CheckCircle2 size={18} className="text-emerald-400" />
                    <span className="text-sm font-medium tracking-wide">{toastConfig.message}</span>
                </div>
            )}
        </div>
    );
};

export default CharacterSettings;
