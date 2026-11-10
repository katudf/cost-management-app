import { useState, useCallback } from 'react';
import { supabase } from '../lib/supabase';
import { invokeManageStaffLogin } from './useStaffSettingsData';

/**
 * 作業員のログインID（docs/specs/worker-login.md §4.4 / §5）。
 * 一覧は RPC get_worker_login_ids（管理者だけ。それ以外は0件）、操作は Edge Function manage-staff-login の target: 'worker'。
 */

const invokeWorker = (body) => invokeManageStaffLogin({ target: 'worker', ...body });

/** 退職日の保存後に呼ぶ。BAN するかはサーバーが DB の退職日で決める（事務も呼べる） */
export const syncWorkerBan = (workerId) => invokeWorker({ action: 'sync_ban', workerId });

/** ログインのある作業員の削除（BAN → 行の削除 → Auth の削除） */
export const deleteWorkerWithLogin = (workerId) => invokeWorker({ action: 'delete', workerId });

/** 担当者の一覧（作業員に紐付けられる人を選ぶため）。管理者のときだけ ID が付く */
export async function fetchLinkableStaff() {
    const [{ data: staff, error }, { data: logins, error: loginError }] = await Promise.all([
        supabase.from('office_staff').select('id, name, role, auth_user_id').order('name', { ascending: true }),
        supabase.rpc('get_office_staff_login_ids'),
    ]);
    if (error) throw error;
    if (loginError) throw loginError;
    const loginMap = new Map((logins || []).map((l) => [l.staff_id, l.login_id]));
    return (staff || []).map((s) => ({ ...s, login_id: loginMap.get(s.id) || null }));
}

export function useWorkerLogins() {
    // worker_id → { login_id, linked_staff_id, banned }
    const [loginMap, setLoginMap] = useState(() => new Map());

    const refetchLogins = useCallback(async () => {
        const { data, error } = await supabase.rpc('get_worker_login_ids');
        if (error) {
            console.warn('作業員のログインIDの取得に失敗しました:', error);
            return null;
        }
        const next = new Map((data || []).map((row) => [row.worker_id, row]));
        setLoginMap(next);
        return next;
    }, []);

    const createLogin = useCallback(
        (workerId, loginId, password) => invokeWorker({ action: 'create', workerId, loginId, password }), []);
    const resetPassword = useCallback(
        (workerId, password) => invokeWorker({ action: 'reset_password', workerId, password }), []);
    const changeLoginId = useCallback(
        (workerId, loginId) => invokeWorker({ action: 'change_login_id', workerId, loginId }), []);
    const linkStaffAccount = useCallback(
        (workerId, staffId) => invokeWorker({ action: 'link_staff_account', workerId, staffId }), []);
    const unlinkLogin = useCallback(
        (workerId) => invokeWorker({ action: 'unlink', workerId }), []);
    /** 作業員の自分のログインを、同じ人の担当者のログインに統合する（作業員のIDは削除。§5.2） */
    const mergeIntoStaff = useCallback(
        (workerId, staffId) => invokeWorker({ action: 'merge_into_staff', workerId, staffId }), []);

    return {
        loginMap, refetchLogins, createLogin, resetPassword, changeLoginId, linkStaffAccount, unlinkLogin, mergeIntoStaff,
    };
}
