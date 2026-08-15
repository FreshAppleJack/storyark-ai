import React, { useState, useEffect } from 'react';
import { X, Check } from 'lucide-react';
import { Button } from '../ui/Button';

interface RelationshipEditDialogProps {
    isOpen: boolean;
    initialLabel: string;
    sourceName?: string;
    targetName?: string;
    onClose: () => void;
    onSave: (label: string) => void;
    onDelete?: () => void;
}

const RelationshipEditDialog: React.FC<RelationshipEditDialogProps> = ({
                                                                           isOpen,
                                                                           initialLabel,
                                                                           sourceName,
                                                                           targetName,
                                                                           onClose,
                                                                           onSave,
                                                                           onDelete
                                                                       }) => {
    const [label, setLabel] = useState(initialLabel);

    useEffect(() => {
        setLabel(initialLabel);
    }, [initialLabel, isOpen]);

    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/20 backdrop-blur-sm animate-in fade-in duration-200">
            <div className="bg-white dark:bg-slate-900 rounded-xl shadow-2xl border border-slate-200 dark:border-slate-800 w-96 p-6 scale-100 animate-in zoom-in-95 duration-200">
                <div className="flex justify-between items-center mb-4">
                    <h3 className="text-lg font-bold text-slate-800 dark:text-white">Relationship</h3>
                    <button onClick={onClose} className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 transition-colors">
                        <X size={20} />
                    </button>
                </div>

                <div className="mb-4">
                    <p className="text-sm text-slate-500 dark:text-slate-400 mb-2">
                        How are <span className="font-semibold text-blue-600">{sourceName || 'Source'}</span> and <span className="font-semibold text-blue-600">{targetName || 'Target'}</span> related?
                    </p>
                    <input
                        type="text"
                        value={label}
                        onChange={(e) => setLabel(e.target.value)}
                        placeholder="e.g. Friends, Rivals, Siblings..."
                        className="w-full px-3 py-2 border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-100 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent text-sm"
                        autoFocus
                        onKeyDown={(e) => {
                            if (e.key === 'Enter') onSave(label);
                        }}
                    />
                </div>

                <div className="flex justify-between items-center gap-3">
                    {onDelete && (
                        <button
                            onClick={onDelete}
                            className="text-xs text-rose-500 hover:text-rose-700 font-medium px-2 py-1"
                        >
                            Delete Line
                        </button>
                    )}
                    <div className="flex gap-2 ml-auto">
                        <Button variant="secondary" size="md" onClick={onClose}>
                            Cancel
                        </Button>
                        <Button size="md" onClick={() => onSave(label)}>
                            <Check size={16} className="mr-1" />
                            Confirm
                        </Button>
                    </div>
                </div>
            </div>
        </div>
    );
};

export default RelationshipEditDialog;