// ============================================================
//  施工台帳自動化システム
//
//  機能:
//    1. LIFFフォーム日報 → GAS POST → スプシ転記 + LINE push通知
//    2. LIFFアプリ → GAS GET → マスタデータ返却
// ============================================================

// ── 本番デフォルト値（Script Propertiesで上書き可能）──
// Dev環境では GASエディタ > プロジェクトの設定 > スクリプト プロパティ で以下を設定:
//   NOTIFY_GROUP_IDS  : ["Cf2d6d3d6f5b326c48ce30c9980c62dae"]
//   DRIVE_ROOT_FOLDER_ID : <dev用DriveフォルダID>
//   LINE_PUSH_USER_ID : <開発者個人のLINE User ID>
const CONFIG = (function() {
  const p = PropertiesService.getScriptProperties().getProperties();
  return {
    LINE_CHANNEL_ACCESS_TOKEN: p.LINE_TOKEN            || 'REMOVED_LINE_TOKEN',
    GEMINI_API_KEY:            p.GEMINI_API_KEY        || 'REMOVED_GEMINI_KEY',
    DRIVE_ROOT_FOLDER_ID:      p.DRIVE_ROOT_FOLDER_ID  || 'REMOVED_DRIVE_ID',
    FORM_ID:                   p.FORM_ID               || 'REMOVED_FORM_ID',
    LINE_PUSH_USER_ID:         p.LINE_PUSH_USER_ID     || 'REMOVED_LINE_USER_ID',
    NOTIFY_GROUP_IDS: p.NOTIFY_GROUP_IDS
      ? JSON.parse(p.NOTIFY_GROUP_IDS)
      : ['REMOVED_LINE_GROUP_ID'],
    // 請求書保存先: DRIVE_ROOT_FOLDER_ID直下に「受信済み請求書/YYYY-MM」を自動作成
  };
})();

// ============================================================
//  シートレイアウト定数
//  実エクセルに合わせた横形式レイアウト
// ============================================================

// 1日ブロックの列幅（22列: 20列 + 空白1列 + 区切り）
const DAY_BLOCK_COLS = 22;

// 各ブロック内の列オフセット（0始まり）
const COL = {
  // 作業員エリア（工場・事務所側）
  FACTORY_LABEL:   0,  // 「作業員」ラベル
  FACTORY_NAME:    1,  // 工場/事務所作業員名
  FACTORY_PRICE:   2,  // 単価
  FACTORY_HOURS:   3,  // 稼働時間(h) 1.0倍
  FACTORY_1_25:    4,  // 1.25h
  FACTORY_1_35:    5,  // 1.35h ★新規追加
  FACTORY_1_5:     6,  // 1.5h
  FACTORY_1_6:     7,  // 1.6h ★新規追加
  FACTORY_1_75:    8,  // 1.75h ★新規追加
  FACTORY_TOTAL:   9,  // 計
  FACTORY_NOTE:   10,  // その他
  // 現場作業員側
  SITE_NAME:      11,  // 現場作業員名
  SITE_PRICE:     12,  // 単価
  SITE_HOURS:     13,  // 稼働時間(h) 1.0倍
  SITE_1_25:      14,  // 1.25h
  SITE_1_35:      15,  // 1.35h ★新規追加
  SITE_1_5:       16,  // 1.5h
  SITE_1_6:       17,  // 1.6h ★新規追加
  SITE_1_75:      18,  // 1.75h ★新規追加
  SITE_TOTAL:     19,  // 計
  SITE_NOTE:      20,  // その他
  // スペーサー
  SPACER:         21,
  // 経費エリア右側の列オフセット（行27-56）
  EXP_LABEL:      10,  // ホテル等ラベル
  EXP_INPUT1:     11,
  EXP_INPUT2:     12,
  EXP_INPUT3:     13,
  EXP_INPUT4:     14,
  EXP_INPUT5:     15,
  EXP_INPUT6:     16,
  EXP_NAME:       17,  // 電車乗客名等
  EXP_AMOUNT:     18,  // 金額
  // 下請け業者（行47-56）
  SUB_NAME1:      13,
  SUB_COUNT1:     14,
  SUB_NAME2:      15,
  SUB_COUNT2:     16,
  SUB_NAME3:      17,
  SUB_COUNT3:     18,
};

// ── フォールバック用の行番号定数（動的検索が失敗した場合に使用）──
const ROW_DEFAULT = {
  DAY_TITLE:        2,   // B列スタートのため2行目
  SITE_NAME:        3,
  REPORTER:         4,
  HEADER:           5,
  WORKER_START:     6,
  WORKER_END:      25,
  WORKER_TOTAL:    26,
  // 車両経費入力欄（1号車）
  VEHICLE1_NAME:   27,  // 車両名
  GASOLINE1:       28,  // ガソリン km入力欄
  PARKING1:        29,  // 駐車場 円入力欄
  HIGHWAY1:        30,  // 高速代 円入力欄
  DIESEL1:         31,  // 軽油 km入力欄
  // 右側経費（ホテル・ゴミ・電車等）の行
  ROW_HOTEL:       27,  // ホテル（右側）
  ROW_GARBAGE_FACTORY: 29, // ゴミ工場（右側）
  ROW_GARBAGE_SITE: 30, // ゴミ現場（右側）
  ROW_TRAIN:       31,  // 電車（右側）
  ROW_OTHER:       39,  // その他（右側）
  ROW_ENTERTAINMENT: 46, // 接待費（右側）
  // 集計行（数式あり・直接書き込まない）
  GAS_DIST_TOTAL:  47,  // ガソリン距離計（km値はここに書く）
  DIESEL_DIST_TOTAL: 48,
  HIGHWAY_TOTAL:   52,  // 高速代合計（数式・書き込まない）
  PARKING_TOTAL:   53,  // 駐車場合計（数式・書き込まない）
  OTHER_MATERIAL:  54,
  HOTEL:           55,
  ENTERTAINMENT:   56,
  // まとめ集計
  SUMMARY_ROW:     62,
  DETAIL_START:    64,  // 請求書明細テーブル開始行
};

/**
 * ② 行番号動的検索
 * シートの左端列（A列）のラベルテキストを検索して行番号を特定する。
 * シートごとにレイアウトが1〜2行ズレていても自動追従する。
 *
 * 検索キーワードマップ:
 *   キーワード（部分一致） → ROWキー名
 *
 * @param {GoogleAppsScript.Spreadsheet.Sheet} sheet
 * @param {number} blockCol  ブロック開始列（1始まり）
 * @returns {Object} 行番号マップ { WORKER_START, WORKER_END, ... }
 */
function detectSheetRows(sheet, blockCol) {
  // キャッシュ: CacheServiceで同一実行内の再スキャンを防止（6時間有効）
  const cacheKey = 'rowDetect_' + sheet.getName().replace(/[^a-zA-Z0-9]/g, '_') + '_' + blockCol;
  try {
    const cached = CacheService.getScriptCache().get(cacheKey);
    if (cached) return JSON.parse(cached);
  } catch (e) { /* キャッシュ取得失敗は無視 */ }

  const result = Object.assign({}, ROW_DEFAULT);  // ROW_DEFAULTを必ずベースにする
  const maxRow = Math.min(sheet.getLastRow(), 80); // 最大80行まで走査

  // シートの左端列（ブロック開始列）を一括取得してスキャン
  const labelCol = blockCol; // ブロックの一番左列にラベルがある
  const labels = sheet.getRange(1, labelCol, maxRow, 1).getValues();

  // 検索ルール: [検索文字列（部分一致）, ROWキー, 優先度]
  const rules = [
    ['作業員',      'HEADER',          1],
    ['ガソリン距離計', 'GAS_DIST_TOTAL', 1],
    ['軽油距離計',  'DIESEL_DIST_TOTAL',1],
    ['電車',        'TRAIN',           1],
    ['ゴミ工場',    'GARBAGE_FACTORY', 1],
    ['ゴミ現場',    'GARBAGE_SITE',    1],
    ['高速代',      'HIGHWAY_TOTAL',   2], // 「高速代」は複数あるので2番目を優先
    ['駐車場',      'PARKING_TOTAL',   2],
    ['その他（資材', 'OTHER_MATERIAL',  1],
    ['ホテル',      'HOTEL',           1],
    ['接待費',      'ENTERTAINMENT',   1],
    ['まとめ',      'SUMMARY_HEADER',  1],
  ];

  // ルールごとにカウントしながらスキャン
  const hitCount = {};
  rules.forEach(([keyword]) => { hitCount[keyword] = 0; });

  labels.forEach((rowArr, idx) => {
    const rowNum = idx + 1;
    const cellText = String(rowArr[0] || '').trim();
    if (!cellText) return;

    rules.forEach(([keyword, rowKey, priority]) => {
      if (cellText.includes(keyword)) {
        hitCount[keyword] = (hitCount[keyword] || 0) + 1;
        if (hitCount[keyword] === priority) {
          result[rowKey] = rowNum;
        }
      }
    });
  });

  // WORKER_START: HEADERの次の行
  if (result.HEADER) {
    result.WORKER_START = result.HEADER + 1;
  }

  // WORKER_END・WORKER_TOTAL: GAS_DIST_TOTALの手前から逆算
  // 作業員エリアの末尾 = 経費セクション開始の2行前
  if (result.GAS_DIST_TOTAL && result.WORKER_START) {
    // 経費セクション開始行を推定（車両名行はガソリン距離計の約20行前）
    const expenseStart = result.GAS_DIST_TOTAL - 20;
    result.WORKER_END   = Math.max(expenseStart - 2, result.WORKER_START + 10);
    result.WORKER_TOTAL = result.WORKER_END + 1;
  }

  // CacheServiceに保存（6時間有効）
  try {
    CacheService.getScriptCache().put(cacheKey, JSON.stringify(result), 21600);
  } catch (e) { /* キャッシュ保存失敗は無視 */ }

  Logger.log(`行番号検出: ${sheet.getName()} / ${JSON.stringify(result)}`);
  return result;
}

// ROW は動的取得のショートカット（後方互換のためグローバルにも定義）
const ROW = ROW_DEFAULT;

// 経費行の右側カラム（全日共通、右端固定列に配置）
// 経費右側（ホテル・ゴミ等）のオフセット
const RIGHT_COL = {
  HOTEL_LABEL:    10,  // ホテルラベル
  HOTEL_INPUT:    11,  // ホテル入力
  APAHOTEL_INPUT: 13,  // アパホテル等入力
  GARBAGE_LABEL:  10,
  GARBAGE_AMT:    18,  // 金額列
  TRAIN_NAME:     17,
  TRAIN_AMT:      18,
  OTHER_NAME:     17,
  OTHER_AMT:      18,
  ENTERTAINMENT_N:17,
  ENTERTAINMENT_A:18,
};




// ============================================================
//  LIFFフォーム日報送信ハンドラ
//  LIFF → GAS POST → スプシ転記 + LINE通知
// ============================================================

/**
 * LIFFフォームから送信された日報を処理する
 * @param {Object} body - { action, sender, senderId, date, sites, note }
 */
