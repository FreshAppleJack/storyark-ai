import type { Chapter, CharacterRole, HandleConfig } from '../types';

export type ApiId = string | number;
export interface EntityDto { id: ApiId; title: string }
export interface UserDto { id: ApiId; username: string; nickname?: string }
export interface ChapterDto extends EntityDto {
    content?: string; wordCount?: number; status?: Chapter['status'];
    isEditable?: boolean; foreshadowings?: unknown;
}
export interface VolumeDto extends EntityDto { chapters?: ChapterDto[] }
export interface CharacterDto {
    id: ApiId; name?: string; aliases?: unknown; role?: CharacterRole;
    description?: string; color?: string; tags?: unknown; avatar?: string;
    handleConfig?: unknown; positionX?: number; positionY?: number;
}
export interface BookDto extends EntityDto {
    coverColor?: string; status?: number; createdAt?: string; updatedAt?: string;
    volumes?: VolumeDto[]; characters?: CharacterDto[];
}
export interface PreferencesDto {
    darkMode?: boolean; editorMarginPx?: number; editorLineHeight?: number;
    aiContinueContextChars?: number; aiContinueOutputChars?: number; autoHighlightTags?: unknown;
}
export interface RelationDto {
    id: ApiId; sourceNodeKey?: string; targetNodeKey?: string;
    sourceCharId?: ApiId; targetCharId?: ApiId; label: string;
    sourceHandle?: string; targetHandle?: string;
}
export interface GraphData {
    nodes: { id?: ApiId; nodeKey: string; characterId: ApiId; positionX: number; positionY: number;
        name?: string; role?: CharacterRole; color?: string; avatar?: string; handleConfig?: string | HandleConfig }[];
    edges: RelationDto[];
}
