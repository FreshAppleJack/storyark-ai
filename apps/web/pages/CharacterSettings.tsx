import React, { useEffect } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, ScrollText } from 'lucide-react';
import { Button } from '../components/ui/Button';
import { useBooks } from '../InteractionContent/BooksContext';
import { localBookOptions, localCharactersOptions } from '../data/local/repository';
import type { Character } from '../types';
import { CharacterList } from '../features/characters/components/CharacterList';
import { CharacterForm } from '../features/characters/components/CharacterForm';
import { CharacterSaveGuard } from '../features/characters/components/CharacterSaveGuard';
import { useCharacterEditor } from '../features/characters/hooks/useCharacterEditor';
import { SaveStatusIndicator } from '../components/ui/SaveStatusIndicator';

function CharacterSettingsContent({ bookId }: { bookId: string }) {
    const navigate = useNavigate();
    const [searchParams] = useSearchParams();
    const { getBook, reorderCharacters, storageMode } = useBooks();
    const isLocal = storageMode === 'local';
    // Local mode loads the book detail and characters into the query cache
    // that getBook projects from; legacy mode relies on the books query.
    const detailQuery = useQuery({ ...localBookOptions(bookId), enabled: isLocal });
    // getBook reads the cache indirectly, so explicitly subscribe to data changes.
    const charactersQuery = useQuery({ ...localCharactersOptions(bookId), enabled: isLocal,
        notifyOnChangeProps: ['data', 'error', 'isPending'] });
    const book = getBook(bookId);
    const editor = useCharacterEditor(bookId);
    const { selectedCharId, selectCharacter } = editor;
    const targetCharacter = book?.characters.find(character => character.id === searchParams.get('charId'));
    useEffect(() => {
        if (targetCharacter && targetCharacter.id !== selectedCharId) selectCharacter(targetCharacter);
    }, [targetCharacter, selectedCharId, selectCharacter]);
    const handleSelect = (character: Character) => {
        void editor.switchCharacter(character).then(ok => {
            if (ok) navigate(`/books/${bookId}/settings?charId=${character.id}`, { replace: true });
        });
    };
    const confirmDelete = async () => {
        if (await editor.deleteSelected()) navigate(`/books/${bookId}/settings`, { replace: true });
    };
    if (isLocal) {
        const pending = detailQuery.isPending || charactersQuery.isPending;
        const error = detailQuery.error ?? charactersQuery.error;
        if (pending || error) {
            return <main className="min-h-screen flex flex-col items-center justify-center gap-4 p-8">
                {pending ? <p role="status">Loading local book...</p> : <>
                    <p role="alert">{error?.message}</p>
                    <Button variant="secondary" onClick={() => { void detailQuery.refetch(); void charactersQuery.refetch(); }}>Retry</Button>
                </>}
                <Link to="/dashboard" className="text-brand-600 underline">Back to Bookshelf</Link>
            </main>;
        }
    }
    if (!book) return <div>Book not found</div>;
    return (
        <div className="h-screen flex flex-col bg-slate-50 dark:bg-slate-950 relative transition-colors duration-300">
            <CharacterSaveGuard isDirty={editor.isDirty} flush={editor.flush} />
            <header className="h-14 bg-white dark:bg-slate-950 border-b border-slate-200 dark:border-slate-800 flex items-center px-4 justify-between flex-shrink-0">
                <div className="flex items-center gap-4">
                    <button onClick={() => navigate(`/editor/${bookId}`)} className="p-2 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-full text-slate-500 dark:text-slate-400">
                        <ArrowLeft size={20} />
                    </button>
                    <h1 className="font-bold text-lg text-slate-800 dark:text-white">World Settings:《{book.title}》</h1>
                </div>

                <div className="flex items-center gap-2">
                    {selectedCharId && editor.saveState !== 'idle' && (
                        <SaveStatusIndicator state={editor.saveState === 'dirty' ? 'unsaved' : editor.saveState} />
                    )}
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
                <CharacterList characters={book.characters} selectedCharId={selectedCharId} handleSelect={handleSelect}
                    handleCreate={editor.handleCreate} onReorder={characters => reorderCharacters(bookId, characters)} />
                <CharacterForm {...editor} handleDeleteClick={() => editor.setShowDeleteModal(true)} confirmDelete={confirmDelete} />
            </div>
        </div>
    );
}
export default function CharacterSettings() {
    const { bookId = '' } = useParams();
    return <CharacterSettingsContent key={bookId} bookId={bookId} />;
}
