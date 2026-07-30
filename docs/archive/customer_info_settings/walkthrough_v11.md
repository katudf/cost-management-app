# 休日カレンダーの表示改善 - 修正内容の確認

会社休日カレンダーの統計情報の追加と、種別カラーの変更を行いました。

## 実施した変更内容

### 1. 月ごとの統計情報の追加
- **[HolidayCalendar.jsx](file:///c:/Users/katuy/Desktop/cost-management-app/src/components/HolidayCalendar.jsx)**
    - 各月のカレンダー下部に、その月の「休日数」と「出勤数」を表示するようにしました。
    - **休日の定義**: 日曜日、および「会社休日」として登録された日（ただし、会議・社員旅行を除く）を休日としてカウントします。

### 2. 年間統計の表記変更
- **[HolidayCalendar.jsx](file:///c:/Users/katuy/Desktop/cost-management-app/src/components/HolidayCalendar.jsx)**
    - カレンダー上部のラベルを「設定済：〇〇日」から「**年間休日日数：〇〇日**」に変更しました。
    - 登録された休日レコード数だけでなく、日曜などの公休日を含めた年度内（4月〜翌3月）の総休日数をリアルタイムに算出して表示します。

### 3. 「会議」カラーの変更
- **[HolidayCalendar.jsx](file:///c:/Users/katuy/Desktop/cost-management-app/src/components/HolidayCalendar.jsx)**
    - 「会議」の表示色を、青系から**緑系**（背景：薄緑、文字：濃緑）に変更し、他の休日とより区別しやすくしました。

## 確認事項

- [x] 各月の枠の下に「休日 〇日 / 出勤 〇日」と表示されている。
- [x] カレンダー上部に「年間休日日数 〇〇日」と表示されており、休日設定を変更すると数値が連動して変わる。
- [x] 「会議」を選択して日付をクリックした際、緑色で表示される。

> [!NOTE]
> 統計機能の追加により、年度内の稼働計画がより正確に把握できるようになりました。