function handleLiffReport(body) {
  try {
    var sender   = body.sender   || '不明';
    var date     = body.date;    // YYYY-MM-DD
    var sites    = body.sites    || [];
    var note     = body.note     || '';

    if (!date) {
      return jsonResponse({ success: false, error: '日付が指定されていません' });
    }

    // 日付順チェック: 一時停止中
    // if (body.senderId) {
    //   var missingDate = checkMissingDate(body.senderId, date);
    //   if (missingDate) {
    //     return jsonResponse({
    //       success: false,
    //       error: missingDate + ' の日報がまだ送信されていません。先にその日の日報を送信してください。'
    //     });
    //   }
    // }

    // 稼働なしの場合は提出記録のみ残して終了
    if (body.isWorking === false) {
      if (body.senderId) saveSubmitter(body.senderId, sender, date);
      var devGroupId0 = body._devNotifyGroupId || null;
      sendLiffReportNotification(sender, date, [], [], [], note || '稼働なし', devGroupId0);
      return jsonResponse({ success: true, successSites: [], failedSites: [] });
    }

    if (sites.length === 0) {
      return jsonResponse({ success: false, error: '現場データがありません' });
    }

    // 日付からyear/month/dayを取得
    var d     = new Date(date + 'T00:00:00');
    var year  = d.getFullYear();
    var month = d.getMonth() + 1;
    var day   = d.getDate();

    var ss = getMonthlySpreadsheet(year, month);

    var successSites = [];
    var failedSites  = [];

    sites.forEach(function(site) {
      if (!site.siteName) return;

      try {
        // 新規現場の場合は空き連番シートをリネーム
        if (site.isNewSite && site.siteName) {
          var newSheet = createSiteSheetByRename(ss, site.siteName);
          if (!newSheet) {
            Logger.log('新規現場シート作成失敗: ' + site.siteName);
          }
        }

        var sheet = getCaseSheet(ss, site.siteName);

        // parseDailyReport互換の形式に変換
        var parsed = {
          year:     year,
          month:    month,
          day:      day,
          siteName: site.siteName,
          reporter: '',  // LIFFからの送信は担当者行に書かない（送信者はLINE通知で確認）
          entries:  (site.workers || []).map(function(w) {
            // 新フォーマット（hoursNormal等）と旧フォーマット（days/overtime）の両対応
            var hoursNormal      = w.hoursNormal != null ? Number(w.hoursNormal) : (Number(w.days) || 0);
            var hoursOT          = Number(w.hoursOT)            || 0;
            var hoursNight       = Number(w.hoursNight)         || 0;
            var hoursOTNight     = Number(w.hoursOTNight)       || 0;
            var hoursSunday      = Number(w.hoursSunday)        || 0;
            var hoursSundayOT    = Number(w.hoursSundayOT)      || 0;
            var hoursSundayNight = Number(w.hoursSundayNight)   || 0;
            var hoursSundayOTN   = Number(w.hoursSundayOTNight) || 0;
            // 旧overtime → overtime150にマッピング
            if (!hoursOT && !hoursNight && Number(w.overtime) > 0) {
              hoursOT = Number(w.overtime) / 8;
            }
            return {
              name:            w.workerName,
              workerRole:      w.workerRole || 'site',
              hoursNormal:     hoursNormal,
              hours125:        hoursOT + hoursNight,        // 1.25: 残業 + 深夜
              hours135:        hoursSunday,                  // 1.35: 法定休日
              hours150:        hoursOTNight,                 // 1.50: 残業+深夜
              hours160:        hoursSundayOT + hoursSundayNight, // 1.60: 法定休日+残業/深夜
              hours175:        hoursSundayOTN,               // 1.75: 法定休日+残業+深夜
            };
          }),
          expenses: buildExpenses(site),
        };

        writeDayBlock(sheet, parsed);

        successSites.push(site.siteName);

      } catch (siteErr) {
        Logger.log('handleLiffReport site error [' + site.siteName + ']: ' + siteErr);
        failedSites.push(site.siteName + '\n  └ ' + String(siteErr).split('\n')[0]);
      }
    });

    // 提出記録を保存
    if (body.senderId && successSites.length > 0) {
      saveSubmitter(body.senderId, sender, date);
    }

    // LINE通知（グループに送信）
    var devGroupId = body._devNotifyGroupId || null;
    sendLiffReportNotification(sender, date, body.sites, successSites, failedSites, note, devGroupId);

    return jsonResponse({
      success: true,
      successSites: successSites,
      failedSites:  failedSites,
    });

  } catch (err) {
    Logger.log('handleLiffReport error: ' + err);
    // 致命的エラーをLINEに通知
    try {
      var errMsg = [
        '🚨 日報処理エラー',
        '送信者: ' + (body.sender || '不明'),
        '日付: ' + (body.date || '不明'),
        'エラー: ' + String(err).split('\n')[0],
        '※ スプレッドシートへの転記が失敗している可能性があります',
      ].join('\n');
      var errMsgObj = [{ type: 'text', text: errMsg }];
      var groupIds = (body._devNotifyGroupId ? [body._devNotifyGroupId] : (CONFIG.NOTIFY_GROUP_IDS || []));
      if (!body._devNotifyGroupId && CONFIG.LINE_PUSH_USER_ID) pushLineMessages(CONFIG.LINE_PUSH_USER_ID, errMsgObj);
      groupIds.forEach(function(id) { pushLineMessages(id, errMsgObj); });
    } catch (notifyErr) {
      Logger.log('エラー通知の送信失敗: ' + notifyErr);
    }
    return jsonResponse({ success: false, error: err.toString() });
  }
}

/**
 * LIFFフォームの経費データをexpenses配列に変換
 * 新構造: { vehicles:[], trains:[], others:[], hotelYen, leopalaceYen, garbageFactoryYen, ... }
 * 旧構造: { distanceKm, parkingYen, highwayYen, ... } にも後方互換で対応
 */
function buildExpenses(site) {
  var expenses = [];
  var exp = site.expenses || {};

  // ── 車両経費（新: vehicles配列 / 旧: distanceKm等フラット）──
  if (Array.isArray(exp.vehicles) && exp.vehicles.length > 0) {
    exp.vehicles.forEach(function(v) {
      if (!v || (!v.distanceKm && !v.dieselKm && !v.parkingYen && !v.highwayYen)) return;
      var vName = (v.vehicleName || '') + (v.etcCard ? '/ ETC' + v.etcCard : '');
      if (v.distanceKm) {
        expenses.push({
          type:        'gasoline',
          label:       (vName ? vName + ' ' : '') + '往復' + v.distanceKm + 'km',
          km:          Number(v.distanceKm),
          amount:      Math.round(Number(v.distanceKm) * 14.58),
          vehicleName: vName,
        });
      }
      if (v.dieselKm) {
        expenses.push({
          type:        'diesel',
          label:       (vName ? vName + ' ' : '') + '軽油往復' + v.dieselKm + 'km',
          km:          Number(v.dieselKm),
          vehicleName: vName,
        });
      }
      if (v.parkingYen) expenses.push({ type: 'parking', label: '駐車場', amount: Number(v.parkingYen) });
      if (v.highwayYen) expenses.push({ type: 'highway', label: '高速代', amount: Number(v.highwayYen) });
    });
  } else {
    // 旧フラット構造（後方互換）
    if (exp.distanceKm) {
      expenses.push({
        type:        'gasoline',
        label:       (exp.vehicle ? exp.vehicle + ' ' : '') + '往復' + exp.distanceKm + 'km',
        km:          Number(exp.distanceKm),
        amount:      Math.round(Number(exp.distanceKm) * 14.58),
        vehicleName: exp.vehicle || '',
      });
    }
    if (exp.parkingYen) expenses.push({ type: 'parking', label: '駐車場', amount: Number(exp.parkingYen) });
    if (exp.highwayYen) expenses.push({ type: 'highway', label: '高速代', amount: Number(exp.highwayYen) });
    if (exp.trainYen)   expenses.push({ type: 'train',   label: '電車',   amount: Number(exp.trainYen) });
    if (exp.otherYen)   expenses.push({ type: 'other',   label: 'その他', amount: Number(exp.otherYen) });
  }

  // ── ホテル / レオパレス ──
  if (exp.hotelYen)      expenses.push({ type: 'hotel',    label: exp.hotelName || 'ホテル',        amount: Number(exp.hotelYen) });
  if (exp.leopalaceYen)  expenses.push({ type: 'leopalace',label: exp.leopalaceName || 'レオパレス等', amount: Number(exp.leopalaceYen) });

  // ── ゴミ ──
  if (exp.garbageFactoryM3) expenses.push({ type: 'garbage_factory', label: 'ゴミ（木材のみ）', amount: Number(exp.garbageFactoryM3) });
  if (exp.garbageSiteM3)    expenses.push({ type: 'garbage_site',    label: 'ゴミ（混載）',     amount: Number(exp.garbageSiteM3) });

  // ── 電車（新: trains配列）──
  (exp.trains || []).forEach(function(t) {
    if (t && t.yen) expenses.push({ type: 'train', label: t.label || '電車', amount: Number(t.yen) });
  });

  // ── その他（新: others配列）──
  (exp.others || []).forEach(function(o) {
    if (o && o.yen) expenses.push({ type: 'other', label: o.label || 'その他', amount: Number(o.yen) });
  });

  // ── 接待費 ──
  if (exp.entertainmentYen) expenses.push({ type: 'entertainment', label: exp.entertainmentLabel || '接待費', amount: Number(exp.entertainmentYen) });

  // ── 下請け業者 ──
  (site.subcontractors || []).forEach(function(sub) {
    if (sub.subcontractorName) {
      expenses.push({ type: 'subcontractor', label: sub.subcontractorName, amount: Number(sub.count) || 1 });
    }
  });

  return expenses;
}

/**
 * LIFFフォーム送信後のLINE通知
 */
function sendLiffReportNotification(sender, date, sites, successSites, failedSites, note, devGroupId) {
  try {
    var d        = new Date(date + 'T00:00:00');
    var weekdays = ['日','月','火','水','木','金','土'];
    var dateLabel = (d.getMonth()+1) + '/' + d.getDate() + '（' + weekdays[d.getDay()] + '）';

    var lines = [
      '📋 ' + dateLabel + ' 日報',
      '👤 ' + sender,
      '─────────────────',
    ];

    sites.forEach(function(site) {
      if (!site.siteName) return;
      lines.push('');
      lines.push('📍 ' + site.siteName);

      // 作業員（1人1行、・始まり）
      var workers = (site.workers || []).filter(function(w) { return w.workerName; });
      if (workers.length > 0) {
        lines.push('');
        workers.forEach(function(w) {
          var parts = [];
          if (w.hoursNormal)        parts.push(w.hoursNormal + 'h');
          if (w.hoursSunday)        parts.push('休日' + w.hoursSunday + 'h');
          if (w.hoursOT)            parts.push('残業' + w.hoursOT + 'h');
          if (w.hoursNight)         parts.push('深夜' + w.hoursNight + 'h');
          if (w.hoursOTNight)       parts.push('深夜残業' + w.hoursOTNight + 'h');
          if (w.hoursSundayOT)      parts.push('休日残業' + w.hoursSundayOT + 'h');
          if (w.hoursSundayNight)   parts.push('休日深夜' + w.hoursSundayNight + 'h');
          if (w.hoursSundayOTNight) parts.push('休日深夜残業' + w.hoursSundayOTNight + 'h');
          if (parts.length === 0 && w.days != null) parts.push(w.days + '日');
          lines.push('・' + w.workerName + (parts.length ? ' ' + parts.join(' + ') : ''));
        });
      }

      // 経費（種別ごと1行、・始まり）
      var exp = site.expenses || {};
      var expLines = [];
      if (exp.carpool) {
        expLines.push('乗合い');
      } else {
        (exp.vehicles || []).forEach(function(v) {
          if (!v) return;
          var vParts = [];
          if (v.vehicleName) vParts.push(v.vehicleName);
          if (v.distanceKm)  vParts.push('往復' + v.distanceKm + 'km');
          if (v.dieselKm)    vParts.push('軽油' + v.dieselKm + 'km');
          if (v.parkingYen)  vParts.push('駐車¥' + Number(v.parkingYen).toLocaleString());
          if (v.highwayYen)  vParts.push('高速¥' + Number(v.highwayYen).toLocaleString());
          if (v.etcUsed)     vParts.push('ETC' + (v.etcCard || ''));
          if (vParts.length > 0) expLines.push(vParts.join(' '));
        });
      }
      if (!exp.vehicles && exp.distanceKm) {
        var vOld = [(exp.vehicle || ''), '往復' + exp.distanceKm + 'km'];
        if (exp.parkingYen) vOld.push('駐車¥' + Number(exp.parkingYen).toLocaleString());
        if (exp.highwayYen) vOld.push('高速¥' + Number(exp.highwayYen).toLocaleString());
        expLines.push(vOld.filter(Boolean).join(' '));
      }
      (exp.trains || []).forEach(function(t) { if (t && t.yen) expLines.push((t.label || '電車') + ' ¥' + Number(t.yen).toLocaleString()); });
      (exp.others || []).forEach(function(o) { if (o && o.yen) expLines.push((o.label || 'その他') + ' ¥' + Number(o.yen).toLocaleString()); });
      if (exp.hotelYen)     expLines.push((exp.hotelName || 'ホテル') + ' ¥' + Number(exp.hotelYen).toLocaleString());
      if (exp.leopalaceYen) expLines.push((exp.leopalaceName || 'レオパレス') + ' ¥' + Number(exp.leopalaceYen).toLocaleString());
      if (exp.garbageFactoryM3 || exp.garbageSiteM3) {
        var g = [];
        if (exp.garbageFactoryM3) g.push('木材のみ ' + Number(exp.garbageFactoryM3) + 'm³');
        if (exp.garbageSiteM3)    g.push('混載 '     + Number(exp.garbageSiteM3)    + 'm³');
        expLines.push('ゴミ ' + g.join(' '));
      }
      if (exp.entertainmentYen) expLines.push((exp.entertainmentLabel || '雑経費') + ' ¥' + Number(exp.entertainmentYen).toLocaleString());
      if (exp.otherYen)         expLines.push('その他 ¥' + Number(exp.otherYen).toLocaleString());
      if (expLines.length > 0) {
        lines.push('');
        expLines.forEach(function(l) { lines.push('・' + l); });
      }

      // 下請け業者
      var subs = (site.subcontractors || []).filter(function(s) { return s.subcontractorName; });
      if (subs.length > 0) {
        lines.push('');
        subs.forEach(function(s) { lines.push('・' + s.subcontractorName + ' ' + s.count + '人'); });
      }
    });

    if (note) lines.push('\n📝 ' + note);

    if (failedSites.length > 0) {
      lines.push('\n⚠️ 未登録: ' + failedSites.join('、'));
    }

    var msg = [{ type: 'text', text: lines.join('\n') }];
    var groupIds = devGroupId ? [devGroupId] : (CONFIG.NOTIFY_GROUP_IDS || []);
    if (!devGroupId && CONFIG.LINE_PUSH_USER_ID) pushLineMessages(CONFIG.LINE_PUSH_USER_ID, msg);
    groupIds.forEach(function(id) { pushLineMessages(id, msg); });

  } catch (err) {
    Logger.log('sendLiffReportNotification error: ' + err);
  }
}

