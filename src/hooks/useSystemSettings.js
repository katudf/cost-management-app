import { useState, useEffect, useCallback } from 'react';
import { supabase } from '../lib/supabase';

/**
 * system_settings（id=1 固定行）へのアクセスを集約するモジュール。
 *
 * このテーブルは id=1 の1行しか存在しない。INSERT は行わず UPDATE のみ。
 * UI コンポーネントから supabase.from('system_settings') を直接叩かないこと。
 *
 * - React の外（useSupabaseData の一括取得や WorkerApp の fetchWithCache）から使う場合は
 *   下の素の関数（fetchSystemSettings / updateSystemSettings）を呼ぶ。
 * - コンポーネントから使う場合は useSystemSettings / useCompanyInfoSettings を使う。
 *
 * エラーは throw する（トースト通知は呼び出し側の責務）。
 */

/** 自社情報の基本項目（印影は含まない） */
const COMPANY_BASIC_FIELDS =
    'company_name, company_zip, company_address, company_tel, company_fax';

/** 自社情報の全項目（印影2列を含む）。設定画面の編集対象。 */
const COMPANY_ALL_FIELDS = `${COMPANY_BASIC_FIELDS}, stamp_company_url, stamp_representative_url`;

/** 時給の既定値（DB取得前の初期表示に使う） */
export const DEFAULT_HOURLY_WAGE = 3500;

/** 見積の有効期限（日数）の既定値 */
const DEFAULT_EST_VALID_DAYS = 30;

/**
 * system_settings（id=1）から指定カラムを取得する素の関数。
 * @param {string} columns 取得カラム（既定は全カラム）
 * @returns {Promise<object|null>}
 */
export async function fetchSystemSettings(columns = '*') {
    const { data, error } = await supabase
        .from('system_settings')
        .select(columns)
        .eq('id', 1)
        .single();
    if (error) throw error;
    return data || null;
}

/**
 * system_settings（id=1）を更新する素の関数。updated_at は自動で付与する。
 * @param {object} patch 更新したいカラムだけを渡す
 */
async function updateSystemSettings(patch) {
    const { error } = await supabase
        .from('system_settings')
        .update({ ...patch, updated_at: new Date().toISOString() })
        .eq('id', 1);
    if (error) throw error;
}

/**
 * system_settings のうち「システム設定」タブが編集する項目（時給・見積有効期限）。
 *
 * 保存ボタンの活性判定のため、編集中の値と「確定済みの値」を別々に保持する。
 * 時給の確定値はアプリ全体（useSupabaseData）が持つため引数で受け取り、
 * 保存成功時に onSaved 経由で書き戻す（再取得はしない）。
 *
 * @param {object}   params
 * @param {number}   params.hourlyWage       アプリ全体が保持している確定済みの時給
 * @param {Function} params.onHourlyWageSaved 保存成功時に確定値を書き戻すコールバック
 */
export function useSystemSettings({ hourlyWage, onHourlyWageSaved }) {
    const [localWage, setLocalWage] = useState(hourlyWage);
    const [validDays, setValidDays] = useState(DEFAULT_EST_VALID_DAYS);
    const [initialValidDays, setInitialValidDays] = useState(DEFAULT_EST_VALID_DAYS);
    const [isSaving, setIsSaving] = useState(false);

    useEffect(() => {
        let cancelled = false;
        const load = async () => {
            try {
                const data = await fetchSystemSettings('est_default_valid_days');
                if (cancelled || !data) return;
                const days = data.est_default_valid_days ?? DEFAULT_EST_VALID_DAYS;
                setValidDays(days);
                setInitialValidDays(days);
            } catch (e) {
                // 取得失敗時は既定値のまま表示を続ける（保存はユーザー操作で明示的に行われる）
                console.error('システム設定取得エラー:', e);
            }
        };
        load();
        return () => { cancelled = true; };
    }, []);

    /** 未保存の変更があるか（保存ボタンの活性判定） */
    const isDirty = localWage !== hourlyWage || validDays !== initialValidDays;

    /** 保存する。失敗時は throw する（トースト通知は呼び出し側の責務）。 */
    const save = useCallback(async () => {
        setIsSaving(true);
        try {
            await updateSystemSettings({
                hourly_wage: localWage,
                est_default_valid_days: validDays,
            });
            // 再取得はせず、確定値をその場で書き戻す
            onHourlyWageSaved(localWage);
            setInitialValidDays(validDays);
        } finally {
            setIsSaving(false);
        }
    }, [localWage, validDays, onHourlyWageSaved]);

    return { localWage, setLocalWage, validDays, setValidDays, isSaving, isDirty, save };
}

