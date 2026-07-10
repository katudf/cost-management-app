# セキュリティ・権限 仕様書（DB再構築計画を含む）

作成日: 2026-07-09
最終更新: 2026-07-10（Phase 3 行・遷移レベル制御の完了を反映 — 全フェーズ完了）
対象: 工事原価管理システム（Supabase プロジェクト `quaollobtalcixmlpmps`）

本書は、現状のセキュリティ実態の棚卸し（As-Is）、目指す権限モデル（To-Be）、
およびデータベース再構築を含む段階的な移行計画を定義する。

> **進捗**: Phase 0（応急処置）は 2026-07-09 に本番環境へ適用済み。詳細は §7 Phase 0 を参照。
> §2 の「現状分析」は Phase 0 適用前（2026-07-09 時点）の記録として残し、
> Phase 0 適用後の状態は §7 に別途まとめている。

---

## 1. 目的とスコープ

### 1.1 目的
- anon キーを持つ第三者による全データの読み書きが可能という現状の脆弱性を解消する
- 「誰が・どの画面で・どのデータに・何をできるか」を仕様として明文化する
- 場当たり的なポリシー追加ではなく、DB再構築を視野に入れた一貫性のある設計に移行する

### 1.2 スコープ
- Supabase Auth による認証設計（4つのアプリモードすべて）
- PostgreSQL RLS（Row Level Security）による認可設計
- Storage バケット・Edge Functions の権限設計
- レガシーテーブルの整理・スキーマ改善（DB再構築）

### 1.3 前提知識
- **anon キーは秘密ではない**。Vite でビルドされた JS バンドルに埋め込まれ、誰でも取り出せる。
  したがってセキュリティは RLS でのみ担保できる。anon キーの隠蔽・ローテーションは対策にならない。
- RLS を有効化してもポリシーが無ければ「全拒否」となり、アプリが動かなくなる。
  有効化とポリシー作成は必ずセットで行う。

---

## 2. 現状分析（As-Is）

### 2.1 アプリ別の認証状態

| アプリ | エントリ | 認証 | 現状の本人確認方法 |
|---|---|---|---|
| AdminApp（管理者） | `/`（デフォルト） | ✅ Supabase Auth（メール+パスワード） | `office_staff.auth_user_id` と紐付け。招待は Edge Function `invite-staff` 経由 |
| WorkerApp（日報入力） | `?mode=worker` / `worker.html` | ❌ なし | 作業員一覧から自分を選ぶだけ。localStorage に保存。なりすまし自由 |
| ScheduleViewApp（工程表閲覧） | `?mode=schedule` | ❌ なし | URL を知っていれば誰でも閲覧可 |
| InventoryApp（在庫管理） | `?mode=inventory` / `inventory.html` | ❌ なし | URL を知っていれば誰でも読み書き可 |

### 2.2 テーブル別の RLS 状態（2026-07-09 時点・Phase 0 適用前の本番実測）

> ⚠️ 以下は Phase 0 適用前の状態の記録（歴史的スナップショット）。
> Phase 0 適用後の実際の状態は §7 Phase 0「実施結果」を参照。

**RLS 無効（= anon キーで無条件に全行読み書き可能）— 14テーブル**

| テーブル | 内容 | 機微度 |
|---|---|---|
| `Workers` | 作業員マスタ（氏名・単価等） | **高**（個人情報） |
| `WorkerCertifications` | 資格情報 | **高**（個人情報） |
| `office_staff` | 担当者（`auth_user_id`, `is_approver` を含む） | **高**（権限昇格の標的） |
| `Customers` | 顧客情報 | **高**（個人情報・取引先情報） |
| `Projects` | 工事案件（受注額等） | 高（経営情報） |
| `TaskRecords` | 日報（作業員×工種×日付） | 中〜高 |
| `Assignments` | 配置表 | 中 |
| `ProjectTasks` | 工種マスタ | 中 |
| `CompanyHolidays` | 会社休日 | 低 |
| `DailyReports` | ~~レガシー（コード未参照）~~ → ✅ DROP済み（2026-07-10） | — |
| `WorkLogs` | ~~レガシー（コード未参照）~~ → ✅ DROP済み（2026-07-10） | — |
| `Materials` | ~~レガシー（コード未参照）~~ → ✅ DROP済み（2026-07-10） | — |
| `MaterialUsageLogs` | ~~レガシー（コード未参照）~~ → ✅ DROP済み（2026-07-10） | — |
| `ServiceMaster` | ~~レガシー（コード未参照）~~ → ✅ DROP済み（2026-07-10） | — |

**RLS 有効・ただし開放ポリシー（`USING (true)` = 実質無制限）— 11テーブル**

`estimates` / `estimate_items` / `PurchaseRecords` / `OvertimeApprovals` / `WorkAllowanceApprovals` /
`Warehouses` / `InventoryItems` / `SubcontractorRecords` / `ProjectSuspensions` /
`CertificationNames` / `system_settings`

> 補足: `office_staff.is_approver` と `auth_user_id` が anon から UPDATE できる現状は、
> 「誰でも自分を承認者に昇格させられる」「承認フローを偽装できる」ことを意味し、
> せっかく実装した見積承認フローの証跡としての価値を無効化してしまう。最優先で塞ぐべき箇所。

### 2.3 その他のアドバイザー指摘（既存）

| 項目 | レベル | 内容 |
|---|---|---|
| `v_estimate_category_totals` ビュー | ERROR | `SECURITY DEFINER` 定義。呼び出し元の RLS を迂回して作成者権限で実行される |
| 関数 5件の `search_path` 未固定 | WARN | `calc_estimate_item_amount`, `set_updated_at`, `get_next_estimate_seq`, `overwrite_paste`, `save_estimate_items` |
| Storage `inventory-images` / `stamps` | WARN | 公開バケットにファイル一覧取得（list）を許すポリシーあり |
| 漏洩パスワード保護 | WARN | HaveIBeenPwned 連携が無効 |
| Postgres バージョン | WARN | セキュリティパッチ未適用（`17.4.1.054`） |
| `estimate_items` の重複ポリシー | — | `Allow all on estimate_items` と `estimate_items_all` の2つの ALL ポリシーが重複 |

### 2.4 Edge Functions

| 関数 | verify_jwt | 内部チェック | 評価 |
|---|---|---|---|
| `gemini-optimize` | true | なし | ログイン済みなら誰でも呼べる。Gemini API 課金の乱用リスクは低〜中 |
| `invite-staff` | false | Authorization ヘッダーの JWT を `auth.getUser()` で検証 | 認証は担保。ただし「ログイン済みなら誰でも招待できる」— 管理者権限チェックが無い |

### 2.5 主要な脅威シナリオ（現状で成立するもの）