/**
 * JSON レスポンスを返すユーティリティ
 */
function jsonResponse(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}


// ============================================================
//  日報原価基本エクセル：「事務、工場、その他」シート複製
//  スプレッドシート上のメニューから実行できます
// ============================================================

/**
 * スプレッドシートを開いた時にカスタムメニューを追加する
 * ※スプレッドシートのGASエディタにこのコードを貼り付けて使う
 */
// ============================================================
//  シート管理（日報原価基本エクセル用）
//
//  【月次運用フロー】
//  1. 「日報原価基本_修正.xlsx」をコピーしてGoogleスプレッドシートに変換
//  2. ファイル名を「2026.05」などに変更（GASがこの名前で検索する）
//  3. スプレッドシートを開くと上部に「📋 シート管理」メニューが出る
//  4. 「現場シートを追加」で現場名を入力して複製
//  5. LIFFから日報を送信 → 現場名シートに自動転記
// ============================================================

// 管理シート名（複製元・非現場シートとして除外される）
var SYSTEM_SHEETS = ['外注', '提出確認', '金額集計', '事務、工場、その他', '設定', '月次サマリ', '業者台帳'];

function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('📋 シート管理')
    .addItem('➕ 現場シートを追加',           'duplicateKojiSheet')
    .addItem('📋 現場シート一覧を確認',       'showSiteSheetList')
    .addSeparator()
    .addItem('🧹 不要文字列を一括削除(O27,R31,R32)', 'clearLegacyCells')
    .addSeparator()
    .addItem('🗑️ 現場シートを削除',          'deleteExtraSheets')
    .addToUi();
}

/**
 * 全現場シートの O27, R31, R32 に残った不要な文字列を一括削除する。
 * メニュー「🧹 不要文字列を一括削除」から実行。
 */
function clearLegacyCells() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var ui = SpreadsheetApp.getUi();
  var siteSheets = ss.getSheets().filter(function(s) {
    return SYSTEM_SHEETS.indexOf(s.getName()) === -1;
  });

  if (siteSheets.length === 0) {
    ui.alert('現場シートが見つかりません。');
    return;
  }

  var cleared = [];
  siteSheets.forEach(function(sheet) {
    sheet.getRange('O27').clearContent();
    sheet.getRange('R31').clearContent();
    sheet.getRange('R32').clearContent();
    cleared.push(sheet.getName());
  });

  ui.alert('✅ 完了\n\n以下のシートの O27, R31, R32 を削除しました:\n\n' + cleared.join('\n'));
}

/**
 * 「事務、工場、その他」を複製し、ダイアログで入力した現場名をシート名にする。
 * 金額集計D10の参照も自動更新する。
 */
function duplicateKojiSheet() {
  var ss  = SpreadsheetApp.getActiveSpreadsheet();
  var ui  = SpreadsheetApp.getUi();
  var src = ss.getSheetByName('事務、工場、その他');

  if (!src) {
    ui.alert('❌ 「事務、工場、その他」シートが見つかりません。');
    return;
  }

  // 現場名をダイアログで入力
  var res = ui.prompt(
    '現場シートを追加',
    '追加する現場名を入力してください：\n（例: BLH名古屋, ギフト桜ステージ）',
    ui.ButtonSet.OK_CANCEL
  );
  if (res.getSelectedButton() !== ui.Button.OK) return;

  var siteName = res.getResponseText().trim();
  if (!siteName) {
    ui.alert('⚠️ 現場名が入力されていません。');
    return;
  }

  // 同名シートの重複チェック
  if (ss.getSheetByName(siteName)) {
    ui.alert('⚠️ 「' + siteName + '」シートは既に存在します。');
    return;
  }

  // 複製して現場名を設定
  var newSheet = src.copyTo(ss);
  newSheet.setName(siteName);

  // 「事務、工場、その他」の直後に移動
  var sheets   = ss.getSheets();
  var srcIndex = sheets.findIndex(function(s) { return s.getName() === '事務、工場、その他'; });
  if (srcIndex >= 0) {
    ss.moveActiveSheet(srcIndex + 2); // srcIndex は 0始まり、moveActiveSheet は 1始まり
  }

  // 金額集計シートの参照を更新
  updateKingakuSheet(ss);

  // 五十音順に並べ替え
  sortSiteSheets(ss);

  ui.alert('✅ 「' + siteName + '」シートを追加しました！\n\nLIFFから日報を送ると自動転記されます。');
  Logger.log('シート複製完了: ' + siteName);
}

/**
 * 金額集計シートのD10を全現場シートのO62合計に更新する。
 * 現場シート = SYSTEM_SHEETSに含まれないシート名
 */
function updateKingakuSheet(ss) {
  var ks = ss.getSheetByName('金額集計');
  if (!ks) return;

  // 全シートから現場シートのみ抽出
  var siteSheets = ss.getSheets().filter(function(s) {
    return SYSTEM_SHEETS.indexOf(s.getName()) === -1;
  });

  if (siteSheets.length === 0) {
    // 現場シートがなければ事務シートのみ参照
    ks.getRange('D10').setFormula("='事務、工場、その他'!O62");
    return;
  }

  // 事務シート + 全現場シートのO62を合計
  var parts = ["='事務、工場、その他'!O62"];
  siteSheets.forEach(function(s) {
    parts.push("'" + s.getName().replace(/'/g, "\\'") + "'!O62");
  });

  ks.getRange('D10').setFormula(parts.join('+'));
  Logger.log('金額集計D10更新 (' + siteSheets.length + '現場): ' + ks.getRange('D10').getFormula());
}

/**
 * 現在の現場シート一覧をダイアログで表示する。
 */
function showSiteSheetList() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var siteSheets = ss.getSheets().filter(function(s) {
    return SYSTEM_SHEETS.indexOf(s.getName()) === -1;
  });

  if (siteSheets.length === 0) {
    SpreadsheetApp.getUi().alert('現場シートはまだありません。\n「➕ 現場シートを追加」から追加してください。');
    return;
  }

  var list = siteSheets.map(function(s, i) {
    return (i + 1) + '. ' + s.getName();
  }).join('\n');

  SpreadsheetApp.getUi().alert(
    '📋 現場シート一覧（' + siteSheets.length + '件）\n\n' + list
  );
}

/**
 * 現場シートを選択して削除する。
 * チェックボックス形式は使えないので番号入力方式で対応。
 */
function deleteExtraSheets() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var ui = SpreadsheetApp.getUi();

  var siteSheets = ss.getSheets().filter(function(s) {
    return SYSTEM_SHEETS.indexOf(s.getName()) === -1;
  });

  if (siteSheets.length === 0) {
    ui.alert('削除できる現場シートはありません。');
    return;
  }

  // 一覧を表示して番号入力を促す
  var list = siteSheets.map(function(s, i) {
    return (i + 1) + '. ' + s.getName();
  }).join('\n');

  var res = ui.prompt(
    '現場シートを削除',
    '削除するシートの番号をカンマ区切りで入力（全削除は「all」）：\n\n' + list,
    ui.ButtonSet.OK_CANCEL
  );
  if (res.getSelectedButton() !== ui.Button.OK) return;

  var input = res.getResponseText().trim().toLowerCase();
  var toDelete = [];

  if (input === 'all') {
    toDelete = siteSheets;
  } else {
    var nums = input.split(',').map(function(n) { return parseInt(n.trim(), 10); });
    nums.forEach(function(n) {
      if (n >= 1 && n <= siteSheets.length) {
        toDelete.push(siteSheets[n - 1]);
      }
    });
  }

  if (toDelete.length === 0) {
    ui.alert('⚠️ 有効な番号が入力されていません。');
    return;
  }

  var names = toDelete.map(function(s) { return s.getName(); }).join('、');
  var confirm = ui.alert(
    '確認',
    '以下のシートを削除します。よろしいですか？\n\n' + names,
    ui.ButtonSet.YES_NO
  );
  if (confirm !== ui.Button.YES) return;

  toDelete.forEach(function(sheet) {
    ss.deleteSheet(sheet);
  });

  // 金額集計を更新
  updateKingakuSheet(ss);

  ui.alert('✅ ' + toDelete.length + '件のシートを削除しました。');
  Logger.log('シート削除完了: ' + names);
}

// ============================================================
//  doGet - LIFFフォーム用マスタデータAPI
//  GETリクエスト: ?action=getMaster でスプシからデータ取得
// ============================================================
function doGet(e) {
  try {
    var action = e && e.parameter && e.parameter.action;

    if (action === 'getMaster') {
      // CacheServiceにマスタデータ全体をキャッシュ（1時間）
      var masterCacheKey = 'master_data_v1';
      try {
        var cachedMaster = CacheService.getScriptCache().get(masterCacheKey);
        if (cachedMaster) {
          return ContentService.createTextOutput(cachedMaster).setMimeType(ContentService.MimeType.JSON);
        }
      } catch(e) { /* キャッシュ取得失敗は無視 */ }

      var now = new Date();
      var ss  = getMonthlySpreadsheet(now.getFullYear(), now.getMonth() + 1);
      // 現場名（設定シートのA列から読む）
      var sites = [];
      try {
        var settingForSites = ss.getSheetByName('設定');
        if (settingForSites) {
          var siteVals = settingForSites.getRange(1, 1, settingForSites.getLastRow(), 1).getValues();
          siteVals.forEach(function(row) {
            var n = String(row[0] || '').trim();
            if (n && !n.startsWith('【') && !n.match(/^\s*\(\d+\)\s*$/)) sites.push(n);
          });
        }
        // 設定シートに現場名がない場合はシートタブから取得（フォールバック）
        if (sites.length === 0) {
          var excludeSheets = ['外注','提出確認','金額集計','事務、工場、その他','設定','月次サマリ','業者台帳'];
          sites = ss.getSheets()
            .map(function(s) { return s.getName().trim(); })
            .filter(function(n) { return n && !excludeSheets.includes(n) && !n.match(/^\s*\(\d+\)\s*$/); });
        }
      } catch (siteErr) {
        Logger.log('getMaster sites error: ' + siteErr);
      }

      // 作業員・下請け業者（「事務、工場、その他」テンプレートシートから直接読む）
      var workers = [];
      var subcontractors = [];
      try {
        var tmpl = ss.getSheetByName('事務、工場、その他');
        if (tmpl) {
          var blockCol = getDayBlockCol(1); // 1日目ブロック開始列
          var rowStart = ROW_DEFAULT.WORKER_START; // 6
          var rowEnd   = ROW_DEFAULT.WORKER_END;   // 25

          // 作業員エリアを一括取得（factory側 + site側）
          var workerRange = tmpl.getRange(rowStart, blockCol, rowEnd - rowStart + 1, DAY_BLOCK_COLS - 1).getValues();
          workerRange.forEach(function(row) {
            var fName  = String(row[COL.FACTORY_NAME]  || '').trim();
            var fPrice = row[COL.FACTORY_PRICE];
            if (fName && typeof fPrice === 'number' && fPrice > 0) {
              workers.push({ name: fName, unitPrice: fPrice, role: 'factory' });
            }
            var sName  = String(row[COL.SITE_NAME]  || '').trim();
            var sPrice = row[COL.SITE_PRICE];
            if (sName && typeof sPrice === 'number' && sPrice > 0) {
              workers.push({ name: sName, unitPrice: sPrice, role: 'site' });
            }
          });

          // 下請け業者（行47〜56、name offsets: 13, 15, 17）
          // ヘッダ行ラベル（「下請け御者」等）を除外
          var subRange = tmpl.getRange(47, blockCol, 10, 18).getValues();
          subRange.forEach(function(row) {
            [13, 15, 17].forEach(function(offset) {
              var name = String(row[offset] || '').trim();
              if (name && !name.includes('下請け御者') && !name.includes('業者名')) {
                subcontractors.push(name);
              }
            });
          });
        }
      } catch (settingErr) {
        Logger.log('getMaster worker error: ' + settingErr);
      }

      var vehicles = ['ハイエース', 'キャラバン', 'プロボックス', 'その他'];

      var result = JSON.stringify({
        sites:          sites,
        workers:        workers,
        subcontractors: subcontractors,
        vehicles:       vehicles,
      });
      // キャッシュに保存（1時間）
      try { CacheService.getScriptCache().put(masterCacheKey, result, 3600); } catch(e) {}
      return ContentService.createTextOutput(result)
        .setMimeType(ContentService.MimeType.JSON);
    }
  } catch (err) {
    Logger.log('doGet error: ' + err);
    return ContentService.createTextOutput(JSON.stringify({ error: err.toString() }))
      .setMimeType(ContentService.MimeType.JSON);
  }

  return ContentService.createTextOutput(JSON.stringify({ status: 'ok' }))
    .setMimeType(ContentService.MimeType.JSON);
}

