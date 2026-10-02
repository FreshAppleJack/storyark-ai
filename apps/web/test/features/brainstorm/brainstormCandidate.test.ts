import { describe, expect, it } from 'vitest';
import { parseBrainstormCandidate } from '../../../features/brainstorm/brainstormCandidate';

const option = {
    title: 'The locked archive opens',
    conflict: 'A rival opens the archive before the protagonists can secure it.',
    motivation: 'The rival wants to erase evidence of an old betrayal.',
    consequences: 'The protagonists lose their safest proof and must trust an enemy witness.',
    development: 'Let the opening expose a partial truth, force a choice, and leave one lead unresolved for the next chapter.',
};
const options = [option, { ...option, title: 'The witness changes sides' }, { ...option, title: 'The clock stops' }];

describe('brainstorm candidate validation', () => {
    it('accepts the minimal structured response and ignores model-generated ids', () => {
        const result = parseBrainstormCandidate(JSON.stringify({ options }));
        expect('errorMessage' in result).toBe(false);
        if ('options' in result) {
            expect(result.options).toHaveLength(3);
            expect(result.options[0]).toMatchObject(option);
            expect(result.options[0].id).not.toBe('');
        }
    });

    it('accepts a fenced response without treating the fence as candidate text', () => {
        const result = parseBrainstormCandidate(`\`\`\`json\n${JSON.stringify({ options })}\n\`\`\``);
        expect('errorMessage' in result).toBe(false);
        if ('options' in result) {
            expect(result.options).toHaveLength(3);
            expect(result.options[0].title).toBe(option.title);
        }
    });

    it('rejects incomplete JSON and wrong field types with a safe message', () => {
        expect(parseBrainstormCandidate(JSON.stringify({ options: [{ ...option, conflict: 42 }, ...options.slice(1)] }))).toEqual({
            errorMessage: 'Some AI directions are incomplete or too long. Try generating again.',
        });
        expect(parseBrainstormCandidate('The previous chapter is excellent.')).toEqual({
            errorMessage: 'The AI response could not be used. Try generating again.',
        });
        expect(parseBrainstormCandidate(`Here are the options: ${JSON.stringify({ options })}`)).toEqual({
            errorMessage: 'The AI response could not be used. Try generating again.',
        });
        expect(parseBrainstormCandidate(JSON.stringify(options))).toEqual({
            errorMessage: 'The AI did not return any usable directions. Try generating again.',
        });
    });

    it('rejects oversized fields and empty option lists', () => {
        expect(parseBrainstormCandidate(JSON.stringify({ options: [] }))).toEqual({
            errorMessage: 'The AI did not return all three directions. Try generating again.',
        });
        expect(parseBrainstormCandidate(JSON.stringify({ options: [{ ...option, development: 'x'.repeat(4001) }, ...options.slice(1)] }))).toEqual({
            errorMessage: 'Some AI directions are incomplete or too long. Try generating again.',
        });
    });
});
