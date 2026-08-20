// 塗料製品 一括登録用 Markdown フォーマットの定義・パース・テンプレート生成

const FIELD_LABELS = {
  manufacturer: 'メーカー',
  process_role: '工程区分',
  name: '製品名',
  product_code: '品番',
  standard_usage_rate: '標準使用量',
  usage_rate_unit: '使用量単位',
  recoat_interval_standard_days: '上塗間隔・標準（日）',
  recoat_interval_max_days: '上塗間隔・上限（日）',
  dilution_rate: '希釈率',
  pot_life: '可使時間',
  drying_time: '乾燥時間',
  reference_price: '参考単価（円）',
  reference_price_unit: '単価単位',
  formaldehyde_grade: 'ホルムアルデヒド放散等級',
  standards: '規格',
  tags: 'タグ',
};

// 旧「JIS認証」分類軸のタグ。現在は paint_standards で扱うため軸ごと廃止されているが、
// 廃止前に作成されたMDファイルを読めるよう、タグとしては黙って読み飛ばす。
// 「JIS取得」は規格番号が分からないため、規格の紐付けはユーザーに明示させる（= 規格項目で指定）。
const OBSOLETE_TAG_VALUES = new Set(['JIS取得', 'JIS非該当']);

const NUMERIC_FIELDS = new Set([
  'standard_usage_rate',
  'recoat_interval_standard_days',
  'recoat_interval_max_days',
  'reference_price',
]);

const REQUIRED_FIELDS = ['manufacturer', 'process_role', 'name'];

// ラベル → フィールドキーの逆引き（表記ゆれ吸収のため前後空白除去して完全一致）
const LABEL_TO_FIELD = Object.entries(FIELD_LABELS).reduce((acc, [key, label]) => {
  acc[label] = key;
  return acc;
}, {});

// テンプレート内の説明用見出し。製品ブロックとして扱わない。
const IGNORED_HEADINGS = ['記入ルール'];

// 記入例の空欄プレースホルダ見出し（"（ここに2件目以降を追記）" など）。
// 中身が全て空欄なら「未記入」として黙って読み飛ばす。
const isPlaceholderHeading = (name) => /^[（(].*[）)]$/.test(name.trim());

/**
 * MDテキストを塗料製品リストにパースする。
 * 各製品は "## " 見出しで開始し、以降 "- キー: 値" の箇条書きで属性を記述する。
 * @param {string} text
 * @returns {{ items: Array<Object>, errors: string[] }}
 *   items[i] は { name, manufacturerName, processRoleName, product_code, ..., tagNames: string[] }
 */
export const parsePaintProductsMarkdown = (text) => {
  const lines = (text || '').replace(/\r\n/g, '\n').split('\n');
  const items = [];
  const errors = [];
  let current = null;
  let skipping = false; // 説明用見出しの配下を読み飛ばし中か
  let blockIndex = 0;

  // 値が1つも記入されていないブロックは未記入の雛形とみなして捨てる
  const isBlank = (block) =>
    !block.manufacturerName &&
    !block.processRoleName &&
    !(block.tagNames || []).length &&
    !(block.standardNames || []).length &&
    Object.keys(FIELD_LABELS).every((f) => f === 'name' || !block[f]);

  const pushCurrent = () => {
    if (!current) return;
    if (isPlaceholderHeading(current.name) && isBlank(current)) return;
    items.push(current);
  };

  lines.forEach((rawLine, lineNo) => {
    const line = rawLine.trim();
    if (line.startsWith('## ')) {
      pushCurrent();
      const heading = line.slice(3).trim();
      if (IGNORED_HEADINGS.includes(heading)) {
        current = null;
        skipping = true;
        return;
      }
      skipping = false;
      blockIndex += 1;
      current = { _blockIndex: blockIndex, _line: lineNo + 1, name: heading };
      return;
    }
    if (skipping) return; // 説明セクションの本文は無視
    if (!current) return; // 見出し前の行（タイトル・説明文）は無視
    if (line === '' || line.startsWith('#')) return; // 空行・その他見出しは無視

    const m = line.match(/^-\s*([^:：]+)[:：]\s*(.*)$/);
    if (!m) return;
    const label = m[1].trim();
    const value = m[2].trim();
    const field = LABEL_TO_FIELD[label];
    if (!field) {
      errors.push(`${blockIndex}番目の製品（${current.name || '無題'}）: 未知の項目「${label}」（${lineNo + 1}行目）`);
      return;
    }
    if (field === 'tags') {
      current.tagNames = value
        .split(/[、,]/)
        .map((s) => s.trim())
        .filter(Boolean);
    } else if (field === 'standards') {
      current.standardNames = value
        .split(/[、,]/)
        .map((s) => s.trim())
        .filter(Boolean);
    } else if (field === 'manufacturer') {
      current.manufacturerName = value;
    } else if (field === 'process_role') {
      current.processRoleName = value;
    } else {
      current[field] = value;
    }
  });
  pushCurrent();

  if (items.length === 0) {
    errors.push('製品が1件も見つかりませんでした（"## 製品名" 見出しで製品を区切ってください）');
  }

  return { items, errors };
};