// ============================================================
//  doPost - LIFFフォーム日報受信
// ============================================================
function doPost(e) {
  try {
    const body = JSON.parse(e.postData.contents);
    if (body.action === 'submitReport') {
      return handleLiffReport(body);
    }
    if (body.action === 'uploadFiles') {
      return handleFileUploads(body);
    }
  } catch (err) {
    Logger.log('doPost error: ' + err);
  }
  return ContentService.createTextOutput(JSON.stringify({ status: 'ok' }))
    .setMimeType(ContentService.MimeType.JSON);
}

/**
 * ファイルアップロード専用ハンドラ（fire-and-forgetで呼ばれる）
 * スプレッドシート書き込みやLINE通知は行わず、Driveへの保存のみ実施
 */
function handleFileUploads(body) {
  try {
    var sender = body.sender || '不明';
    var date   = body.date;
    var sites  = body.sites || [];
    sites.forEach(function(site) {
      if (!site.siteName || !site.expenses) return;
      try {
        var exp = site.expenses;
        // ゴミ写真
        if ((exp.garbageFactoryM3 || exp.garbageSiteM3) && exp.garbagePhotos && exp.garbagePhotos.length > 0) {
          var ss    = getSpreadsheetBySiteName(site.siteName);
          var sheet = ss ? getCaseSheet(ss, site.siteName) : null;
          var day   = date ? parseInt(date.split('-')[2]) : null;
          var folderUrl = saveGarbagePhotos(exp.garbagePhotos, date, sender, site.siteName);
          if (folderUrl && sheet && day) writeGarbageFolderLink(sheet, folderUrl, day);
        }
        // 各経費ファイル
        [
          { key: 'vehicleFiles',       label: '車両' },
          { key: 'trainFiles',         label: '電車' },
          { key: 'hotelFiles',         label: 'ホテル' },
          { key: 'leopalaceFiles',     label: 'レオパレス' },
          { key: 'otherFiles',         label: 'その他経費' },
          { key: 'entertainmentFiles', label: '雑経費' },
        ].forEach(function(cat) {
          var files = exp[cat.key];
          if (files && files.length > 0) {
            saveExpenseFiles(files, date, sender, site.siteName, cat.label);
          }
        });
      } catch (siteErr) {
        Logger.log('handleFileUploads site error [' + site.siteName + ']: ' + siteErr);
      }
    });
  } catch (err) {
    Logger.log('handleFileUploads error: ' + err);
  }
  return jsonResponse({ success: true });
}


// ============================================================
//  現場シートへの日報書き込み（横形式）
// ============================================================

/**
 * LINEから受け取った日報データを現場シートの「日ブロック」に書き込む。
 * 日報の「何日」をそのまま列位置に変換して上書き。
 * 既存シートのレイアウト（作業員名・単価・経費ラベル）はそのまま維持し、
 * 「工数」「残業」「経費金額」のみを書き込む。
 */
function writeDayBlock(sheet, parsed) {
  const { day, reporter, entries, expenses } = parsed;
  const settings = getSettings();
  const workerPrices = getWorkerPrices();

  const blockCol = getDayBlockCol(day);

  // ② 行番号を動的に検出（シートごとのレイアウトズレに自動追従）
  const ROW_D = detectSheetRows(sheet, blockCol);

  // ── 担当者（報告者）を記録 ──
  const reporterRow = (ROW_D && ROW_D.REPORTER) ? ROW_D.REPORTER : ROW_DEFAULT.REPORTER;
  if (reporter && reporterRow) {
    sheet.getRange(reporterRow, blockCol + COL.FACTORY_NAME).setValue(reporter);
  }

  // ── 作業員の工数を書き込む ──
  entries.forEach(entry => {
    const matched = findWorkerRowInBlock(sheet, blockCol, entry.name, ROW_D);
    if (matched) {
      if (entry.hoursNormal) sheet.getRange(matched.row, matched.daysCol).setValue(entry.hoursNormal);
      if (entry.hours125)    sheet.getRange(matched.row, matched.daysCol + 1).setValue(entry.hours125);
      if (entry.hours135)    sheet.getRange(matched.row, matched.daysCol + 2).setValue(entry.hours135);
      if (entry.hours150)    sheet.getRange(matched.row, matched.daysCol + 3).setValue(entry.hours150);
      if (entry.hours160)    sheet.getRange(matched.row, matched.daysCol + 4).setValue(entry.hours160);
      if (entry.hours175)    sheet.getRange(matched.row, matched.daysCol + 5).setValue(entry.hours175);
    } else {
      const emptyRow = findEmptyWorkerRow(sheet, blockCol, ROW_D, entry.workerRole);
      if (emptyRow) {
        const price = workerPrices[entry.name] || settings.defaultWorkerPrice;
        // roleに応じてfactory列/site列に書き込む
        const isFactory = entry.workerRole === 'factory';
        const nameCol  = isFactory ? blockCol + COL.FACTORY_NAME  : blockCol + COL.SITE_NAME;
        const priceCol = isFactory ? blockCol + COL.FACTORY_PRICE : blockCol + COL.SITE_PRICE;
        const hrsCol   = isFactory ? blockCol + COL.FACTORY_HOURS : blockCol + COL.SITE_HOURS;
        const h125Col  = isFactory ? blockCol + COL.FACTORY_1_25  : blockCol + COL.SITE_1_25;
        const h135Col  = isFactory ? blockCol + COL.FACTORY_1_35  : blockCol + COL.SITE_1_35;
        const h150Col  = isFactory ? blockCol + COL.FACTORY_1_5   : blockCol + COL.SITE_1_5;
        const h160Col  = isFactory ? blockCol + COL.FACTORY_1_6   : blockCol + COL.SITE_1_6;
        const h175Col  = isFactory ? blockCol + COL.FACTORY_1_75  : blockCol + COL.SITE_1_75;
        sheet.getRange(emptyRow, nameCol).setValue(entry.name);
        sheet.getRange(emptyRow, priceCol).setValue(price);
        if (entry.hoursNormal) sheet.getRange(emptyRow, hrsCol).setValue(entry.hoursNormal);
        if (entry.hours125)    sheet.getRange(emptyRow, h125Col).setValue(entry.hours125);
        if (entry.hours135)    sheet.getRange(emptyRow, h135Col).setValue(entry.hours135);
        if (entry.hours150)    sheet.getRange(emptyRow, h150Col).setValue(entry.hours150);
        if (entry.hours160)    sheet.getRange(emptyRow, h160Col).setValue(entry.hours160);
        if (entry.hours175)    sheet.getRange(emptyRow, h175Col).setValue(entry.hours175);
        const pCell    = sheet.getRange(emptyRow, priceCol).getA1Notation();
        const dCell    = sheet.getRange(emptyRow, hrsCol).getA1Notation();
        const o1Cell   = sheet.getRange(emptyRow, h125Col).getA1Notation();
        const o135Cell = sheet.getRange(emptyRow, h135Col).getA1Notation();
        const o15Cell  = sheet.getRange(emptyRow, h150Col).getA1Notation();
        const o16Cell  = sheet.getRange(emptyRow, h160Col).getA1Notation();
        const o175Cell = sheet.getRange(emptyRow, h175Col).getA1Notation();
        const totCol   = isFactory ? blockCol + COL.FACTORY_TOTAL : blockCol + COL.SITE_TOTAL;
        sheet.getRange(emptyRow, totCol).setFormula(
          `=${pCell}*(${dCell}*1.0+IF(${o1Cell}="",0,${o1Cell}*1.25)+IF(${o135Cell}="",0,${o135Cell}*1.35)+IF(${o15Cell}="",0,${o15Cell}*1.5)+IF(${o16Cell}="",0,${o16Cell}*1.6)+IF(${o175Cell}="",0,${o175Cell}*1.75))/8`
        );
        Logger.log('作業員を新規追加: ' + entry.name + ' (role=' + entry.workerRole + ', row=' + emptyRow + ', 単価=' + price + ')');
      } else {
        Logger.log('⚠️ 作業員追加失敗（空き行なし）: ' + entry.name + ' (role=' + entry.workerRole + ')');
      }
    }
  });

  // ── 経費データ書き込み ──
  writeExpensesToBlock(sheet, blockCol, expenses, ROW_D);
}


/**
 * 下請け業者の人数を該当する業者欄に書き込む
 * シートの行47以降から業者名を検索して人数欄に書き込む
 */
function writeSubcontractorCount(sheet, blockCol, subName, count) {
  try {
    var normalizedSub = normalizeName(subName);
    // 行47〜60を検索（下請け業者エリア）
    var SUB_ROW_START = 47;
    var SUB_ROW_END   = 56;
    // 業者名は offset13・15・17 に固定、人数は offset14・16・18
    var NAME_OFFSETS = [13, 15, 17];
    var NUM_OFFSETS  = [14, 16, 18];

    for (var row = SUB_ROW_START; row <= SUB_ROW_END; row++) {
      for (var i = 0; i < NAME_OFFSETS.length; i++) {
        var nameCell = sheet.getRange(row, blockCol + NAME_OFFSETS[i]);
        var cellVal  = String(nameCell.getValue() || '').trim();
        if (cellVal && normalizeName(cellVal) === normalizedSub) {
          sheet.getRange(row, blockCol + NUM_OFFSETS[i]).setValue(count);
          Logger.log('下請け業者書き込み: ' + subName + ' ' + count + '人 (行' + row + ')');
          return;
        }
      }
    }
    Logger.log('下請け業者が見つかりません: ' + subName);
  } catch (e) {
    Logger.log('writeSubcontractorCount error: ' + e);
  }
}

/**
 * 指定ブロック内（工場側・現場側両方）から作業員名を検索し
 * 一致した行番号と工数列番号を返す。
 * @returns {{ row: number, daysCol: number } | null}
 */
function findWorkerRowInBlock(sheet, blockCol, workerName, ROW_D) {
  const R = ROW_D || ROW_DEFAULT;
  const normalizedInput = normalizeName(workerName);
  for (let row = R.WORKER_START; row <= R.WORKER_END; row++) {
    const factoryVal = sheet.getRange(row, blockCol + COL.FACTORY_NAME).getValue();
    if (factoryVal === workerName || normalizeName(String(factoryVal)) === normalizedInput) {
      return { row, daysCol: blockCol + COL.FACTORY_HOURS };
    }
    const siteVal = sheet.getRange(row, blockCol + COL.SITE_NAME).getValue();
    if (siteVal === workerName || normalizeName(String(siteVal)) === normalizedInput) {
      return { row, daysCol: blockCol + COL.SITE_HOURS };
    }
  }
  return null;
}

