import { useState, useCallback } from 'react';
import { supabase } from '../lib/supabase';
import { STAFF_ROLE } from '../utils/constants';

// 招待されたロールが最初に使う画面。管理者画面に入れない作業員・閲覧者を管理者画面に案内しないようにする。
const INVITE_LANDING_PAGE = {
    [STAFF_ROLE.WORKER]: 'worker.html',
    [STAFF_ROLE.VIEWER]: 'schedule.html',
};

export function useStaffSettingsData() {
    const [staffList, setStaffList] = useState([]);
    const [isLoading, setIsLoading] = useState(true);

    const refetch = useCallback(async () => {
        setIsLoading(true);
        try {
            const { data, error } = await supabase
                .from('office_staff')
                .select('*')
                .order('name', { ascending: true });

            if (error) throw error;

            // ログイン用メールアドレスは auth.users 側にしか無いため RPC で取得して合成する。
            // 管理者以外は0件が返る（メールは表示しない）。取得失敗時も一覧自体は表示する。
            const { data: emails, error: emailError } = await supabase.rpc('get_office_staff_emails');
            if (emailError) console.warn('担当者メールアドレスの取得に失敗しました:', emailError);
            const emailMap = new Map((emails || []).map(e => [e.staff_id, e.email]));

            setStaffList((data || []).map(s => ({ ...s, email: emailMap.get(s.id) || null })));
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

    const deleteStaff = useCallback(async (id) => {
        // RLSで削除権限がない場合、PostgRESTはエラーを返さず0件削除のまま204を返す。
        // .select() で削除された行を受け取り、0件なら権限不足として明示的にエラーにする。
        const { data, error } = await supabase.from('office_staff').delete().eq('id', id).select();
        if (error) throw error;
        if (!data || data.length === 0) {
            throw new Error('削除する権限がないか、対象の担当者が見つかりません。');
        }
    }, []);

    const inviteStaff = useCallback(async (staffId, email) => {
        // 招待メールのリンク先を、いま開いている画面（本番URL等）を基準に決める。
        // 未指定だと Supabase の Site URL が使われ、localhost に飛ばされることがある。
        // 作業員は作業日報、閲覧者は工程表に直接案内する（管理者画面では「権限がありません」になるため）。
        const role = staffList.find(s => s.id === staffId)?.role;
        const landingPage = INVITE_LANDING_PAGE[role];
        const baseDir = window.location.pathname.replace(/[^/]*$/, '');
        const redirectTo = landingPage
            ? `${window.location.origin}${baseDir}${landingPage}`
            : `${window.location.origin}${window.location.pathname}`;
        const { error } = await supabase.functions.invoke('invite-staff', {
            body: { staffId, email, redirectTo },
        });
        if (error) {
            // Edge Function が返したエラーメッセージ（{ error: '...' }）を取り出して画面に出せるようにする
            const body = await error.context?.json?.().catch(() => null);
            throw new Error(body?.error || error.message);
        }
    }, [staffList]);

    return { staffList, isLoading, refetch, createStaff, updateStaff, deleteStaff, inviteStaff };
}
