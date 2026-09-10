import React from 'react';
import { Users } from 'lucide-react';
import type { BrainstormEditor } from '../hooks/useBrainstormWorkspace';
type Props = Pick<BrainstormEditor, 'mentionedCharacters'>;
export function BrainstormContextPanel({ mentionedCharacters }: Props) {
    return (
        <aside className="min-h-0 bg-white dark:bg-slate-900 border-l border-slate-200 dark:border-slate-800 overflow-y-auto p-4">
            <div className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-950">
                <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                    <Users size={15} />
                    Appearing Characters
                </div>
                {mentionedCharacters.length === 0 ? (
                    <p className="mt-4 text-sm leading-6 text-slate-500 dark:text-slate-400">No highlighted characters found in the selected chapters.</p>
                ) : (
                    <div className="mt-4 space-y-3">
                        {mentionedCharacters.map(character => (
                            <div key={character.id} className="rounded-lg border border-slate-200 p-3 dark:border-slate-800">
                                <div className="flex items-center gap-2">
                                    <span className="h-3 w-3 rounded-full" style={{ backgroundColor: character.color }} />
                                    <span className="font-semibold text-slate-900 dark:text-white">{character.name}</span>
                                </div>
                                <p className="mt-1 text-xs uppercase tracking-wide text-slate-400">{character.role}</p>
                                {character.tags.length > 0 && (
                                    <div className="mt-2 flex flex-wrap gap-1.5">
                                        {character.tags.map(tag => (
                                            <span key={tag} className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] text-slate-600 dark:bg-slate-800 dark:text-slate-300">{tag}</span>
                                        ))}
                                    </div>
                                )}
                                {character.description && <p className="mt-2 text-xs leading-5 text-slate-500 dark:text-slate-400">{character.description}</p>}
                            </div>
                        ))}
                    </div>
                )}
            </div>
        </aside>
    );
}
