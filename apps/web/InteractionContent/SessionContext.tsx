/* eslint-disable react-refresh/only-export-components -- provider + hook
   pairs stay together by design (same pattern as the legacy AppContext). */
import React, { createContext, useContext, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Book, User } from '../types';
import { accountApi } from '../data/accountApi';

interface SessionContextType {
    user: User | null;
    updateNickname: (nickname: string) => Promise<boolean>;
    login: (username: string, pass: string) => Promise<boolean>;
    logout: () => void;
    register: (username: string, pass: string, nickname: string) => Promise<boolean>;
}

const SessionContext = createContext<SessionContextType | undefined>(undefined);

const localSession: SessionContextType = {
    user: null, login: async () => false, register: async () => false,
    updateNickname: async () => false, logout: () => {},
};
/** Compatibility facade only; local startup never mounts authenticated session state. */
export function LocalSessionProvider({ children }: { children: React.ReactNode }) {
    return <SessionContext.Provider value={localSession}>{children}</SessionContext.Provider>;
}

/**
 * Owns the authenticated identity only. Loading initial data is NOT part of
 * login: preferences reload via the preferences provider's user effect and
 * books via the enabled books query once `user` is set. Logout clears the
 * whole query cache so the next account never sees previous data.
 */
export function SessionProvider({ children }: { children: React.ReactNode }): React.ReactElement {
    const [user, setUser] = useState<User | null>(null);
    const queryClient = useQueryClient();
    const booksQueryKey = ['books', user?.id ?? 'anonymous'] as const;

    const login = async (username: string, pass: string) => {
        try {
            const appUser = await accountApi.login(username, pass);
            setUser(appUser);
            return true;
        } catch (error) {
            console.error("Login failed:", error);
            return false;
        }
    };

    const register = async (username: string, pass: string, nickname: string) => {
        try {
            await accountApi.register(username, pass, nickname);
            return true;
        } catch (error) {
            console.error("Registration failed:", error);
            return false;
        }
    };

    const logout = () => {
        setUser(null);
        queryClient.removeQueries();
    };

    const updateNickname = async (nickname: string): Promise<boolean> => {
        const normalizedNickname = nickname.trim();
        if (!user || !normalizedNickname) return false;

        const previousUser = user;
        const previousBooks = queryClient.getQueryData<Book[]>(booksQueryKey);

        const renameEverywhere = (next: string) => {
            setUser(prev => prev ? { ...prev, nickname: next } : prev);
            queryClient.setQueryData<Book[]>(booksQueryKey, (prev = []) => (
                prev.map(book => ({ ...book, author: next }))
            ));
        };

        renameEverywhere(normalizedNickname);
        try {
            const response = await accountApi.updateNickname(normalizedNickname);
            renameEverywhere(response.nickname || normalizedNickname);
            return true;
        } catch (error) {
            console.error("Failed to update nickname:", error);
            setUser(previousUser);
            queryClient.setQueryData(booksQueryKey, previousBooks);
            return false;
        }
    };

    return (
        <SessionContext.Provider value={{ user, updateNickname, login, logout, register }}>
            {children}
        </SessionContext.Provider>
    );
}

export const useSession = () => {
    const context = useContext(SessionContext);
    if (!context) throw new Error('useSession must be used within SessionProvider');
    return context;
};
