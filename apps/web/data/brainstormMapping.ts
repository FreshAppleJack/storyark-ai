import type { BrainstormWorkspace } from '../types';
import type { BrainstormDto } from './dto';
import { asRecord, parseJsonSafe } from '../utils/serialization';

export const createEmptyBrainstorm = (): BrainstormWorkspace => ({
    selectedChapterIds: [], contextSnapshot: {}, generatedOptions: [], selectedOptionId: null, finalContent: '',
});
const text = (value: unknown) => typeof value === 'string' ? value : '';

export function mapBrainstormResponse(data: BrainstormDto): BrainstormWorkspace {
    if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('Invalid brainstorm response');
    const chapterIds = parseJsonSafe(data.selectedChapterIds, []);
    const options = parseJsonSafe(data.generatedOptions, []);
    const updatedAt = data.updatedAt ? new Date(data.updatedAt).getTime() : undefined;
    return {
        selectedChapterIds: Array.isArray(chapterIds) ? chapterIds.filter(id => typeof id === 'string' || typeof id === 'number').map(String) : [],
        contextSnapshot: asRecord(parseJsonSafe(data.contextSnapshot, {})),
        generatedOptions: Array.isArray(options) ? options.map(asRecord).filter(option => option.id).map(option => ({
            id: String(option.id), title: text(option.title), conflict: text(option.conflict), motivation: text(option.motivation),
            consequences: text(option.consequences), development: text(option.development),
        })) : [],
        selectedOptionId: data.selectedOptionId || null, finalContent: data.finalContent || '',
        updatedAt: Number.isFinite(updatedAt) ? updatedAt : undefined,
    };
}

export const toBrainstormPayload = (workspace: BrainstormWorkspace) => ({
    selectedChapterIds: JSON.stringify(workspace.selectedChapterIds), contextSnapshot: JSON.stringify(workspace.contextSnapshot),
    generatedOptions: JSON.stringify(workspace.generatedOptions), selectedOptionId: workspace.selectedOptionId || null, finalContent: workspace.finalContent,
});
