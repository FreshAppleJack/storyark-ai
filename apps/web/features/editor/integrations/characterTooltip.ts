import tippy from 'tippy.js';
import type { Character } from '../../../types';

/** Builds the HTML card shown when hovering a character mention. */
export const buildCharacterTooltipContent = (char: Character): string => {
    const initial = char.name.charAt(0);
    return `
        <div class="p-3 bg-white text-slate-800 rounded-lg shadow-xl border border-slate-100 max-w-xs animate-in fade-in zoom-in duration-100 font-sans text-left">
            <div class="flex items-start gap-3 mb-2">
                <div class="w-10 h-10 rounded-full flex items-center justify-center text-white text-sm font-bold shadow-sm flex-shrink-0" style="background-color: ${char.color}">
                    ${initial}
                </div>
                <div class="flex-1 min-w-0">
                    <div class="font-bold text-sm truncate">${char.name}</div>
                    ${char.role ? `<div class="text-[10px] uppercase tracking-wide text-slate-400 font-semibold mt-0.5">${char.role}</div>` : ''}
                </div>
            </div>
            ${char.tags && char.tags.length > 0 ? `
                <div class="flex flex-wrap gap-1 mb-2">
                    ${char.tags.map(tag =>
        `<span class="px-1.5 py-0.5 rounded text-[10px] font-medium bg-slate-100 text-slate-600 border border-slate-200">${tag}</span>`
    ).join('')}
                </div>
            ` : ''}
            ${char.description ? `
                <div class="text-xs text-slate-600 leading-relaxed line-clamp-4 border-t border-slate-50 pt-2 mt-1">
                    ${char.description}
                </div>
            ` : ''}
        </div>
    `;
};

export interface CharacterTooltipHandlerOptions {
    getCharacter: (id: string) => Character | undefined;
    /** Return true to suppress the tooltip (e.g. while a context menu is open). */
    shouldSuppress?: () => boolean;
}

/**
 * Creates the mouseover handler that attaches a character card tooltip
 * to mention elements inside the editor. The editor component wires it
 * to the editor element and owns the listener lifecycle.
 */
export const createCharacterTooltipHandler = ({ getCharacter, shouldSuppress }: CharacterTooltipHandlerOptions) => {
    return (event: MouseEvent) => {
        const target = (event.target as HTMLElement).closest('.mention');
        if (target && !((target as any)._tippy)) {
            if (shouldSuppress?.()) return;

            const charId = target.getAttribute('data-id');
            if (charId) {
                const char = getCharacter(charId);
                if (char) {
                    tippy(target, {
                        content: buildCharacterTooltipContent(char),
                        allowHTML: true,
                        interactive: true,
                        placement: 'top',
                        animation: 'shift-away',
                        duration: [200, 150],
                        delay: [200, 0],
                        appendTo: document.body,
                    });
                }
            }
        }
    };
};
