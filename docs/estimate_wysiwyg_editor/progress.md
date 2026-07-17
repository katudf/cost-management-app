# 見積WYSIWYGエディタ刷新 — 進捗・引き継ぎメモ

最終更新: 2026-07-16（コンテキストクリア前の退避）
作業場所: worktree `.claude/worktrees/ecstatic-cerf-0e582d` / branch `claude/quotation-editor-redesign-a3edb5`
確定設計: [design.md](design.md)（§4 統一ルール / §5 データモデルが正）

## 全体フェーズ計画（ユーザー承認済み、7フェーズ）

| Phase | 内容 | 状態 |
|-------|------|------|
| 1 | DB基盤（estimate_sheets + save_estimate_items_v2 RPC） | ✅ 完了・コミット e0b4c7a・**本番適用済み** |
| 2 | データアクセス層（supabaseEstimates.js のv2対応） | ✅ 完了・コミット 9b47fcd |
| 3 | エディタ骨格（`src/estimate-editor/` 新設：紙面スタック＋鑑インライン編集＋左ナビ＋右設定パネル） | ✅ 完了・コミット（8ファイル作成、`npm run build` 通過） |
| 4 | 明細グリッド（セル編集・Tab/Enter/矢印・行操作・TSV貼り付け）→ 保存ラウンドトリップ検証 | 未着手 |
| 5 | 計算・リンクエンジン（シート末尾合計、リンク①②、循環参照チェック、総括表自動生成） | 未着手 |
| 6 | EstimatePDF.jsx のシートモデル対応（明細末尾=税抜合計、消費税・税込は鑑側、通しページ番号） | 未着手 |
| 7 | 統合（AdminApp差し替え、Excel取込シート対応、旧RPC・旧EstimateForm一族の削除） | 未着手 |

作業ツリーは 9b47fcd 時点でクリーン（この progress.md 追加を除く）。`npm run build` は通過確認済み（既存の chunk-size 警告のみ）。

## Phase 1 の成果（本番 Supabase `quaollobtalcixmlpmps` に適用済み）

- migration `20260716120000_add_estimate_sheets_and_links.sql`:
  - `estimate_sheets` (id uuid PK, estimate_id bigint FK CASCADE, sort_order int, title text, created_at)。RLSポリシー `estimate_sheets_office_all`（is_admin() OR office）。
  - `estimate_items` に `sheet_id` uuid FK CASCADE / `linked_sheet_id` uuid FK SET NULL（リンク①: 他シート合計→自行単価）/ `linked_category_item_id` bigint 自己FK SET NULL（リンク②: カテゴリ合計）。
  - バックフィル済み: 全見積に sort_order=1 のトップシートを作成し全明細を帰属（30見積/30シート/875明細）。
- migration `20260716130000_save_estimate_items_v2.sql`: RPC `save_estimate_items_v2(p_estimate_id, p_sheets jsonb, p_items jsonb) RETURNS jsonb`。
  - シートを配列順に UPSERT（id null=新規）、payload に無いシートは DELETE。明細は全削除→2パス INSERT（`WITH ORDINALITY`、sort_order=ord−1）→ pass2 で `linked_category_item_id` を index→新ID に再マップ。戻り値 `{'sheet_ids': [...]}`。
  - v2 payload: `p_sheets` = `{id: uuid|null, title}` の順序配列 / `p_items` = `{sheet_index, linked_sheet_index|null, linked_item_index|null, item_type, category_symbol, name, spec, quantity, unit, unit_price, amount, note}`。
  - 旧RPC `save_estimate_items` は Phase 7 まで温存（旧フォームと EstimateList.jsx のExcel取込が使用中）。

## Phase 2 の成果（src/supabaseEstimates.js）

- `fetchEstimateById`: sheets/items を含めて取得。シート0件なら仮トップシート `{id:null, sort_order:1}` を合成、`sheet_id==null` の明細はトップシートへ。
- `saveEstimateItemsV2(estimateId, payloadSheets, payloadItems)` → sheet_ids 配列を返す。
- `buildSaveItemsPayload(sheets, items)`: UUID正規表現で仮ID（`sheet_tmp_*`）を null に変換、sheet_index / linked_* index を解決。所属シート不明は `明細の所属シートが見つかりません` を throw。
- スクラッチパッドの13アサーションで検証済み。

