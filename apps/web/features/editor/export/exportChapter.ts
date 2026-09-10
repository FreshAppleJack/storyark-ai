import { buildChapterExportHtml, buildWordExportDocument } from '../utils/exportHtml';

export type ChapterExportFormat = 'docx' | 'pdf';

export interface ChapterExportSnapshot {
    title: string;
    editorHtml: string;
}

/** Resolves after conversion and download handoff, not after the user saves to disk. */
export async function exportChapter(format: ChapterExportFormat, snapshot: ChapterExportSnapshot): Promise<void> {
    // Capture strings before loading dependencies or waiting for conversion.
    const { title, editorHtml } = snapshot;
    const chapterHtml = buildChapterExportHtml(title, editorHtml);

    if (format === 'docx') {
        const [{ asBlob }, { saveAs }] = await Promise.all([
            import('html-docx-js-typescript'),
            import('file-saver'),
        ]);
        const documentHtml = buildWordExportDocument(title, chapterHtml);
        const result = await asBlob(documentHtml, {
            orientation: 'portrait',
            margins: { top: 720, right: 720, bottom: 720, left: 720 },
        });
        // The library also supports Node buffers; the browser build must return a Blob.
        if (!(result instanceof Blob)) throw new Error('DOCX conversion did not return a Blob');
        saveAs(result, `${title}.docx`);
        return;
    }

    const { default: html2pdf } = await import('html2pdf.js');
    const element = document.createElement('div');
    element.innerHTML = chapterHtml;
    Object.assign(element.style, {
        fontFamily: '"Songti SC", serif',
        fontSize: '12pt',
        lineHeight: '1.8',
        color: '#000',
        padding: '40px',
    });

    // html2pdf shares this property bag across its worker chain. Its declarations
    // omit it, but retaining this worker's overlay lets us clean up failed renders
    // without removing resources owned by another export.
    const worker = html2pdf();
    const resources = worker as typeof worker & {
        prop: { overlay: HTMLElement | null };
    };
    let clonedDocument: Document | undefined;
    const options = {
        margin: 1,
        filename: `${title}.pdf`,
        image: { type: 'jpeg' as const, quality: 0.98 },
        html2canvas: {
            scale: 2,
            useCORS: true,
            onclone: (document: Document) => { clonedDocument = document; },
        },
        jsPDF: { unit: 'in', format: 'a4', orientation: 'portrait' as const },
        pagebreak: { mode: ['avoid-all', 'css', 'legacy'] },
    };

    try {
        await worker.set(options).from(element).save();
    } finally {
        clonedDocument?.defaultView?.frameElement?.remove();
        resources.prop.overlay?.remove();
        element.remove();
    }
}