1. **個人情報漏洩**: バンドルから anon キーを取り出し、REST API 経由で `Workers`・`Customers`・`WorkerCertifications` の全件を取得
2. **権限昇格**: `office_staff` の任意の行の `is_approver` を true に UPDATE → 見積承認を偽装
3. **データ破壊**: 任意のテーブルへの DELETE / UPDATE（バックアップからの復旧以外に手段なし）
4. **なりすまし日報**: WorkerApp は本人確認が無いため、他人名義の日報登録・改竄が可能（内部者リスク）
5. **経営情報の窃取**: `estimates`・`Projects`・`PurchaseRecords` から受注額・原価・粗利がすべて算出可能

---

## 3. 権限モデル（To-Be）

### 3.1 ロール定義

アプリの実利用形態（少人数の建設会社、事務所スタッフ＋現場作業員）に合わせ、5ロールを定義する。

| ロール | 想定ユーザー | 認証 | 概要 |
|---|---|---|---|
| `admin` | 経営者・システム管理者 | Supabase Auth | 全操作可。担当者管理・招待・システム設定 |
| `approver` | 承認権限を持つ担当者 | Supabase Auth | `office` の権限＋見積の承認/差し戻し |
| `office` | 事務・営業担当者 | Supabase Auth | 見積・原価・マスタの閲覧/編集。承認は不可 |
| `worker` | 現場作業員 | Supabase Auth（**共有アカウント**・§3.3で決定） | 日報の入力/編集。閲覧はマスタの必要最小限。個人の識別は画面内選択（従来通り） |
| `viewer` | 工程表の閲覧者 | Supabase Auth（**共有アカウント**・§3.3で決定） | 読み取り専用 |

**設計判断のポイント**

- `approver` は既存の `office_staff.is_approver` をそのまま活かす（ロールというよりフラグとして扱う）。
- `admin` は新設。`office_staff.role`（`'admin' | 'office'`）カラムを追加して表現する。
  当面は `is_approver` と別軸（承認できるか／管理できるか）で管理する。
- `worker` は共有アカウント方式のため、`Workers.auth_user_id` の追加は**当面不要**
  （将来、個人アカウント方式へ切り替える場合のオプションとして §5.2 に残す）。
  worker ロールの判定は「共有アカウントの `auth.uid()` を worker ロールとして登録したテーブル
  （例: `app_accounts(auth_user_id, role)`）」または `office_staff` に `role='worker'` 行を
  設けることで行う（実装時に選択）。
- **anon（未ログイン）にはいかなるテーブルへのアクセスも許さない**のを最終目標とする。
  ScheduleViewApp のみ、運用上どうしても未ログイン閲覧を残したい場合は §3.3 の選択肢で判断する。

### 3.2 ロール判定の実装方式

JWT カスタムクレームではなく、**DB 内のヘルパー関数（SECURITY DEFINER + search_path 固定）**で判定する。
クレーム方式より遅延は僅かに増えるが、ロール変更が即時反映され、Auth Hook の追加設定も不要で運用が単純。

```sql
-- ログイン中ユーザーが office_staff に登録済みか（admin/approver/office 共通の入口）
CREATE OR REPLACE FUNCTION public.is_staff()
RETURNS boolean
LANGUAGE sql SECURITY DEFINER STABLE
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM office_staff
    WHERE auth_user_id = auth.uid()
  );
$$;

-- 管理者か
CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS boolean
LANGUAGE sql SECURITY DEFINER STABLE
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM office_staff
    WHERE auth_user_id = auth.uid() AND role = 'admin'
  );
$$;

-- ログイン中ユーザーに対応する作業員ID（作業員でなければ NULL）
-- ※ 共有アカウント方式（§3.3決定）では auth.uid() が個人を特定できないため当面使用しない。
--    将来、個人アカウント方式へ切り替えた場合に導入する。
CREATE OR REPLACE FUNCTION public.current_worker_id()
RETURNS bigint
LANGUAGE sql SECURITY DEFINER STABLE
SET search_path = public
AS $$
  SELECT id FROM "Workers" WHERE auth_user_id = auth.uid();
$$;
```

> 注意: これらの関数は RLS ポリシー内で頻繁に呼ばれる。`STABLE` 指定によりクエリ内でキャッシュされるが、
> 大量行のスキャンでは `(SELECT is_staff())` のようにサブクエリで包んで1回評価に固定するのが定石。

### 3.3 アプリ別の認証方針

| アプリ | 方針 | 備考 |
|---|---|---|
| AdminApp | 現行の Auth を継続 | `office_staff.role` 追加で admin/office を分離 |
| WorkerApp | **Supabase Auth 必須化** | 下記「作業員認証の選択肢」参照 |
| InventoryApp | Supabase Auth 必須化 | worker 以上のロールでログイン。倉庫端末は共有アカウント可 |
| ScheduleViewApp | 選択肢あり | 下記参照 |

**作業員認証の選択肢 → ✅ 決定（2026-07-09）: C. 共有アカウント**

| 案 | 内容 | 長所 | 短所 |
|---|---|---|---|
| A. メール招待（office_staff と同方式） | `Workers.auth_user_id` 追加。`invite-staff` を汎用化した `invite-user` で招待 | 実装済みパターンの流用。個人単位の証跡 | 全作業員のメールアドレスが必要（※個人用メールでも招待自体は可能） |
| B. 電話番号 OTP | SMS ログイン | メール不要 | SMS 送信コスト・Twilio 等の設定が必要 |
| **C. 現場共有アカウント＋画面内選択（採用）** | 1つの worker アカウントでログイン後、現在の「一覧から選ぶ」を継続 | 移行が最も楽。作業員の業務は日報入力のみのため十分 | 個人の証跡が取れない。なりすまし対策は社内統制に委ねる |

> 決定の背景: 作業員には会社メールアドレスが無く、業務は日報入力のみ。
> 本対策の主目的である「外部第三者の遮断」は共有アカウントで完全に達成できるため C を採用。
> DBレベルで日報の本人性を担保したくなった場合は、将来 A（個人メール招待——個人用アドレスで可）へ
> 切り替えられる。この決定により §3.2 の `current_worker_id()` と Phase 3 の日報本人限定 RLS は
> 当面対象外となる。

**ScheduleViewApp の選択肢 → ✅ 決定（2026-07-09）: A. viewer 共有アカウント**

| 案 | 内容 | 備考 |
|---|---|---|
| **A. viewer 共有アカウントでログイン（採用）** | 閲覧専用アカウントを1つ発行し、関係者に共有 | anon を完全に閉じられる。実装も LoginScreen の流用 |
| B. anon に SELECT のみ許可 | `Assignments`・`Projects`（一部カラム）等に anon SELECT ポリシーを残す | URL を知る誰もが工事名・配置を見られる状態が続く |

