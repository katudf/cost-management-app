/**
 * SettingsPanel.jsx と EstimateSidebar.jsx に重複していた日時フォーマットの一本化（§9.26）。
 */

// "2026-07-08T01:23:45.000Z" -> "2026/07/08 10:23"
export const formatDateTime = (val) => {
  if (!val) return '';
  const d = new Date(val);
  if (Number.isNaN(d.getTime())) return '';
  const pad = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}/${pad(d.getMonth() + 1)}/${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
};
