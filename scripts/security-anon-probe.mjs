#!/usr/bin/env node
/**
 * 匿名（anon）キーで叩いて弾かれることを確認する回帰テスト。
 *
 * 背景:
 *   SECURITY DEFINER 関数は RLS を迂回して postgres 権限で動くため、
 *   EXECUTE 権限を anon から剥奪し忘れると、未認証の第三者が
 *   /rest/v1/rpc/<関数名> から直接呼べてしまう。
 *   実際 restore_estimate / purge_expired_estimates がこの状態になっていた
 *   （20260910054306_fix_estimate_rpc_anon_bypass で修正）。
 *
 *   関数を追加するたびに手作業で確認するのは漏れるので、
 *   「anonから叩けてはいけないもの」を一覧で持ち、CIで毎回検証する。
 *
 * 使い方:
 *   npm run test:security
 *   （.env の VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY を読む）
 *
 * 新しくRPCやテーブルを追加したら、必ずこの一覧にも追記すること。
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');

// ---------------------------------------------------------
// .env 読み込み（dotenv非依存。値は絶対にログに出さない）
// ---------------------------------------------------------
function loadEnv() {
  const env = { ...process.env };
  try {
    const text = readFileSync(resolve(ROOT, '.env'), 'utf8');
    for (const line of text.split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
      if (!m) continue;
      env[m[1]] ??= m[2].replace(/^["']|["']$/g, '');
    }
  } catch {
    // .env が無い場合は環境変数のみを使う（CI想定）
  }
  return env;
}

const env = loadEnv();
const URL_BASE = env.VITE_SUPABASE_URL;
const ANON_KEY = env.VITE_SUPABASE_ANON_KEY;

if (!URL_BASE || !ANON_KEY) {
  console.error('VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY が未設定です');
  process.exit(2);
}

const headers = {
  apikey: ANON_KEY,
  Authorization: `Bearer ${ANON_KEY}`,
  'Content-Type': 'application/json',
};

// ---------------------------------------------------------
// anon から呼べてはいけない RPC
//   引数は「権限チェックを通過したかどうか」を見分けるためだけのダミー。
//   権限エラー(42501)以外が返ったら、そこまで到達している＝NG。
// ---------------------------------------------------------
const FORBIDDEN_RPCS = [
  { name: 'purge_expired_estimates', body: {}, why: '期限切れ見積書の物理削除（破壊的）' },
  { name: 'restore_estimate', body: { p_estimate_id: 1 }, why: '削除済み見積書の復元' },
  { name: 'approve_estimate', body: { p_estimate_id: 1 }, why: '見積書の承認' },
  { name: 'return_estimate', body: { p_estimate_id: 1, p_reason: 'probe' }, why: '見積書の差し戻し' },
  { name: 'is_admin', body: {}, why: 'ロール判定ヘルパー' },
  { name: 'is_staff', body: {}, why: 'ロール判定ヘルパー' },
  { name: 'is_approver_staff', body: {}, why: 'ロール判定ヘルパー' },
  { name: 'current_staff_role', body: {}, why: 'ロール判定ヘルパー' },
  { name: 'protect_estimate_approval_columns', body: {}, why: 'トリガー関数' },
  { name: 'protect_office_staff_privileged_columns', body: {}, why: 'トリガー関数' },
];

// ---------------------------------------------------------
// anon から読めてはいけないテーブル／ビュー
// ---------------------------------------------------------
const FORBIDDEN_READS = [
  { name: 'office_staff', why: '担当者マスタ（個人情報）' },
  { name: 'workers_directory', why: '従業員名簿ビュー' },
  { name: 'estimates', why: '見積書' },
  { name: 'estimate_items', why: '見積明細' },
  { name: 'Customers', why: '顧客情報' },
  { name: 'PurchaseRecords', why: '仕入帳' },
  // 塗料DB系13テーブル（全数を網羅する。
  //   20260910055855_scope_paint_policies_to_authenticated で
  //   ポリシーの対象ロールを authenticated に限定済み）
  { name: 'paint_manufacturers', why: '塗料メーカマスタ' },
  { name: 'paint_process_roles', why: '工程区分マスタ' },
  { name: 'paint_products', why: '塗料製品マスタ' },
  { name: 'paint_classification_axes', why: '塗料分類軸マスタ' },
  { name: 'paint_classification_tags', why: '塗料分類タグ値マスタ' },
  { name: 'paint_product_tags', why: '製品×タグ中間テーブル' },
  { name: 'paint_standards', why: '塗料規格マスタ' },
  { name: 'paint_product_standards', why: '製品×規格中間テーブル' },
  { name: 'paint_abbreviations', why: '塗料略記号マスタ' },
  { name: 'coating_systems', why: '塗装仕様マスタ' },
  { name: 'coating_system_steps', why: '塗装仕様の構成行' },
  { name: 'coating_system_variants', why: '塗装仕様のバリエーション' },
  { name: 'coating_system_abbreviations', why: '塗装仕様略記号マスタ' },
];

// 権限拒否とみなすステータス／エラーコード
const DENIED_CODES = new Set(['42501', 'PGRST202', '42883']);

function isDenied(status, json) {
  if (status === 401 || status === 403 || status === 404) return true;
  if (json && typeof json === 'object' && DENIED_CODES.has(json.code)) return true;
  return false;
}

async function probe(url, init) {
  const res = await fetch(url, init);
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* 非JSONはそのまま扱う */ }
  return { status: res.status, json, text };
}

