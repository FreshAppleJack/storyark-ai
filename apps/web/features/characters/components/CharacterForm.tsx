import React from 'react';
import { AlertTriangle, Save, Tag, Trash2, User as UserIcon } from 'lucide-react';
import { Button } from '../../../components/ui/Button';
import { Input } from '../../../components/ui/Input';
import type { Character } from '../../../types';
import { COLORS, getCharacterDisplayName, type CharacterFormData } from '../characterForm';
interface Props {
    selectedCharId: string | null; formData: CharacterFormData;
    setFormData: (form: CharacterFormData) => void; isSaving: boolean;
    showDeleteModal: boolean; setShowDeleteModal: (show: boolean) => void;
    handleSave: () => Promise<void>; handleDeleteClick: () => void; confirmDelete: () => Promise<void>;
}
export function CharacterForm({ selectedCharId, formData, setFormData, isSaving,
    showDeleteModal, setShowDeleteModal, handleSave, handleDeleteClick, confirmDelete }: Props) {
    return <>
        <main className="flex-1 overflow-y-auto p-8">
            {selectedCharId ? (
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
                            <Button variant="danger" size="sm" onClick={handleDeleteClick} icon={<Trash2 size={16} />}>Archive</Button>
                            <Button disabled={isSaving} onClick={handleSave} icon={<Save size={16} />}>Save Changes</Button>
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
        {showDeleteModal && (
            <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[100] backdrop-blur-sm">
                <div className="bg-white dark:bg-slate-900 p-6 rounded-lg shadow-xl max-w-sm w-full mx-4 border border-slate-200 dark:border-slate-800 animate-in fade-in zoom-in duration-200">
                    <div className="flex items-center gap-3 mb-4 text-rose-600">
                        <div className="p-2 bg-rose-100 rounded-full"><AlertTriangle size={24} /></div>
                        <h3 className="text-lg font-bold text-slate-900 dark:text-white">Archive Character?</h3>
                    </div>
                    <p className="text-slate-600 dark:text-slate-300 mb-6 text-sm leading-relaxed">
                        Archive <span className="font-bold text-slate-800 dark:text-white">{getCharacterDisplayName(formData.name)}</span>?<br />
                        Existing mentions, text and graph references stay linked; the character simply stops
                        appearing in new suggestions and auto-highlighting.
                    </p>
                    <div className="flex justify-end gap-3">
                        <Button variant="ghost" onClick={() => setShowDeleteModal(false)}>Cancel</Button>
                        <Button variant="primary" className="bg-rose-600 hover:bg-rose-700 text-white border-none shadow-md shadow-rose-200" onClick={confirmDelete}>Archive</Button>
                    </div>
                </div>
            </div>
        )}
    </>;
}