---

## 4. テーブル別権限マトリクス（To-Be）

凡例: ✅=全行可 / R=SELECTのみ / ―=不可

> 注: worker は共有アカウント（§3.3決定）のため、DBからは個人を区別できない。
> 「自分の行のみ」の制御は不可であり、worker 列の権限は共有アカウント全体に適用される。

| テーブル | admin | approver / office | worker | viewer |
|---|---|---|---|---|
| `Projects` | ✅ | ✅ | R（担当工事の把握用） | R（工程表表示分） |
| `ProjectTasks` | ✅ | ✅ | R | ― |
| `TaskRecords`（日報） | ✅ | ✅ | ✅（共有アカウントのため全作業員分。`worker_id` は画面内選択で付与） | ― |
| `SubcontractorRecords` | ✅ | ✅ | ― | ― |
| `Assignments`（配置表） | ✅ | ✅ | R | R |
| `Workers` | ✅ | ✅ | R（氏名等の表示用。単価カラムは §5.4 のビュー分離を検討） | ― |
| `WorkerCertifications` | ✅ | ✅ | ― | ― |
| `CertificationNames` | ✅ | ✅ | R | ― |
| `estimates` / `estimate_items` | ✅ | ✅（承認操作の本人制限はアプリ層＋§4.1） | ― | ― |
| `Customers` | ✅ | ✅ | ― | ― |
| `office_staff` | ✅ | R＋自分の行の一部 UPDATE | ― | ― |
| `system_settings` | ✅ | R | R | R |
| `PurchaseRecords` | ✅ | ✅ | ― | ― |
| `OvertimeApprovals` / `WorkAllowanceApprovals` | ✅ | ✅ | R | ― |
| `Warehouses` / `InventoryItems` | ✅ | ✅ | ✅（在庫は現場でも動かすため） | ― |
| `CompanyHolidays` | ✅ | ✅ | R | R |
| `ProjectSuspensions` | ✅ | ✅ | R | R |

### 4.1 特に重要な個別ルール

1. **`office_staff` の保護（最優先）**
   - `is_approver`・`role`・`auth_user_id` を変更できるのは `admin` のみ
   - office は自分の行の表示名等のみ UPDATE 可（列単位の制御は `WITH CHECK` + トリガー、
     またはカラムを分離したテーブル設計で対応。§5.3 参照）
2. **見積承認の証跡保護**
   - `estimates.status` の `pending → approved / returned` 遷移は、
     `approver_staff_id` が自分（`auth.uid()` 対応の staff）である場合のみ許可するポリシーを検討
   - 完全な列・遷移単位の制御が必要なら、UPDATE を直接許さず
     `approve_estimate(estimate_id)` / `return_estimate(estimate_id, reason)` の
     SECURITY DEFINER RPC に集約する方式が確実（推奨）
3. **日報の本人性 — 当面対象外（§3.3の決定による）**
   - 共有アカウント方式では `auth.uid()` で個人を特定できないため、
     `worker_id = current_worker_id()` によるDBレベルの本人限定は成立しない
   - 本人性の担保は従来通り「画面内で自分を選ぶ」運用と社内統制に委ねる
   - 将来、個人アカウント方式（§3.3 案A）へ切り替えた場合にこのルールを有効化する

---

## 5. DB再構築の提案

### 5.1 レガシーテーブルの削除

`src/` から一切参照されていない以下の5テーブルは、内容確認・バックアップの上で DROP する。
攻撃対象領域と管理コストを減らす最も安価な対策。

- `DailyReports` / `WorkLogs` / `Materials` / `MaterialUsageLogs` / `ServiceMaster`

> 実施前に各テーブルの中身を確認し、必要なら CSV エクスポートを保管する。

> **状況（2026-07-10）**: ✅ **実施完了**。ユーザーの明示的な実行指示（§9.1 #4）を受け、
> `phase3_drop_legacy_unused_tables` マイグレーションで5テーブルを DROP した。
> 実行時に、生存テーブル `ProjectTasks` の `serviceMasterId` 列が `ServiceMaster(id)` への
> FK制約（`ProjectTasks_serviceMasterId_fkey1`）を持っていることが新たに判明した
>（当初の5テーブル依存関係分析には含まれていなかった）。事前確認の結果、
> `ProjectTasks` 全93行で `serviceMasterId` は NULL、かつアプリコードからの参照も無かったため、
> 同一マイグレーション内でこの FK制約を先に `DROP CONSTRAINT` した上で5テーブルを DROP した。
> DROP順序は依存関係の都合上 `WorkLogs` → `MaterialUsageLogs` → `DailyReports` → `Materials` → `ServiceMaster`。
> DROP後に `get_advisors`（security）を再実行し、当該5テーブルの `rls_enabled_no_policy` INFO が
> 消滅したことを確認済み。

### 5.2 スキーマ変更（権限モデルに必要なもの）

> **状況（2026-07-09 確認）**: `office_staff.role`（TEXT）・`auth_user_id`（UUID）は
> 既に本番に存在する（別タスクで先行追加済み。当初 CHECK 制約は未設定）。
> 現在値は自由記述（例: 「見積作成者」「見積作成者/承認者」「システム管理者」）であり、
> 本設計で使う `admin/office/worker/viewer` の値域には未統一。以下 (1) は
> **値の正規化＋ CHECK 制約追加**として読み替える。

```sql
-- (1) 既存 role 列を admin/office/worker/viewer の値域に統一し、CHECK 制約を追加
--     例: UPDATE office_staff SET role = 'admin' WHERE id = 17; -- 「システム管理者」→ admin
--         UPDATE office_staff SET role = 'office' WHERE role IN ('見積作成者','見積作成者/承認者') OR role IS NULL;
ALTER TABLE office_staff ALTER COLUMN role SET DEFAULT 'office';
ALTER TABLE office_staff ADD CONSTRAINT office_staff_role_check
  CHECK (role IN ('admin', 'office', 'worker', 'viewer'));

-- (2) 【将来オプション】作業員を個人アカウント化する場合のみ
-- ALTER TABLE "Workers" ADD COLUMN auth_user_id UUID UNIQUE REFERENCES auth.users(id);
```

- 初期データ（2026-07-09 確認・決定済み。詳細は §9.1 #6）:
  `office_staff.id = 17`（name: `admin`, auth_user_id あり, email: `katudf@gmail.com`）が
  現在唯一の Auth 紐付き admin 相当ユーザー。この行を `role = 'admin'` に正規化する。
  他の担当者（id 3, 4, 5, 7, 8）は auth_user_id 未設定＝ログイン不可のため `role = 'office'` 相当。
  `id = 16`（佐藤 勝義, auth_user_id あり, email: `katuyoshi_s@kimura-paint.com`）は
  ログイン可能だが role 未設定・is_approver=false — 正規化時に `office` を明示的に設定する。