function findEmptyWorkerRow(sheet, blockCol, ROW_D, workerRole) {
  const R = ROW_D || ROW_DEFAULT;
  const isFactory = workerRole === 'factory';
  const checkCol  = isFactory ? blockCol + COL.FACTORY_NAME : blockCol + COL.SITE_NAME;
  // WORKER_START〜WORKER_ENDの範囲のみ（経費行への侵入を防ぐ）
  for (let row = R.WORKER_START; row <= R.WORKER_END; row++) {
    if (!sheet.getRange(row, checkCol).getValue()) return row;
  }
  return null;
}

/**
 * 経費データをブロックの所定行に書き込む
 */
function writeExpensesToBlock(sheet, blockCol, expenses, ROW_D) {
  // ROW_DEFAULT を必ずベースにして、ROW_D で上書きする（nullが混入しないよう保護）
  const R = Object.assign({}, ROW_DEFAULT, ROW_D || {});

  const AMT_COL = 1;  // 駐車場・高速代の金額列オフセット（ラベルの次列）

  expenses.forEach(function(exp) {
    try {
      switch (exp.type) {
        case 'gasoline':
          // 行27（車両名）に車両名を書く（ある場合のみ）
          Logger.log('gasoline write: vehicleName=' + exp.vehicleName + ' km=' + exp.km + ' row=' + R.VEHICLE1_NAME + '/' + R.GASOLINE1 + ' col=' + (blockCol + 1));
          if (exp.vehicleName && R.VEHICLE1_NAME) {
            sheet.getRange(R.VEHICLE1_NAME, blockCol + 1).setValue(exp.vehicleName);
          }
          // 行28（1号車ガソリン入力欄）のoffset1にkm値を書く
          // 行47（ガソリン距離計）は数式（=C28+C33+C38+C43）で自動集計されるので書き込み不要
          if (R.GASOLINE1) {
            sheet.getRange(R.GASOLINE1, blockCol + 1).setValue(exp.km);
          }
          break;
        case 'diesel':
          // 軽油: 車両名を行27(VEHICLE1_NAME)、軽油kmを行31(DIESEL1)に書き込む
          Logger.log('diesel write: vehicleName=' + exp.vehicleName + ' km=' + exp.km + ' row=' + R.VEHICLE1_NAME + '/' + R.DIESEL1 + ' col=' + (blockCol + 1));
          if (exp.vehicleName && R.VEHICLE1_NAME) {
            sheet.getRange(R.VEHICLE1_NAME, blockCol + 1).setValue(exp.vehicleName);
          }
          if (R.DIESEL1) {
            sheet.getRange(R.DIESEL1, blockCol + 1).setValue(exp.km);
          }
          break;
        case 'highway':
          if (R.HIGHWAY1) sheet.getRange(R.HIGHWAY1, blockCol + AMT_COL).setValue(exp.amount);
          break;
        case 'parking':
          if (R.PARKING1) sheet.getRange(R.PARKING1, blockCol + AMT_COL).setValue(exp.amount);
          break;
        case 'train':
          if (R.ROW_TRAIN) {
            if (exp.label) sheet.getRange(R.ROW_TRAIN, blockCol + RIGHT_COL.TRAIN_NAME).setValue(exp.label);
            sheet.getRange(R.ROW_TRAIN, blockCol + RIGHT_COL.TRAIN_AMT).setValue(exp.amount);
          }
          break;
        case 'hotel':
          if (R.ROW_HOTEL) {
            // ホテル名=S列(offset17)、金額=T列(offset18) — スプシ実測値に基づく
            if (exp.label) sheet.getRange(R.ROW_HOTEL, blockCol + RIGHT_COL.TRAIN_NAME).setValue(exp.label);
            sheet.getRange(R.ROW_HOTEL, blockCol + RIGHT_COL.TRAIN_AMT).setValue(exp.amount);
          }
          break;
        case 'garbage_factory':
          // 木材のみ: blockCol+3（単価セル）を読んで m³×単価 をDZ29等（右側経費行）に書き込む
          if (R.GARBAGE_FACTORY && R.ROW_GARBAGE_FACTORY) {
            var factoryUnitPrice = sheet.getRange(R.GARBAGE_FACTORY, blockCol + 3).getValue();
            sheet.getRange(R.ROW_GARBAGE_FACTORY, blockCol + RIGHT_COL.GARBAGE_AMT)
              .setValue(exp.amount * factoryUnitPrice);
          }
          break;
        case 'garbage_site':
          // 混載: blockCol+3（単価セル）を読んで m³×単価 をDZ30等（右側経費行）に書き込む
          if (R.GARBAGE_SITE && R.ROW_GARBAGE_SITE) {
            var siteUnitPrice = sheet.getRange(R.GARBAGE_SITE, blockCol + 3).getValue();
            sheet.getRange(R.ROW_GARBAGE_SITE, blockCol + RIGHT_COL.GARBAGE_AMT)
              .setValue(exp.amount * siteUnitPrice);
          }
          break;
        case 'leopalace':
          if (R.ROW_HOTEL) {
            var leopRow = R.ROW_HOTEL + 1;  // レオパレス等行はホテル行の1つ下
            if (exp.label) sheet.getRange(leopRow, blockCol + RIGHT_COL.TRAIN_NAME).setValue(exp.label);
            sheet.getRange(leopRow, blockCol + RIGHT_COL.TRAIN_AMT).setValue(exp.amount);
          }
          break;
        case 'entertainment':
          if (R.ROW_ENTERTAINMENT) {
            if (exp.label) sheet.getRange(R.ROW_ENTERTAINMENT, blockCol + RIGHT_COL.ENTERTAINMENT_N).setValue(exp.label);
            sheet.getRange(R.ROW_ENTERTAINMENT, blockCol + RIGHT_COL.ENTERTAINMENT_A).setValue(exp.amount);
          }
          break;
        case 'subcontractor':
          // 下請け業者の人数を該当業者の人数欄に書き込む
          writeSubcontractorCount(sheet, blockCol, exp.label, exp.amount);
          break;
        default:
          if (R.ROW_OTHER) {
            if (exp.label) sheet.getRange(R.ROW_OTHER, blockCol + RIGHT_COL.OTHER_NAME).setValue(exp.label);
            sheet.getRange(R.ROW_OTHER, blockCol + RIGHT_COL.OTHER_AMT).setValue(exp.amount);
          }
          break;
      }
    } catch (e) {
      Logger.log('writeExpensesToBlock error [' + exp.type + ']: ' + e.message);
    }
  });
}

/**
 * まとめセクション（シート下部）を全日ブロックの合計で更新
 */
function updateSummarySection(sheet) {
  const lastCol = sheet.getLastColumn();
  const numBlocks = Math.floor((lastCol - 1) / DAY_BLOCK_COLS);
  if (numBlocks === 0) return;

  // 各カテゴリの合計を集計
  const workerTotal = collectSumAcrossBlocks(sheet, ROW.WORKER_TOTAL, COL.SITE_TOTAL, numBlocks);
  const factoryTotal = collectSumAcrossBlocks(sheet, ROW.WORKER_TOTAL, COL.FACTORY_TOTAL, numBlocks);
  const gasolineTotal = collectSumAcrossBlocks(sheet, ROW.GAS_DIST_TOTAL, COL.FACTORY_TOTAL, numBlocks);
  const highwayTotal  = collectSumAcrossBlocks(sheet, ROW.HIGHWAY_TOTAL, COL.FACTORY_TOTAL, numBlocks);
  const parkingTotal  = collectSumAcrossBlocks(sheet, ROW.PARKING_TOTAL, COL.FACTORY_TOTAL, numBlocks);
  const trainTotal    = collectSumAcrossBlocks(sheet, ROW.TRAIN, COL.FACTORY_TOTAL, numBlocks);
  const hotelTotal    = collectSumAcrossBlocks(sheet, ROW.ROW_HOTEL, RIGHT_COL.HOTEL_INPUT, numBlocks);
  const garbageTotal  = collectSumAcrossBlocks(sheet, ROW.ROW_GARBAGE_FACTORY, RIGHT_COL.GARBAGE_AMT, numBlocks)
                      + collectSumAcrossBlocks(sheet, ROW.ROW_GARBAGE_SITE, RIGHT_COL.GARBAGE_AMT, numBlocks);
  const otherTotal    = collectSumAcrossBlocks(sheet, ROW.OTHER_MATERIAL, COL.FACTORY_TOTAL, numBlocks);
  const entertainTotal = collectSumAcrossBlocks(sheet, ROW.ENTERTAINMENT, COL.FACTORY_TOTAL, numBlocks);

  const grandTotal = workerTotal + factoryTotal + gasolineTotal + highwayTotal
                   + parkingTotal + trainTotal + hotelTotal + garbageTotal
                   + otherTotal + entertainTotal;

  // まとめ行ヘッダ
  const sumRow = ROW.SUMMARY_HEADER;
  sheet.getRange(sumRow, 1, 1, 14).setValues([[
    'まとめ', '商社', '業者', '社員', '駐車場', '燃料', '高速',
    '宿泊', '接待費', 'ゴミ', '交通費', 'ホームセンター雑費', '', '合計'
  ]]).setFontWeight('bold').setBackground('#D3D1C7');

  // まとめデータ行
  sheet.getRange(sumRow + 1, 1, 1, 14).setValues([[
    '',           // 商社（手動入力）
    0,            // 業者（手動入力）
    workerTotal + factoryTotal,
    parkingTotal,
    gasolineTotal,
    highwayTotal,
    hotelTotal,
    entertainTotal,
    garbageTotal,
    trainTotal,
    otherTotal,
    '',
    '',
    grandTotal,
  ]]);

  // 売上入力行（既存の値を保持）
  if (!sheet.getRange(sumRow + 2, 18).getValue()) {
    sheet.getRange(sumRow + 2, 17).setValue('↑税別請負金額記入');
  }
}

/**
 * 指定行・オフセットの全ブロック合計を数値で返す
 */
function collectSumAcrossBlocks(sheet, row, colOffset, numBlocks) {
  let total = 0;
  for (let b = 0; b < numBlocks; b++) {
    const col = 1 + b * DAY_BLOCK_COLS + colOffset;
    const val = sheet.getRange(row, col).getValue();
    if (typeof val === 'number') total += val;
  }
  return total;
}


// ============================================================
//  ブロック管理ユーティリティ
// ============================================================

/**
 * 日報の「何日」をそのまま「何日目」として列位置を返す。
 * 例: 14日 → 14日目ブロック → 開始列 = (14-1)*22 + 2 = 288列目
 * 既存シートにそのブロックが存在しない場合はinitDayBlockは呼ばない
 * （既存シートのレイアウトを壊さないため）。
 * @param {GoogleAppsScript.Spreadsheet.Sheet} sheet
 * @param {number} dayNumber 日報の「何日」（1〜31）
 * @returns {number} 1始まりの列番号
 */
function getDayBlockCol(dayNumber) {
  // シートはB列(2列目)スタート
  return (dayNumber - 1) * DAY_BLOCK_COLS + 2;
}

/**
 * 後方互換のためのラッパー（新規シート作成時のみ使用）
 */
function findOrCreateDayBlock(sheet, dateStr) {
  const lastCol = sheet.getLastColumn();
  for (let col = 1; col <= lastCol; col += DAY_BLOCK_COLS) {
    if (sheet.getRange(1, col).getNote() === dateStr) return col;
  }
  const newCol = lastCol === 0 ? 1 : Math.ceil(lastCol / DAY_BLOCK_COLS) * DAY_BLOCK_COLS + 1;
  initDayBlock(sheet, newCol, dateStr);
  return newCol;
}

function getDayIndex(blockCol) {
  return Math.ceil(blockCol / DAY_BLOCK_COLS);
}

/**
 * 新規日ブロックを初期化（ヘッダ行・作業員リスト・経費ラベルを記入）
 */
