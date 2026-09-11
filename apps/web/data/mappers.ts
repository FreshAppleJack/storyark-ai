import type { Node, Edge } from '@xyflow/react';
import type { Book, Chapter, Character, Volume, Relation, StoryPlanning, User, ForeshadowingNote } from '../types';
import type { BookDto, ChapterDto, CharacterDto, VolumeDto, RelationDto, PreferencesDto } from './dto';
import { normalizeCharacterName, normalizeCharacterAliases } from '../domain/characterInput';
import { normalizeEditorSpacingSettings, normalizeAiContinueSettings, normalizeAutoHighlightSettings } from '../domain/preferences';
import { asRecord, parseTags } from '../utils/serialization';
import { normalizeHandleConfig } from '../domain/relationshipHandles';

export function mapId(value: unknown): string {
    if ((typeof value === 'string' && value.trim()) || (typeof value === 'number' && Number.isSafeInteger(value))) return String(value);
    throw new Error('API response is missing a valid entity ID');
}

export function mapUser(value: unknown): User {
    const data = asRecord(value);
    if (typeof data.username !== 'string' || !data.username.trim()) throw new Error('Invalid authenticated user response');
    return { id: mapId(data.id), username: data.username,
        nickname: typeof data.nickname === 'string' ? data.nickname : undefined, isAuthenticated: true };
}

export function mapPreferences(data: PreferencesDto) {
    return {
        darkMode: data.darkMode,
        spacing: normalizeEditorSpacingSettings(data),
        aiContinue: normalizeAiContinueSettings({ contextChars: data.aiContinueContextChars, outputChars: data.aiContinueOutputChars }),
        autoHighlight: normalizeAutoHighlightSettings({ disabledRoles: parseTags(data.autoHighlightTags) as Character['role'][] }),
    };
}

export function mapChapter(data: ChapterDto): Chapter {
    if (data.content != null && typeof data.content !== 'string') throw new Error('Invalid chapter content');
    return {
        id: mapId(data.id), title: data.title, content: data.content || '', wordCount: data.wordCount || 0,
        status: data.status || 'draft', isEditable: data.isEditable !== false,
        foreshadowings: parseForeshadowings(data.foreshadowings),
    };
}

/** Reject damaged notes instead of silently replacing them with an empty save. */
function parseForeshadowings(value: unknown): ForeshadowingNote[] {
    const parsed: unknown = typeof value === 'string' && value ? JSON.parse(value) : value;
    if (parsed == null || parsed === '') return [];
    if (!Array.isArray(parsed)) throw new Error('Invalid chapter foreshadowings');
    return parsed.map(value => {
        const note = asRecord(value);
        if (typeof note.excerpt !== 'string' || typeof note.note !== 'string') throw new Error('Invalid foreshadowing note');
        return {
            id: mapId(note.id), excerpt: note.excerpt, note: note.note,
            isRecovered: typeof note.isRecovered === 'boolean' ? note.isRecovered : undefined,
            createdAt: typeof note.createdAt === 'number' && Number.isFinite(note.createdAt) ? note.createdAt : 0,
            updatedAt: typeof note.updatedAt === 'number' && Number.isFinite(note.updatedAt) ? note.updatedAt : 0,
        };
    });
}

/** The current server payload uses numeric IDs; never serialize NaN as null. */
export function toServerId(value: unknown): number {
    const id = typeof value === 'string' && value.trim() ? Number(value) : value;
    if (typeof id !== 'number' || !Number.isSafeInteger(id) || id <= 0) throw new Error('Invalid server entity ID');
    return id;
}

export function mapVolume(data: VolumeDto): Volume {
    return { id: mapId(data.id), title: data.title, chapters: (data.chapters || []).map(mapChapter) };
}

export function mapCharacter(data: CharacterDto, bookId: string): Character {
    return {
        id: mapId(data.id), bookId, name: normalizeCharacterName(data.name),
        aliases: normalizeCharacterAliases(data.aliases, data.name), role: data.role || 'supporting',
        description: data.description || '', color: data.color || '#3b82f6', tags: parseTags(data.tags), avatar: data.avatar,
        handleConfig: normalizeHandleConfig(data.handleConfig),
        positionX: data.positionX, positionY: data.positionY,
    };
}

export function mapBooks(data: BookDto[], author: string, now: number): Book[] {
    return data.map(book => ({
        id: mapId(book.id), title: book.title, author, coverColor: book.coverColor || 'bg-blue-600',
        lastModified: parseTimestamp(book.updatedAt || book.createdAt, now),
        status: book.status === 2 ? 'completed' : 'serializing', volumes: (book.volumes || []).map(mapVolume),
        characters: Array.isArray(book.characters) ? book.characters.map(character => mapCharacter(character, mapId(book.id))) : [],
    }));
}

function parseTimestamp(value: string | undefined, fallback: number): number {
    const timestamp = value ? Date.parse(value) : NaN;
    return Number.isFinite(timestamp) ? timestamp : fallback;
}

export function mapRelations(data: RelationDto[]): Relation[] {
    return data.map(relation => ({
        id: mapId(relation.id), sourceCharId: relation.sourceNodeKey || mapId(relation.sourceCharId),
        targetCharId: relation.targetNodeKey || mapId(relation.targetCharId), label: relation.label,
    }));
}

export const toBookPayload = (book: Book) => ({
    id: toServerId(book.id), title: book.title, status: book.status === 'completed' ? 2 : 1,
    coverColor: book.coverColor, userId: 0, // Preserve the existing server update contract.
});

export type ChapterWrite = Pick<Chapter, 'title' | 'content' | 'wordCount' | 'status' | 'isEditable' | 'foreshadowings'>;
export const toChapterPayload = (volumeId: string, chapter: ChapterWrite) => ({
    ...chapter, volumeId: toServerId(volumeId), foreshadowings: JSON.stringify(chapter.foreshadowings),
});

export const toCharacterPayload = (data: Partial<Character>) => ({
    name: normalizeCharacterName(data.name, 'New Character'), aliases: normalizeCharacterAliases(data.aliases, data.name),
    role: data.role || 'supporting', description: data.description || '', color: data.color || '#3b82f6',
    tags: data.tags || [], avatar: data.avatar,
});

export const toPlanningPayload = (planning: StoryPlanning) => ({
    storySummary: planning.storySummary, storyBackground: planning.storyBackground,
    chapterSummaries: JSON.stringify(planning.chapterSummaries), plotSettings: JSON.stringify(planning.plotSettings),
});

export const toGraphPayload = (nodes: Node[], edges: Edge[]) => ({
    nodes: nodes.map(node => ({ id: node.id, characterId: toServerId(node.data.id), x: node.position.x, y: node.position.y, handleConfig: node.data.handleConfig })),
    edges: edges.map(edge => ({ source: edge.source, target: edge.target, sourceHandle: edge.sourceHandle, targetHandle: edge.targetHandle, label: edge.label || '' })),
});