/**
 * パース結果をマスタ（メーカー・工程区分・タグ）と突き合わせ、
 * DB保存用ペイロードに変換する。
 * @param {Array<Object>} items parsePaintProductsMarkdown の items
 * @param {{manufacturers: Array, processRoles: Array, axes: Array, standards?: Array}} masters
 * @returns {{ valid: Array<{product: Object, tagIds: number[], standardIds: number[], name: string}>, errors: string[] }}
 */
export const resolvePaintProductsAgainstMasters = (items, masters) => {
  const { manufacturers, processRoles, axes, standards = [] } = masters;
  const manufacturerByName = new Map(manufacturers.map((m) => [m.name.trim(), m]));
  const roleByName = new Map(processRoles.map((r) => [r.name.trim(), r]));
  const tagByValue = new Map();
  axes.forEach((axis) => axis.tags.forEach((t) => tagByValue.set(t.value.trim(), t)));

  // 規格は「JIS A 6909」のような表示形（種別＋番号）でも、「A 6909」だけでも引けるようにする
  const standardByName = new Map();
  standards.forEach((st) => {
    const code = (st.code || '').trim();
    standardByName.set(`${st.standard_type} ${code}`, st);
    standardByName.set(`${st.standard_type}${code}`, st);
    if (!standardByName.has(code)) standardByName.set(code, st);
  });
  const normalizeStandardKey = (v) => v.replace(/\s+/g, ' ').trim();

  const valid = [];
  const errors = [];

  items.forEach((item, idx) => {
    const label = `${idx + 1}番目の製品（${item.name || '無題'}）`;
    // 1製品内の不備はまとめて報告する（1件直すたびに再取込みさせないため）
    let ok = true;
    const fail = (msg) => {
      errors.push(`${label}: ${msg}`);
      ok = false;
    };

    const missing = REQUIRED_FIELDS.filter((f) => {
      if (f === 'manufacturer') return !item.manufacturerName;
      if (f === 'process_role') return !item.processRoleName;
      return !item[f] || !String(item[f]).trim();
    });
    if (missing.length > 0) {
      fail(`必須項目が不足しています（${missing.map((f) => FIELD_LABELS[f]).join('・')}）`);
    }

    let manufacturer = null;
    if (item.manufacturerName) {
      manufacturer = manufacturerByName.get(item.manufacturerName.trim());
      if (!manufacturer) fail(`メーカー「${item.manufacturerName}」が見つかりません`);
    }
    let processRole = null;
    if (item.processRoleName) {
      processRole = roleByName.get(item.processRoleName.trim());
      if (!processRole) fail(`工程区分「${item.processRoleName}」が見つかりません`);
    }

    NUMERIC_FIELDS.forEach((f) => {
      const v = item[f];
      if (v !== undefined && v !== '' && Number.isNaN(Number(v))) {
        fail(`「${FIELD_LABELS[f]}」は数値で入力してください（値: ${v}）`);
      }
    });

    const tagIds = [];
    (item.tagNames || []).forEach((tagName) => {
      // 廃止済みの「JIS取得」「JIS非該当」タグは無視する（規格は「規格」項目で指定する）
      if (OBSOLETE_TAG_VALUES.has(tagName)) return;
      const tag = tagByValue.get(tagName);
      if (!tag) {
        fail(`タグ「${tagName}」が見つかりません`);
        return;
      }
      tagIds.push(tag.id);
    });

    const standardIds = [];
    (item.standardNames || []).forEach((stName) => {
      const key = normalizeStandardKey(stName);
      const st = standardByName.get(key);
      if (!st) {
        fail(`規格「${stName}」が見つかりません`);
        return;
      }
      standardIds.push(st.id);
    });

    if (!ok) return;

    const numOrNull = (v) => (v === undefined || v === '' ? null : Number(v));
    const textOrNull = (v) => (v === undefined || v === '' ? null : String(v).trim());

    valid.push({
      name: item.name,
      product: {
        manufacturer_id: manufacturer.id,
        process_role_id: processRole.id,
        name: item.name.trim(),
        product_code: textOrNull(item.product_code),
        standard_usage_rate: numOrNull(item.standard_usage_rate),
        usage_rate_unit: textOrNull(item.usage_rate_unit),
        recoat_interval_standard_days: numOrNull(item.recoat_interval_standard_days),
        recoat_interval_max_days: numOrNull(item.recoat_interval_max_days),
        dilution_rate: textOrNull(item.dilution_rate),
        pot_life: textOrNull(item.pot_life),
        drying_time: textOrNull(item.drying_time),
        reference_price: numOrNull(item.reference_price),
        reference_price_unit: textOrNull(item.reference_price_unit),
        formaldehyde_grade: textOrNull(item.formaldehyde_grade),
      },
      tagIds,
      standardIds,
    });
  });

  return { valid, errors };
};

