# タスクリスト: NET金額カスタマイズ実装

- [ ] `src/supabaseEstimates.js` の修正
    - [ ] `calcTotals` 関数を拡張してカスタムNET計算に対応
- [ ] `src/EstimateForm.jsx` の修正
    - [ ] `header` 初期状態に `net_calc_type`, `net_perc`, `net_amount` を追加
    - [ ] 読取時のデータセット処理を更新
    - [ ] 右サイドバーにNET計算設定のUIを追加
    - [ ] 保存処理のペイロードに新フィールドを追加
- [ ] `src/EstimatePDF.jsx` の修正
    - [ ] PDF生成時の `calcTotals` 呼び出しにNET設定を渡す
- [ ] 完了確認とドキュメント更新
    - [ ] `walkthrough.md` の作成
