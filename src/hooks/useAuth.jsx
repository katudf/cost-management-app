import React, { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react';
import { isAuthSessionMissingError } from '@supabase/supabase-js';
import { supabase } from '../lib/supabase';
import { PASSWORD_CHANGE_KIND, getSessionKind } from '../utils/constants';
import { clearMasterCache } from '../utils/offlineCache';
import { loginInputToEmail } from '../utils/loginId';
import { readJson, writeJson, removeStorage, migrateLegacyWorkerKeys } from '../utils/safeStorage';

const AuthContext = createContext(null);

// サーバー側のセッション失効を確かめる間隔（画面を開いている間）と、フォーカスのたびに確かめすぎないための最短間隔
const SESSION_CHECK_INTERVAL_MS = 5 * 60 * 1000;
const SESSION_CHECK_MIN_GAP_MS = 30 * 1000;
// getUser() がこれらを返したら、そのログインはもう使えない（削除・利用停止されたユーザー）
const SESSION_REVOKED_CODES = new Set(['session_not_found', 'user_not_found', 'user_banned']);

// 担当者・作業員の情報の端末保存（オフライン起動用）。ログインしている Auth ユーザーごとに分ける。
const IDENTITY_CACHE_PREFIX = 'cost-app-identity:';
const loadIdentityCache = (authUserId) => readJson(IDENTITY_CACHE_PREFIX + authUserId);
const saveIdentityCache = (authUserId, value) => writeJson(IDENTITY_CACHE_PREFIX + authUserId, value);
const clearIdentityCache = (authUserId) => { if (authUserId) removeStorage(IDENTITY_CACHE_PREFIX + authUserId); };

export const AuthProvider = ({ children }) => {
    const [session, setSession] = useState(undefined); // undefined = 判定中, null = 未ログイン
    const [currentStaff, setCurrentStaff] = useState(null);
    // 自分の作業員（get_my_worker）。作業員の個人アカウントと担当者兼作業員で入る
    const [currentWorker, setCurrentWorker] = useState(null);
    // 担当者・作業員の情報を取れず、端末の保存も無い（初めてのオフライン起動）。
    // このときは「その他（利用不可）」にせず、通信が戻ったら取り直す
    const [isIdentityUnknown, setIsIdentityUnknown] = useState(false);
    const [isStaffLoading, setIsStaffLoading] = useState(false);
    const [isPasswordRecovery, setIsPasswordRecovery] = useState(false);
    // 担当者情報を取得済み（または取得中）のユーザーID。
    // トークン自動更新（TOKEN_REFRESHED）やタブ復帰時の SIGNED_IN でも onAuthStateChange が発火するが、
    // そのたびに再取得して isLoading を立てると各画面がローディング表示に切り替わり、
    // 入力中のフォームがアンマウントされて内容が消えてしまう。ユーザーが変わったときだけ取得する。
    const staffUserIdRef = useRef(null);
    // 招待リンクからの初回パスワード設定中か。初回設定は変更履歴に記録しない。
    const isInviteFlowRef = useRef(false);

    // 担当者の行と、自分の作業員（作業員の個人アカウント・担当者兼作業員）を取る。
    // 通信できないとき（現場でのオフライン起動）は、前回取れた内容をこの端末の保存から使う
    // （作業員アプリの画面の分岐がこれで決まるため。権限そのものは DB が判定する）。
    const fetchCurrentStaff = useCallback(async (authUserId) => {
        if (!authUserId) {
            staffUserIdRef.current = null;
            setCurrentStaff(null);
            setCurrentWorker(null);
            setIsIdentityUnknown(false);
            return;
        }
        if (staffUserIdRef.current === authUserId) return;
        staffUserIdRef.current = authUserId;
        // 以前の（ログインしている人で分けていない）作業員・現場の保存を、この人のキーへ移す
        migrateLegacyWorkerKeys(authUserId);
        setIsStaffLoading(true);
        try {
            const [staffResult, workerResult] = await Promise.all([
                supabase.from('office_staff').select('*').eq('auth_user_id', authUserId).maybeSingle(),
                supabase.rpc('get_my_worker'),
            ]);
            if (staffResult.error) throw staffResult.error;
            const staff = staffResult.data || null;
            let worker;
            if (workerResult.error) {
                // 作業員の取得だけ失敗したときは、担当者の判定は活かし、作業員は前回の保存を使う
                console.error('作業員情報の取得に失敗しました:', workerResult.error);
                worker = loadIdentityCache(authUserId)?.worker ?? null;
            } else {
                worker = (Array.isArray(workerResult.data) ? workerResult.data[0] : workerResult.data) || null;
            }
            if (staffUserIdRef.current !== authUserId) return;
            setCurrentStaff(staff);
            setCurrentWorker(worker);
            setIsIdentityUnknown(false);
            saveIdentityCache(authUserId, { staff, worker });
        } catch (error) {
            console.error('担当者情報の取得に失敗しました:', error);
            if (staffUserIdRef.current !== authUserId) return;
            const cached = loadIdentityCache(authUserId);
            setCurrentStaff(cached?.staff ?? null);
            setCurrentWorker(cached?.worker ?? null);
            setIsIdentityUnknown(!cached);
            // キャッシュも無ければ、次のイベント（通信の回復など）で取り直せるようにしておく
            if (!cached) staffUserIdRef.current = null;
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

    // 初めてのオフライン起動で担当者・作業員の情報が取れなかったときは、通信が戻ったら取り直す
    const sessionUserId = session?.user?.id || null;
    useEffect(() => {
        if (!isIdentityUnknown || !sessionUserId) return undefined;
        const retry = () => fetchCurrentStaff(sessionUserId);
        window.addEventListener('online', retry);
        return () => window.removeEventListener('online', retry);
    }, [isIdentityUnknown, sessionUserId, fetchCurrentStaff]);

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
        clearIdentityCache(staffUserIdRef.current);
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
        currentWorker,
        sessionKind: getSessionKind(currentStaff, currentWorker, isIdentityUnknown),
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
