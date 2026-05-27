# 天気予報情報の拡張 実装計画書

本計画書は、天気予報セクションに週間予報、時間別予報、および降水確率を追加し、より情報量が多く実用的なスマートディスプレイ画面を構成するための実装方針を定義します。

## 1. ゴール説明
現在の天気予報（現在の気温・天気・地名）に加えて、以下の情報を追加します：
- **降水確率**: 現在時間帯の降水確率（%）
- **時間別予報**: 直近3時間の天気・気温・降水確率の推移
- **週間予報**: 今後5日間の天気・最高気温・最低気温の推移

これらを、プレミアムなデザインポリシー（ダークモード、適切なコントラスト、視認性の高いレイアウト）を維持したまま、画面右側の天気エリアに統合します。

---

## 2. 影響分析（自己検証）

### 設計ポリシー（Design Policies）との整合性
- **デザインのプレミアム性**: 黒背景を基調とし、アクセントカラー（例: 降水確率は水色系、温度は薄い青/赤など）を用いて視覚的に整理された、スタイリッシュなカードレイアウトを採用します。
- **省電力性**: データ取得は30分ごとのポーリングを維持し、無駄な通信によるバッテリー消費を防ぎます。

### 重要経路（Critical Paths）への副作用
- **非同期処理の維持**: APIリクエストの拡張およびレスポンスのJSONパース処理はすべて `Dispatchers.IO` スレッドで行うため、UI（時計のアニメーションなど）の動作パフォーマンスには一切影響を与えません。

### デグレード（先祖返り）の防止
- **フォールバック処理**: API取得失敗時やオフライン時には、前回のキャッシュまたはエラーUIを表示し、東京のデフォルト値で適切に動作する設計を維持します。また、JSON解析時のヌルポインタ例外を防ぐため、安全なオプショナルアクセスを行います。

---

## 3. 提案する変更内容

### 3.1. データレイヤーの変更
#### [MODIFY] [DataRepository.kt](file:///c:/Users/katuy/Desktop/cost-management-app/Standby_app/app/src/main/java/com/example/standbyclockapp/data/DataRepository.kt)
- **データモデルの拡張**:
  ```kotlin
  data class HourlyForecast(
      val time: String, // "12:00" など
      val temperature: Double,
      val weatherCode: Int,
      val precipitationProbability: Int
  )

  data class DailyForecast(
      val date: String, // "金" などの曜日、または "M/d" 形式
      val maxTemp: Double,
      val minTemp: Double,
      val weatherCode: Int
  )

  data class WeatherData(
      val temperature: Double,
      val weatherCode: Int,
      val location: String = "東京",
      val precipitationProbability: Int = 0, // 現在の降水確率
      val hourlyForecasts: List<HourlyForecast> = emptyList(), // 直近3時間
      val dailyForecasts: List<DailyForecast> = emptyList() // 向こう5日間
  )
  ```
- **APIリクエストURLの変更**:
  `hourly=temperature_2m,precipitation_probability,weathercode` および `daily=weathercode,temperature_2m_max,temperature_2m_min` パラメータを追加。
- **JSONパース処理の拡張**:
  APIレスポンスから `hourly` と `daily` の配列情報をパースし、現在の時刻に対応するインデックスから直近3時間分、および向こう5日間分を抽出して `WeatherData` に格納する。

### 3.2. UIロジックレイヤーの変更
#### [MODIFY] [MainScreenViewModel.kt](file:///c:/Users/katuy/Desktop/cost-management-app/Standby_app/app/src/main/java/com/example/standbyclockapp/ui/main/MainScreenViewModel.kt)
- 基本ロジックは変更ありませんが、データモデルの拡張に伴い、最新の `WeatherData` が `WeatherUiState.Success` としてUI側にシームレスに伝搬されます。

### 3.3. UIレイヤー of MainScreen
#### [MODIFY] [MainScreen.kt](file:///c:/Users/katuy/Desktop/cost-management-app/Standby_app/app/src/main/java/com/example/standbyclockapp/ui/main/MainScreen.kt)
- **`WeatherSection` の再設計**:
  カード全体のサイズを広げ、縦方向に3つのブロック（Current, Hourly, Daily）を配置します。
  - **Current Block**: 現在の天気（アイコン、地名、気温、現在の降水確率 ☔ XX%）
  - **Hourly Block**: 横スクロールまたは等幅の Row で配置。直近3時間の「時間」「天気アイコン」「気温」「降水確率」を配置。
  - **Daily Block**: 縦方向の Column で配置。今後5日間の「曜日」「天気アイコン」「気温範囲（最高/最低）」をグリッド状に配置。

---

## 4. 検証計画

### 4.1. 手動・エミュレータによる検証
1. アプリをビルドして実機/エミュレータに展開する。
2. アプリを起動し、位置情報パーミッション確認後に、現在地（エミュレータ上の現在地）に基づいた天気情報が表示されるか確認する。
3. カード内に降水確率、直近3時間の時間別予報、向こう5日間の週間予報が欠落なく、整ったレイアウトで表示されることを目視確認する。
4. `adb shell` コマンドでスクリーンショットを取得し、表示の崩れ（文字切れ、はみ出しなど）がないかを検証する。