function initDayBlock(sheet, startCol, dateStr) {
  const workerPrices = getWorkerPrices();
  const workerNames = Object.keys(workerPrices);

  // ── 1行目: 日付タイトル（noteに日付を保存して検索キーに使う） ──
  const titleCell = sheet.getRange(ROW.DAY_TITLE, startCol);
  titleCell.setNote(dateStr).setValue(`${getDayIndex(startCol)}日目`)
    .setFontWeight('bold').setBackground('#4A90D9').setFontColor('#FFFFFF');

  // ── 5行目: 列ヘッダ ──
  sheet.getRange(ROW.HEADER, startCol, 1, DAY_BLOCK_COLS - 1).setValues([[
    '作業員', '工場・事務所作業員名', '単価', '1.0h', '1.25h', '1.35h', '1.5h', '1.6h', '1.75h', '計', 'その他',
    '現場作業員名', '単価', '1.0h', '1.25h', '1.35h', '1.5h', '1.6h', '1.75h', '計', 'その他',
  ]]).setFontWeight('bold').setBackground('#D3D1C7');

  // ── 作業員名と単価をプリセット（設定シートから） ──
  // 工場側：前半の作業員
  const factoryWorkers = workerNames.slice(0, 14);
  const siteWorkers    = workerNames.slice(14, 34);

  factoryWorkers.forEach((name, i) => {
    const row = ROW.WORKER_START + i;
    sheet.getRange(row, startCol + COL.FACTORY_NAME).setValue(name);
    sheet.getRange(row, startCol + COL.FACTORY_PRICE).setValue(workerPrices[name]);
    // 計の数式: 単価×(1.0h×1.0+1.25h×1.25+1.35h×1.35+1.5h×1.5+1.6h×1.6+1.75h×1.75)/8
    const pCell    = sheet.getRange(row, startCol + COL.FACTORY_PRICE).getA1Notation();
    const dCell    = sheet.getRange(row, startCol + COL.FACTORY_HOURS).getA1Notation();
    const o1Cell   = sheet.getRange(row, startCol + COL.FACTORY_1_25).getA1Notation();
    const o135Cell = sheet.getRange(row, startCol + COL.FACTORY_1_35).getA1Notation();
    const o15Cell  = sheet.getRange(row, startCol + COL.FACTORY_1_5).getA1Notation();
    const o16Cell  = sheet.getRange(row, startCol + COL.FACTORY_1_6).getA1Notation();
    const o175Cell = sheet.getRange(row, startCol + COL.FACTORY_1_75).getA1Notation();
    sheet.getRange(row, startCol + COL.FACTORY_TOTAL).setFormula(
      `=${pCell}*(${dCell}*1.0+IF(${o1Cell}="",0,${o1Cell}*1.25)+IF(${o135Cell}="",0,${o135Cell}*1.35)+IF(${o15Cell}="",0,${o15Cell}*1.5)+IF(${o16Cell}="",0,${o16Cell}*1.6)+IF(${o175Cell}="",0,${o175Cell}*1.75))/8`
    );
    sheet.getRange(row, startCol + COL.FACTORY_TOTAL).setNumberFormat('#,##0');
  });

  siteWorkers.forEach((name, i) => {
    const row = ROW.WORKER_START + i;
    sheet.getRange(row, startCol + COL.SITE_NAME).setValue(name);
    sheet.getRange(row, startCol + COL.SITE_PRICE).setValue(workerPrices[name]);
    const pCell    = sheet.getRange(row, startCol + COL.SITE_PRICE).getA1Notation();
    const dCell    = sheet.getRange(row, startCol + COL.SITE_HOURS).getA1Notation();
    const o1Cell   = sheet.getRange(row, startCol + COL.SITE_1_25).getA1Notation();
    const o135Cell = sheet.getRange(row, startCol + COL.SITE_1_35).getA1Notation();
    const o15Cell  = sheet.getRange(row, startCol + COL.SITE_1_5).getA1Notation();
    const o16Cell  = sheet.getRange(row, startCol + COL.SITE_1_6).getA1Notation();
    const o175Cell = sheet.getRange(row, startCol + COL.SITE_1_75).getA1Notation();
    sheet.getRange(row, startCol + COL.SITE_TOTAL).setFormula(
      `=${pCell}*(${dCell}*1.0+IF(${o1Cell}="",0,${o1Cell}*1.25)+IF(${o135Cell}="",0,${o135Cell}*1.35)+IF(${o15Cell}="",0,${o15Cell}*1.5)+IF(${o16Cell}="",0,${o16Cell}*1.6)+IF(${o175Cell}="",0,${o175Cell}*1.75))/8`
    );
    sheet.getRange(row, startCol + COL.SITE_TOTAL).setNumberFormat('#,##0');
  });

  // ── 経費ラベル行 ──
  const expenseLabels = [
    [ROW.VEHICLE1_NAME, '車両名'],
    [ROW.GASOLINE1,     'ガソリン（l距離'],
    [ROW.PARKING1,      '駐車場'],
    [ROW.HIGHWAY1,      '高速代'],
    [ROW.DIESEL1,       '軽油（l距離'],
    [ROW.GAS_DIST_TOTAL, 'ガソリン距離計'],
    [ROW.DIESEL_DIST_TOTAL, '軽油距離計'],
    [ROW.TRAIN,         '電車'],
    [ROW.ROW_GARBAGE_FACTORY, 'ゴミ工場'],
    [ROW.ROW_GARBAGE_SITE,  'ゴミ現場'],
    [ROW.HIGHWAY_TOTAL, '高速代'],
    [ROW.PARKING_TOTAL, '駐車場'],
    [ROW.OTHER_MATERIAL,'その他（資材等'],
    [ROW.HOTEL,         'ホテル,マンスリー'],
    [ROW.ENTERTAINMENT, '接待費'],
  ];
  expenseLabels.forEach(([row, label]) => {
    sheet.getRange(row, startCol).setValue(label).setFontColor('#555555');
  });

  // ── 右側経費ラベル（ホテル・ゴミ等） ──
  sheet.getRange(ROW.VEHICLE1_NAME, startCol + RIGHT_COL.HOTEL_LABEL).setValue('ホテル');
  sheet.getRange(ROW.PARKING1,      startCol + RIGHT_COL.GARBAGE_LABEL).setValue('ゴミ（工場');
  sheet.getRange(ROW.HIGHWAY1,      startCol + RIGHT_COL.GARBAGE_LABEL).setValue('ゴミ（現場');
  sheet.getRange(ROW.DIESEL1,       startCol + RIGHT_COL.TRAIN_NAME).setValue('電車');

  // ── 下請け業者リスト（設定から自動取得） ──
  const subcontractors = getSubcontractors();
  subcontractors.forEach((name, i) => {
    const row = ROW.GAS_DIST_TOTAL + 3 + Math.floor(i / 3);
    const offset = (i % 3) * 2;
    sheet.getRange(row, startCol + COL.SITE_NAME + offset).setValue(name);
  });

  // 列幅調整
  sheet.setColumnWidth(startCol, 100);
  for (let i = 1; i < DAY_BLOCK_COLS; i++) {
    sheet.setColumnWidth(startCol + i, i === COL.FACTORY_NAME || i === COL.SITE_NAME ? 90 : 60);
  }
}


// ============================================================
//  スプレッドシート操作
//  ★毎月手動でエクセル→スプシ変換してDriveにアップロード済みの
//    ファイルを開く。ファイル名は「YYYY年MM月_案件台帳」で検索。
// ============================================================

/**
 * Driveから当月（または指定年月）の案件台帳スプシを取得する。
 * ファイルが見つからない場合はエラーをスローする（手動アップロード前提）。
 */
function getMonthlySpreadsheet(year, month) {
  // CacheServiceでスプシIDをキャッシュ（1時間）
  var cacheKey = 'ss_id_' + year + '_' + month;
  try {
    var cachedId = CacheService.getScriptCache().get(cacheKey);
    if (cachedId) return SpreadsheetApp.openById(cachedId);
  } catch (e) { /* キャッシュミスは無視 */ }

  // 対応するファイル名パターン（複数形式）
  const patterns = [
    `${year}.${month}`,                                       // 2026.4
    `${year}.${String(month).padStart(2, '0')}`,              // 2026.04
    `${year}年${String(month).padStart(2, '0')}月_案件台帳`,  // 2026年04月_案件台帳
    `${year}年${month}月_案件台帳`,                           // 2026年4月_案件台帳
  ];

  const folder = DriveApp.getFolderById(CONFIG.DRIVE_ROOT_FOLDER_ID);

  // ルートフォルダ内を検索
  for (const name of patterns) {
    const files = folder.getFilesByName(name);
    if (files.hasNext()) {
      const ss = SpreadsheetApp.open(files.next());
      try { CacheService.getScriptCache().put(cacheKey, ss.getId(), 3600); } catch(e) {}
      return ss;
    }
  }

  // 同フォルダ配下に限定して検索（dev/prod スプシの混在防止）
  for (const name of patterns) {
    const allFiles = DriveApp.searchFiles(
      `title = "${name}" and "${CONFIG.DRIVE_ROOT_FOLDER_ID}" in parents and trashed = false`
    );
    if (allFiles.hasNext()) {
      const ss = SpreadsheetApp.open(allFiles.next());
      try { CacheService.getScriptCache().put(cacheKey, ss.getId(), 3600); } catch(e) {}
      return ss;
    }
  }

  // 当月が見つからない場合は前月にフォールバック
  const prevDate = new Date(year, month - 2, 1); // month-2 = 前月（0始まり）
  const prevYear  = prevDate.getFullYear();
  const prevMonth = prevDate.getMonth() + 1;

  if (year !== prevYear || month !== prevMonth) {
    const prevPatterns = [
      `${prevYear}.${prevMonth}`,
      `${prevYear}.${String(prevMonth).padStart(2, '0')}`,
      `${prevYear}年${String(prevMonth).padStart(2, '0')}月_案件台帳`,
      `${prevYear}年${prevMonth}月_案件台帳`,
    ];

    for (const name of prevPatterns) {
      const files = folder.getFilesByName(name);
      if (files.hasNext()) {
        Logger.log(`当月(${year}.${month})未検出 → 前月(${prevYear}.${prevMonth})にフォールバック`);
        return SpreadsheetApp.open(files.next());
      }
    }

    for (const name of prevPatterns) {
      const allFiles = DriveApp.searchFiles(
        `title = "${name}" and "${CONFIG.DRIVE_ROOT_FOLDER_ID}" in parents and trashed = false`
      );
      if (allFiles.hasNext()) {
        Logger.log(`当月(${year}.${month})未検出 → 前月(${prevYear}.${prevMonth})にフォールバック`);
        return SpreadsheetApp.open(allFiles.next());
      }
    }
  }

  throw new Error(
    `📂 ${year}.${month} がDriveに見つかりません。\n` +
    `エクセルをGoogleスプレッドシートに変換してDriveにアップロードしてください。`
  );
}

// 後方互換エイリアス（テスト関数等から呼ばれる）
function getOrCreateMonthlySpreadsheet(year, month) {
  return getMonthlySpreadsheet(year, month);
}

/**
 * 案件スプシから現場名のシートを取得する。
 * シートが存在しない場合は該当現場が未登録である旨のエラーをスローする。
 * ※シートはエクセルのまま存在するはずなので新規作成しない。
 */
function getCaseSheet(ss, siteName) {
  // ① 完全一致
  const exact = ss.getSheetByName(siteName);
  if (exact) return exact;

  const allSheets = ss.getSheets();

  // ② 正規化マッチ（全角半角・スペース・大文字小文字を無視）
  const normalizedInput = normalizeName(siteName);
  const normalized = allSheets.find(s => normalizeName(s.getName()) === normalizedInput);
  if (normalized) return normalized;

  // ③ 一致なし → 候補リストをエラーメッセージに含めてLINEに返す
  const candidates = findCandidateSheets(allSheets, siteName);
  const candidateMsg = candidates.length > 0
    ? `\n\n【もしかして？】\n` + candidates.map((n, i) => `${i + 1}. ${n}`).join('\n')
    : `\n\n（近い現場名が見つかりませんでした）`;

  throw new Error(
    `❌ 現場「${siteName}」が見つかりません。` +
    `\n正確なシート名で送り直してください。` +
    candidateMsg
  );
}

// 後方互換エイリアス
function getOrCreateCaseSheet(ss, siteName) {
  return getCaseSheet(ss, siteName);
}


// ============================================================
//  設定シート（作業員単価・下請け業者を管理）
// ============================================================

