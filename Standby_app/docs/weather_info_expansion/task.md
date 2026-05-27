# 天気予報情報の拡張 タスクリスト

- [x] DataRepository のデータモデル定義 of 拡張 (`HourlyForecast`, `DailyForecast`, `WeatherData` のアップデート)
- [x] DataRepository での Open-Meteo API リクエストパラメータの拡張 (hourly, daily, timezone パラメータの追加)
- [x] DataRepository での API レスポンス (JSON) のパース処理の実装 (直近3時間の時間別予報、向こう5日間の週間予報)
- [x] MainScreen の Compose UI `WeatherSection` の再設計
  - [x] 現在の天気ブロックのレイアウト調整と降水確率の表示
  - [x] 直近3時間の時間別予報表示 (Hourly Block)
  - [x] 今後5日間の週間予報表示 (Daily Block)
- [/] 動作検証
  - [/] ビルドおよびエミュレータへのインストール・起動
  - [/] 位置情報から取得した現在地の天気・時間別予報・週間予報が正常にロードされることの確認
  - [/] 画面レイアウトの検証およびスクリーンショットの取得
