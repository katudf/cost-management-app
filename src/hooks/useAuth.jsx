import React, { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react';
import { isAuthSessionMissingError } from '@supabase/supabase-js';
import { supabase } from '../lib/supabase';
import { PASSWORD_CHANGE_KIND } from '../utils/constants';
import { clearMasterCache } from '../utils/offlineCache';
import { loginInputToEmail } from '../utils/loginId';

const AuthContext = createContext(null);

// サーバー側のセッション失効を確かめる間隔（画面を開いている間）と、フォーカスのたびに確かめすぎないための最短間隔
const SESSION_CHECK_INTERVAL_MS = 5 * 60 * 1000;
const SESSION_CHECK_MIN_GAP_MS = 30 * 1000;
// getUser() がこれらを返したら、そのログインはもう使えない（削除・利用停止されたユーザー）
const SESSION_REVOKED_CODES = new Set(['session_not_found', 'user_not_found', 'user_banned']);

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
    // 招待リンクからの初回パスワード設定中か。初回設定は変更履歴に記録しない。
    const isInviteFlowRef = useRef(false);

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

    // 自分の担当者情報（名前・ロール）を変更したあとに読み直す。
    // 画面がローディング表示に切り替わって入力中のフォームが消えないよう、isStaffLoading は立てない。
    const refreshCurrentStaff = useCallback(async () => {
        const authUserId = staffUserIdRef.current;
        if (!authUserId) return;
        const { data, error } = await supabase
            .from('office_staff')
            .select('*')
            .eq('auth_user_id', authUserId)
            .maybeSingle();
        if (error) throw error;
        // 読み直している間にログアウト・別ユーザーへの切替があった場合は反映しない
        if (staffUserIdRef.current !== authUserId) return;
        setCurrentStaff(data || null);
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
            isInviteFlowRef.current = true;
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
                isInviteFlowRef.current = false;
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

    // サーバー側でセッションが消されていないか確かめる（docs/specs/login-id.md §4.2）。
    // 管理者がパスワードをリセットしたり担当者を削除したりすると、その人のセッションはサーバーで削除されるが、
    // 手元のアクセストークンは期限（最大1時間）まで使え続ける。画面に戻ったときと定期的に getUser() を呼び、
    // セッションが無いと分かったらログアウトする。getUser() はセッション削除（session_not_found）を受け取ると
    // 手元のセッションを消して SIGNED_OUT を発火するので、画面は上の onAuthStateChange でログイン画面に戻る。
    // 通信エラー（オフラインの日報入力など）ではログアウトしない。
    const hasSession = !!session;
    useEffect(() => {
        if (!supabase || !hasSession) return undefined;

        let lastCheckedAt = 0;
        let checking = false;
        const verifySession = async ({ force = false } = {}) => {
            const now = Date.now();
            if (checking || (!force && now - lastCheckedAt < SESSION_CHECK_MIN_GAP_MS)) return;
            if (typeof navigator !== 'undefined' && navigator.onLine === false) return;
            checking = true;
            lastCheckedAt = now;
            try {
                const { error } = await supabase.auth.getUser();
                if (error && (isAuthSessionMissingError(error) || SESSION_REVOKED_CODES.has(error.code))) {
                    // 共有端末に名簿・現場一覧が残らないよう、通常のログアウトと同じく後片付けする
                    await supabase.auth.signOut({ scope: 'local' }).catch(() => {});
                    clearMasterCache();
                }
            } catch (error) {
                console.warn('ログイン状態の確認に失敗しました:', error);
            } finally {
                checking = false;
            }
        };

        const onVisible = () => {
            if (document.visibilityState === 'visible') verifySession();
        };
        window.addEventListener('focus', onVisible);
        document.addEventListener('visibilitychange', onVisible);
        const timer = window.setInterval(() => {
            if (document.visibilityState === 'visible') verifySession({ force: true });
        }, SESSION_CHECK_INTERVAL_MS);

        return () => {
            window.removeEventListener('focus', onVisible);
            document.removeEventListener('visibilitychange', onVisible);
            window.clearInterval(timer);
        };
    }, [hasSession]);

    // loginInput はログインID。移行期間（フェーズ1）は従来のメールアドレスも受け付ける（docs/specs/login-id.md §3.3）
    const signIn = useCallback(async (loginInput, password) => {
        const { error } = await supabase.auth.signInWithPassword({ email: loginInputToEmail(loginInput), password });
        if (error) throw error;
    }, []);

    // ログイン中の本人によるパスワード変更（§4.3）。変更すると他の端末はログアウトされ、この端末だけ残る。
    // 現在のパスワードは2段階で確かめる。
    //   1. 現在のパスワードでログインし直す（Supabase Auth の設定に関係なく確かめられる）
    //   2. updateUser に current_password を付ける（「Require current password when updating」がオンならサーバーでも確かめる）
    const changeOwnPassword = useCallback(async (currentPassword, newPassword) => {
        // ログイン用メールアドレスはサーバーから取り直す。ID割り当て直後は、手元のセッションの email が
        // トークン更新まで古い実メールのままのため。
        const { data: userData, error: userError } = await supabase.auth.getUser();
        if (userError || !userData?.user?.email) throw new Error('ログイン情報を確認できませんでした。再度ログインしてください');
        const { error: verifyError } = await supabase.auth.signInWithPassword({
            email: userData.user.email,
            password: currentPassword,
        });
        if (verifyError) {
            throw new Error(verifyError.code === 'invalid_credentials' ? '現在のパスワードが違います' : verifyError.message);
        }

        const { error } = await supabase.auth.updateUser({ password: newPassword, current_password: currentPassword });
        if (error) {
            const messages = {
                current_password_mismatch: '現在のパスワードが違います',
                current_password_required: '現在のパスワードを入力してください',
                same_password: '新しいパスワードが現在のパスワードと同じです',
                weak_password: '新しいパスワードが短すぎるか、弱すぎます',
            };
            throw new Error(messages[error.code] || error.message);
        }
        // 記録に失敗してもパスワード変更自体は成功しているので throw しない（updatePassword と同じ扱い）
        try {
            const { error: logError } = await supabase.rpc('log_password_change', { p_kind: PASSWORD_CHANGE_KIND.SELF });
            if (logError) throw logError;
            return { logged: true };
        } catch (logError) {
            console.error('パスワード変更履歴の記録に失敗しました:', logError);
            return { logged: false };
        }
    }, []);

    const signOut = useCallback(async () => {
        await supabase.auth.signOut();
        // 共有端末でログアウト後も名簿・現場一覧が端末に残らないよう、マスタのキャッシュを消す。
        // 未送信の下書きは消さない（消すかどうかは画面側で確認してから clearDraftQueue を呼ぶ）。
        clearMasterCache();
    }, []);

    const resetPasswordForEmail = useCallback(async (email) => {
        const redirectTo = `${window.location.origin}${window.location.pathname}`;
        const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo });
        if (error) throw error;
    }, []);

    const updatePassword = useCallback(async (newPassword) => {
        const { error } = await supabase.auth.updateUser({ password: newPassword });
        if (error) throw error;
        // システム管理者向けの変更履歴に記録する（日時・端末はサーバー側で取得）。
        // 記録に失敗してもパスワード変更自体は成功しているため throw せず、
        // logged: false を返して画面側で知らせる（招待からの初回設定は記録しないので null）。
        let logged = null;
        if (!isInviteFlowRef.current) {
            try {
                const { error: logError } = await supabase.rpc('log_password_change', { p_kind: PASSWORD_CHANGE_KIND.RECOVERY });
                if (logError) throw logError;
                logged = true;
            } catch (logError) {
                console.error('パスワード変更履歴の記録に失敗しました:', logError);
                logged = false;
            }
        }
        isInviteFlowRef.current = false;
        setIsPasswordRecovery(false);
        return { logged };
    }, []);

    const cancelPasswordRecovery = useCallback(() => {
        setIsPasswordRecovery(false);
    }, []);

    const value = {
        session,
        isAuthenticated: !!session,
        isLoading: session === undefined || isStaffLoading,
        currentStaff,
        refreshCurrentStaff,
        isPasswordRecovery,
        signIn,
        signOut,
        resetPasswordForEmail,
        updatePassword,
        changeOwnPassword,
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
