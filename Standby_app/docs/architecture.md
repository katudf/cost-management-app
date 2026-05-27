# StandbyClockApp アーキテクチャ構成図 (Architecture)

## 1. 概要
本アプリは、Android端末を横向きにし、かつ充電している状態（スタンド状態）での使用を想定したスマートディスプレイ風アプリである。
画面の左半分に現在時刻（デジタルクロック）を大きく表示し、右半分にニュースや天気予報を自動的に切り替えながら表示（垂れ流し）する。

## 2. 設計ポリシー (Design Policies)
- **横向き固定 (Landscape Only)**: UIは横向き専用とし、縦向きでの起動であっても強制的に横向きで表示する。
- **充電状態の連動 (Charging Interaction)**:
  - 充電器に接続されている間は、画面がスリープに入らないように制御する（`FLAG_KEEP_SCREEN_ON` の制御）。
  - 充電中かどうかの状態を検知し、非充電時は省電力のために画面輝度を下げるか、または充電を促すインジケータを表示する。
- **デザインのプレミアム性 (Premium Aesthetics)**:
  - 黒背景を基調とした有機EL（OLED）フレンドリーなダークモードデザインを採用し、焼き付きを防止する。
  - ネオン風の微細なグラデーションや、滑らかなトランジションアニメーションを採用し、インテリアに馴染む高級感を演出する。
  - フォントはモダンなサンセリフ系を採用する。
- **データ更新の自動化**:
  - 天気予報およびニュースは、バックグラウンドのコルーチンを用いて定期的に自動更新する。

## 3. システム構造 (System Structure)

```mermaid
graph TD
    subgraph UI Layer (Jetpack Compose)
        MainActivity[MainActivity] --> MainScreen[MainScreen]
        MainScreen --> LeftSection[LeftSection: Clock & Battery]
        MainScreen --> RightSection[RightSection: News & Weather]
    end

    subgraph Logic Layer
        MainScreenViewModel[MainScreenViewModel] --> NewsFlow[News Flow]
        MainScreenViewModel --> WeatherFlow[Weather Flow]
        MainScreenViewModel --> BatteryReceiver[Battery & Power Connection Monitor]
    end

    subgraph Data Layer
        Repository[DataRepository] --> NewsApi[News RSS Parser]
        Repository --> WeatherApi[Open-Meteo API Client]
    end
```

### 3.1. UIレイアウト構成
画面を左右 1:1 に分割する。
- **左半分 (Clock Area)**:
  - 大きく「時:分」を表示。秒表示は小さく表示する。
  - 日付（月/日/曜日）。
  - 充電状態（充電中アイコン ⚡ とバッテリー残量 %）。
  - 設定画面（SettingsScreen）への遷移ボタン（⚙️ 設定）。
- **右半分 (Information Area)**:
  - 設定されたタイマー間隔（デフォルト10秒、5〜60秒で設定可能）で、天気予報画面とニュース一覧画面が自動で交互に切り替わって表示される。
  - **天気予報画面**: 現在の天気（都市名、気温、降水確率）に加え、時間別予報（4時間分）と週間予報（4日分）を広々と表示。
  - **ニュース画面**: NHK RSSから取得したニュースを、5秒ごとに1件ずつ自動で順次切り替えながら表示（フェードアニメーション）する。画面にはタイトル、公開日時、詳細な概要（description）、および現在のニュースのインデックス（例: 1 / 15）が表示される。


### 3.2. 外部API・通信
- **ニュース**: NHKニュースの主要RSS (`https://www3.nhk.or.jp/rss/news/cat0.xml`) または Yahoo! ニュースの RSS を非同期でパースして表示する。
- **天気予報**: 登録不要で利用可能な `Open-Meteo API` (`https://api.open-meteo.com/`) から、任意の地域（デフォルト：東京）の現在の天気および気温を取得する。

## 4. 重要経路 (Critical Paths)
1. **スリープ防止制御のライフサイクル連動**:
   `MainActivity` の `onResume` / `onPause` において、充電状態の監視レシーバーと連動して `FLAG_KEEP_SCREEN_ON` を適切に設定・解除する。
2. **定期的な通信とメモリリーク防止**:
   天気予報は30分ごと、ニュースは15分ごとに更新。アプリがバックグラウンドに回った際は、通信およびUI更新のジョブを即座に停止する（`repeatOnLifecycle` の使用）。
