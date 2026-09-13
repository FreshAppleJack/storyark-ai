import React from 'react';
import {
    ChevronRight, Globe, ListTree, Loader2, PanelRightClose, PanelRightOpen, Settings, Wand2,
} from 'lucide-react';
import { Button } from '../../../components/ui/Button';
import { SaveStatusIndicator } from '../../../components/ui/SaveStatusIndicator';
import { ExportMenu } from './ExportMenu';

export type EditorSaveStatus = 'saved' | 'saving' | 'unsaved' | 'error';

interface EditorHeaderProps {
    localMode?: boolean;
    volumeTitle?: string;
    chapterTitle: string;
    hasActiveChapter: boolean;
    saveStatus: EditorSaveStatus;
    aiAvailable?: boolean;
    isAiLoading: boolean;
    isReadOnly: boolean;
    isContextPanelOpen: boolean;
    contextPanelItemCount: number;
    isExporting: boolean;
    onNavigateForeshadowingBoard: () => void;
    onNavigateWorldBuilding: () => void;
    onAIContinue: () => void;
    onStopAI?: () => void;
    onToggleContextPanel: () => void;
    onRetrySave: () => void;
    onNavigateSettings: () => void;
    onExportWord: (event: React.MouseEvent) => void;
    onExportPdf: (event: React.MouseEvent) => void;
}

/**
 * Editor page top bar: breadcrumb, save status, navigation shortcuts,
 * AI continue, context panel toggle, settings and the export dropdown.
 * Purely presentational — every action is delegated to the parent page.
 */
export function EditorHeader({
    localMode = false,
    volumeTitle,
    chapterTitle,
    hasActiveChapter,
    saveStatus,
    aiAvailable = true,
    isAiLoading,
    isReadOnly,
    isContextPanelOpen,
    contextPanelItemCount,
    isExporting,
    onNavigateForeshadowingBoard,
    onNavigateWorldBuilding,
    onAIContinue,
    onStopAI,
    onToggleContextPanel,
    onRetrySave,
    onNavigateSettings,
    onExportWord,
    onExportPdf,
}: EditorHeaderProps): React.ReactElement {
    return (
        <header className="h-14 bg-white dark:bg-slate-950 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between px-6 flex-shrink-0">
            <div className="flex items-center gap-4">
                {hasActiveChapter ? (
                    <div className="flex flex-col">
                        <span className="text-xs text-slate-500 dark:text-slate-400 flex items-center gap-1">
                        {volumeTitle} <ChevronRight size={10}/>
                        </span>
                        <span className="text-sm font-semibold text-slate-900 dark:text-white">{chapterTitle}</span>
                    </div>
                ) : (
                    <span className="text-slate-400 dark:text-slate-500 text-sm">Select a chapter to start writing</span>
                )}
            </div>

            <div className="flex items-center gap-4">
                <SaveStatusIndicator state={saveStatus} savedText={localMode ? 'Saved locally' : 'Saved'} onRetry={onRetrySave} />

                <div className="h-4 mx-1 border-l border-slate-300 dark:border-slate-700" />

                <Button
                    variant="secondary"
                    size="sm"
                    onClick={onNavigateForeshadowingBoard}
                    className="text-brand-600 dark:text-brand-300 border-brand-200 dark:border-brand-800 bg-brand-50 dark:bg-brand-950/40 hover:bg-brand-100 dark:hover:bg-brand-900/50"
                >
                    <ListTree size={16} className="mr-2" />
                    Foreshadowing Board
                </Button>

                <Button
                    variant="secondary"
                    size="sm"
                    onClick={onNavigateWorldBuilding}
                    className="text-brand-600 dark:text-brand-300 border-brand-200 dark:border-brand-800 bg-brand-50 dark:bg-brand-950/40 hover:bg-brand-100 dark:hover:bg-brand-900/50"
                >
                    <Globe size={16} className="mr-2" />
                    World Building
                </Button>

                <div className="h-4 mx-1 border-l border-slate-300 dark:border-slate-700" />

                {isAiLoading ? (
                    <Button
                        variant="secondary"
                        size="sm"
                        className="text-brand-600 dark:text-brand-300 border-brand-200 dark:border-brand-800 bg-brand-50 dark:bg-brand-950/40 hover:bg-brand-100 dark:hover:bg-brand-900/50"
                        onClick={onStopAI}
                    >
                        <Loader2 size={16} className="animate-spin mr-2"/>
                        Stop AI
                    </Button>
                ) : (
                    <Button
                        variant="secondary"
                        size="sm"
                        className="text-brand-600 dark:text-brand-300 border-brand-200 dark:border-brand-800 bg-brand-50 dark:bg-brand-950/40 hover:bg-brand-100 dark:hover:bg-brand-900/50"
                        onClick={onAIContinue}
                        disabled={!aiAvailable || isReadOnly}
                        title={!aiAvailable ? 'Configure a local AI model before generating' : undefined}
                    >
                        <Wand2 size={16} className="mr-2"/>
                        AI Continue
                    </Button>
                )}
                <Button
                    variant="secondary"
                    size="sm"
                    onClick={onToggleContextPanel}
                    className="text-slate-600 dark:text-slate-300"
                    title={isContextPanelOpen ? 'Hide Foreshadowing & Plot' : 'Show Foreshadowing & Plot'}
                >
                    {isContextPanelOpen ? <PanelRightClose size={16} className="mr-2"/> : <PanelRightOpen size={16} className="mr-2"/>}
                    Foreshadowing & Plot
                    {contextPanelItemCount > 0 && (
                        <span className="ml-2 rounded-full bg-slate-200 dark:bg-slate-800 px-1.5 py-0.5 text-[10px] font-semibold text-slate-600 dark:text-slate-300">
                            {contextPanelItemCount}
                        </span>
                    )}
                </Button>
                <div className="h-4 mx-1 border-l border-slate-300 dark:border-slate-700" />
                <Button
                    variant="ghost"
                    size="sm"
                    onClick={onNavigateSettings}
                    title="Global Settings"
                >
                    <Settings className="block w-4 h-4" />
                </Button>

                <ExportMenu isExporting={isExporting} onExportWord={onExportWord} onExportPdf={onExportPdf} />
            </div>
        </header>
    );
}
