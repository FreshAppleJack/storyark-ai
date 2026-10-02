import type { ExchangeValidationIssue } from '../../data/export/exchange';
import { EXCHANGE_LIMITS } from '../../data/export/exchange/limits';

export function importIssueMessage(issue: ExchangeValidationIssue): string {
    switch (issue.code) {
        case 'UNSUPPORTED_VERSION': return 'This file needs a different version of StoryArk. Try updating the app or choose another export.';
        case 'UNSUPPORTED_ASSET': return 'This file contains attachments StoryArk cannot import. Choose another export.';
        case 'LIMIT_EXCEEDED': return issue.path === '$'
            ? `This file is too large. Choose a StoryArk export under ${Math.round(EXCHANGE_LIMITS.maxExportBytes / 1024 / 1024)} MB.`
            : 'Some content in this file is too large to import. Choose another export.';
        case 'REFERENCE_NOT_FOUND': case 'REFERENCE_MISMATCH': return 'Some chapters or linked items are missing from this file. Try exporting the work again.';
        case 'UNSAFE_CONTENT': case 'FORBIDDEN_FIELD': return 'This file contains information StoryArk cannot safely import. Choose another StoryArk export.';
        default: return 'This file is incomplete or could not be read. Choose another StoryArk export.';
    }
}

export function importWarningMessage(message: string): string {
    if (/unknown field|ignored|unrecognized field/i.test(message)) return 'Some extra information in this file will be ignored.';
    return 'Some chapters use an older or unsupported format. Their text will be preserved, but they cannot be edited yet.';
}