function initSettingsSheet(sheet) {
  // ── 作業員単価テーブル ──
  sheet.getRange('A1').setValue('【作業員単価】').setFontWeight('bold').setBackground('#4A90D9').setFontColor('#FFFFFF');
  sheet.getRange('A2:B2').setValues([['作業員名', '日単価（円）']]).setFontWeight('bold').setBackground('#D3D1C7');

  // 実エクセルから読み取った作業員と単価
  const defaultWorkers = [
    // 工場・事務所側
    ['今井',   30000], ['伊藤',   23000], ['野村',   23000], ['毛利',   23000],
    ['鵜飼',   20000], ['相馬',   20000], ['Worker07', 20000], ['前田',   20000],
    ['ジェイ', 20000], ['ヌル',   20000], ['デデ',   20000], ['アチェ', 20000],
    ['平床',   20000], ['作長',   20000],
    // 現場作業員側
    ['大塚',   30000], ['小島',   30000], ['山本',   20000], ['Worker18',   20000],
    ['Worker19', 20000], ['アリフ', 20000], ['Worker21', 20000], ['ハイ', 20000],
    ['ガイ',   20000], ['辻',     23000], ['佐藤',   20000], ['さや',   20000],
    ['片岡',   20000], ['Worker28',   20000], ['浅野',   23000], ['横井',   20000],
    ['白石',   23000], ['香田',   20000], ['Worker33',   20000], ['Worker34',   20000],
    ['佐谷',   20000],
  ];
  sheet.getRange(3, 1, defaultWorkers.length, 2).setValues(defaultWorkers);
  [120, 100].forEach((w, i) => sheet.setColumnWidth(i + 1, w));

  // ── ガソリン単価 ──
  const settingsStartRow = defaultWorkers.length + 5;
  sheet.getRange(settingsStartRow, 1).setValue('【ガソリン設定】').setFontWeight('bold').setBackground('#4A90D9').setFontColor('#FFFFFF');
  sheet.getRange(settingsStartRow + 1, 1, 3, 3).setValues([
    ['設定項目', '値', '備考'],
    ['ガソリン単価（円/L）', 175, '変更で全件再計算'],
    ['燃費（km/L）', 12.0, '車種ごとに変更可'],
  ]);
  sheet.getRange(settingsStartRow + 3, 1, 1, 2).setValues([['1km単価（自動計算）', `=B${settingsStartRow + 2}/B${settingsStartRow + 3}`]]);

  // ── 下請け業者リスト ──
  const subStartRow = settingsStartRow + 7;
  sheet.getRange(subStartRow, 1).setValue('【下請け業者リスト】').setFontWeight('bold').setBackground('#4A90D9').setFontColor('#FFFFFF');
  sheet.getRange(subStartRow + 1, 1).setValue('業者名').setFontWeight('bold').setBackground('#D3D1C7');
  const defaultSubs = [
    ['VendorA'], ['VendorB'], ['VendorC'], ['VendorD'], ['リベロ'], ['名鏡'],
    ['岩橋'], ['水野ガラス'], ['VendorE'], ['マルナ'], ['正徳'], ['中部メンテナンス'],
    ['VendorF'], ['GSテクノ'], ['カミムラ'], ['VendorG'], ['VendorH'],
  ];
  sheet.getRange(subStartRow + 2, 1, defaultSubs.length, 1).setValues(defaultSubs);

  // デフォルト日当
  const miscStartRow = subStartRow + defaultSubs.length + 3;
  sheet.getRange(miscStartRow, 1).setValue('【その他設定】').setFontWeight('bold').setBackground('#4A90D9').setFontColor('#FFFFFF');
  sheet.getRange(miscStartRow + 1, 1, 2, 2).setValues([
    ['デフォルト日当（円）', 20000],
    ['ゴミ処理費_工場（円）', 8000],
  ]);
}

/**
 * 設定シートから作業員単価マップを取得
 * @returns {Object} { 名前: 単価, ... }
 */
function getWorkerPrices() {
  try {
    const now = new Date();
    const ss = getOrCreateMonthlySpreadsheet(now.getFullYear(), now.getMonth() + 1);
    const s = ss.getSheetByName('設定');
    if (!s) return {};

    const data = s.getRange('A3:B100').getValues();
    const map = {};
    data.forEach(([name, price]) => {
      if (name && price) map[String(name).trim()] = Number(price);
    });
    return map;
  } catch (e) {
    Logger.log('getWorkerPrices error: ' + e);
    return {};
  }
}

/**
 * 設定シートから下請け業者リストを取得
 */
function getSubcontractors() {
  try {
    const now = new Date();
    const ss = getOrCreateMonthlySpreadsheet(now.getFullYear(), now.getMonth() + 1);
    const s = ss.getSheetByName('設定');
    if (!s) return [];

    // 下請け業者リストの開始行を探す
    const allValues = s.getDataRange().getValues();
    let startRow = -1;
    allValues.forEach((row, i) => {
      if (row[0] === '業者名') startRow = i + 2;
    });
    if (startRow === -1) return [];

    const data = s.getRange(startRow, 1, 30, 1).getValues();
    return data.map(r => r[0]).filter(v => v);
  } catch (e) {
    return [];
  }
}

function getSettings() {
  try {
    const now = new Date();
    const ss = getOrCreateMonthlySpreadsheet(now.getFullYear(), now.getMonth() + 1);
    const s = ss.getSheetByName('設定');
    if (!s) return { gasPrice: 175, fuelEff: 12.0, pricePerKm: 14.58, defaultWorkerPrice: 20000 };

    const allValues = s.getDataRange().getValues();
    let gasPrice = 175;
    let fuelEff = 12.0;
    let defaultWorkerPrice = 20000;

    allValues.forEach(row => {
      if (row[0] === 'ガソリン単価（円/L）') gasPrice = Number(row[1]) || 175;
      if (row[0] === '燃費（km/L）')        fuelEff = Number(row[1]) || 12.0;
      if (row[0] === 'デフォルト日当（円）') defaultWorkerPrice = Number(row[1]) || 20000;
    });

    return { gasPrice, fuelEff, pricePerKm: gasPrice / fuelEff, defaultWorkerPrice };
  } catch (e) {
    return { gasPrice: 175, fuelEff: 12.0, pricePerKm: 14.58, defaultWorkerPrice: 20000 };
  }
}


// ============================================================
//  Google Drive 操作
// ============================================================

function createSiteDriveFolder(siteName, year, month) {
  const root = DriveApp.getFolderById(CONFIG.DRIVE_ROOT_FOLDER_ID);
  const folderName = `${year}-${String(month).padStart(2, '0')}_${siteName}`;
  const existing = root.getFoldersByName(folderName);
  if (existing.hasNext()) return existing.next();
  return root.createFolder(folderName);
}

function saveFileToDrive(blob, siteName, year, month) {
  const folder = createSiteDriveFolder(siteName, year, month);
  const fileName = `invoice_${Utilities.formatDate(new Date(), 'Asia/Tokyo', 'yyyyMMdd_HHmmss')}`;
  return folder.createFile(blob.setName(fileName)).getUrl();
}


// ============================================================
//  LINE 送受信
// ============================================================

/**
 * 複数メッセージをまとめてpushする（LINE APIは1回に最大5件）
 */
function pushLineMessages(to, messages) {
  try {
    UrlFetchApp.fetch('https://api.line.me/v2/bot/message/push', {
      method: 'post',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${CONFIG.LINE_CHANNEL_ACCESS_TOKEN}` },
      payload: JSON.stringify({ to, messages }),
    });
  } catch (err) { Logger.log('pushLineMessages error: ' + err); }
}

function pushLineMessage(to, message) {
  try {
    UrlFetchApp.fetch('https://api.line.me/v2/bot/message/push', {
      method: 'post',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${CONFIG.LINE_CHANNEL_ACCESS_TOKEN}` },
      payload: JSON.stringify({ to, messages: [{ type: 'text', text: message }] }),
    });
  } catch (err) { Logger.log('pushLineMessage error: ' + err); }
}

function createNextMonthFile() {
  const now = new Date();
  const next = new Date(now.getFullYear(), now.getMonth() + 1, 1);
  getOrCreateMonthlySpreadsheet(next.getFullYear(), next.getMonth() + 1);
  Logger.log('翌月ファイル作成完了');
}


/**
 * 6. 業者管理台帳を設定シートに追加する初期化関数
 * 初回1回だけ実行する
 */
function setupVendorSheet() {
  const now = new Date();
  const ss  = getMonthlySpreadsheet(now.getFullYear(), now.getMonth() + 1);

  let sheet = ss.getSheetByName('業者台帳');
  if (!sheet) {
    sheet = ss.insertSheet('業者台帳');
  }

  const headers = [['会社名', '担当者名', '電話番号', 'メールアドレス', 'フォームURL', '備考', '登録日']];
  sheet.getRange(1, 1, 1, 7).setValues(headers).setFontWeight('bold').setBackground('#2C7BB6').setFontColor('#FFFFFF');

  // Googleフォームのリンクをあらかじめ入れておく
  const formUrl = 'https://docs.google.com/forms/d/' + CONFIG.FORM_ID + '/viewform';
  sheet.getRange(2, 5).setValue(formUrl);
  sheet.getRange(1, 1, 1, 7).setFrozenRows && sheet.setFrozenRows(1);

  [150, 100, 120, 180, 300, 150, 100].forEach(function(w, i) {
    sheet.setColumnWidth(i + 1, w);
  });

  Logger.log('✅ 業者台帳シートを作成しました。');
  Logger.log('請求書フォームURL: ' + formUrl);
}



// ============================================================
//  名前正規化ユーティリティ
// ============================================================

/**
 * 現場名・作業員名を正規化して比較用文字列を返す。
 * ・全角英数字 → 半角
 * ・全角スペース・半角スペース → 除去
 * ・カタカナ長音「ー」統一（ｰ→ー）
 * ・小文字化（英字の大文字小文字を無視）
 */
function normalizeName(str) {
  if (!str) return '';
  return String(str)
    // 全角英数字 → 半角
    .replace(/[Ａ-Ｚａ-ｚ０-９]/g, s => String.fromCharCode(s.charCodeAt(0) - 0xFEE0))
    // 全角記号（カッコ等）→ 半角
    .replace(/　/g, ' ')   // 全角スペース → 半角
    .replace(/（/g, '(').replace(/）/g, ')')
    .replace(/：/g, ':')
    // スペース除去
    .replace(/\s/g, '')
    // 長音統一
    .replace(/ｰ/g, 'ー')
    // 小文字化
    .toLowerCase();
}

/**
 * シート名一覧から入力名に最も近いものをスコアで返す（候補リスト用）。
 * 正規化後に部分一致するものを候補として返す。
 * @returns {string[]} 候補シート名の配列（最大5件）
 */
function findCandidateSheets(allSheets, inputName) {
  const normalized = normalizeName(inputName);
  // 実際の現場シートのみ対象（数字のみのシート名・管理シートを除外）
  const caseSheets = allSheets.filter(s => {
    const n = s.getName().trim();
    return n && !n.match(/^\s*\(\d+\)\s*$/) && !['外注','提出確認','金額集計','事務、工場、その他','設定','月次サマリ'].includes(n);
  });

  // スコアリング: 正規化後の部分一致 or 包含関係
  const scored = caseSheets.map(s => {
    const sn = normalizeName(s.getName());
    let score = 0;
    if (sn === normalized) score = 100;                          // 完全一致
    else if (sn.includes(normalized) || normalized.includes(sn)) score = 60; // 部分一致
    else {
      // 文字レベルの共通度（簡易編集距離）
      let common = 0;
      for (const ch of normalized) { if (sn.includes(ch)) common++; }
      score = Math.floor((common / Math.max(normalized.length, 1)) * 40);
    }
    return { sheet: s, score };
  });

  return scored
    .filter(x => x.score > 20)
    .sort((a, b) => b.score - a.score)
    .slice(0, 5)
    .map(x => x.sheet.getName());
}


// ============================================================
//  新機能: 現場シート五十音順ソート・新規現場作成・ゴミ写真・日付順チェック
// ============================================================

/**
 * 現場シートを五十音順に並び替える
 * システムシート（SYSTEM_SHEETS）は位置固定、連番シートは末尾固定
 * 現場シートは「事務、工場、その他」の直後から五十音順で配置
 */