- 共有アカウントの表現: worker 用・viewer 用の Auth ユーザーを各1つ作成し、
  `office_staff` に `role = 'worker'` / `role = 'viewer'` の行として登録する
  （担当者一覧UIでは role で除外表示する）。専用テーブル `app_accounts` を新設する案もあるが、
  既存の `auth_user_id` 紐付け・ヘルパー関数をそのまま流用できるため office_staff への同居を推奨。

### 5.3 スキーマ改善（推奨・任意）

| 項目 | 内容 | 優先度 | 状況 |
|---|---|---|---|
| `v_estimate_category_totals` | `SECURITY INVOKER`（Postgres 15+ は `security_invoker = true`）に変更 | 高 | ✅ 完了（Phase 0, 2026-07-09） |
| 関数の `search_path` 固定 | 既存5関数に `SET search_path = public` を付与 | 高 | ✅ 完了（Phase 0, 2026-07-09） |
| `estimate_items` の重複ポリシー | 2つの ALL ポリシーを1つに整理 | 中 | 未着手 |
| `Workers` の機微カラム分離 | 単価・給与関連カラムを `worker_pay_rates` 等に分離し、staff のみアクセス可にする（worker ロールに Workers の R を与えるため） | 中 | ✅ 代替方式で完了（Phase 3, 2026-07-10）。テーブル分離ではなく安全カラムのみの SECURITY DEFINER ビュー `workers_directory` で遮蔽（§7 Phase 3） |
| `office_staff` の権限カラム分離 | `is_approver`/`role`/`auth_user_id` を別テーブル化すると「自分の行の表示名のみ更新可」が素直な RLS で書ける | 低（トリガーで代替可） | 未着手 |
| 命名規約の統一 | PascalCase（`"Workers"`）と snake_case（`estimates`）が混在。**snake_case への全面改名は影響範囲が全コードに及ぶため、新規テーブルから snake_case とし、既存は改名しない**ことを推奨 | 低 | 未着手 |
| FK の整備 | `TaskRecords.worker_id → Workers.id` 等、欠けている外部キー制約を洗い出して追加 | 中 | 未着手 |

### 5.4 ドキュメント修正

- CLAUDE.md の主要テーブル一覧にある `PurchaseLedgers` は実在しない（実体は `PurchaseRecords`）。修正する。
- 本仕様書確定後、`docs/architecture.md` に認証・認可の節を追記する。

---

## 6. Storage・Edge Functions の権限設計

### 6.1 Storage

| バケット | 現状 | To-Be | 状況 |
|---|---|---|---|
| `inventory-images` | public + list 許可 | public は維持可（画像URLの直接参照のため）。**list を許す SELECT ポリシー（`inventory images select`）は削除**。アップロード/削除は worker 以上に限定 | ✅ list ポリシー削除は完了（Phase 0, 2026-07-09）。✅ アップロード/削除の authenticated 限定も完了（Phase 1, 2026-07-10）。ロール別（worker以上）への絞り込みはPhase 2で対応 |
| `stamps`（承認印） | public + list 許可（2ポリシー） | 社印・個人印は機微。**private 化し、署名付きURL（createSignedUrl）での参照に切り替え**を推奨。少なくとも list ポリシーは削除 | ✅ list ポリシー（`Allow all actions`/`Public Access`）削除は完了（Phase 0, 2026-07-09）。✅ private化＋署名付きURL化も完了（Phase 3, 2026-07-10。SELECT=staff、書き込み=admin/office のバケット限定ポリシー4本。詳細は §7 Phase 3） |

### 6.2 Edge Functions

| 関数 | To-Be |
|---|---|
| `invite-staff` | 呼び出し元が `role = 'admin'` の staff であることを関数内で検証する（現状は「ログイン済みなら誰でも」） |
| `gemini-optimize` | 現状維持（verify_jwt: true）。乱用が見えたらレート制限を検討 |
| （新規）`invite-user` | 作業員招待用。`invite-staff` を汎用化するか、`target: 'staff' | 'worker'` パラメータ化 |

---

## 7. 段階的移行計画

一気に厳密化するとアプリが確実に壊れるため、4フェーズに分ける。
**各フェーズは独立してデプロイ・検証・ロールバック可能**にする。

### Phase 0: 応急処置（アプリ改修なし・即日可能） — ✅ 実施完了（2026-07-09）

目的: 「RLS 無効」状態の解消と、権限昇格経路の封鎖。アプリの動作は変えない。

1. ✅ **レガシー5テーブル**: DROP ではなく **RLS 有効化・ポリシー無しで全遮断** を採用。
   実施前に全件確認したところ `DailyReports`=2行、`WorkLogs`=0行、`Materials`=2行、
   `MaterialUsageLogs`=0行、`ServiceMaster`=3行とデータが残っていたため、
   このコマンドの実行スコープ（応急処置）では削除まで踏み込まず、まず安全にロックする方針とした。
   DROP の可否は §9.1 #4 で削除可と決定済み。実行は別途明示確認の上で行う。
2. ✅ RLS 無効だった残り8テーブル（`Workers`, `WorkerCertifications`, `Customers`, `Projects`,
   `TaskRecords`, `Assignments`, `ProjectTasks`, `CompanyHolidays`）: RLS 有効化＋開放ポリシー付与
   （現状の動作を維持）
3. ✅ **例外: `office_staff` のみ開放にしない** — SELECT は開放（AdminApp のログイン後解決・承認者一覧表示に必要）、
   INSERT/UPDATE/DELETE は `authenticated` ロールに限定（下記SQL通り実施済み）:

```sql
ALTER TABLE office_staff ENABLE ROW LEVEL SECURITY;
CREATE POLICY "office_staff_select" ON office_staff
  FOR SELECT USING (true);
CREATE POLICY "office_staff_write" ON office_staff
  FOR ALL TO authenticated USING (true) WITH CHECK (true);
```

4. ✅ `v_estimate_category_totals` を `security_invoker = true` 化。既存5関数
   （`calc_estimate_item_amount`, `set_updated_at`, `get_next_estimate_seq(text)`,
   `overwrite_paste(jsonb)`, `save_estimate_items(bigint, jsonb)`）に `SET search_path = public` を付与
5. ✅ Storage の list ポリシー削除 — `inventory-images` の `"inventory images select"`、
   `stamps` の `"Allow all actions"` / `"Public Access"` を削除
