# エージェント分担ルール

このリポジトリを複数のAIエージェントで同時に扱う際の取り決め。

## 構成

| | 役割 | 書き込み |
|---|---|---|
| デスクトップ版 Claude Code | 実装 | 可 |
| Herdr ペイン1: claude | 設計整合レビュー | `docs/handoff/REVIEW.md` のみ |
| Herdr ペイン2: agy | 機械検証 | `docs/handoff/VERIFY.md` のみ |

## なぜ書き込みを分けるのか

Herdr はターミナルを束ねるだけで、ファイルの排他制御をしない。
同じファイルを同時に編集すると後から書いた側が勝ち、片方の変更が黙って消える。

実装の書き込み口を1つ（デスクトップ版）に寄せ、検証役には**互いに別のファイル**だけを
許可する。この形なら書き込みが衝突しない。

## なぜレビュー役と検証役を分けるのか

同じモデル・同じ `CLAUDE.md` を見る2エージェントは、同じ観点を見落とす。
検証を2回やっても情報量は増えない。役割を機械判定と設計判断に分ける。

- **agy（機械検証）** — テスト・ビルド・grep で白黒つく判定。速さが効く。
- **claude（設計整合）** — `CLAUDE.md` の規約と実装の突き合わせ。文脈の読解が要る。

---

## agy の担当（機械検証）

結果は `docs/handoff/VERIFY.md` に書く。**それ以外のファイルは編集しない。**

### 1. ユニットテスト

```bash
npm test
```

ベースライン: **2ファイル / 26テスト 全passing（約7秒）**。
件数が減っていたらテストが消えている。増えるのは正常。

### 2. ビルド

```bash
npm run build
```

ベースライン: **成功、約17秒**。
chunk 500kB 超の警告は既知。**これは既存の状態なので不合格にしない。**
新規の警告・エラーだけを報告する。

### 3. 規約違反の grep

`CLAUDE.md`「設計上の重要なルール」を機械的に当てる。

```bash
# UIから直接 supabase.from を呼んでいないか
grep -rln "supabase\.from" src/components

# window.confirm / window.prompt の使用（コメント行は除く）
grep -rn "window\.confirm\|window\.prompt" src --include=*.jsx --include=*.js --include=*.ts --include=*.tsx | grep -v "^\s*\*" | grep -v "// "

# ステータスの直書き
grep -rn "'施工中'\|'見積'\|'予定'\|'完了'" src --include=*.jsx | grep -v constants.js
```

**既知の違反（2026-09-09 時点のベースライン）:**

- `supabase.from` を直接呼ぶコンポーネント **5件**
  `HolidayCalendar.jsx` / `tabs/CustomerSettings.jsx` / `tabs/InputTab.jsx`
  / `tabs/settings/CertificationManager.jsx` / `tabs/StaffSettings.jsx`
- `window.confirm` / `window.prompt` の実使用 **0件**
  （`ConfirmProvider.jsx:8` はコメント内の記述なので違反ではない）
- ステータス直書き **0件**

**この数を超えたら報告する。** 既存分をいちいち蒸し返さない。
今回の変更が増やしたかどうかだけが問題。

### やらないこと

- `src/` の編集（読むのは自由）
- `CLAUDE.md` / `docs/` の編集（`docs/handoff/VERIFY.md` を除く）
- git のコミット・ブランチ操作
- Supabase への書き込み・マイグレーション適用

---

## claude（ペイン1）の担当（設計整合レビュー）

結果は `docs/handoff/REVIEW.md` に書く。**それ以外のファイルは編集しない。**

`CLAUDE.md`「設計上の重要なルール」に照らして、grep では拾えない部分を読む。

- **Supabase呼び出し** — フック経由になっているか。フックを足した場合、
  `useSupabaseData.js` の既存パターンから外れていないか
- **削除確認** — `useConfirm()` を使っているか。`ConfirmModal` を直接置いた場合、
  ルート要素の内側にあるか（兄弟要素エラー防止）
- **マジック文字列** — `constants.js` の定数を使っているか
- **数値入力** — 負値不要の `<input type="number">` に `min="0"` があるか
- **アイコンボタン** — `aria-label` と `title` があるか
- **エラー通知** — `showToast(..., 'error')` でユーザーに届いているか

### 実装の意図を渡さない

レビュー役には「なぜその変更をしたか」を説明しない。差分と `CLAUDE.md` だけを見せる。
実装側の言い訳を知らない状態のほうが、規約との不整合を素直に指摘する。

### やらないこと

- `src/` の編集
- git 操作
- agy の担当（テスト実行・ビルド）の再実行

---

## デスクトップ版 Claude Code の担当（実装）

- `src/` の実装・リファクタリング
- `CLAUDE.md` / `docs/` の更新
- git 操作
- Supabase マイグレーション

変更したら `docs/handoff/REQUEST.md` に**何をしたか**を書く。**なぜしたかは書かない。**

---

## 回し方

```
1. デスクトップ版で実装 → REQUEST.md に変更点を書く
2. agy に  「REQUEST.md を読んで機械検証、結果を VERIFY.md に」
3. claude に「REQUEST.md を読んで設計整合レビュー、結果を REVIEW.md に」
4. 人間が VERIFY.md / REVIEW.md を読んで次の指示を出す
```

2 と 3 は**並行に投げてよい**。互いの結果に依存しない。

エージェント同士は直接やり取りしない。人間が各ペインに指示を出す。

## いつ3エージェントを回すか

**全ての変更で回す必要はない。** 往復コストのほうが高くつく場合がある。

回す価値があるのは:

- 複数ファイルにまたがる変更
- Supabase スキーマに触れた
- 認証・ロール判定（`useAuth.jsx`）に触れた
- 規約の解釈が分かれる変更

それ以外は**デスクトップ版と agy の2者で足りる。** ペイン1は寝かせておく。

## 併用時の注意

- **検証を投げる前に、実装側の編集が終わっているか確認する。**
  編集途中のファイルを検証しても意味がない。
- 修正は必ずデスクトップ版で行う。検証役に直させない。
- Herdr の状態表示（緑/黄）は短時間のコマンドでは変化が見えにくい。
  完了判定は画面の出力で行う。
