/**
 * 混合字数统计工具函数
 * 规则：
 * 1. 中文（CJK）：汉字 + 全角标点，每个字符算 1 个字。
 * 2. 英文：以空格/标点分隔的单词算 1 个字。
 * 3. 过滤零宽空格等不可见字符。
 * 4. 不统计中文全角空格 (\u3000)。
 */
export const calculateMixedWordCount = (text: string): number => {
    if (!text) return 0;

    // 1. 移除零宽字符(\u200B)和换行符
    // Tiptap 中插入 Mention 时会添加零宽空格，如果不去除会导致字数虚高
    const cleanText = text.replace(/[\u200B\r\n]+/g, '');

    // 2. CJK 统计 (符合中文网文统计习惯：汉字 + 全角标点 + 常用符号)
    // \u4e00-\u9fa5: 汉字
    // \uff00-\uffef: 全角ASCII、全角标点
    // \u2000-\u206f: 常用标点
    // \u3001-\u303f: CJK 标点
    const cjkRegex = /[\u4e00-\u9fa5\uff00-\uffef\u2000-\u206f\u3001-\u303f]/g;
    const cjkMatches = cleanText.match(cjkRegex) || [];
    const cjkCount = cjkMatches.length;

    // 3. 英文统计
    // 移除 CJK 字符，只保留非 CJK 部分进行单词统计
    // 注意：全角空格 (\u3000) 因为移出了 cjkRegex，所以会保留在 nonCjkText 中。
    // 但它不符合下方英文单词的匹配规则 ([a-zA-Z0-9]...)，只会被视作分隔符，
    // 因此既不会算作中文，也不会算作英文单词，符合预期。
    const nonCjkText = cleanText.replace(cjkRegex, ' ');

    // 使用正则提取单词
    // 匹配规则：字母/数字开头，中间可以包含单引号('或’)或连字符(-)，必须以字母/数字结尾
    // 例子： "It's" -> 1词; "state-of-the-art" -> 1词; "Hello..." -> 忽略...
    const enMatches = nonCjkText.match(/[a-zA-Z0-9]+(?:['’-][a-zA-Z0-9]+)*/g) || [];
    const enCount = enMatches.length;

    return cjkCount + enCount;
};
