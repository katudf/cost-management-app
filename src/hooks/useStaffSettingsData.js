import { useState, useCallback } from 'react';
import { supabase } from '../lib/supabase';

/**
 * 担当者・関係者管理のデータ操作。
 * ログインID の発行・割り当て・リセット・変更と、ログインのある担当者の削除は
 * Edge Function manage-staff-login を経由する（docs/specs/login-id.md §5）。
 */

// Edge Function のエラー本文（{ error: '...' }）を取り出して画面に出せるようにする
// （作業員のログイン操作 useWorkerLogins.js も使う）
export async function invokeManageStaffLogin(body) {
    const { data, error } = await supabase.functions.invoke('manage-staff-login', { body });
    if (error) {
        const errorBody = await error.context?.json?.().catch(() => null);
        throw new Error(errorBody?.error || error.message);
    }
    return data;
}

/** ログイン中の本人のログインID（未割り当てなら null） */
export async function fetchMyLoginId() {
    const { data, error } = await supabase.rpc('get_my_login_id');
    if (error) throw error;
    return data || null;
}

export function useStaffSettingsData() {
    const [staffList, setStaffList] = useState([]);
    const [isLoading, setIsLoading] = useState(true);

    const refetch = useCallback(async () => {
        setIsLoading(true);
        try {
            // ログインIDは auth.users 側（架空メール）にしか無いため RPC で取得して合成する。互いに依存しないので同時に取る。
            // 管理者以外は0件が返る（IDは表示しない）。取得失敗時も一覧自体は表示する。
            //   login_id     : 割り当て済みのID
            //   legacy_email : まだIDに移行していない人のメールアドレス（移行期間のみ）
            const [
                { data, error },
                { data: logins, error: loginError },
            ] = await Promise.all([
                supabase.from('office_staff').select('*').order('name', { ascending: true }),
                supabase.rpc('get_office_staff_login_ids'),
            ]);

            if (error) throw error;
            if (loginError) console.warn('担当者ログインIDの取得に失敗しました:', loginError);
            const loginMap = new Map((logins || []).map(l => [l.staff_id, l]));

            setStaffList((data || []).map(s => ({
                ...s,
                login_id: loginMap.get(s.id)?.login_id || null,
                legacy_email: loginMap.get(s.id)?.legacy_email || null,
            })));
        } finally {
            setIsLoading(false);
        }
    }, []);

    const createStaff = useCallback(async (payload) => {
        const { error } = await supabase.from('office_staff').insert([payload]);
        if (error) throw error;
    }, []);

    const updateStaff = useCallback(async (id, payload) => {
        // RLSで更新権限がない場合も、PostgRESTはエラーを返さず0件更新のまま成功を返す。
        // deleteStaff と同様に .select() で更新された行を受け取り、0件なら明示的にエラーにする。
        const { data, error } = await supabase.from('office_staff').update(payload).eq('id', id).select();
        if (error) throw error;
        if (!data || data.length === 0) {
            throw new Error('更新する権限がないか、対象の担当者が見つかりません。');
        }
    }, []);

    const deleteStaff = useCallback(async (staff) => {
        // ログインのある担当者は Auth ユーザーも一緒に消すため Edge Function 経由にする
        // （DB のトリガーが直接の削除を拒否する）
        if (staff.auth_user_id) {
            await invokeManageStaffLogin({ action: 'delete', staffId: staff.id });
            return;
        }
        // RLSで削除権限がない場合、PostgRESTはエラーを返さず0件削除のまま204を返す。
        // .select() で削除された行を受け取り、0件なら権限不足として明示的にエラーにする。
        const { data, error } = await supabase.from('office_staff').delete().eq('id', staff.id).select();
        if (error) throw error;
        if (!data || data.length === 0) {
            throw new Error('削除する権限がないか、対象の担当者が見つかりません。');
        }
    }, []);

    /** ログインのない担当者にIDとパスワードを発行する */
    const createLogin = useCallback(
        (staffId, loginId, password) => invokeManageStaffLogin({ action: 'create', staffId, loginId, password }),
        [],
    );

    /** 移行用。メールでログインしていた担当者にIDを割り当てる（password は任意） */
    const assignLoginId = useCallback(
        (staffId, loginId, password) => invokeManageStaffLogin({ action: 'assign_login_id', staffId, loginId, password: password || undefined }),
        [],
    );

    /** パスワードを管理者が決めた値にリセットする（対象者は全端末でログアウトされる） */
    const resetPassword = useCallback(
        (staffId, password) => invokeManageStaffLogin({ action: 'reset_password', staffId, password }),
        [],
    );

    /** ログインIDを変える */
    const changeLoginId = useCallback(
        (staffId, loginId) => invokeManageStaffLogin({ action: 'change_login_id', staffId, loginId }),
        [],
    );

    return {
        staffList, isLoading, refetch, createStaff, updateStaff, deleteStaff,
        createLogin, assignLoginId, resetPassword, changeLoginId,
    };
}
