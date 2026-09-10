import apiClient from '../services/api';
import type { AiContinueSettings, AutoHighlightSettings, EditorSpacingSettings } from '../types';
import type { UserDto, PreferencesDto } from './dto';
import { mapUser, mapPreferences } from './mappers';

// apiClient's response interceptor already unwraps response.data.
// All request and conversion failures reject; UI fallbacks belong to the caller.
export const accountApi = {
    async login(username: string, password: string) {
        return mapUser(await apiClient.post<unknown, UserDto>('/auth/login', { username, password }));
    },
    register: (username: string, password: string, nickname: string) =>
        apiClient.post<unknown, void>('/auth/register', { username, password, nickname }),
    updateNickname: (nickname: string) => apiClient.put<unknown, Pick<UserDto, 'nickname'>>('/auth/me/nickname', { nickname }),
    async getPreferences() {
        return mapPreferences(await apiClient.get<unknown, PreferencesDto>('/user-settings/me'));
    },
    saveDarkMode: (darkMode: boolean) => apiClient.put<unknown, void>('/user-settings/me/dark-mode', { darkMode }),
    saveSpacing: (settings: EditorSpacingSettings) => apiClient.put<unknown, void>('/user-settings/me/editor-spacing', settings),
    saveAiContinue: (settings: AiContinueSettings) => apiClient.put<unknown, void>('/user-settings/me/ai-continue', {
        aiContinueContextChars: settings.contextChars, aiContinueOutputChars: settings.outputChars,
    }),
    saveAutoHighlight: (settings: AutoHighlightSettings) => apiClient.put<unknown, void>('/user-settings/me/auto-highlight', settings),
};
