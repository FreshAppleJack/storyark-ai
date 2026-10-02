export interface AiContinueAnchor {
    from: number;
    to: number;
    docSize: number;
    selectedText: string;
    retrievalAnchor: {
        paragraphOrdinal: number;
        textOffset: number;
    };
}