function sortSiteSheets(ss) {
  var baseSheet = ss.getSheetByName('事務、工場、その他');
  if (!baseSheet) return;

  var allSheets = ss.getSheets();
  var baseIndex = -1;
  for (var i = 0; i < allSheets.length; i++) {
    if (allSheets[i].getName() === '事務、工場、その他') {
      baseIndex = i;
      break;
    }
  }
  if (baseIndex < 0) return;

  // 現場シートのみ抽出（システムシートでも連番でもないもの）
  var siteSheets = allSheets.filter(function(s) {
    var name = s.getName();
    return SYSTEM_SHEETS.indexOf(name) === -1 && !name.match(/^\(\d+\)$/);
  });

  // 五十音順にソート
  siteSheets.sort(function(a, b) {
    return a.getName().localeCompare(b.getName(), 'ja');
  });

  // 逆順にして事務シートの直後に1枚ずつ挿入 → 最終的に五十音順になる
  siteSheets.reverse().forEach(function(sheet) {
    sheet.activate();
    ss.moveActiveSheet(baseIndex + 2); // 1始まり
  });
}

/**
 * 空き連番シート（(2)〜(71)）を新規現場名にリネームする
 * リネーム後、五十音順に並べ替える
 */
function createSiteSheetByRename(ss, siteName) {
  // 既に同名シートがあれば何もしない
  if (ss.getSheetByName(siteName)) return ss.getSheetByName(siteName);

  // マスタキャッシュを破棄（新現場が次回getMasterに反映されるよう）
  try { CacheService.getScriptCache().remove('master_data_v1'); } catch(e) {}

  // (2)〜(71)の中から最小の空き番号を探す
  var sheets = ss.getSheets();
  var numbered = sheets
    .filter(function(s) { return s.getName().match(/^\(\d+\)$/); })
    .sort(function(a, b) {
      return parseInt(a.getName().replace(/[()]/g, '')) - parseInt(b.getName().replace(/[()]/g, ''));
    });

  if (numbered.length === 0) return null;

  var target = numbered[0];
  target.setName(siteName);

  // 五十音順で正しい位置に移動
  sortSiteSheets(ss);

  return target;
}

/**
 * ゴミ写真をDriveに保存してフォルダURLを返す
 * フォルダパス: DRIVE_ROOT / YYYY-MM / YYYY-MM-DD_送信者名_現場名 /
 */
function saveGarbagePhotos(base64Photos, date, senderName, siteName) {
  try {
    var root = DriveApp.getFolderById(CONFIG.DRIVE_ROOT_FOLDER_ID);
    var yearMonth = date.slice(0, 7); // YYYY-MM

    // YYYY-MM フォルダ
    var monthIter = root.getFoldersByName(yearMonth);
    var monthFolder = monthIter.hasNext() ? monthIter.next() : root.createFolder(yearMonth);

    // 現場名 フォルダ
    var siteIter = monthFolder.getFoldersByName(siteName);
    var siteFolder = siteIter.hasNext() ? siteIter.next() : monthFolder.createFolder(siteName);

    // YYYY-MM-DD_送信者名 フォルダ
    var subName = date + '_' + senderName;
    var subIter = siteFolder.getFoldersByName(subName);
    var subFolder = subIter.hasNext() ? subIter.next() : siteFolder.createFolder(subName);

    // 写真を保存
    base64Photos.forEach(function(base64, idx) {
      var blob = Utilities.newBlob(
        Utilities.base64Decode(base64),
        'image/jpeg',
        'ゴミ_' + senderName + '_' + (idx + 1) + '.jpg'
      );
      subFolder.createFile(blob);
    });

    return subFolder.getUrl();
  } catch (e) {
    Logger.log('saveGarbagePhotos error: ' + e);
    return null;
  }
}

/**
 * 経費ファイル（JPEG/PDF）をDriveに保存してフォルダURLを返す
 * dataUrls: data:mime;base64,xxx 形式の配列
 * フォルダパス: DRIVE_ROOT / YYYY-MM / 現場名 / YYYY-MM-DD_送信者名 / category_N.ext
 */
function saveExpenseFiles(dataUrls, date, senderName, siteName, category) {
  try {
    var root = DriveApp.getFolderById(CONFIG.DRIVE_ROOT_FOLDER_ID);
    var yearMonth = date.slice(0, 7);

    var monthIter = root.getFoldersByName(yearMonth);
    var monthFolder = monthIter.hasNext() ? monthIter.next() : root.createFolder(yearMonth);

    var siteIter = monthFolder.getFoldersByName(siteName);
    var siteFolder = siteIter.hasNext() ? siteIter.next() : monthFolder.createFolder(siteName);

    var subName = date + '_' + senderName;
    var subIter = siteFolder.getFoldersByName(subName);
    var subFolder = subIter.hasNext() ? subIter.next() : siteFolder.createFolder(subName);

    var fileUrls = [];
    dataUrls.forEach(function(dataUrl, idx) {
      var mimeType = 'image/jpeg';
      var base64Data = dataUrl;
      if (typeof dataUrl === 'string' && dataUrl.indexOf('data:') === 0) {
        var commaIdx = dataUrl.indexOf(',');
        var header = dataUrl.slice(0, commaIdx);
        base64Data = dataUrl.slice(commaIdx + 1);
        var mimeMatch = header.match(/data:([^;]+);/);
        if (mimeMatch) mimeType = mimeMatch[1];
      }
      var ext = mimeType === 'application/pdf' ? '.pdf' : '.jpg';
      var blob = Utilities.newBlob(
        Utilities.base64Decode(base64Data),
        mimeType,
        date + '_' + siteName + '_' + category + '_' + senderName + '_' + (idx + 1) + ext
      );
      var file = subFolder.createFile(blob);
      fileUrls.push(file.getUrl());
    });

    return fileUrls; // ファイル個別URLの配列
  } catch (e) {
    Logger.log('saveExpenseFiles error: ' + e);
    return null;
  }
}

/**
 * 現場シートの行63にゴミ写真フォルダのDriveリンクを書き込む
 */
function writeGarbageFolderLink(sheet, folderUrl, day) {
  try {
    var blockCol = getDayBlockCol(day);
    sheet.getRange(63, blockCol).setValue('📸 写真フォルダ');
    sheet.getRange(63, blockCol + 1).setValue(folderUrl);
  } catch (e) {
    Logger.log('writeGarbageFolderLink error: ' + e);
  }
}

// リマインド除外アカウント（名前で管理）
var REMINDER_EXCLUDE_NAMES = ['REMOVED_HANDLE', 'REMOVED_NAME'];

/**
 * 提出済み記録を保存 & 既知ユーザーに登録
 * キー: submitters_YYYY-MM-DD → JSON配列 ["userId1", ...]
 * キー: known_users → JSON配列 [{id, name}, ...]
 */
function saveSubmitter(senderId, senderName, date) {
  try {
    var props = PropertiesService.getScriptProperties();

    // 提出日記録
    var key = 'submitters_' + date;
    var existing = props.getProperty(key);
    var ids = existing ? JSON.parse(existing) : [];
    if (ids.indexOf(senderId) === -1) {
      ids.push(senderId);
      props.setProperty(key, JSON.stringify(ids));
    }

    // 既知ユーザー登録（名前も保存しておく）
    var knownRaw = props.getProperty('known_users');
    var knownUsers = knownRaw ? JSON.parse(knownRaw) : [];
    var exists = knownUsers.some(function(u) { return u.id === senderId; });
    if (!exists) {
      knownUsers.push({ id: senderId, name: senderName });
      props.setProperty('known_users', JSON.stringify(knownUsers));
      Logger.log('既知ユーザー登録: ' + senderName);
    }
  } catch (e) {
    Logger.log('saveSubmitter error: ' + e);
  }
}

/**
 * 前日分の未提出者にLINEリマインドを送る
 * 毎朝8時のトリガーで実行する
 */
function sendDailyReminder() {
  try {
    var props = PropertiesService.getScriptProperties();
    var knownRaw = props.getProperty('known_users');
    if (!knownRaw) {
      Logger.log('既知ユーザーなし、リマインドスキップ');
      return;
    }
    var knownUsers = JSON.parse(knownRaw);

    // 前日（日曜はスキップ → 月曜は金曜分をチェック）
    var target = new Date();
    target.setDate(target.getDate() - 1);
    while (target.getDay() === 0) { // 日曜スキップ
      target.setDate(target.getDate() - 1);
    }
    var targetDate = Utilities.formatDate(target, 'Asia/Tokyo', 'yyyy-MM-dd');
    var weekdays = ['日','月','火','水','木','金','土'];
    var dateLabel = (target.getMonth() + 1) + '/' + target.getDate() + '（' + weekdays[target.getDay()] + '）';

    var submittedIds = getSubmitterIds(targetDate);

    var unsubmitted = knownUsers.filter(function(u) {
      // 除外アカウントはスキップ
      if (REMINDER_EXCLUDE_NAMES.indexOf(u.name) !== -1) return false;
      // 提出済みはスキップ
      return submittedIds.indexOf(u.id) === -1;
    });

    if (unsubmitted.length === 0) {
      Logger.log('全員提出済み（' + targetDate + '）');
      return;
    }

    Logger.log('未提出者: ' + unsubmitted.map(function(u) { return u.name; }).join(', '));

    var msg = [{
      type: 'text',
      text: '⏰ 日報リマインド\n\n' + dateLabel + ' の日報がまだ届いていません。\n提出をお願いします！\n\nhttps://liff.line.me/' + getLiffId()
    }];

    unsubmitted.forEach(function(u) {
      pushLineMessages(u.id, msg);
    });

  } catch (e) {
    Logger.log('sendDailyReminder error: ' + e);
  }
}

/**
 * LIFFのIDをScriptPropertiesから取得（なければ空文字）
 */
function getLiffId() {
  var p = PropertiesService.getScriptProperties().getProperties();
  return p.LIFF_ID || '';
}

/**
 * 毎朝8時のリマインドトリガーを設定する（初回1回だけ実行）
 */
function setupDailyReminderTrigger() {
  // 既存トリガーを削除してから再登録
  ScriptApp.getProjectTriggers().forEach(function(t) {
    if (t.getHandlerFunction() === 'sendDailyReminder') {
      ScriptApp.deleteTrigger(t);
    }
  });
  ScriptApp.newTrigger('sendDailyReminder')
    .timeBased()
    .everyDays(1)
    .atHour(8)
    .create();
  Logger.log('リマインドトリガー設定完了（毎朝8時）');
}

/**
 * 指定日の提出済みsenderIdリストを返す
 */
function getSubmitterIds(date) {
  try {
    var props = PropertiesService.getScriptProperties();
    var key = 'submitters_' + date;
    var val = props.getProperty(key);
    return val ? JSON.parse(val) : [];
  } catch (e) {
    Logger.log('getSubmitterIds error: ' + e);
    return [];
  }
}

/**
 * 指定送信者の、指定日より前で未送信の最も古い日付を返す
 * 直近7日間のみチェック（日曜日はスキップ）
 * 過去に1件も提出記録がない場合（新規ユーザー・長期不在）はスキップ
 * @returns {string|null} 未送信日付(YYYY-MM-DD) または null（問題なし）
 */
function checkMissingDate(senderId, date) {
  // 直前の平日を1つ特定
  var checkDate = new Date(date + 'T00:00:00');
  var prevDateStr = null;
  for (var i = 1; i <= 7; i++) {
    checkDate.setDate(checkDate.getDate() - 1);
    if (checkDate.getDay() === 0) continue; // 日曜スキップ
    prevDateStr = Utilities.formatDate(checkDate, 'Asia/Tokyo', 'yyyy-MM-dd');
    break;
  }
  if (!prevDateStr) return null;

  // 直前の平日が提出済みならOK
  if (getSubmitterIds(prevDateStr).indexOf(senderId) !== -1) return null;

  // 直前が未提出 → さらに遡って「過去に提出済みの日があるか」確認
  // なければ新規ユーザーとみなしてスキップ
  var innerDate = new Date(checkDate);
  for (var j = 1; j <= 6; j++) {
    innerDate.setDate(innerDate.getDate() - 1);
    if (innerDate.getDay() === 0) continue;
    var innerDateStr = Utilities.formatDate(innerDate, 'Asia/Tokyo', 'yyyy-MM-dd');
    if (getSubmitterIds(innerDateStr).indexOf(senderId) !== -1) {
      return prevDateStr; // 過去に提出済みがある → 間が抜けているのでブロック
    }
  }

  // 過去7日間に提出記録なし → 新規ユーザーとみなしてスキップ
  return null;
}
