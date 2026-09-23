export interface User {
  id: string;
  username: string;
  nickname?: string;
  isAuthenticated: boolean;
}

export interface EditorSpacingSettings {
  editorMarginPx: number;
  editorLineHeight: number;
}

export interface AiContinueSettings {
  contextChars: number;
  outputChars: number;
}

export type CharacterRole = 'protagonist' | 'antagonist' | 'supporting' | 'mob';

export interface AutoHighlightSettings {
  disabledRoles: CharacterRole[];
}

export const CHARACTER_ROLE_OPTIONS: Array<{ value: CharacterRole; label: string; description: string }> = [
  { value: 'protagonist', label: 'Protagonist', description: 'Main characters' },
  { value: 'antagonist', label: 'Antagonist', description: 'Opposing characters' },
  { value: 'supporting', label: 'Supporting', description: 'Supporting cast' },
  { value: 'mob', label: 'Mob', description: 'Background characters' },
];

export const EDITOR_SPACING_LIMITS = {
  marginPx: {
    min: 24,
    max: 72,
    step: 4,
    default: 48,
  },
  lineHeight: {
    min: 1.2,
    max: 1.8,
    step: 0.05,
    default: 1.5,
  },
} as const;

export const AI_CONTINUE_LIMITS = {
  contextChars: {
    min: 500,
    max: 6000,
    step: 250,
    default: 2000,
  },
  outputChars: {
    min: 120,
    max: 800,
    step: 20,
    default: 300,
  },
} as const;

export interface Chapter {
  databaseVersion?: number;
  id: string;
  title: string;
  wordCount: number;
  status: 'draft' | 'published';
  content: string;
  isEditable: boolean;
  foreshadowings: ForeshadowingNote[];
  lastModified?: number;
}

export interface ForeshadowingNote {
  id: string;
  excerpt: string;
  note: string;
  isRecovered?: boolean;
  createdAt: number;
  updatedAt: number;
}

export interface ChapterSummary {
  sourceChapterVersion?: number;
  chapterId: string;
  summary: string;
  updatedAt: number;
}

export interface PlotSetting {
  missingChapterIds?: string[];
  id: string;
  title: string;
  details: string;
  chapterIds: string[];
  createdAt: number;
  updatedAt: number;
}

export interface StoryPlanning {
  storySummary: string;
  storyBackground: string;
  chapterSummaries: ChapterSummary[];
  plotSettings: PlotSetting[];
  updatedAt?: number;
}

export interface BrainstormOption {
    id: string;
    title: string;
    conflict: string;
    motivation: string;
    consequences: string;
    development: string;
}

export interface BrainstormGenerationMetadata {
    configId: string;
    modelId: string;
    generatedAt: number;
    promptVersion: string;
    includesPlanning?: boolean;
    retrieval?: {
        retrievalVersion: string;
        requestedAt: number;
        sourceVersions: Array<{
            sourceId: string;
            chapterId: string | null;
            sourceVersion: number;
            indexVersion: number;
        }>;
        includedHitIds: string[];
        indexVersion: number | null;
        embeddingFingerprint: string | null;
    } | null;
    source: {
        bookId: string;
        workspaceDatabaseVersion: number;
        planningDatabaseVersion: number;
        graphDatabaseVersion: number;
        selectedChapters: Array<{ chapterId: string; databaseVersion: number }>;
    };
}

export interface BrainstormWorkspace {
    selectedChapterIds: string[];
    contextSnapshot: Record<string, unknown>;
    generatedOptions: BrainstormOption[];
    selectedOptionId?: string | null;
    finalContent: string;
    generationMetadata?: BrainstormGenerationMetadata;
    updatedAt?: number;
}

// � HandleConfig in types.ts to prevent circular dependencies
export interface HandleConfig {
  top: 'source' | 'target' | 'both' | 'none';
  right: 'source' | 'target' | 'both' | 'none';
  bottom: 'source' | 'target' | 'both' | 'none';
  left: 'source' | 'target' | 'both' | 'none';
}

export interface Character {
  id: string;
  bookId: string;
  name: string;
  aliases: string[];
  role: CharacterRole;
  description: string;
  avatar?: string;
  color: string;
  tags: string[];
  // connection point configuration stored in backend
  handleConfig?: HandleConfig;
  positionX?: number;
  positionY?: number;
  /** Local archive state: archived characters keep their references but stop new matching. */
  isArchived?: boolean;
}

export interface Relation {
  id?: string; // May not have an ID when created
  sourceCharId: string;
  targetCharId: string;
  label: string;
}

export interface Volume {
  id: string;
  title: string;
  chapters: Chapter[];
}

export type BookStatus = 'serializing' | 'completed';

export interface Book {
    id: string;
    title: string;
    author: string;
    status: BookStatus;
    isReadOnly?: boolean;
    coverColor?: string;
  lastModified: number;
  volumes: Volume[];
  characters: Character[];
  relations?: Relation[];
  storyPlanning?: StoryPlanning;
}

// Colors for Style Guide
export interface ColorSwatch {
  name: string;
  class: string;
  hex: string;
  usage: string;
}

export interface TypographySpec {
  role: string;
  font: string;
  size: string;
  weight: string;
  sample: string;
}