/**
 * マスタデータをもとに、記入例付きのテンプレートMDを生成する。
 * @param {{manufacturers: Array, processRoles: Array, axes: Array, standards?: Array}} masters
 */
export const buildPaintProductsTemplateMarkdown = (masters) => {
  const { manufacturers, processRoles, axes, standards = [] } = masters;

  const manufacturerList = manufacturers.length > 0
    ? manufacturers.map((m) => `${m.name}`).join(' / ')
    : '（マスタ管理タブでメーカーを登録してください）';
  const roleList = processRoles.length > 0
    ? processRoles.map((r) => r.name).join(' / ')
    : '防食下地 / 下塗 / 中塗 / 上塗 / ジンクリッチ';
  const axisLines = axes.map((axis) => `  - ${axis.name}: ${axis.tags.map((t) => t.value).join(' / ') || '(未登録)'}`).join('\n');

  const standardList = standards.length > 0
    ? standards.map((st) => `${st.standard_type} ${st.code}`).join(' / ')
    : '（マスタ管理タブで規格を登録してください）';

  const exampleManufacturer = manufacturers[0]?.name || 'ニッペ';
  const exampleRole = processRoles[0]?.name || '下塗';
  const exampleTag = axes[0]?.tags?.[0]?.value;

  return `# 塗料製品 一括登録フォーマット

以下のルールに従って、"## " で始まる見出し1つにつき製品1件を記述してください。
このファイルの内容を「塗料製品の登録」ダイアログの読み込みボタンからそのまま取り込めます。

## 記入ルール

- 製品ごとに \`## 製品名\` で開始する
- 属性は \`- 項目名: 値\` の形式で1行ずつ記述する
- 必須項目: ${FIELD_LABELS.manufacturer}・${FIELD_LABELS.process_role}・${FIELD_LABELS.name}（見出し）
- ${FIELD_LABELS.manufacturer} は登録済みのメーカー名と完全一致させてください（現在登録済み: ${manufacturerList}）
- ${FIELD_LABELS.process_role} は次のいずれか: ${roleList}
- ${FIELD_LABELS.tags} は「、」または「,」区切りで複数指定できます。指定可能なタグ:
${axisLines || '  （分類軸が未登録です）'}
- 数値項目（標準使用量・上塗間隔・参考単価）は数値のみを入力してください（単位は別項目）
- ${FIELD_LABELS.standards} は「、」または「,」区切りで複数指定できます。JIS・JASSの認証はタグではなくこの項目で指定します。
  指定可能な規格: ${standardList}
  ※ 認証がない製品はこの行を省略してください（旧フォーマットの「JIS非該当」タグは読み飛ばされます）
- 不要な項目は行ごと省略できます

---

## ${exampleManufacturer} ○○シリコンさび止め

- ${FIELD_LABELS.manufacturer}: ${exampleManufacturer}
- ${FIELD_LABELS.process_role}: ${exampleRole}
- ${FIELD_LABELS.product_code}: EX-100
- ${FIELD_LABELS.standard_usage_rate}: 0.15
- ${FIELD_LABELS.usage_rate_unit}: kg/m2
- ${FIELD_LABELS.recoat_interval_standard_days}: 1
- ${FIELD_LABELS.recoat_interval_max_days}: 10
- ${FIELD_LABELS.dilution_rate}: シンナーA 0〜5%
- ${FIELD_LABELS.pot_life}: 8時間（20℃）
- ${FIELD_LABELS.drying_time}: 16時間以上（20℃）
- ${FIELD_LABELS.reference_price}: 18000
- ${FIELD_LABELS.reference_price_unit}: 缶(16kg)
- ${FIELD_LABELS.formaldehyde_grade}: F☆☆☆☆
${standards.length > 0 ? `- ${FIELD_LABELS.standards}: ${standards[0].standard_type} ${standards[0].code}` : ''}
${exampleTag ? `- ${FIELD_LABELS.tags}: ${exampleTag}` : ''}

## （ここに2件目以降を追記）

- ${FIELD_LABELS.manufacturer}:
- ${FIELD_LABELS.process_role}:
- ${FIELD_LABELS.product_code}:
- ${FIELD_LABELS.standard_usage_rate}:
- ${FIELD_LABELS.usage_rate_unit}:
- ${FIELD_LABELS.recoat_interval_standard_days}:
- ${FIELD_LABELS.recoat_interval_max_days}:
- ${FIELD_LABELS.dilution_rate}:
- ${FIELD_LABELS.pot_life}:
- ${FIELD_LABELS.drying_time}:
- ${FIELD_LABELS.reference_price}:
- ${FIELD_LABELS.reference_price_unit}:
- ${FIELD_LABELS.formaldehyde_grade}:
- ${FIELD_LABELS.standards}:
- ${FIELD_LABELS.tags}:
`;
};

export { FIELD_LABELS };