6. ダッシュボード作業（MCP 経由では操作不可）2件:
   - ✅ Postgres アップグレード実施済み（2026-07-09、`17.4.1.054` → `17.6`。`get_advisors` 再実行でバージョンWARNの解消を確認）
   - ⏭️ 「漏洩パスワード保護」の有効化は**見送り**（2026-07-09）。Supabase Pro プラン以上でのみ有効化可能な機能であり、
     現行プランでは有効化不可のため。将来的にプランをアップグレードした際に再検討する

**適用したマイグレーション**:
- `phase0_security_hardening`（手順1〜4）
- `phase0_storage_policy_cleanup`（手順5）

**実施結果の検証**: `get_advisors`（security）を再実行し、**ERROR レベルの指摘は0件**になったことを確認
（従来あった `SECURITY DEFINER` ビューの ERROR、RLS無効の ERROR 群はすべて解消）。
残る指摘はすべて想定内の WARN/INFO のみ（2026-07-09 再確認）:
- 開放ポリシー（`USING (true)`）自体への `rls_policy_always_true` WARN — Phase 1 以降で対応する既知の設計上の暫定状態
- ロックしたレガシー5テーブルへの `rls_enabled_no_policy` INFO — 意図した全遮断状態なので対応不要
- ✅ Postgresバージョンの要パッチ WARN — `17.6` へのアップグレード完了により**解消済み**（2026-07-09 `get_advisors` で非掲出を確認）
- ⏭️ 漏洩パスワード保護（`auth_leaked_password_protection`）WARN — **解消せず残存**。Supabase Pro プラン以上が必要な機能のため、
  現行プランでは対応不可と判断し見送り（§9.1 参照）。プランアップグレード時に再検討

**効果**: アドバイザーの ERROR は解消。ただし匿名の読み書きは大半のテーブルでまだ可能（Phase 1 で解消予定）。
**リスク**: 実施前の想定通りほぼ無し（動作は現状と同一。office_staff の書き込みのみ、未ログインからは不可になった。
レガシー5テーブルはコード未参照のためアプリ動作への影響も無し）。

### Phase 1: 全テーブル authenticated 限定（要アプリ改修） — ✅ 実施完了（2026-07-10）

目的: 「URL と anon キーを知っている第三者」を完全に締め出す。

- 前提となるアプリ改修:
  - ✅ WorkerApp / InventoryApp / ScheduleViewApp に AuthProvider + LoginScreen を組み込み完了（2026-07-09）。
    `LoginScreen.jsx` を `title`/`subtitle` props で汎用化し、`useAuth.jsx`（AdminApp と同一の仕組み）をそのまま再利用。
    各アプリで `isAuthLoading` → `isPasswordRecovery`（`ResetPasswordScreen`） → `!isAuthenticated`（`LoginScreen`） →
    既存の画面、という順でガードを追加（AdminApp と同一パターン）。`App.jsx` で3アプリすべてを `AuthProvider` でラップ。
    WorkerApp / InventoryApp の既存「一覧から自分を選ぶ」画面（`loggedInWorker`）はログイン後の内側にそのまま残置
    （コメントを「ログイン画面」→「作業員選択画面」に変更のみ）。
    プレビュー環境で `?mode=worker`（作業日報システム）/ `?mode=inventory`（在庫管理システム）/
    `?mode=schedule`（工程表閲覧）/ 既定（工事原価管理システム＝AdminApp）の4モードすべてで、
    未ログイン時に対応するタイトルの LoginScreen が表示され、コンソールエラーが無いことを確認済み。
  - ✅ worker 共有アカウントの発行（§3.3 決定: C案）— **実施完了（2026-07-10）**。
    `kimuratosoukougyo@gmail.com` で Auth ユーザーを作成し、`office_staff` に
    `id=18`（name: `現場作業員（共通）`, role: `worker`, auth_user_id 紐付け, is_approver: false）として登録。
    作成は一時的な管理用 Edge Function（`adminClient.auth.admin.createUser()` 使用、作業完了後に
    無効化済み・HTTP 410 を返すのみの状態）経由で実施し、認証済み管理者セッションの実 JWT で呼び出した
    （`verify_jwt` を無効化する代替案は「service-role 管理エンドポイントの公開化」に当たるため採用せず）。
    プレビュー環境（`?mode=worker`）で当該アカウントの実ログインを検証し、LoginScreen 通過後に
    既存の「名前を選んでください」作業員選択画面へ正しく遷移することを確認済み。
  - ✅ viewer 共有アカウントの発行（§3.3 決定: A案）— **実施完了（2026-07-10）**。
    `kimuratosoukougyo@sweet.ocn.ne.jp` で Auth ユーザーを作成し、`office_staff` に
    `id=19`（name: `工程表閲覧（共通）`, role: `viewer`, auth_user_id 紐付け, is_approver: false）として登録。
    worker アカウントと同一メールアドレスは Supabase Auth の一意制約により使用不可のため、
    別メールアドレスで発行（パスワードは worker アカウントと同一の `kpi234459` を利用する運用判断）。
    作成は worker アカウント発行時と同じ一時的な管理用 Edge Function
    （許可リストを viewer のメールアドレスに更新して再デプロイ、`verify_jwt: true` を維持）経由で実施し、
    認証済み管理者セッションの実 JWT で呼び出した。作業完了後、同関数は再度無効化済み（HTTP 410 を返すのみ）。
    プレビュー環境（`?mode=schedule`）で当該アカウントの実ログインを検証し、LoginScreen 通過後に
    既存の読み取り専用「配置予定表」画面へ正しく遷移することを確認済み。
- DB 変更: 全テーブルの開放ポリシーを `TO authenticated` に付け替え — **実施完了（2026-07-10）**。
  共有アカウント発行後、ユーザーからの実行許可を得て本番へ適用した。

  対象は現状分析（§2.2）で洗い出した開放ポリシー全20テーブル
  （単純 `ALL` ポリシー11テーブル: `Assignments`, `CertificationNames`, `CompanyHolidays`,
  `Customers`, `ProjectSuspensions`, `ProjectTasks`, `Projects`, `SubcontractorRecords`,
  `TaskRecords`, `WorkerCertifications`, `Workers` / 4分割ポリシー6テーブル:
  `InventoryItems`, `OvertimeApprovals`, `PurchaseRecords`, `Warehouses`,
  `WorkAllowanceApprovals`, `system_settings` / 特殊2テーブル: `estimates`, `estimate_items`
  / `office_staff` の残り `SELECT` ポリシー）。マイグレーション `phase1_rls_authenticated_only`
  として一括適用（個別に分けず全20テーブルを1マイグレーションで適用する方針は
  ユーザーが選択、§9.1 #12）。`estimates`/`estimate_items` は重複していた
  `{anon,authenticated}` 開放ポリシーと `Allow all on ...` ポリシーを削除し、
  `estimates_all`/`estimate_items_all` を `TO authenticated` に一本化（`estimates` は
  `USING (deleted_at IS NULL)` を維持）。

