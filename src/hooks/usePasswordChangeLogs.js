import { useState, useCallback, useEffect } from 'react';
import { supabase } from '../lib/supabase';

/**
 * パスワード変更履歴（password_change_logs）の取得。
 *
 * 閲覧できるのはシステム管理者のみ（RLS で制御）。記録は useAuth の updatePassword が
 * RPC log_password_change 経由で行うため、ここは読み取り専用。
 *
 * エラーは throw する（トースト通知は呼び出し側の責務）。
 */

/** 一覧に表示する件数（新しい順）。未読がこれより多いときは未読をすべて表示する */
export const MAX_LOGS = 100;

/** 未読バッジを定期的に更新する間隔（ミリ秒） */
const UNREAD_REFRESH_INTERVAL_MS = 5 * 60 * 1000;

async function fetchUnreadCount() {
    const { data, error } = await supabase.rpc('count_unread_password_change_logs');
    if (error) throw error;
    return Number(data) || 0;
}

export function usePasswordChangeLogs() {
    const [logs, setLogs] = useState([]);
    const [loading, setLoading] = useState(false);

    /** 一覧を取得して返す。未読分は件数上限を超えても取りこぼさない */
    const reload = useCallback(async () => {
        setLoading(true);
        try {
            const unread = await fetchUnreadCount();
            const { data, error } = await supabase
                .from('password_change_logs')
                .select('*')
                .order('created_at', { ascending: false })
                .limit(Math.max(MAX_LOGS, unread));
            if (error) throw error;
            const rows = data || [];
            setLogs(rows);
            return rows;
        } finally {
            setLoading(false);
        }
    }, []);

    /**
     * 表示した履歴を既読にする。until（表示した中で最新の created_at）までを既読にし、
     * 取得後に追加された履歴は未読のまま残す。
     */
    const markAllRead = useCallback(async (until) => {
        if (!until) return;
        const { error } = await supabase.rpc('mark_password_change_logs_read', { p_until: until });
        if (error) throw error;
    }, []);

    return { logs, loading, reload, markAllRead };
}

/**
 * 未読のパスワード変更件数（ナビの未読バッジ用）。
 * enabled が false（システム管理者以外）のときは問い合わせず 0 のまま。
 * 画面に戻ったとき（focus / visibilitychange）と一定間隔で再取得する。
 * 取得失敗はバッジが出ないだけなので console に留める。
 */
export function usePasswordChangeLogUnread(enabled) {
    const [unreadCount, setUnreadCount] = useState(0);

    const refreshUnread = useCallback(async () => {
        if (!enabled) {
            setUnreadCount(0);
            return;
        }
        try {
            setUnreadCount(await fetchUnreadCount());
        } catch (error) {
            console.error('未読パスワード変更件数の取得に失敗しました', error);
        }
    }, [enabled]);

    useEffect(() => {
        refreshUnread();
        if (!enabled) return undefined;

        const handleVisible = () => {
            if (document.visibilityState === 'visible') refreshUnread();
        };
        window.addEventListener('focus', handleVisible);
        document.addEventListener('visibilitychange', handleVisible);
        const timer = setInterval(handleVisible, UNREAD_REFRESH_INTERVAL_MS);
        return () => {
            window.removeEventListener('focus', handleVisible);
            document.removeEventListener('visibilitychange', handleVisible);
            clearInterval(timer);
        };
    }, [enabled, refreshUnread]);

    return { unreadCount, refreshUnread };
}
