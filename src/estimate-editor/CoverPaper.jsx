// src/estimate-editor/CoverPaper.jsx
// 見積書の鑑（表紙）を紙面そのままのレイアウトで表示し、印字項目を
// 紙面上の透明インラインinputで直接編集するコンポーネント。
//
// 移植元: src/EstimatePDF.jsx の CoverPage（レイアウト・スタイル値はすべて同一。
//         pt値は paperStyles.js 経由で px 換算）。見た目を変えるときは
//         EstimatePDF.jsx 側との一致を必ず確認すること。
//
// - isLocked 時はプレーンテキスト描画（印刷結果と同じ見え方）
// - 社判・代表印は PDF と同様「URLが設定されていれば描画」（stamp_header は
//   現行PDFでも参照していないため、挙動を揃えている）
// - wrapText（ヘアスペース挿入）は react-pdf の折返し対策なのでHTML側では不要
import React from 'react';
import CustomerCombobox from './CustomerCombobox';
import {
  pt, PAPER_WIDTH, PAPER_HEIGHT, COLORS, page, cover, table,
  fmt, fmtDate, calcFontSize,
} from './paperStyles';

const HONORIFICS = ['御中', '様', '殿', 'なし'];

// 透明インラインinputの共通スタイル（印字テキストと同じ書体・サイズを継承）
const fieldStyle = {
  background: 'transparent',
  border: 'none',
  outline: 'none',
  padding: 0,
  margin: 0,
  fontFamily: 'inherit',
  fontSize: 'inherit',
  fontWeight: 'inherit',
  color: 'inherit',
  lineHeight: 'inherit',
};
// ホバー/フォーカス時だけ編集可能箇所をうっすら示す
const FIELD_CLS = 'rounded-sm hover:bg-blue-50 focus:bg-blue-50 focus:ring-1 focus:ring-blue-300 transition-colors';