```sql
-- 例（単純ALLポリシーの型。4分割ポリシーはDROPが4文になる点のみ異なる）
DROP POLICY "workers_open" ON "Workers";
CREATE POLICY "workers_authenticated_all" ON "Workers"
  FOR ALL TO authenticated USING (true) WITH CHECK (true);
```

- **Storage: `inventory-images` バケットのアクセス制限 — 実施完了（2026-07-10）**。
  同一マイグレーション内で対応（§6.1 表の「アップロード/削除は worker 以上に限定」を実施）。
  バケット自体は `public: true` を維持（公開URL経由の画像表示に必要。RLSは公開URL直接取得を
  制御できないため、public フラグ自体を外す必要はない）。`storage.objects` の
  INSERT/UPDATE/DELETE ポリシー（`inventory images insert/update/delete`、いずれも
  ロール `{public}` で無条件許可）を `TO authenticated` に絞り込んだ
  （SELECT ポリシーは Phase 0 で既に削除済み・未追加のため対象外）。

```sql
DROP POLICY "inventory images insert" ON storage.objects;
DROP POLICY "inventory images update" ON storage.objects;
DROP POLICY "inventory images delete" ON storage.objects;

CREATE POLICY "inventory images insert authenticated" ON storage.objects
  FOR INSERT TO authenticated WITH CHECK (bucket_id = 'inventory-images');
CREATE POLICY "inventory images update authenticated" ON storage.objects
  FOR UPDATE TO authenticated USING (bucket_id = 'inventory-images');
CREATE POLICY "inventory images delete authenticated" ON storage.objects
  FOR DELETE TO authenticated USING (bucket_id = 'inventory-images');
```

**検証結果（2026-07-10）**:
- anon キーでの REST API 直接アクセス: `Workers`/`Projects`/`estimates`/`InventoryItems`/
  `office_staff`/`system_settings` へのSELECTはすべて HTTP 200 + 空配列 `[]`（RLSにより
  正しくフィルタされた状態。401ではなく200+空配列がPostgRESTの正常な仕様動作）。
  `Workers` への anon INSERT は HTTP 401 + `42501`（RLS違反エラー）で明示的に拒否を確認。
- アプリ動作確認: 認証済みセッションで `/`（AdminApp）・`?mode=worker`（WorkerApp）・
  `?mode=schedule`（ScheduleViewApp）の3モードすべてが実データを正常表示し、
  コンソールエラー・失敗した通信リクエストが無いことを確認。
- `get_advisors`（security）再実行: 新規の ERROR は0件。
  - WARN多数（`rls_policy_always_true`）は今回付け替えたポリシー自体が
    `USING (true)` の意図的な暫定設計（authenticatedゲートのみ、ロール別制御はPhase 2の役割）
    であるため想定内。ロール別への絞り込みはPhase 2で対応する。
  - INFO（`rls_enabled_no_policy`、レガシー5テーブル）は Phase 0 からの既知の意図した全遮断状態で対応不要。
  - 漏洩パスワード保護WARNはPhase 0から継続の既知の見送り事項（§9.1 #9）で本作業とは無関係。

**効果**: 外部の第三者からのアクセスは全面遮断。**ここまでで外部脅威（§2.5 の 1,2,3,5）は解消**。
`inventory-images` への匿名アップロード/改竄/削除も遮断。
**残リスク**: ログインした従業員なら誰でも何でもできる（内部統制は未達、Phase 2 で対応）。

### Phase 2: ロール別制御 — ✅ 実施完了（2026-07-10）

目的: §4 のマトリクスを実装。内部者の権限を職務に合わせて絞る。

- ✅ `office_staff.role` 正規化（`admin`/`office`/`worker`/`viewer` の4値に統一）
- ✅ ヘルパー関数（§3.2）作成: `is_staff()` / `is_admin()` / `current_staff_role()` / `is_approver_staff()`
  （いずれも `SECURITY DEFINER`, `STABLE`, `SET search_path = public`、`office_staff.auth_user_id = auth.uid()` で判定）
- ✅ `invite-staff` Edge Function に admin チェック追加（呼び出し元の `office_staff.role === 'admin'` を確認、
  それ以外は HTTP 403）
- ✅ `office_staff` の RLS をロール別に変更（マイグレーション `phase2_office_staff_rls`）:
  SELECT は全 authenticated に維持（承認者一覧表示等に必要）。INSERT/DELETE は admin のみ。
  UPDATE は admin または本人の行のみ許可した上で、`role`/`auth_user_id`/`is_approver` の変更は
  トリガー（`protect_office_staff_privileged_columns`）で admin 以外を拒否する列単位保護を追加。
- ✅ `Customers`/`Workers`/`WorkerCertifications` のRLSをロール別に変更
  （マイグレーション `phase2_customers_workers_certifications_rls`）: admin/office はフルアクセス、
  `Workers` のみ worker に SELECT を追加開放（作業員選択画面での表示用）。
- ✅ `estimates`/`estimate_items`/`PurchaseRecords`/`Projects` のRLSをロール別に変更
  （マイグレーション `phase2_estimates_purchase_projects_rls`）: admin/office はフルアクセス、
  `Projects` は worker/viewer に SELECT を追加開放。`estimates` は `deleted_at IS NULL` の
  USING 条件を維持。見積承認操作自体の本人制限（§4.1 ルール2）はアプリ層に委ね、
  RPC化（`approve_estimate`/`return_estimate`）は Phase 3 の推奨事項として残す。
- ✅ 残り12テーブルのRLSをロール別に変更（マイグレーション `phase2_remaining_tables_rls`）:
  `ProjectTasks`, `TaskRecords`, `SubcontractorRecords`, `Assignments`, `CertificationNames`,
  `system_settings`, `OvertimeApprovals`, `WorkAllowanceApprovals`, `Warehouses`,
  `InventoryItems`, `CompanyHolidays`, `ProjectSuspensions`。§4 マトリクス通り、
  `TaskRecords`/`Warehouses`/`InventoryItems` は worker にも書き込みを許可（共有アカウントでの
  日報入力・現場での在庫操作のため）。`system_settings` は Phase 1 の「全authenticated書き込み可」から
  「admin のみ書き込み可・他ロールはSELECTのみ」へ意図的に厳格化（§4マトリクス通り）。

**検証結果（2026-07-10）**:
- 全マイグレーション適用直後に `pg_policies` を直接クエリし、`success:true` だけでなく
  実際の `qual`/`with_check` 句がロール判定条件を含む形になっていることを1件ずつ確認。