/**
 * 自社情報（system_settings の id=1 固定行）を読み取り専用で取得する。
 *
 * @param {string} columns 取得カラム。**呼び出し側でインライン文字列を渡してよい**
 *                         （JSは文字列リテラルをインターンするため再取得は起きない）が、
 *                         動的に組み立てた文字列を渡すと毎レンダリング再取得になるので注意。
 */
export function useCompanyInfo(columns = COMPANY_BASIC_FIELDS) {
    const [companyInfo, setCompanyInfo] = useState(null);
    const [isLoading, setIsLoading] = useState(true);

    useEffect(() => {
        let cancelled = false;
        const load = async () => {
            try {
                const data = await fetchSystemSettings(columns);
                if (!cancelled) setCompanyInfo(data);
            } catch (e) {
                console.error('自社情報取得エラー:', e);
            } finally {
                if (!cancelled) setIsLoading(false);
            }
        };
        load();
        return () => { cancelled = true; };
    }, [columns]);

    return { companyInfo, isLoading };
}

/** 自社情報フォームの空の初期値（7項目） */
const EMPTY_COMPANY_INFO = {
    company_name: '',
    company_zip: '',
    company_address: '',
    company_tel: '',
    company_fax: '',
    stamp_company_url: '',
    stamp_representative_url: '',
};

/**
 * 自社情報の編集用フック（設定画面の「自社情報」タブ）。
 *
 * 取得に失敗したまま保存すると、空文字で既存の住所・電話・印影パスを
 * 上書き破壊してしまう。そのため取得成功フラグ（isLoaded）と
 * 取得失敗フラグ（loadFailed）を分けて持ち、失敗時は保存を禁止する。
 */
export function useCompanyInfoSettings() {
    const [companyInfo, setCompanyInfo] = useState(EMPTY_COMPANY_INFO);
    const [isLoaded, setIsLoaded] = useState(false);
    const [loadFailed, setLoadFailed] = useState(false);
    const [isSaving, setIsSaving] = useState(false);

    useEffect(() => {
        let cancelled = false;
        const load = async () => {
            try {
                const data = await fetchSystemSettings(COMPANY_ALL_FIELDS);
                if (cancelled) return;
                if (data) {
                    setCompanyInfo({
                        company_name: data.company_name || '',
                        company_zip: data.company_zip || '',
                        company_address: data.company_address || '',
                        company_tel: data.company_tel || '',
                        company_fax: data.company_fax || '',
                        stamp_company_url: data.stamp_company_url || '',
                        stamp_representative_url: data.stamp_representative_url || '',
                    });
                }
                setIsLoaded(true);
            } catch (e) {
                console.error('自社情報取得エラー:', e);
                if (!cancelled) setLoadFailed(true);
            }
        };
        load();
        return () => { cancelled = true; };
    }, []);

    /** 保存する。失敗時は throw する（トースト通知は呼び出し側の責務）。 */
    const save = useCallback(async () => {
        if (loadFailed) {
            // 取得に失敗した状態のフォームは空文字ばかりなので、保存すると既存値を破壊する
            throw new Error('自社情報の読み込みに失敗しているため保存できません。画面を再読み込みしてください。');
        }
        setIsSaving(true);
        try {
            await updateSystemSettings(companyInfo);
        } finally {
            setIsSaving(false);
        }
    }, [companyInfo, loadFailed]);

    return { companyInfo, setCompanyInfo, isLoaded, loadFailed, isSaving, save };
}