## Phase 3 実装計画（✅ 完了 — 全8ファイル作成済み）

`src/estimate-editor/` に以下の順で作成（全て完了）：

1. **paperStyles.js** — `export const pt = (v) => v * 96 / 72;`（A4横 842×595pt ≈ 1123×794px）。EstimatePDF.jsx の全スタイル値（pt）を移植元とする。
2. **estimateDraftV2.js** — `src/utils/estimateDraft.js` の写しで KEY_PREFIX `'estimate-draft-v2:'`、SCHEMA_VERSION 2、payload `{header, sheets, items}`、`Array.isArray(parsed.sheets)` 検証追加。API・日本語コメント構造は同一。
3. **CustomerCombobox.jsx** — `src/components/estimate/EstimateHeader.jsx` の 28–223行をそのまま移植。
4. **CoverPaper.jsx** — 鑑（1123×794px）。EstimatePDF.jsx の CoverPage を移植し、印字項目を紙面上の透明インラインinputで直接編集（見積番号3分割・見積日・顧客コンボ＋宛名・工事名・工事場所・工期・有効期限・支払条件・備考・担当select）。isLocked時はプレーンテキスト描画。calcFontSize縮小、totalBox、社判/代表印の絶対配置、show_approver＋姓の丸印も踏襲。
5. **SheetPaper.jsx** — Phase 3では読み取り専用。シートごとに19行/ページ、DetailPage のダミー行パディングアルゴリズムを踏襲。フッター: トップシート(index 0)=FIXED行(show_fixed_fees時)＋「税抜合計」行＋NET行(show_net時)、サブシート=「合 計」1行。
6. **PageNav.jsx** — 左ナビ（鑑＋シート一覧、`paper-cover` / `paper-sheet-{idx}` へ scrollIntoView）。シート削除はゴミ箱アイコン＋ConfirmModal、シート0は削除不可。
7. **SettingsPanel.jsx** — EstimateSidebar.jsx を全セクション・モーダルごと移植＋numberError/再採番ブロック＋「過去見積から取込」ボタン（ImportItemsModal、トップシートへ追記）。
8. **EstimateEditor.jsx** — マウント契約 `({ estimateId, onBack, onSaved, onStatusChanged })` 維持。EstimateForm.jsx から init/dirty/draft/beforeunload/ステータス系/ロック/再採番/保存を移植。

### Phase 3 の確定判断（重要）

- **カテゴリ必須明細バリデーションは廃止**。**空行は保持**（name空でのフィルタをしない）。空行は `item_type: ITEM + category_symbol: '__blank__'`（state内もセンチネルのまま）。COMMENT行は旧フォーム同様ロード時デコード・保存時エンコード。
- sheets state は `[{id, title}]`。新規シートの仮IDは `` `sheet_tmp_${Date.now()}` ``。items はフラット配列＋`sheet_id`。
- 保存フロー: 旧handleSaveのガード（isLocked/顧客/工事名/番号regex `^\d{6}-\d{4}-\d{3}$`/MAX_ROWS 300）→ checkDuplicateNumber → ヘッダーpayloadは旧と同一（total_with_tax含む）→ createEstimate/updateEstimate → `buildSaveItemsPayload` → `saveEstimateItemsV2` → 返却 sheet_ids を index順に適用し items の sheet_id を仮ID→uuid に再マップ → ORDERED同期 → clearDraft → onSaved。23505 は「他のユーザーによって使用されました。再採番してください。」
- ドラフトv2 payload は `{header, sheets, items}`。
- レイアウト: ヘッダーバー（戻る/タイトル/作成者/ロックpill/プレビュー）→ flex行: 左PageNav(~160px sticky) / 中央紙面スタック(bg slate-200、紙1123px幅センター、overflow-x auto、PC専用) / 右SettingsPanel(280px)。
- シート追加は最終シート下の［＋ページ追加］。
- PDFプレビューは暫定で全シートの明細をフラット化して旧 EstimateDocument に渡す（buildPreviewEstimate 移植、Phase 6で本対応）。show_subtotals の合計行注入はシート単位で適用。
- 税率/NETの紙面上オーバーレイ編集は後回し（パネルが主）。
- 完了後 `npm run build` → コミット（trailer: `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`）。

