import type { Node, Edge } from '@xyflow/react';
import type { Book, Chapter, Character, Volume, Relation, StoryPlanning, User, HandleConfig, ForeshadowingNote } from '../types';
import type { BookDto, ChapterDto, CharacterDto, VolumeDto, RelationDto, UserDto, PreferencesDto } from './dto';
import { normalizeCharacterName, normalizeCharacterAliases } from '../domain/characterInput';
import { normalizeEditorSpacingSettings, normalizeAiContinueSettings, normalizeAutoHighlightSettings } from '../domain/preferences';
import { parseJsonSafe, parseTags } from '../utils/serialization';

export function mapId(value: unknown): string {
    if ((typeof value === 'string' && value.trim()) || (typeof value === 'number' && Number.isFinite(value))) return String(value);
    throw new Error('API response is missing a valid entity ID');
}

export function mapUser(data: UserDto): User {
    return { id: mapId(data.id), username: data.username, nickname: data.nickname, isAuthenticated: true };
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
    const notes = parseJsonSafe(data.foreshadowings, []);
    return {
        id: mapId(data.id), title: data.title, content: data.content || '', wordCount: data.wordCount || 0,
        status: data.status || 'draft', isEditable: data.isEditable !== false,
        foreshadowings: Array.isArray(notes) ? notes as ForeshadowingNote[] : [],
    };
}

export function mapVolume(data: VolumeDto): Volume {
    return { id: mapId(data.id), title: data.title, chapters: (data.chapters || []).map(mapChapter) };
}

export function mapCharacter(data: CharacterDto, bookId: string): Character {
    return {
        id: mapId(data.id), bookId, name: normalizeCharacterName(data.name),
        aliases: normalizeCharacterAliases(data.aliases, data.name), role: data.role || 'supporting',
        description: data.description || '', color: data.color || '#3b82f6', tags: parseTags(data.tags), avatar: data.avatar,
        handleConfig: parseJsonSafe(data.handleConfig, null) as HandleConfig,
        positionX: data.positionX, positionY: data.positionY,
    };
}

export function mapBooks(data: BookDto[], author: string, now: number): Book[] {
    return data.map(book => ({
        id: mapId(book.id), title: book.title, author, coverColor: book.coverColor || 'bg-blue-600',
        lastModified: book.updatedAt || book.createdAt ? new Date(book.updatedAt || book.createdAt).getTime() : now,
        status: book.status === 2 ? 'completed' : 'serializing', volumes: (book.volumes || []).map(mapVolume),
        characters: Array.isArray(book.characters) ? book.characters.map(character => mapCharacter(character, mapId(book.id))) : [],
    }));
}

export function mapRelations(data: RelationDto[]): Relation[] {
    return data.map(relation => ({
        id: mapId(relation.id), sourceCharId: relation.sourceNodeKey || mapId(relation.sourceCharId),
        targetCharId: relation.targetNodeKey || mapId(relation.targetCharId), label: relation.label,
    }));
}

export const toBookPayload = (book: Book) => ({
    id: Number(book.id), title: book.title, status: book.status === 'completed' ? 2 : 1,
    coverColor: book.coverColor, userId: 0, // Preserve the existing server update contract.
});

export type ChapterWrite = Pick<Chapter, 'title' | 'content' | 'wordCount' | 'status' | 'isEditable' | 'foreshadowings'>;
export const toChapterPayload = (volumeId: string, chapter: ChapterWrite) => ({
    ...chapter, volumeId: Number(volumeId), foreshadowings: JSON.stringify(chapter.foreshadowings),
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
    nodes: nodes.map(node => ({ id: node.id, characterId: Number(node.data.id), x: node.position.x, y: node.position.y, handleConfig: node.data.handleConfig })),
    edges: edges.map(edge => ({ source: edge.source, target: edge.target, sourceHandle: edge.sourceHandle, targetHandle: edge.targetHandle, label: edge.label || '' })),
});
