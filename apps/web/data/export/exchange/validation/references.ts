import type {
    ExchangeBook,
    ExchangeBrainstormWorkspace,
    ExchangeChapter,
    ExchangeCharacter,
    ExchangeForeshadowing,
    ExchangeGraph,
    ExchangePlanning,
    ExchangeVolume,
} from '../types';
import { comparePositionAndId, compareStrings, type ValidationContext } from './core';

export function validateReferences(
    context: ValidationContext,
    book: ExchangeBook,
    volumes: ExchangeVolume[],
    chapters: ExchangeChapter[],
    characters: ExchangeCharacter[],
    graphs: ExchangeGraph[],
    foreshadowings: ExchangeForeshadowing[],
    planning: ExchangePlanning,
    brainstormWorkspaces: ExchangeBrainstormWorkspace[],
): void {
    const volumeById = new Map(volumes.map(item => [item.id, item]));
    const chapterById = new Map(chapters.map(item => [item.id, item]));
    const characterById = new Map(characters.map(item => [item.id, item]));
    const noteById = new Map(foreshadowings.map(item => [item.id, item]));
    const chapterOrder = new Map(chapters.map((chapter, index) => [chapter.id, index]));
    const volumeOrder = new Map(volumes.map((volume, index) => [volume.id, index]));
    const chapterIndex = new Map(chapters.map((chapter, index) => [chapter.id, index]));

    if (volumes.some(volume => volume.bookId !== book.id)) context.add('$.volumes', 'REFERENCE_MISMATCH', 'Every volume must belong to book.id.');
    if (chapters.some(chapter => chapter.bookId !== book.id || !volumeById.has(chapter.volumeId) || volumeById.get(chapter.volumeId)?.bookId !== book.id)) {
        context.add('$.chapters', 'REFERENCE_MISMATCH', 'Every chapter must reference a volume in the same book.');
    }
    const expectedChapterOrder = [...chapters].sort((left, right) => (
        (volumeOrder.get(left.volumeId) ?? Number.MAX_SAFE_INTEGER) - (volumeOrder.get(right.volumeId) ?? Number.MAX_SAFE_INTEGER)
        || comparePositionAndId(left, right)
    ));
    if (chapters.some((chapter, index) => chapter !== expectedChapterOrder[index])) context.add('$.chapters', 'UNSORTED', 'Chapters must be sorted by volume order, position and id.');
    if (characters.some(character => character.bookId !== book.id)) context.add('$.characters', 'REFERENCE_MISMATCH', 'Every character must belong to book.id.');
    if (graphs.some(graph => graph.bookId !== book.id)) context.add('$.graphs', 'REFERENCE_MISMATCH', 'Every graph must belong to book.id.');

    const noteIdsByChapter = new Map<string, Set<string>>();
    foreshadowings.forEach(note => {
        if (!chapterById.has(note.chapterId)) context.add('$.foreshadowings', 'REFERENCE_NOT_FOUND', `Foreshadowing ${note.id} references a missing chapter.`);
        else {
            const ids = noteIdsByChapter.get(note.chapterId) ?? new Set<string>();
            ids.add(note.id);
            noteIdsByChapter.set(note.chapterId, ids);
        }
    });
    chapters.forEach(chapter => {
        const noteIds = noteIdsByChapter.get(chapter.id) ?? new Set<string>();
        if (chapter.foreshadowingIds.length !== noteIds.size || chapter.foreshadowingIds.some(id => !noteIds.has(id))) {
            context.add(`$.chapters[${chapterIndex.get(chapter.id) ?? 0}].foreshadowingIds`, 'REFERENCE_MISMATCH', 'Chapter foreshadowingIds must enumerate exactly the notes owned by the chapter.');
        }
    });
    const expectedNotes = [...foreshadowings].sort((left, right) => (
        (chapterOrder.get(left.chapterId) ?? Number.MAX_SAFE_INTEGER) - (chapterOrder.get(right.chapterId) ?? Number.MAX_SAFE_INTEGER)
        || compareStrings(left.id, right.id)
    ));
    if (foreshadowings.some((note, index) => note !== expectedNotes[index])) context.add('$.foreshadowings', 'UNSORTED', 'Foreshadowings must be sorted by chapter order and id.');

    context.foreshadowingMarks.forEach(mark => {
        const note = noteById.get(mark.id);
        if (!note) context.add(mark.path, 'REFERENCE_NOT_FOUND', `Foreshadowing note ${mark.id} does not exist in this export.`);
        else if (note.chapterId !== mark.chapterId) context.add(mark.path, 'REFERENCE_MISMATCH', 'A foreshadowing mark must reference a note in the same chapter.');
    });
    context.canonicalMentionIds.forEach(mention => {
        if (!characterById.has(mention.id)) context.add(mention.path, 'REFERENCE_NOT_FOUND', `Mention character ${mention.id} does not exist in this export.`);
    });

    graphs.forEach((graph, graphIndex) => {
        const nodes = new Map(graph.nodes.map(node => [node.nodeKey, node]));
        graph.nodes.forEach((node, nodeIndex) => {
            if (!characterById.has(node.characterId)) context.add(`$.graphs[${graphIndex}].nodes[${nodeIndex}].characterId`, 'REFERENCE_NOT_FOUND', `Graph node ${node.nodeKey} references a missing character.`);
        });
        graph.edges.forEach((edge, edgeIndex) => {
            if (!nodes.has(edge.sourceNodeKey)) context.add(`$.graphs[${graphIndex}].edges[${edgeIndex}].sourceNodeKey`, 'REFERENCE_NOT_FOUND', `Graph edge ${edge.id} references a missing source node instance.`);
            if (!nodes.has(edge.targetNodeKey)) context.add(`$.graphs[${graphIndex}].edges[${edgeIndex}].targetNodeKey`, 'REFERENCE_NOT_FOUND', `Graph edge ${edge.id} references a missing target node instance.`);
        });
    });

    if (planning.bookId !== book.id) context.add('$.planning.bookId', 'REFERENCE_MISMATCH', 'Planning must belong to book.id.');
    planning.chapterSummaries.forEach((summary, index) => {
        const chapter = chapterById.get(summary.chapterId);
        if (!chapter) context.add(`$.planning.chapterSummaries[${index}].chapterId`, 'REFERENCE_NOT_FOUND', 'Planning summary references a missing chapter.');
        else {
            if (summary.sourceChapterVersion !== undefined && summary.sourceChapterVersion > chapter.databaseVersion) context.add(`$.planning.chapterSummaries[${index}].sourceChapterVersion`, 'REFERENCE_MISMATCH', 'sourceChapterVersion cannot be newer than the exported chapter snapshot.');
            if (summary.generationMetadata) {
                if (summary.generationMetadata.source.bookId !== book.id) {
                    context.add(`$.planning.chapterSummaries[${index}].generationMetadata.source.bookId`, 'REFERENCE_MISMATCH', 'Summary generation metadata must belong to book.id.');
                }
            }
        }
    });
    planning.plotSettings.forEach((plot, index) => {
        [...plot.chapterIds, ...(plot.missingChapterIds ?? [])].forEach((chapterId, chapterIndexValue) => {
            if (!chapterById.has(chapterId)) context.add(`$.planning.plotSettings[${index}].chapterIds[${chapterIndexValue}]`, 'REFERENCE_NOT_FOUND', 'Plot setting references a missing chapter.');
        });
    });
    const expectedSummaries = [...planning.chapterSummaries].sort((left, right) => (
        (chapterOrder.get(left.chapterId) ?? Number.MAX_SAFE_INTEGER) - (chapterOrder.get(right.chapterId) ?? Number.MAX_SAFE_INTEGER)
        || compareStrings(left.chapterId, right.chapterId)
    ));
    if (planning.chapterSummaries.some((item, index) => item !== expectedSummaries[index])) context.add('$.planning.chapterSummaries', 'UNSORTED', 'Chapter summaries must be sorted by chapter order and id.');
    const expectedPlots = [...planning.plotSettings].sort((left, right) => left.createdAt - right.createdAt || compareStrings(left.id, right.id));
    if (planning.plotSettings.some((item, index) => item !== expectedPlots[index])) context.add('$.planning.plotSettings', 'UNSORTED', 'Plot settings must be sorted by createdAt and id.');

    brainstormWorkspaces.forEach((workspace, workspaceIndex) => {
        if (workspace.bookId !== book.id) context.add(`$.brainstormWorkspaces[${workspaceIndex}].bookId`, 'REFERENCE_MISMATCH', 'Brainstorm workspace must belong to book.id.');
        workspace.selectedChapterIds.forEach((chapterId, chapterIndexValue) => {
            if (!chapterById.has(chapterId)) context.add(`$.brainstormWorkspaces[${workspaceIndex}].selectedChapterIds[${chapterIndexValue}]`, 'REFERENCE_NOT_FOUND', 'Brainstorm workspace references a missing chapter.');
        });
        if (typeof workspace.contextSnapshot.bookId === 'string' && workspace.contextSnapshot.bookId !== book.id) context.add(`$.brainstormWorkspaces[${workspaceIndex}].contextSnapshot.bookId`, 'REFERENCE_MISMATCH', 'Brainstorm context snapshot must belong to book.id.');
        if (workspace.selectedOptionId !== undefined && workspace.selectedOptionId !== null && !workspace.generatedOptions.some(option => option.id === workspace.selectedOptionId)) {
            context.add(`$.brainstormWorkspaces[${workspaceIndex}].selectedOptionId`, 'REFERENCE_NOT_FOUND', 'selectedOptionId must reference a saved generated option.');
        }
        const metadata = workspace.generationMetadata;
        if (metadata) {
            if (metadata.source.bookId !== book.id) context.add(`$.brainstormWorkspaces[${workspaceIndex}].generationMetadata.source.bookId`, 'REFERENCE_MISMATCH', 'Generation metadata must belong to book.id.');
            metadata.source.selectedChapters.forEach((selected, selectedIndex) => {
                const chapter = chapterById.get(selected.chapterId);
                if (!chapter) context.add(`$.brainstormWorkspaces[${workspaceIndex}].generationMetadata.source.selectedChapters[${selectedIndex}]`, 'REFERENCE_NOT_FOUND', 'Generation metadata references a missing chapter.');
                else if (selected.databaseVersion > chapter.databaseVersion) context.add(`$.brainstormWorkspaces[${workspaceIndex}].generationMetadata.source.selectedChapters[${selectedIndex}].databaseVersion`, 'REFERENCE_MISMATCH', 'Generation source version cannot be newer than the exported chapter snapshot.');
            });
        }
    });
}