### 移植元ファイル（次セッションで要再読）

| 移植元 | 用途 |
|--------|------|
| `src/EstimatePDF.jsx`（941行） | paperStyles / CoverPaper / SheetPaper の全メトリクス・描画ルール（fmt/fmtDate/calcFontSize、19行パディング、フッター行構成） |
| `src/EstimateForm.jsx`（1210行） | EstimateEditor のロジック全般（init/draft/status/save/lock/preview/ConfirmModal文言） |
| `src/components/estimate/EstimateSidebar.jsx`（428行） | SettingsPanel |
| `src/components/estimate/EstimateHeader.jsx` 28–223行 | CustomerCombobox |
| `src/utils/estimateDraft.js` | estimateDraftV2.js |
| `src/supabaseEstimates.js` | v2 API（buildSaveItemsPayload / saveEstimateItemsV2 / fetchEstimateById / calcTotals / formatCurrency） |

### 環境メモ

- worktree の node_modules は deps のみ。パッケージは親 `C:\Users\katuy\Desktop\cost-management-app\node_modules` に解決される（スクラッチパッドのスクリプトでは esbuild を絶対パス import）。
- `src/utils/dateUtils` は **.ts**（`toDateStr(d)`, `addDays(d, n)`、拡張子なし import でOK）。
- マウント統合先: `src/AdminApp.jsx:1045-1063`（Phase 7 で EstimateForm → EstimateEditor に差し替え、コールバック契約維持）。
- Supabase MCP ツールは ToolSearch 経由の deferred（prefix `mcp__b7de1755-...`、execute_sql / apply_migration 等）。
- セッションは非対話・自律進行（質問せず進める）。ユーザーの常時指示: 「Phase3のコード作成の続きを行ってください」。

### Phase 3 完了メモ（次セッションへの引き継ぎ）

Phase 3 の全8ファイルを `src/estimate-editor/` に作成し `npm run build` 通過（exit 0、1759 modules、既存 chunk-size 警告のみ）。コミット済み。

- EstimateEditor.jsx の確定実装:
  - シートは `[{id, title}]`、新規仮ID `sheet_tmp_${Date.now()}_${rand}`。items はフラット＋`sheet_id`。
  - 合計（鑑・totals）は **トップシート**の ITEM＋（show_fixed_fees時）FIXED を対象に `calcTotals`。
  - 通しページ番号: 鑑=No.1、`sheetStartPages` が `calcSheetPageCount` を累積（running 初期値2）。
  - 保存: シート順に COMMENT エンコード＋（show_subtotals時）小計行注入 → `buildSaveItemsPayload(sheets, savingItems)` → `saveEstimateItemsV2` → 返却 sheet_ids を **length一致時のみ** index順に適用し sheets/items の sheet_id を再マップ。空行はフィルタせず全行保存。
  - 取込（handleImportGroups）はトップシートの nonFixed 末尾・FIXED手前へ追記。
  - PDFプレビューは buildPreviewEstimate で全シートをフラット化 → 旧 `EstimateDocument`（BlobProvider）。
- **Phase 4 の次アクション**: SheetPaper を読み取り専用から編集グリッド化（セル編集・Tab/Enter/矢印移動・行操作・TSV貼り付け）し、EstimateEditor に `updateItem/addItem/removeRow/addCategory/addComment/setItems` 系の item 操作を配線。その後、保存ラウンドトリップ（作成→再読込→再保存で sheet_id と linked_* が保持されるか）を実機 or スクラッチパッドで検証する。
- 注意: `SheetPaper.jsx` 内の空行センチネルは `BLANK_SENTINEL='__blank__'`。EstimateEditor はまだ明細セル編集UIを持たないため、新規シート追加時はカテゴリ＋空明細1組のみ生成する。
