import { describe, expect, it } from 'vitest';
import { calculateCharacterCount, calculateMixedWordCount } from '../../utils/textUtils';

describe('calculateMixedWordCount', () => {
  // These examples document the existing writing count rules, including full-width punctuation.
  it.each([
    { name: 'Chinese characters and full-width punctuation', text: '你好，世界！', expected: 6 },
    { name: 'English words separated by spaces and punctuation', text: 'Hello, brave world!', expected: 3 },
    { name: 'mixed Chinese and English without separating spaces', text: '你好React世界 hello', expected: 6 },
    { name: 'empty text and whitespace', text: ' \t\r\n\u3000', expected: 0 },
    { name: 'zero-width spaces inserted around mentions', text: '\u200B你好\u200B hello\u200B', expected: 3 },
    { name: 'hyphenated English words', text: 'A state-of-the-art editor is user-friendly.', expected: 5 },
    { name: 'English paragraphs and curly apostrophes', text: 'It’s working\nhello world', expected: 4 },
    { name: 'Unicode whitespace and invisible placeholders', text: 'hello\u2003world\u2060\uFEFF', expected: 2 },
    { name: 'Han characters outside the basic Unicode block', text: '𠮷你好', expected: 3 },
  ])('counts $name', ({ text, expected }) => {
    expect(calculateMixedWordCount(text)).toBe(expected);
  });

  it('returns zero for an empty string or only zero-width spaces', () => {
    expect(calculateMixedWordCount('')).toBe(0);
    expect(calculateMixedWordCount('\u200B\u200B')).toBe(0);
  });
});

describe('calculateCharacterCount', () => {
  it.each([
    ['你好，世界！', 6],
    ['Hello world!', 11],
    ['你好React世界 hello', 14],
    [' \t\r\n\u3000\u200B\u200C\u200D\u2060\uFEFF', 0],
    ['\u200B你好\u200B hello', 7],
    ['𠮷 e\u0301 👩‍💻', 3],
    ['', 0],
  ])('counts visible characters in %j', (text, expected) => {
    expect(calculateCharacterCount(text)).toBe(expected);
  });
});
