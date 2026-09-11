import apiClient from '../services/api';
import type { AiContinueSettings, AutoHighlightSettings, EditorSpacingSettings } from '../types';
import type { UserDto, PreferencesDto } from './dto';
import { mapUser, mapPreferences } from './mappers';

// apiClient returns response bodies, not Axios response envelopes.
// All request and conversion failures reject; UI fallbacks belong to the caller.
export const accountApi = {
    async login(username: string, password: string) {
        return mapUser(await apiClient.post<UserDto>('/auth/login', { username, password }));
    },
    register: (username: string, password: string, nickname: string) =>
        apiClient.post<void>('/auth/register', { username, password, nickname }),
    updateNickname: (nickname: string) => apiClient.put<Pick<UserDto, 'nickname'>>('/auth/me/nickname', { nickname }),
    async getPreferences() {
        return mapPreferences(await apiClient.get<PreferencesDto>('/user-settings/me'));
    },
    saveDarkMode: (darkMode: boolean) => apiClient.put<void>('/user-settings/me/dark-mode', { darkMode }),
    saveSpacing: (settings: EditorSpacingSettings) => apiClient.put<void>('/user-settings/me/editor-spacing', settings),
    saveAiContinue: (settings: AiContinueSettings) => apiClient.put<void>('/user-settings/me/ai-continue', {
        aiContinueContextChars: settings.contextChars, aiContinueOutputChars: settings.outputChars,
    }),
    saveAutoHighlight: (settings: AutoHighlightSettings) => apiClient.put<void>('/user-settings/me/auto-highlight', settings),
};
