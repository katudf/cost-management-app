// src/features/scheduleShare/scheduleShareApi.js
// 配置表のログイン不要共有（共有キー付きURL）の DB 操作

import { supabase } from '../../lib/supabase';

/** 現在の共有キーを取得（管理者のみ。未発行・停止中は null） */
export async function fetchShareToken() {
    const { data, error } = await supabase
        .from('schedule_share')
        .select('token')
        .eq('id', 1)
        .maybeSingle();
    if (error) throw error;
    return data?.token ?? null;
}

/** 共有キーを発行・再発行（旧URLは無効化される） */
export async function regenerateShareToken() {
    const { data, error } = await supabase.rpc('regenerate_schedule_share_token');
    if (error) throw error;
    return data;
}

/** 共有を停止（キーを削除） */
export async function disableShare() {
    const { error } = await supabase.rpc('disable_schedule_share');
    if (error) throw error;
}

/** 共有キーで配置表データを取得（ログイン不要） */
export async function fetchPublicSchedule(key, startStr, endStr) {
    const { data, error } = await supabase.rpc('get_public_schedule', {
        p_key: key,
        p_start: startStr,
        p_end: endStr,
    });
    if (error) throw error;
    return data;
}

/** 共有URLを組み立てる */
export function buildShareUrl(token) {
    return `${window.location.origin}/?mode=schedule&key=${encodeURIComponent(token)}`;
}
