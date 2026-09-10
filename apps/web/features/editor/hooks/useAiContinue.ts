import { useCallback, useEffect, useRef, useState } from 'react';
import { formatAiContinueText } from '../utils/aiContinueText';

interface AiContinuePayload {
    content: string;
    outputLengthChars: number;
}

interface UseAiContinueOptions {
    /** Identity of the chapter the editor currently shows. */
    chapterId: string;
    isReadOnly: boolean;
    hasContent: boolean;
    contextChars: number;
    outputChars: number;
    /** Latest text to continue from (editor text or plain fallback). */
    getContextText: () => string;
    /** Performs the HTTP call and resolves with the raw AI text. */
    requestContinue: (payload: AiContinuePayload) => Promise<string>;
    /** Inserts formatted HTML into the CURRENT editor (no-op when closed). */
    insertResult: (formattedHtml: string) => void;
    /** Notifies the page about a failed request (e.g. toast). */
    onError?: (error: unknown) => void;
}

interface UseAiContinueResult {
    isAiLoading: boolean;
    continueWriting: () => Promise<void>;
}

/**
 * AI continuation with chapter-switch protection. Every request captures
 * the load session (bumped on each chapter switch) and a request sequence
 * number; a result is inserted only when both still match, so a response
 * arriving after a switch — or after switching away and back — is dropped
 * instead of polluting another chapter. A stale request's finally never
 * clears the loading state of a newer one.
 */
export function useAiContinue({
    chapterId,
    isReadOnly,
    hasContent,
    contextChars,
    outputChars,
    getContextText,
    requestContinue,
    insertResult,
    onError,
}: UseAiContinueOptions): UseAiContinueResult {
    const [isAiLoading, setIsAiLoading] = useState(false);
    const sessionRef = useRef(0);
    const requestSeqRef = useRef(0);
    const latestRequestRef = useRef(0);
    const fnsRef = useRef({ getContextText, requestContinue, insertResult, onError });
    useEffect(() => {
        fnsRef.current = { getContextText, requestContinue, insertResult, onError };
    });

    // Every chapter load starts a new session (mount included).
    useEffect(() => {
        sessionRef.current += 1;
    }, [chapterId]);

    // A switch also clears the pending indicator: the old request is dead.
    const [prevChapterId, setPrevChapterId] = useState(chapterId);
    if (prevChapterId !== chapterId) {
        setPrevChapterId(chapterId);
        setIsAiLoading(false);
    }

    const continueWriting = useCallback(async () => {
        if (isReadOnly || !hasContent || isAiLoading) return;
        const requestId = ++requestSeqRef.current;
        latestRequestRef.current = requestId;
        const sessionId = sessionRef.current;
        setIsAiLoading(true);
        try {
            const contextToSend = fnsRef.current.getContextText().slice(-contextChars);
            const aiText = await fnsRef.current.requestContinue({
                content: contextToSend,
                outputLengthChars: outputChars,
            });
            const formatted = formatAiContinueText(aiText);
            const isCurrent = sessionRef.current === sessionId && latestRequestRef.current === requestId;
            if (formatted && isCurrent) {
                // Inserted exactly once into the chapter the request came from;
                // the editor's own update flow persists it as a draft edit.
                fnsRef.current.insertResult(formatted);
            }
        } catch (error) {
            console.error('AI Request Failed:', error);
            fnsRef.current.onError?.(error);
        } finally {
            // Only the newest request may clear the shared loading flag.
            if (latestRequestRef.current === requestId) {
                setIsAiLoading(false);
            }
        }
    }, [isReadOnly, hasContent, isAiLoading, contextChars, outputChars]);

    return { isAiLoading, continueWriting };
}