- `get_advisors`（security）再実行: 新規の ERROR は0件。
  - レガシー5テーブル（`DailyReports`, `MaterialUsageLogs`, `Materials`, `ServiceMaster`, `WorkLogs`）の
    `rls_enabled_no_policy` INFO は Phase 0 から継続の既知の意図した全遮断状態で対応不要
    （§5.1 でのレガシーテーブル削除候補）。
  - ヘルパー関数（`is_admin`等）が `anon`/`authenticated` から実行可能という WARN は、
    いずれも `auth.uid()` に基づく読み取り専用の自己ロール判定のみで副作用が無いため許容
    （`protect_office_staff_privileged_columns` はトリガー専用関数で直接RPC呼び出しは無害）。
  - 漏洩パスワード保護WARNはPhase 0から継続の既知の見送り事項（§9.1 #9）で本作業とは無関係。

**効果**: ログイン済みでもロールに応じた権限のみに制限（admin/office/worker/viewer で
読み書き範囲が分離）。**内部統制のギャップ（Phase 1 の残リスク）を解消**。
**残リスク**: 見積承認の「本人の承認枠のみ承認可」という遷移レベル制御、`Workers` の
単価等機微カラムの分離は未実施（Phase 3 で対応）。

### Phase 3: 行・遷移レベル制御（仕上げ） — ✅ 実施完了（2026-07-10）

スコープ（計画時）:
- 見積承認の RPC 化（`approve_estimate` / `return_estimate`）と `estimates` の直接 UPDATE 制限
- `Workers` 機微カラムの分離（§5.3）
- `stamps` バケットの private 化
- ~~日報の本人限定（`worker_id = current_worker_id()`）~~ — 共有アカウント方式（§3.3決定）のため対象外。
  将来、作業員を個人アカウント化した場合に実施

**実施内容**:

1. ✅ **見積承認の RPC 化と証跡カラム保護**（§4.1 ルール2。マイグレーションで
   `approve_estimate(p_estimate_id bigint)` / `return_estimate(p_estimate_id bigint, p_reason text)` を作成）
   - 両 RPC は `SECURITY DEFINER` + `SET search_path = public`。関数内で
     `is_approver_staff()`（承認権限を持つ staff か）と現在ステータスの遷移妥当性を検証してから
     `status` / 承認証跡カラムを更新する。
   - `estimates` への直接 UPDATE で `status` や承認証跡カラム（承認者・承認日時・差し戻し理由）を
     書き換える経路はトリガー（`protect_estimate_approval_columns`）で拒否。RPC 内部からの更新のみ、
     トランザクションローカルの `set_config('app.estimates_status_rpc', '1', true)` フラグで通す方式。
   - フロントエンドは `src/supabaseEstimates.js` の `approveEstimate` / `returnEstimate` を
     `supabase.rpc()` 呼び出しに変更し、成功後に承認証跡を再取得して画面へ反映。
2. ✅ **`Workers` 機微カラムの遮蔽**（§5.3 の「カラム分離」は既存コードへの影響が大きいため、
   **テーブル分離ではなく SECURITY DEFINER ビューで同等の効果を実現**する方式を採用）
   - マイグレーション `phase3_workers_directory_view`: 安全カラムのみ
     （`id`, `name`, `display_order`, `worker_type`, `resignation_date`）を公開する
     `workers_directory` ビューを作成（`WHERE is_staff()` で staff 登録済みユーザーのみ）。
     `Workers` 基表の worker 向け SELECT ポリシー（`workers_select_worker`）は削除し、
     基表への直接アクセスは admin/office のみ（`workers_office_all`）とした。
   - フロントエンド（`src/WorkerApp.jsx`・`src/ScheduleViewApp.jsx`・`src/hooks/useInventory.js`）を
     `workers_directory` からの取得に切り替え。副次効果として、従来 viewer が工程表画面で
     作業員名を取得できなかったギャップ（§4 マトリクスでは viewer の Workers は「―」だったが
     配置表表示には氏名が必要）も、機微カラムを漏らさずに解消された。
   - この方式により、worker/viewer ロールから単価・給与関連カラムへ到達する経路は存在しない。
3. ✅ **`stamps` バケットの private 化＋署名付きURL化**（§6.1・§9.1 #6。
   マイグレーション `phase3_stamps_bucket_private`）
   - バケットを `public: false` に変更し、`storage.objects` にバケット限定ポリシーを4本作成:
     SELECT は staff 全員（`is_staff()`）、INSERT/UPDATE/DELETE は admin/office のみ
     （UPDATE はアップロードが `upsert: true` のため必要）。
   - フロントエンドは新設の `src/utils/stampStorage.js` に集約:
     `getStampSignedUrl(value)` が `createSignedUrl(path, 3600)` で1時間有効の署名付きURLを発行。
     `stampPathFromValue()` が DB に残る旧形式（公開URLのフル文字列）と新形式（バケット内パスのみ）の
     両方からパスを抽出するため、**既存データの移行は不要**（後方互換）。
     参照箇所は `fetchSystemSettings`（`src/supabaseEstimates.js`）と
     `CompanyInfoSettings.jsx`（設定画面のプレビュー表示・アップロード）。新規アップロードはパスのみを保存する。
4. ✅ **SECURITY DEFINER 関数の EXECUTE 権限整理**（アドバイザー WARN への対応。
   マイグレーション `phase3_revoke_definer_function_exec`）
   - ヘルパー4関数（`is_staff` / `is_admin` / `current_staff_role` / `is_approver_staff`）と
     承認RPC 2関数: `anon` / `PUBLIC` から REVOKE（`authenticated` は維持 —
     RLS ポリシー式はクエリ実行ロールで評価されるため、また RPC はフロントエンドから呼ぶため必要）。
   - トリガー専用2関数（`protect_estimate_approval_columns` / `protect_office_staff_privileged_columns`）:
     `anon` / `authenticated` / `PUBLIC` すべてから REVOKE（トリガー発火は所有者権限で行われ
     呼び出し元の EXECUTE 権限を要さないため、REST RPC 面から完全に除去できる）。
   - `has_function_privilege()` で全8関数×anon/authenticated の権限を実測し、設計通りであることを確認済み。

**検証結果（2026-07-10）**:
- `get_advisors`（security）再実行:
  - 従来出ていた `anon_security_definer_function_executable` WARN（6関数）と
    トリガー関数への WARN は**すべて解消**。
  - ERROR `security_definer_view`（`workers_directory`）— **意図した設計として許容**。
    全アプリロールが DB 上は同一の `authenticated` ロールを共有するため、
    「worker/viewer に安全カラムのみ見せる」にはビュー側で定義者権限＋`is_staff()` ガードを
    使うのが本設計の遮蔽メカニズムそのもの。
  - WARN `authenticated_security_definer_function_executable`（ヘルパー4関数＋承認RPC 2関数）—
    上記4の通り仕様上必要なため許容。
  - INFO `rls_enabled_no_policy`（レガシー5テーブル）— Phase 0 から継続の意図した全遮断状態。
  - WARN `auth_leaked_password_protection` — Phase 0 から継続の既知の見送り事項（§9.1 #9）。
