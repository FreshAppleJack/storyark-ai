import { useCallback, useEffect, useRef, useState } from 'react';
import { toast } from 'react-hot-toast';
import type { Character } from '../../../types';
import { useBooks } from '../../../InteractionContent/BooksContext';
import { showSaveSuccessToast } from '../../../components/ui/saveToast';
import { COLORS, emptyCharacterForm, toCharacterForm, toCharacterPatch, type CharacterFormData } from '../characterForm';

export type CharacterSaveState = 'idle' | 'dirty' | 'saving' | 'saved';

export function useCharacterEditor(bookId: string) {
    const { createCharacter, updateCharacter, deleteCharacter } = useBooks();
    const [selectedCharId, setSelectedCharId] = useState<string | null>(null);
    const [formData, updateForm] = useState(emptyCharacterForm);
    const [showDeleteModal, setShowDeleteModal] = useState(false);
    const [saveState, setSaveState] = useState<CharacterSaveState>('idle');
    const mounted = useRef(false);
    const busy = useRef(false);
    const revision = useRef(0);
    useEffect(() => {
        mounted.current = true;
        return () => { mounted.current = false; };
    }, []);

    const selectCharacter = useCallback((character: Character) => {
        revision.current++;
        setSelectedCharId(character.id);
        updateForm(toCharacterForm(character));
        setSaveState('idle');
        setShowDeleteModal(false);
    }, []);
    const setFormData = (form: CharacterFormData) => {
        revision.current++;
        setSaveState('dirty');
        updateForm(form);
    };
    const handleCreate = async () => {
        if (busy.current) return;
        busy.current = true;
        try {
            const ok = await createCharacter(bookId, {
                name: 'New Character', role: 'supporting', color: COLORS[Math.floor(Math.random() * COLORS.length)].value,
            });
            if (mounted.current && !ok) toast.error('Failed to create character.');
        } finally { busy.current = false; }
    };
    const handleSave = async () => {
        if (!selectedCharId || busy.current) return;
        const patch = toCharacterPatch(formData);
        if (!patch) { toast.error('Character name cannot be empty.'); return; }
        const snapshotRevision = revision.current;
        busy.current = true;
        setSaveState('saving');
        try {
            const ok = await updateCharacter(bookId, selectedCharId, patch);
            if (!mounted.current || snapshotRevision !== revision.current) return;
            if (ok) {
                // The indicator persists like the editor's: it only leaves
                // when the next edit marks the form dirty.
                setSaveState('saved');
                showSaveSuccessToast('Character saved successfully!');
            } else {
                setSaveState('dirty');
                toast.error('Failed to save character. Your draft is still available.');
            }
        } finally { busy.current = false; }
    };
    const deleteSelected = async () => {
        if (!selectedCharId || busy.current) return false;
        const snapshotRevision = revision.current;
        busy.current = true;
        try {
            const ok = await deleteCharacter(bookId, selectedCharId);
            if (!mounted.current || snapshotRevision !== revision.current) return false;
            if (!ok) { toast.error('Failed to delete character.'); return false; }
            setSelectedCharId(null);
            updateForm(emptyCharacterForm());
            setShowDeleteModal(false);
            return true;
        } finally { busy.current = false; }
    };
    return {
        selectedCharId, formData, setFormData, showDeleteModal, setShowDeleteModal,
        saveState, isSaving: saveState === 'saving',
        selectCharacter, handleCreate, handleSave, deleteSelected
    };
}
