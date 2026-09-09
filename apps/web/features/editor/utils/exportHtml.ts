/**
 * Pure HTML builders for chapter export (Word / PDF).
 * The handlers in the page own editor access and file saving; these functions
 * only assemble the markup so they can be unit-tested without a DOM editor.
 */

/**
 * Wraps the editor HTML with a centered chapter title; shared by Word and PDF.
 */
export function buildChapterExportHtml(title: string, editorHtml: string): string {
    return `
        <div style="font-family: 'Songti SC', serif; padding: 20px;">
            <h1 style="text-align: center; margin-bottom: 20px;">${title}</h1>
            ${editorHtml}
        </div>
    `;
}

/**
 * Builds a complete HTML document so Word recognizes UTF-8 encoding.
 */
export function buildWordExportDocument(title: string, chapterHtml: string): string {
    return `
        <!DOCTYPE html>
        <html>
        <head>
            <meta charset="utf-8">
            <title>${title}</title>
            <style>
                body { font-family: "Songti SC", "SimSun", serif; font-size: 14pt; line-height: 1.5; }
                p { margin-bottom: 1em; text-indent: 2em; }
            </style>
        </head>
        <body>
            ${chapterHtml}
        </body>
        </html>
    `;
}
