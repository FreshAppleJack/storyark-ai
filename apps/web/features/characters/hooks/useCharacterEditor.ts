import { useCallback, useEffect, useRef, useState } from 'react';
import { toast } from 'react-hot-toast';
import type { Character } from '../../../types';
import { useBooks } from '../../../InteractionContent/BooksContext';
import { showSaveSuccessToast } from '../../../components/ui/saveToast';
import { COLORS, emptyCharacterForm, toCharacterForm, toCharacterPatch, type CharacterFormData } from '../characterForm';
import { registerWorkDraftFlush } from '../../../services/workDraftFlushRegistry';

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
    const savedRevision = useRef(0);
    const pendingSave = useRef<Promise<boolean> | null>(null);
    const selectedCharIdRef = useRef<string | null>(null);
    const formDataRef = useRef(formData);
    const selectionRequest = useRef(0);
    useEffect(() => {
        mounted.current = true;
        return () => { mounted.current = false; };
    }, []);

    const selectCharacter = useCallback((character: Character) => {
        const nextForm = toCharacterForm(character);
        revision.current++;
        savedRevision.current = revision.current;
        selectedCharIdRef.current = character.id;
        formDataRef.current = nextForm;
        setSelectedCharId(character.id);
        updateForm(nextForm);
        setSaveState('idle');
        setShowDeleteModal(false);
    }, []);
    const setFormData = useCallback((form: CharacterFormData) => {
        revision.current++;
        formDataRef.current = form;
        setSaveState('dirty');
        updateForm(form);
    }, []);

    const flush = useCallback((): Promise<boolean> => {
        if (pendingSave.current) return pendingSave.current;
        if (!selectedCharIdRef.current || savedRevision.current === revision.current) return Promise.resolve(true);
        if (busy.current) return Promise.resolve(false);

        const operation = (async () => {
            busy.current = true;
            setSaveState('saving');
            try {
                do {
                    const snapshotRevision = revision.current;
                    const snapshotCharId = selectedCharIdRef.current;
                    if (!snapshotCharId) return true;

                    const patch = toCharacterPatch(formDataRef.current);
                    if (!patch) {
                        if (mounted.current) {
                            setSaveState('dirty');
                            toast.error('Character name cannot be empty.');
                        }
                        return false;
                    }

                    let ok = false;
                    try {
                        ok = await updateCharacter(bookId, snapshotCharId, patch);
                    } catch (error) {
                        console.error('Failed to save character:', error);
                    }
                    if (!mounted.current) return false;
                    if (!ok) {
                        setSaveState('dirty');
                        toast.error('Failed to save character. Your draft is still available.');
                        return false;
                    }

                    // A character switch should normally wait for this flush,
                    // but do not claim the new character's draft was saved if
                    // another path changed the selection while the request ran.
                    if (selectedCharIdRef.current === snapshotCharId) {
                        savedRevision.current = snapshotRevision;
                    }
                    if (selectedCharIdRef.current === snapshotCharId && revision.current === snapshotRevision) {
                        setSaveState('saved');
                        showSaveSuccessToast('Character saved successfully!');
                    }
                } while (savedRevision.current !== revision.current);
                return true;
            } finally {
                pendingSave.current = null;
                busy.current = false;
                if (mounted.current && savedRevision.current !== revision.current) setSaveState('dirty');
            }
        })();
        pendingSave.current = operation;
        return operation;
    }, [bookId, updateCharacter]);
    useEffect(() => registerWorkDraftFlush(bookId, 'characters', flush), [bookId, flush]);

    const switchCharacter = useCallback(async (character: Character) => {
        if (selectedCharIdRef.current === character.id) return true;
        const request = ++selectionRequest.current;
        const ok = await flush();
        if (!ok || request !== selectionRequest.current) return false;
        selectCharacter(character);
        return true;
    }, [flush, selectCharacter]);

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
    const handleSave = async () => { await flush(); };
    const deleteSelected = async () => {
        const charId = selectedCharIdRef.current;
        if (!charId || busy.current) return false;
        const snapshotRevision = revision.current;
        busy.current = true;
        try {
            const ok = await deleteCharacter(bookId, charId);
            if (!mounted.current || snapshotRevision !== revision.current) return false;
            if (!ok) { toast.error('Failed to delete character.'); return false; }
            revision.current++;
            savedRevision.current = revision.current;
            selectedCharIdRef.current = null;
            formDataRef.current = emptyCharacterForm();
            setSelectedCharId(null);
            updateForm(emptyCharacterForm());
            setSaveState('idle');
            setShowDeleteModal(false);
            return true;
        } finally { busy.current = false; }
    };
    return {
        selectedCharId, formData, setFormData, showDeleteModal, setShowDeleteModal,
        saveState, isDirty: saveState === 'dirty' || saveState === 'saving', isSaving: saveState === 'saving',
        selectCharacter, switchCharacter, flush, handleCreate, handleSave, deleteSelected
    };
}
