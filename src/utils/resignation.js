// 退職済みかの判定。DB の public.is_resigned() と同じく「退職日が日本時間の今日以前」を退職済みとする
// （docs/specs/worker-login.md §3.1）。退職予定日が先の日付なら、その日まではまだ在籍として扱う。

// 日本時間の今日（YYYY-MM-DD）
export const todayInJapan = (now = new Date()) =>
    new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Tokyo' }).format(now);

export const isResigned = (resignationDate, now = new Date()) => {
    const date = String(resignationDate ?? '').trim().slice(0, 10);
    if (!date) return false;
    return date <= todayInJapan(now);
};
