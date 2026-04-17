# 現場削除確認のカスタムモーダル化計画

Chrome等のブラウザ設定によって `window.confirm` ダイアログが表示されない、または機能しない問題を解消するため、独自の確認モーダルを実装します。これにより、環境に依存せず確実に現場の削除が行えるようになります。

## 現状の分析
- 現在、`useProjects.js` 内の `removeProject` 関数で `window.confirm` を使用しています。
- 一部のブラウザ設定や拡張機能により、この標準ダイアログがブロックされる可能性があります。

## 提案される変更

### 1. [ConfirmModal.jsx](file:///c:/Users/katuy/Desktop/cost-management-app/src/components/ConfirmModal.jsx) [NEW]
- タイトル、メッセージ、確認ボタン、キャンセルボタンを持つ汎用的な確認モーダルコンポーネントを作成します。
- Tailwind CSS を使用して、モダンでプレミアムなデザイン（削除なので警告感のある赤ベース）にします。

### 2. [useProjects.js](file:///c:/Users/katuy/Desktop/cost-management-app/src/hooks/useProjects.js) [MODIFY]
- モーダルの表示状態を管理する `isDeleteModalOpen` 状態を追加します。
- `removeProject` 関数を、ダイアログを出すのではなくモーダルを開く処理に変更します。
- 実際に削除を実行する `confirmRemoveProject` 関数を新設します。

### 3. [MasterTab.jsx](file:///c:/Users/katuy/Desktop/cost-management-app/src/components/tabs/MasterTab.jsx) [MODIFY]
- 作成した `ConfirmModal` を配置し、`useProjects` から提供される状態と関数を紐づけます。

## 検証計画

### 手動確認
- 「現場を削除」ボタンをクリックした際、ブラウザ標準のダイアログではなく、デザインされたカスタムモーダルが表示されることを確認。
- 「キャンセル」を押すと何も起きずモーダルが閉じることを確認。
- 「削除する」を押すと、正しく現場が削除され、ダッシュボードに戻ることを確認。
- Chrome, Edge 等の主要ブラウザで動作に差異がないことを確認。
