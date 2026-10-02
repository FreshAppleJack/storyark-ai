import { describe, expect, it } from 'vitest';
import { HELP_QUESTION_COUNT, HELP_SECTIONS, searchHelp } from '../../../features/help/helpContent';

describe('help guide content and search', () => {
    it('keeps all 60 answers in the six agreed topics with unique disclosure IDs', () => {
        const questions = HELP_SECTIONS.flatMap(section => section.questions);
        expect(HELP_SECTIONS).toHaveLength(6);
        expect(HELP_QUESTION_COUNT).toBe(60);
        expect(new Set(questions.map(item => item.id)).size).toBe(60);
        expect(questions.every(item => item.question.trim() && item.answer.trim())).toBe(true);
    });

    it('finds answer text and alternative search terms across topics', () => {
        expect(searchHelp('  CTRL   windows ').flatMap(section => section.questions).map(item => item.id)).toEqual(['help-question-9']);
        expect(searchHelp('embedding').map(section => section.id)).toEqual(['search']);
        expect(searchHelp('REQUEST TIMEOUT').flatMap(section => section.questions).map(item => item.id)).toEqual(['help-question-54']);
        expect(searchHelp('not-a-guide-term')).toEqual([]);
        expect(searchHelp('   ')).toBe(HELP_SECTIONS);
    });
});
