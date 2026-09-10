import React, { useEffect, useRef, useState } from 'react';
import { Check, Loader2, UserRound } from 'lucide-react';
import { Button } from '../../../components/ui/Button';
import { Input } from '../../../components/ui/Input';
import { useSession } from '../../../InteractionContent/SessionContext';
import { SettingShell } from './SettingControls';
export function ProfileSettings() {
    const { user, updateNickname } = useSession();
    const currentNickname = user?.nickname || user?.username || '';
    const [nicknameDraft, updateDraft] = useState(currentNickname);
    const [isSavingNickname, setIsSavingNickname] = useState(false);
    const [nicknameStatus, setNicknameStatus] = useState<'idle' | 'saved' | 'error'>('idle');
    const normalizedNicknameDraft = nicknameDraft.trim();
    const isNicknameDirty = normalizedNicknameDraft !== currentNickname;
    const isNicknameInvalid = !normalizedNicknameDraft || normalizedNicknameDraft.length > 64;
    const previousNickname = useRef(currentNickname);
    const revision = useRef(0);
    const busy = useRef(false);
    const mounted = useRef(false);
    useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
    useEffect(() => {
        const previous = previousNickname.current;
        previousNickname.current = currentNickname;
        // A remote refresh may update a pristine form, never newer local typing.
        if (!busy.current) updateDraft(draft => draft === previous ? currentNickname : draft);
    }, [currentNickname]);
    const setNicknameDraft = (value: string) => { revision.current++; updateDraft(value); };
    const handleNicknameSubmit = async (event: React.FormEvent) => {
        event.preventDefault();
        if (!isNicknameDirty || isNicknameInvalid || busy.current) return;
        busy.current = true;
        const snapshotRevision = revision.current;
        setIsSavingNickname(true);
        setNicknameStatus('idle');
        try {
            const ok = await updateNickname(normalizedNicknameDraft);
            if (mounted.current && revision.current === snapshotRevision) setNicknameStatus(ok ? 'saved' : 'error');
        } finally { busy.current = false; if (mounted.current) setIsSavingNickname(false); }
    };
    return (
        <SettingShell
            title="Author Profile"
            description="Update the nickname shown across your books, editor surfaces, and profile-aware interactions."
            icon={<UserRound size={22} />}
        >
            <form onSubmit={handleNicknameSubmit} className="space-y-3 rounded-2xl border border-slate-200 bg-slate-50 p-4 dark:border-slate-800 dark:bg-slate-950">
                <Input
                    label="User nickname"
                    value={nicknameDraft}
                    maxLength={64}
                    error={isNicknameInvalid}
                    helperText={
                        isNicknameInvalid
                            ? 'Nickname must be 1-64 characters.'
                            : nicknameStatus === 'saved'
                                ? 'Nickname saved.'
                                : nicknameStatus === 'error'
                                    ? 'Save failed. Please try again.'
                                    : 'Used as your author name across the workspace.'
                    }
                    onChange={(event) => {
                        setNicknameDraft(event.target.value);
                        setNicknameStatus('idle');
                    }}
                />
                <div className="flex items-center justify-between gap-3">
                    <p className="text-xs text-slate-400 dark:text-slate-500">{normalizedNicknameDraft.length}/64</p>
                    <Button
                        type="submit"
                        variant="primary"
                        size="sm"
                        disabled={!isNicknameDirty || isNicknameInvalid || isSavingNickname}
                    >
                        {isSavingNickname ? <Loader2 size={14} className="mr-2 animate-spin" /> : <Check size={14} className="mr-2" />}
                        Save
                    </Button>
                </div>
            </form>
        </SettingShell>
    );
}