const CoverPaper = ({
  header,            // EstimateEditor のヘッダーstate
  onChange,          // (field, value) => void
  customers,
  onCreateCustomer,  // (name) => Promise<customer|null>
  officeStaff,
  settings,          // system_settings（社名・住所・印影URL）
  totals,            // calcTotals の結果 { net, subtotal, tax, total }
  isLocked,
}) => {
  const { subtotal, tax, total } = totals;

  const estimateNumber = `${header.estimate_number_date}-${header.estimate_number_seq}-${header.estimate_number_branch}`;
  const selectedCustomer = customers.find(c => String(c.id) === String(header.customer_id));
  const staff = officeStaff.find(s => String(s.id) === String(header.staff_id));

  // 顧客名の動的フォントサイズ計算（2行表示を前提に40文字基準）
  const customerFullName = `${selectedCustomer?.name || ''}　${header.customer_honorific === 'なし' ? '' : (header.customer_honorific || '御中')}`;
  const customerFontSize = calcFontSize(customerFullName, cover.customerFontSize, cover.customerMaxChars);

  // 工事名・備考の動的フォントサイズ計算
  const titleFontSize = calcFontSize(header.title, cover.projectFontSize, cover.titleValueMaxChars);
  const notesFontSize = calcFontSize(header.notes, cover.projectFontSize, cover.notesMaxChars);

  // 工事詳細の1行（ラベル＋値。値は透明inputで編集）
  const projectRow = (label, valueNode) => (
    <div style={{
      display: 'flex',
      marginBottom: pt(4),
      borderBottom: `${pt(0.5)}px dashed #ccc`,
      paddingBottom: pt(3),
    }}>
      <span style={{
        width: cover.projectLabelWidth,
        flexShrink: 0,
        fontWeight: 'bold',
        fontSize: cover.projectFontSize,
        color: COLORS.labelInk,
      }}>{label}</span>
      {valueNode}
    </div>
  );

  // テキスト系の値フィールド（isLocked時はプレーンテキスト）
  const textField = (field, { style = {}, ariaLabel } = {}) => (
    isLocked ? (
      <span style={{ width: cover.projectValueWidth, fontSize: cover.projectFontSize, ...style }}>
        {header[field] || ''}
      </span>
    ) : (
      <input
        type="text"
        value={header[field] || ''}
        onChange={e => onChange(field, e.target.value)}
        aria-label={ariaLabel}
        className={FIELD_CLS}
        style={{ ...fieldStyle, width: cover.projectValueWidth, fontSize: cover.projectFontSize, ...style }}
      />
    )
  );

  // 日付フィールド（isLocked時は「Y年M月D日」表記、編集時はdate input）
  const dateField = (field, { style = {}, ariaLabel } = {}) => (
    isLocked ? (
      <span style={style}>{fmtDate(header[field])}</span>
    ) : (
      <input
        type="date"
        value={header[field] || ''}
        onChange={e => onChange(field, e.target.value)}
        aria-label={ariaLabel}
        className={FIELD_CLS}
        style={{ ...fieldStyle, ...style }}
      />
    )
  );

  return (
    <div
      id="paper-cover"
      className="bg-white shadow-lg shrink-0"
      style={{
        width: PAPER_WIDTH,
        height: PAPER_HEIGHT,
        boxSizing: 'border-box',
        paddingTop: page.paddingTop,
        paddingBottom: page.paddingBottom,
        paddingLeft: page.paddingX,
        paddingRight: page.paddingX,
        fontSize: page.fontSize,
        color: COLORS.ink,
        position: 'relative',
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      <div style={{
        border: `${pt(1)}px solid #333`,
        padding: cover.outerBorderPadding,
        flex: 1,
        minHeight: 0,
        overflow: 'hidden',
        display: 'flex',
        flexDirection: 'column',
      }}>

        {/* 1. タイトル部分 (御見積書) */}
        <div style={{
          fontSize: cover.titleFontSize,
          fontWeight: 'bold',
          textAlign: 'center',
          letterSpacing: cover.titleLetterSpacing,
          borderBottom: `${pt(1.5)}px solid ${COLORS.ink}`,
          paddingBottom: cover.titlePaddingBottom,
          marginBottom: cover.titleMarginBottom,
          width: cover.titleWidth,
          alignSelf: 'center',
        }}>御　見　積　書</div>

        {/* 2. ヘッダー行 (見積No / 見積日) */}
        <div style={{
          display: 'flex',
          justifyContent: 'space-between',
          marginBottom: cover.headerRowMarginBottom,
          fontSize: cover.headerFontSize,
        }}>
          <div>
            見積 No.
            {isLocked ? (
              <span>{estimateNumber}</span>
            ) : (
              <span className="font-mono">
                <input
                  type="text"
                  value={header.estimate_number_date}
                  onChange={e => onChange('estimate_number_date', e.target.value)}
                  maxLength={6}
                  placeholder="YYMMDD"
                  aria-label="見積番号（日付部）"
                  className={`${FIELD_CLS} text-center`}
                  style={{ ...fieldStyle, width: '7ch' }}
                />
                -
                <input
                  type="text"
                  value={header.estimate_number_seq}
                  onChange={e => onChange('estimate_number_seq', e.target.value)}
                  maxLength={4}
                  placeholder="0001"
                  aria-label="見積番号（連番部）"
                  className={`${FIELD_CLS} text-center`}
                  style={{ ...fieldStyle, width: '5ch' }}
                />
                -
                <input
                  type="text"
                  value={header.estimate_number_branch}
                  onChange={e => onChange('estimate_number_branch', e.target.value)}
                  maxLength={3}
                  placeholder="001"
                  aria-label="見積番号（枝番部）"
                  className={`${FIELD_CLS} text-center`}
                  style={{ ...fieldStyle, width: '4ch' }}
                />
              </span>
            )}
          </div>
          <div>
            見積日 {dateField('issue_date', { ariaLabel: '見積日' })}
          </div>
        </div>

        {/* 3. 顧客・合計金額(左) と 自社情報(右) の2カラム配置 */}
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: pt(8), gap: pt(8) }}>

          {/* 左カラム: 宛名と合計金額ボックス */}
          <div style={{ width: cover.leftWidth }}>
            <div style={{
              borderBottom: `${pt(0.5)}px solid #555`,
              paddingBottom: pt(3),
              marginBottom: pt(6),
            }}>
              {isLocked ? (
                <div style={{ fontSize: customerFontSize, fontWeight: 'bold' }}>
                  {customerFullName}
                </div>
              ) : (
                <div className="flex items-end gap-2">
                  {/* 顧客コンボ（紙面上で直接選択・新規登録） */}
                  <div className="flex-1 min-w-0">
                    <CustomerCombobox
                      customers={customers}
                      value={header.customer_id}
                      onChange={v => onChange('customer_id', v)}
                      onCreateCustomer={onCreateCustomer}
                      disabled={isLocked}
                    />
                  </div>
                  <select
                    value={header.customer_honorific}
                    onChange={e => onChange('customer_honorific', e.target.value)}
                    aria-label="宛名の敬称"
                    className={FIELD_CLS}
                    style={{ ...fieldStyle, fontSize: pt(14), fontWeight: 'bold' }}
                  >
                    {HONORIFICS.map(h => <option key={h} value={h}>{h}</option>)}
                  </select>
                </div>
              )}
            </div>
            <div style={{ fontSize: cover.subTextFontSize, marginBottom: pt(4), color: COLORS.subInk }}>
              下記の通りお見積り申し上げます。
            </div>

            {/* 合計金額ボックス (税込表示) */}
            <div style={{
              display: 'flex',
              border: `${pt(1.5)}px solid ${COLORS.ink}`,
              marginTop: pt(4),
              marginBottom: pt(4),
              width: cover.totalBoxWidth,
              boxSizing: 'border-box',
            }}>
              <div style={{
                background: COLORS.headerBg,
                padding: `${pt(5)}px ${pt(8)}px`,
                fontSize: cover.totalBoxFontSize,
                fontWeight: 'bold',
                borderRight: `${pt(1)}px solid ${COLORS.ink}`,
                width: cover.totalBoxLabelWidth,
                boxSizing: 'border-box',
                display: 'flex',
                alignItems: 'center',
              }}>合計（税込）</div>
              <div style={{
                padding: `${pt(5)}px ${pt(10)}px`,
                fontSize: cover.totalBoxFontSize,
                fontWeight: 'bold',
                flex: 1,
                display: 'flex',
                alignItems: 'center',
              }}>¥{fmt(total)}-</div>
            </div>

            {/* 税抜金額と消費税の小テキスト */}
            <div style={{ fontSize: cover.subTextFontSize, marginBottom: pt(4), color: COLORS.subInk }}>
              工事金額：¥{fmt(subtotal)}-　　消費税相当額：¥{fmt(tax)}-
            </div>
          </div>

          {/* 右カラム: 自社住所・連絡先 と 印鑑枠 */}
          <div style={{
            width: cover.rightWidth,
            paddingTop: cover.rightPaddingTop,
            marginRight: cover.rightMarginRight,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'flex-start',
          }}>
            <div style={{
              position: 'relative',
              fontSize: cover.companyFontSize,
              lineHeight: cover.companyLineHeight,
            }}>
              {/* 印鑑画像を先に描画し、テキストの背面に配置する
                  （テキスト側を position:relative にしてDOM後勝ちで前面へ） */}
              {settings?.stamp_company_url && (
                <img
                  src={settings.stamp_company_url}
                  alt="社判"
                  style={{
                    position: 'absolute',
                    top: cover.companyStampTop,
                    right: cover.companyStampRight,
                    width: cover.companyStampSize,
                    height: cover.companyStampSize,
                    objectFit: 'contain',
                  }}
                />
              )}
              {settings?.stamp_representative_url && (
                <img
                  src={settings.stamp_representative_url}
                  alt="代表印"
                  style={{
                    position: 'absolute',
                    top: cover.representativeStampTop,
                    right: cover.representativeStampRight,
                    width: cover.representativeStampSize,
                    height: cover.representativeStampSize,
                    objectFit: 'contain',
                  }}
                />
              )}

              <div style={{
                position: 'relative',
                fontSize: cover.companyNameFontSize,
                fontWeight: 'bold',
                marginBottom: pt(3),
              }}>
                {settings?.company_name || ''}
              </div>
              {settings?.company_address && (
                <div style={{ position: 'relative' }}>{settings.company_address}</div>
              )}
              {settings?.company_tel && (
                <div style={{ position: 'relative' }}>TEL：{settings.company_tel}</div>
              )}
              {settings?.company_fax && (
                <div style={{ position: 'relative' }}>FAX：{settings.company_fax}</div>
              )}
              <div style={{ position: 'relative' }}>
                担当：
                {isLocked ? (
                  <span>{staff?.name || ''}</span>
                ) : (
                  <select
                    value={header.staff_id || ''}
                    onChange={e => onChange('staff_id', e.target.value)}
                    aria-label="担当者"
                    className={FIELD_CLS}
                    style={fieldStyle}
                  >
                    <option value="">-- 選択 --</option>
                    {officeStaff.map(s => (
                      <option key={s.id} value={s.id}>{s.name}</option>
                    ))}
                  </select>
                )}
              </div>
            </div>

            {/* 印鑑枠部分（show_approver時は承認欄の空枠を追加） */}
            <div style={{ display: 'flex', gap: pt(4), marginTop: pt(8) }}>
              {header.show_approver && (
                <div style={{
                  width: cover.stampBoxSize,
                  height: cover.stampBoxSize,
                  border: `${pt(0.5)}px solid ${COLORS.dashed}`,
                  boxSizing: 'border-box',
                }} />
              )}
              <div style={{
                width: cover.stampBoxSize,
                height: cover.stampBoxSize,
                border: `${pt(0.5)}px solid ${COLORS.dashed}`,
                boxSizing: 'border-box',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}>
                {staff?.name && (
                  <div style={{
                    width: cover.personalStampSize,
                    height: cover.personalStampSize,
                    borderRadius: '50%',
                    border: `${pt(1)}px solid ${COLORS.stampRed}`,
                    boxSizing: 'border-box',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}>
                    <span style={{
                      color: COLORS.stampRed,
                      fontSize: cover.personalStampFontSize,
                      fontFamily: "'Shippori Mincho', serif",
                    }}>
                      {staff.name.split(/[\s　]+/)[0]}
                    </span>
                  </div>
                )}
              </div>
            </div>
          </div>

        </div>

        {/* 4. 工事内容詳細セクション (左右分割レイアウト) */}
        <div style={{ marginTop: pt(4), paddingTop: pt(8), display: 'flex', overflow: 'hidden' }}>

          {/* 左ブロック: 工事詳細情報 */}
          <div style={{ flex: 1, paddingRight: pt(15), marginTop: cover.projectInfoLeftMarginTop }}>
            {projectRow('工  事  名', textField('title', {
              style: { fontWeight: 'bold', fontSize: titleFontSize },
              ariaLabel: '工事名',
            }))}
            {projectRow('工事場所 ', textField('site_location', { ariaLabel: '工事場所' }))}
            {projectRow('工　　期 ', textField('work_period', { ariaLabel: '工期' }))}
            {projectRow('有効期限 ', dateField('valid_until', {
              style: { width: cover.projectValueWidth, fontSize: cover.projectFontSize },
              ariaLabel: '有効期限',
            }))}
            {projectRow('支払条件', textField('payment_terms', { ariaLabel: '支払条件' }))}
          </div>

          {/* 右ブロック: 備考 */}
          <div style={{
            width: cover.projectInfoRightWidth,
            paddingLeft: cover.projectInfoRightPaddingLeft,
            marginTop: pt(4),
          }}>
            <div style={{ display: 'flex', marginBottom: pt(4) }}>
              <span style={{
                width: cover.projectLabelWidth,
                fontWeight: 'bold',
                fontSize: cover.projectFontSize,
                color: COLORS.labelInk,
              }}>備　考</span>
            </div>
            {isLocked ? (
              <div style={{
                width: cover.notesValueWidth,
                fontSize: notesFontSize,
                whiteSpace: 'pre-wrap',
              }}>{header.notes || ''}</div>
            ) : (
              <textarea
                value={header.notes || ''}
                onChange={e => onChange('notes', e.target.value)}
                rows={5}
                aria-label="備考"
                className={`${FIELD_CLS} resize-none`}
                style={{ ...fieldStyle, width: cover.notesValueWidth, fontSize: notesFontSize }}
              />
            )}
          </div>

        </div>

      </div>

      {/* ページフッター（会社名・ページ番号） */}
      <div style={{
        position: 'absolute',
        bottom: pt(15),
        left: 0,
        right: 0,
        textAlign: 'center',
        fontSize: table.footerFontSize,
        color: COLORS.muted,
      }}>{settings?.company_name || ''}</div>
      <div style={{
        position: 'absolute',
        bottom: pt(15),
        right: pt(40),
        fontSize: table.footerFontSize,
        color: COLORS.muted,
      }}>No.1</div>
    </div>
  );
};

export default CoverPaper;
