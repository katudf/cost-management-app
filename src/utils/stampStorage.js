// src/utils/stampStorage.js
// 印影画像（stamps バケット）のURL変換ユーティリティ
// stamps バケットは private のため、表示・PDF埋め込みには署名付きURLを使う

import { supabase } from '../lib/supabase';

const BUCKET = 'stamps';
const SIGNED_URL_EXPIRES_IN = 3600; // 1時間（PDF生成・プレビュー表示中に失効しない長さ）

// DBにはバケット内パスを保存する。ただし private 化以前のデータは
// 公開URL（.../object/public/stamps/xxx.png）のまま残っているため、両形式からパスを取り出す
export const stampPathFromValue = (value) => {
  if (!value) return null;
  const match = value.match(/\/stamps\/(.+)$/);
  return match ? decodeURIComponent(match[1]) : value;
};

// 署名付きURLを取得する。パス未設定なら null を返す
export const getStampSignedUrl = async (value) => {
  const path = stampPathFromValue(value);
  if (!path) return null;
  const { data, error } = await supabase.storage
    .from(BUCKET)
    .createSignedUrl(path, SIGNED_URL_EXPIRES_IN);
  if (error) throw error;
  return data.signedUrl;
};
