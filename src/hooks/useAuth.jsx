import React, { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react';
import { supabase } from '../lib/supabase';

const AuthContext = createContext(null);

export const AuthProvider = ({ children }) => {
    const [session, setSession] = useState(undefined); // undefined = 判定中, null = 未ログイン
    const [currentStaff, setCurrentStaff] = useState(null);
    const [isStaffLoading, setIsStaffLoading] = useState(false);
    const [isPasswordRecovery, setIsPasswordRecovery] = useState(false);
    // 担当者情報を取得済み（または取得中）のユーザーID。
    // トークン自動更新（TOKEN_REFRESHED）やタブ復帰時の SIGNED_IN でも onAuthStateChange が発火するが、
    // そのたびに再取得して isLoading を立てると各画面がローディング表示に切り替わり、
    // 入力中のフォームがアンマウントされて内容が消えてしまう。ユーザーが変わったときだけ取得する。
    const staffUserIdRef = useRef(null);

    const fetchCurrentStaff = useCallback(async (authUserId) => {
        if (!authUserId) {
            staffUserIdRef.current = null;
            setCurrentStaff(null);
            return;
        }
        if (staffUserIdRef.current === authUserId) return;
        staffUserIdRef.current = authUserId;
        setIsStaffLoading(true);
        try {
            const { data, error } = await supabase
                .from('office_staff')
                .select('*')
                .eq('auth_user_id', authUserId)
                .maybeSingle();
            if (error) throw error;
            setCurrentStaff(data || null);
        } catch (error) {
            console.error('担当者情報の取得に失敗しました:', error);
            staffUserIdRef.current = null;
            setCurrentStaff(null);
        } finally {
            setIsStaffLoading(false);
        }
    }, []);

    useEffect(() => {
        if (!supabase) {
            setSession(null);
            return;
        }

        // 招待メールのリンク（type=invite）は SIGNED_IN イベントで届くため、
        // PASSWORD_RECOVERY と同様にパスワード設定を必須にする
        const params = new URLSearchParams(window.location.hash.replace(/^#/, ''));
        const isInviteLink = params.get('type') === 'invite';
        if (isInviteLink) {
            setIsPasswordRecovery(true);
        }

        supabase.auth.getSession().then(({ data }) => {
            setSession(data.session || null);
            if (data.session?.user?.id) {
                fetchCurrentStaff(data.session.user.id);
            }
        });

        const { data: listener } = supabase.auth.onAuthStateChange((event, newSession) => {
            if (event === 'PASSWORD_RECOVERY') {
                setIsPasswordRecovery(true);
            }
            if (event === 'SIGNED_IN' && isInviteLink) {
                setIsPasswordRecovery(true);
            }
            setSession(newSession);
            fetchCurrentStaff(newSession?.user?.id);
        });

        return () => {
            listener?.subscription?.unsubscribe();
        };
    }, [fetchCurrentStaff]);

    const signIn = useCallback(async (email, password) => {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
    }, []);

    const signOut = useCallback(async () => {
        await supabase.auth.signOut();
    }, []);

    const resetPasswordForEmail = useCallback(async (email) => {
        const redirectTo = `${window.location.origin}${window.location.pathname}`;
        const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo });
        if (error) throw error;
    }, []);

    const updatePassword = useCallback(async (newPassword) => {
        const { error } = await supabase.auth.updateUser({ password: newPassword });
        if (error) throw error;
        setIsPasswordRecovery(false);
    }, []);

    const cancelPasswordRecovery = useCallback(() => {
        setIsPasswordRecovery(false);
    }, []);

    const value = {
        session,
        isAuthenticated: !!session,
        isLoading: session === undefined || isStaffLoading,
        currentStaff,
        isPasswordRecovery,
        signIn,
        signOut,
        resetPasswordForEmail,
        updatePassword,
        cancelPasswordRecovery,
    };

    return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};

export const useAuth = () => {
    const context = useContext(AuthContext);
    if (!context) {
        throw new Error('useAuth must be used within an AuthProvider');
    }
    return context;
};
