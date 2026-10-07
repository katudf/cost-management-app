import { useState, useEffect, useMemo, useCallback } from 'react';
import { supabase } from '../lib/supabase';
import { toDateStr, addDays } from '../utils/dateUtils';

// コメント配列から projectId → { dateStr: comment } のルックアップを作る純関数。
// 行単位の参照を安定させるため、案件ごとにオブジェクトを分ける。
export function buildCellCommentLookup(comments) {
    const lookup = {};
    comments.forEach(c => {
        if (!lookup[c.project_id]) lookup[c.project_id] = {};
        lookup[c.project_id][c.date] = c.comment;
    });
    return lookup;
}

// 配置表バーチャートのセル（案件×日付）コメントの取得・保存・削除
export function useAssignmentCellComments({ startDate, totalDays, showToast }) {
    const [comments, setComments] = useState([]);

    const startStr = toDateStr(startDate);
    const endStr = toDateStr(addDays(startDate, totalDays - 1));

    const fetchComments = useCallback(async () => {
        const { data, error } = await supabase
            .from('AssignmentCellComments')
            .select('id, project_id, date, comment')
            .gte('date', startStr)
            .lte('date', endStr);
        if (error) {
            console.error('セルコメント取得エラー:', error);
            return;
        }
        setComments(data || []);
    }, [startStr, endStr]);

    useEffect(() => {
        fetchComments();
    }, [fetchComments]);

    const commentsByProject = useMemo(() => buildCellCommentLookup(comments), [comments]);

    const deleteCellComment = useCallback(async (projectId, dateStr) => {
        const { error } = await supabase
            .from('AssignmentCellComments')
            .delete()
            .eq('project_id', projectId)
            .eq('date', dateStr);
        if (error) {
            console.error('セルコメント削除エラー:', error);
            showToast?.('コメントの削除に失敗しました', 'error');
            return false;
        }
        setComments(prev => prev.filter(c => !(c.project_id === projectId && c.date === dateStr)));
        return true;
    }, [showToast]);

    // 空文字ならコメント削除として扱う
    const saveCellComment = useCallback(async (projectId, dateStr, text) => {
        const comment = (text || '').trim();
        if (!comment) return deleteCellComment(projectId, dateStr);

        const { data, error } = await supabase
            .from('AssignmentCellComments')
            .upsert(
                { project_id: projectId, date: dateStr, comment, updated_at: new Date().toISOString() },
                { onConflict: 'project_id,date' }
            )
            .select('id, project_id, date, comment')
            .single();
        if (error) {
            console.error('セルコメント保存エラー:', error);
            showToast?.('コメントの保存に失敗しました', 'error');
            return false;
        }
        setComments(prev => [
            ...prev.filter(c => !(c.project_id === projectId && c.date === dateStr)),
            data
        ]);
        return true;
    }, [showToast, deleteCellComment]);

    return { commentsByProject, saveCellComment, deleteCellComment, fetchComments };
}
