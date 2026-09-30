/** Keep an empty editing field valid at display and persistence boundaries. */
export function chapterTitleOrDefault(title: string): string {
    return title.trim() ? title : 'Untitled Chapter';
}