- アプリ動作確認: REVOKE 適用後にプレビュー環境で AdminApp を再検証し、認証済みセッションで
  案件一覧（見積/予定/施工中/完了）が正常にデータ表示されること・コンソール警告/エラーが
  無いことを確認（RLS のヘルパー関数評価が REVOKE 後も正常に機能している証跡）。
  stamps 署名付きURL・承認RPC・`workers_directory` 経由の各画面は実装時に個別にプレビュー検証済み。

**効果**: 見積承認の証跡はDBレベルで偽装不可能になり（§2.5 脅威2の残滓を完全封鎖）、
作業員の単価等機微情報は worker/viewer から到達不能、社印・個人印は署名付きURLでのみ参照可能になった。
**これで Phase 0〜3 の全計画スコープが完了**。
**残事項（いずれも本計画外の任意項目)**: `estimate_items` 重複ポリシー整理等の §5.3 任意改善、
漏洩パスワード保護（プランアップグレード時）。
（レガシー5テーブルの DROP は §5.1 の通り 2026-07-10 に実施完了。）
なお `src/supabaseEstimates.js` の `fetchWorkers` が選択する `Workers.stamp_url` は
現在どの画面でも描画されない残置カラムであり、将来の整理候補。

### 検証方法（各フェーズ共通）

- anon キーのみで REST API を叩き、遮断対象テーブルが 401/空になることを確認する
  （例: `curl "https://<project>.supabase.co/rest/v1/Workers?select=*" -H "apikey: <anon>"`）
- 各ロールのテストアカウントでアプリの全画面を操作し、業務フローが通ることを確認する
- `get_advisors`（security）を再実行し、ERROR が残っていないことを確認する

---

## 8. 運用ルール

1. **新規テーブル作成時**: RLS 有効化＋その時点のフェーズに合ったポリシーをマイグレーションに必ず含める
   （「とりあえず開放」を新規に増やさない。Phase 1 以降は最低でも `TO authenticated`）
2. **スキーマ変更は必ずマイグレーションファイル経由**で行う（今回発覚した「直接 SQL 適用による履歴乖離」の再発防止）
3. **service_role キーは Edge Functions の Secrets のみ**に置く。クライアント・リポジトリに置かない
4. 退職者が出たら: Auth ユーザーの無効化（ban）→ `office_staff` / `Workers` の紐付け行を無効化
5. 年1回程度、`get_advisors` の結果と本仕様書の乖離を棚卸しする

---

## 9. 決定事項と未決事項

### 9.1 決定済み

| # | 論点 | 決定 |
|---|---|---|
| 1 | 作業員の認証方式（2026-07-09） | **C: 共有アカウント**（作業員に会社メール無し・業務は日報入力のみのため。将来A案へ切替可） |
| 2 | 工程表閲覧の扱い（2026-07-09） | **A: viewer 共有アカウント** |
| 3 | Phase 0（応急処置）の実施（2026-07-09） | **実施完了（2026-07-09）**。詳細は §7 Phase 0 を参照 |
| 4 | レガシー5テーブルの削除可否（2026-07-09） | **削除可**。内容確認済みで支障無しとユーザー確認済み（§5.1）。<br>✅ 2026-07-10 にユーザーの明示的な実行指示を得て `DROP TABLE` 実施完了（§5.1）。実行時に判明した `ProjectTasks` の未使用FK制約も同時に除去済み |
| 5 | どのフェーズまで実施するか（2026-07-09） | **Phase 3 まで実施** → ✅ Phase 0〜3 すべて完了（2026-07-10、§7 参照） |
| 6 | `stamps` バケットの private 化（2026-07-09） | **実施完了（2026-07-10）**。list ポリシー削除は Phase 0、private化＋署名付きURL化は Phase 3 で完了（§6.1・§7 Phase 3） |
| 7 | admin ロールを付与する担当者（2026-07-09） | `office_staff.id = 17`（name: `admin`, email: `katudf@gmail.com`）**の1名**。<br>2026-07-09 時点で Auth 紐付き（`auth_user_id` 設定済み）かつ `role = 'システム管理者'` / `is_approver = true` はこの行のみ。<br>他に Auth 紐付きの `id = 16`（佐藤 勝義）は role 未設定・is_approver=false のため `office` 相当とする（§5.2） |
| 8 | Postgres バージョンアップグレード（2026-07-09） | **実施済み**。`17.4.1.054` → `17.6`。ダッシュボードから実施、`get_advisors` でバージョンWARNの解消を確認（§7 Phase 0） |
| 9 | 漏洩パスワード保護の有効化（2026-07-09） | **見送り**。Supabase Pro プラン以上が必要な機能で、現行プランでは有効化不可のため。プランアップグレード時に再検討（§7 Phase 0） |
| 10 | worker 共有アカウントの発行（2026-07-10） | **実施完了**。`kimuratosoukougyo@gmail.com` で Auth ユーザー作成、`office_staff.id=18`（role: `worker`）に紐付け。プレビューでのログイン成功を確認済み（§7 Phase 1） |
| 11 | viewer 共有アカウントの発行（2026-07-10） | **実施完了**。`kimuratosoukougyo@sweet.ocn.ne.jp` で Auth ユーザー作成、`office_staff.id=19`（role: `viewer`）に紐付け。プレビュー（`?mode=schedule`）でのログイン成功を確認済み（§7 Phase 1） |
| 12 | RLS Phase 1 の DB 変更・`inventory-images` 書き込み制限（2026-07-10） | **実施完了**。マイグレーション `phase1_rls_authenticated_only` を適用し、開放ポリシーがあった全20テーブル＋`storage.objects`（`inventory-images`のINSERT/UPDATE/DELETE）を `TO authenticated` に変換。検証: anon REST APIでのSELECTは200+空配列、INSERTは401+`42501`で拒否を確認／admin・worker・schedule の3モードでアプリ動作に問題無し・コンソールエラー無しを確認／`get_advisors` 再実行で新規ERRORなし（既存想定内のWARN・INFOのみ）。ロール別の内部統制はPhase 2で対応（§7 Phase 1） |

### 9.2 未決（ユーザー判断が必要）

現時点で未決事項なし（2026-07-09、#3〜#6 はすべて decided 済み → §9.1 に統合）。