const failures = [];
let passed = 0;

console.log('=== anon キーによる到達性チェック ===\n');
console.log('--- RPC ---');
for (const { name, body, why } of FORBIDDEN_RPCS) {
  const { status, json, text } = await probe(`${URL_BASE}/rest/v1/rpc/${name}`, {
    method: 'POST', headers, body: JSON.stringify(body),
  });
  if (isDenied(status, json)) {
    passed++;
    console.log(`  OK   ${name}  -> HTTP ${status} ${json?.code ?? ''}`);
  } else {
    failures.push({ kind: 'RPC', name, why, status, detail: text.slice(0, 200) });
    console.log(`  NG   ${name}  -> HTTP ${status}  ${text.slice(0, 120)}`);
  }
}

console.log('\n--- テーブル／ビュー ---');
for (const { name, why } of FORBIDDEN_READS) {
  const { status, json, text } = await probe(
    `${URL_BASE}/rest/v1/${encodeURIComponent(name)}?select=*&limit=1`,
    { method: 'GET', headers },
  );
  // RLSで弾かれる場合は HTTP 200 + 空配列になる。これは「読めていない」ので合格。
  const emptyByRls = status === 200 && Array.isArray(json) && json.length === 0;
  if (isDenied(status, json) || emptyByRls) {
    passed++;
    const how = emptyByRls ? 'RLSにより0件' : `HTTP ${status} ${json?.code ?? ''}`;
    console.log(`  OK   ${name}  -> ${how}`);
  } else {
    const n = Array.isArray(json) ? json.length : '?';
    failures.push({ kind: 'TABLE', name, why, status, detail: `${n}件返却` });
    console.log(`  NG   ${name}  -> HTTP ${status} ${n}件返却`);
  }
}

console.log(`\n=== 結果: ${passed}件合格 / ${failures.length}件失敗 ===`);

if (failures.length > 0) {
  console.error('\n未認証で到達できてしまう箇所があります:');
  for (const f of failures) {
    console.error(`  [${f.kind}] ${f.name} — ${f.why}`);
    console.error(`         HTTP ${f.status}: ${f.detail}`);
  }
  console.error('\nSECURITY DEFINER 関数なら EXECUTE を anon, PUBLIC から剥奪し、');
  console.error('テーブルなら RLS ポリシーの TO 句を authenticated に絞ってください。');
  process.exit(1);
}

console.log('未認証で到達できる箇所はありません。');
