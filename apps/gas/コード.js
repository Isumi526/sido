// ============================================================
//  バナナデザイン 案件台帳自動化システム v2.1
//
//  機能:
//    1. LINEグループ日報 → 既存スプシへ自動転記（横形式・実エクセル対応）
//       - 毎月手動でエクセル→スプシ変換してDriveにアップロード
//       - 日報の「14日」→ そのまま14日目のブロック列に書き込む
//    2. Googleフォーム請求書PDF → Gemini解析 → スプシ自動登録
//    3. Google Drive 案件フォルダ自動作成
// ============================================================

const CONFIG = {
  LINE_CHANNEL_ACCESS_TOKEN: 'REMOVED_LINE_TOKEN',
  GEMINI_API_KEY: 'REMOVED_GEMINI_KEY',
  DRIVE_ROOT_FOLDER_ID: 'REMOVED_DRIVE_ID',
  FORM_ID: 'REMOVED_FORM_ID',
  LINE_PUSH_USER_ID: 'REMOVED_LINE_USER_ID',
  NOTIFY_GROUP_IDS: ['REMOVED_LINE_GROUP_ID'],
  // 請求書保存先: DRIVE_ROOT_FOLDER_ID直下に「受信済み請求書/YYYY-MM」を自動作成
};

// ============================================================
//  シートレイアウト定数
//  実エクセルに合わせた横形式レイアウト
// ============================================================

// 1日ブロックの列幅（エクセルと同じ16列）
const DAY_BLOCK_COLS = 16;

// 各ブロック内の列オフセット（0始まり）
const COL = {
  // 作業員セクション（工場・事務所側）
  FACTORY_LABEL:   0,  // 「作業員」ラベル
  FACTORY_NAME:    1,  // 工場/事務所作業員名
  FACTORY_PRICE:   2,  // 単価
  FACTORY_DAYS:    3,  // 工数(日)
  FACTORY_1_25:    4,  // 1.25倍
  FACTORY_1_5:     5,  // 1.5倍
  FACTORY_TOTAL:   6,  // 計（単価×工数）
  FACTORY_NOTE:    7,  // その他
  // 現場作業員側
  SITE_NAME:       8,  // 現場作業員名
  SITE_PRICE:      9,  // 単価
  SITE_DAYS:      10,  // 工数(日)
  SITE_1_25:      11,  // 1.25倍
  SITE_1_5:       12,  // 1.5倍
  SITE_TOTAL:     13,  // 計
  SITE_NOTE:      14,  // その他
  // スペーサー
  SPACER:         15,
};

// ── フォールバック用の行番号定数（動的検索が失敗した場合に使用）──
const ROW_DEFAULT = {
  DAY_TITLE:        1,
  SITE_NAME:        2,
  REPORTER:         3,
  HEADER:           4,
  WORKER_START:     5,
  WORKER_END:      25,
  WORKER_TOTAL:    25,
  // 車両経費入力欄（1号車）
  VEHICLE1_NAME:   27,  // 車両名
  GASOLINE1:       28,  // ガソリン km入力欄
  PARKING1:        29,  // 駐車場 円入力欄
  HIGHWAY1:        30,  // 高速代 円入力欄
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
  HOTEL:           6,
  LEOPALACE:       7,
  GARBAGE_FACTORY: 8,  // ゴミ工場 名称
  GARBAGE_F_AMT:  13,  // ゴミ工場 金額
  GARBAGE_SITE_L:  8,  // ゴミ現場 名称
  GARBAGE_S_AMT:  13,  // 金額
  TRAIN_NAME:      8,
  TRAIN_AMT:      13,
  OTHER_NAME:      8,
  OTHER_AMT:      13,
  ENTERTAINMENT_N: 8,
  ENTERTAINMENT_A: 13,
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

    if (!date || sites.length === 0) {
      return jsonResponse({ success: false, error: '日付または現場データがありません' });
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
        var sheet = getCaseSheet(ss, site.siteName);

        // parseDailyReport互換の形式に変換
        var parsed = {
          year:     year,
          month:    month,
          day:      day,
          siteName: site.siteName,
          reporter: '',  // LIFFからの送信は担当者行に書かない（送信者はLINE通知で確認）
          entries:  (site.workers || []).map(function(w) {
            return {
              name:        w.workerName,
              days:        Number(w.days)    || 1.0,
              overtime125: 0,
              overtime150: Number(w.overtime) > 0 ? Number(w.overtime) / 8 : 0,
            };
          }),
          expenses: buildExpenses(site),
        };

        writeDayBlock(sheet, parsed);
        saveDailyReportLog(parsed);
        successSites.push(site.siteName);

      } catch (siteErr) {
        Logger.log('handleLiffReport site error [' + site.siteName + ']: ' + siteErr);
        failedSites.push(site.siteName);
      }
    });

    // LINE通知（グループに送信）
    sendLiffReportNotification(sender, date, body.sites, successSites, failedSites, note);

    return jsonResponse({
      success: true,
      successSites: successSites,
      failedSites:  failedSites,
    });

  } catch (err) {
    Logger.log('handleLiffReport error: ' + err);
    return jsonResponse({ success: false, error: err.toString() });
  }
}

/**
 * LIFFフォームの経費データをexpenses配列に変換
 */
function buildExpenses(site) {
  var expenses = [];
  var exp = site.expenses || {};

  if (exp.distanceKm) {
    expenses.push({
      type:        'gasoline',
      label:       (exp.vehicle ? exp.vehicle + ' ' : '') + '往復' + exp.distanceKm + 'km',
      km:          Number(exp.distanceKm),
      amount:      Math.round(Number(exp.distanceKm) * 14.58),
      vehicleName: exp.vehicle || '',
    });
  }
  if (exp.parkingYen)       expenses.push({ type: 'parking',         label: '駐車場',       amount: Number(exp.parkingYen) });
  if (exp.highwayYen)       expenses.push({ type: 'highway',         label: '高速代',       amount: Number(exp.highwayYen) });
  if (exp.trainYen)         expenses.push({ type: 'train',           label: '電車',         amount: Number(exp.trainYen) });
  if (exp.garbageFactoryYen) expenses.push({ type: 'garbage_factory', label: 'ゴミ（工場）', amount: Number(exp.garbageFactoryYen) });
  if (exp.garbageSiteYen)   expenses.push({ type: 'garbage_site',    label: 'ゴミ（現場）', amount: Number(exp.garbageSiteYen) });
  if (exp.hotelYen)         expenses.push({ type: 'hotel',           label: 'ホテル',       amount: Number(exp.hotelYen) });
  if (exp.otherYen)         expenses.push({ type: 'other',           label: 'その他',       amount: Number(exp.otherYen) });

  // 下請け業者
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
function sendLiffReportNotification(sender, date, sites, successSites, failedSites, note) {
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

      // 作業員
      var workers = (site.workers || []).filter(function(w) { return w.workerName; });
      if (workers.length > 0) {
        var wStr = workers.map(function(w) {
          var s = w.workerName + ' ' + w.days + '日';
          if (w.overtime > 0) s += ' 残業' + w.overtime + 'h';
          return s;
        }).join(' / ');
        lines.push('  👷 ' + wStr);
      }

      // 経費
      var exp = site.expenses || {};
      var expItems = [];
      if (exp.distanceKm) expItems.push((exp.vehicle || '') + '往復' + exp.distanceKm + 'km');
      if (exp.parkingYen)        expItems.push('駐車場¥' + Number(exp.parkingYen).toLocaleString());
      if (exp.highwayYen)        expItems.push('高速¥' + Number(exp.highwayYen).toLocaleString());
      if (exp.trainYen)          expItems.push('電車¥' + Number(exp.trainYen).toLocaleString());
      if (exp.garbageFactoryYen) expItems.push('ゴミ工場¥' + Number(exp.garbageFactoryYen).toLocaleString());
      if (exp.garbageSiteYen)    expItems.push('ゴミ現場¥' + Number(exp.garbageSiteYen).toLocaleString());
      if (exp.hotelYen)          expItems.push('ホテル¥' + Number(exp.hotelYen).toLocaleString());
      if (exp.otherYen)          expItems.push('その他¥' + Number(exp.otherYen).toLocaleString());
      if (expItems.length > 0) lines.push('  💴 ' + expItems.join(' / '));

      // 下請け業者
      var subs = (site.subcontractors || []).filter(function(s) { return s.subcontractorName; });
      if (subs.length > 0) {
        var sStr = subs.map(function(s) { return s.subcontractorName + ' ' + s.count + '人'; }).join(' / ');
        lines.push('  🏢 ' + sStr);
      }
    });

    if (note) lines.push('\n📝 ' + note);

    if (failedSites.length > 0) {
      lines.push('\n⚠️ 未登録: ' + failedSites.join('、'));
    }

    var msg = [{ type: 'text', text: lines.join('\n') }];
    if (CONFIG.LINE_PUSH_USER_ID) pushLineMessages(CONFIG.LINE_PUSH_USER_ID, msg);
    (CONFIG.NOTIFY_GROUP_IDS || []).forEach(function(id) { pushLineMessages(id, msg); });

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
function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('📋 シート管理')
    .addItem('「事務、工場、その他」を複製', 'duplicateKojiSheet')
    .addItem('不要なシートを削除', 'deleteExtraSheets')
    .addToUi();
}

/**
 * 「事務、工場、その他」シートを複製して連番名を付ける
 * 例: (2), (3), (4)...
 */
function duplicateKojiSheet() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var srcSheet = ss.getSheetByName('事務、工場、その他');
  
  if (!srcSheet) {
    SpreadsheetApp.getUi().alert('「事務、工場、その他」シートが見つかりません。');
    return;
  }
  
  // 現在の最大連番を取得
  var sheets = ss.getSheets();
  var maxNum = 1;
  sheets.forEach(function(sheet) {
    var name = sheet.getName().trim();
    var m = name.match(/^\((\d+)\)$/);
    if (m) {
      maxNum = Math.max(maxNum, parseInt(m[1]));
    }
  });
  
  var newNum = maxNum + 1;
  var newName = '(' + newNum + ')';
  
  // 複製して末尾に追加
  var newSheet = srcSheet.copyTo(ss);
  newSheet.setName(newName);
  
  // 「事務、工場、その他」の右隣に移動
  var srcIndex = ss.getSheets().indexOf(srcSheet);
  ss.moveActiveSheet(srcIndex + newNum); // 末尾でもOK
  
  // 金額集計シートの参照を更新
  updateKingakuSheet(ss, newNum);
  
  SpreadsheetApp.getUi().alert('「' + newName + '」シートを作成しました！');
  Logger.log('シート複製完了: ' + newName);
}

/**
 * 金額集計シートのD10に新しいシートの参照を追加する
 * ='事務、工場、その他'!O62+' (2)'!O62+...
 */
function updateKingakuSheet(ss, maxNum) {
  var ks = ss.getSheetByName('金額集計');
  if (!ks) return;
  
  var parts = ["='事務、工場、その他'!O62"];
  for (var i = 2; i <= maxNum; i++) {
    parts.push("' (" + i + ")'!O62");
  }
  ks.getRange('D10').setFormula(parts.join('+'));
  Logger.log('金額集計D10更新: ' + ks.getRange('D10').getFormula());
}

/**
 * (2)以降の全シートを削除する
 * ※使用済みデータがある場合は削除前に確認ダイアログを表示
 */
function deleteExtraSheets() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var ui = SpreadsheetApp.getUi();
  
  var extraSheets = ss.getSheets().filter(function(sheet) {
    return sheet.getName().trim().match(/^\(\d+\)$/);
  });
  
  if (extraSheets.length === 0) {
    ui.alert('削除対象のシートはありません。');
    return;
  }
  
  var result = ui.alert(
    '確認',
    extraSheets.length + '件のシート（' + extraSheets.map(function(s){ return s.getName(); }).join(', ') + '）を削除します。よろしいですか？',
    ui.ButtonSet.YES_NO
  );
  
  if (result !== ui.Button.YES) return;
  
  extraSheets.forEach(function(sheet) {
    ss.deleteSheet(sheet);
  });
  
  // 金額集計を1シートに戻す
  var ks = ss.getSheetByName('金額集計');
  if (ks) {
    ks.getRange('D10').setFormula("='事務、工場、その他'!O62");
  }
  
  ui.alert('削除完了しました。');
  Logger.log('シート削除完了: ' + extraSheets.length + '件');
}

// ============================================================
//  doGet - LIFFフォーム用マスタデータAPI
//  GETリクエスト: ?action=getMaster でスプシからデータ取得
// ============================================================
function doGet(e) {
  try {
    var action = e && e.parameter && e.parameter.action;

    if (action === 'getMaster') {
      var now = new Date();
      var ss  = getMonthlySpreadsheet(now.getFullYear(), now.getMonth() + 1);
      var excludeSheets = ['外注','提出確認','金額集計','事務、工場、その他','設定','月次サマリ','業者台帳'];

      // 現場名
      var sites = ss.getSheets()
        .map(function(s) { return s.getName().trim(); })
        .filter(function(n) { return n && !excludeSheets.includes(n) && !n.match(/^\s*\(\d+\)\s*$/); });

      // 作業員（設定シートから直接読む）
      var workers = [];
      var subcontractors = [];
      try {
        var settingSheet = ss.getSheetByName('設定');
        if (settingSheet) {
          var allValues = settingSheet.getDataRange().getValues();

          // 作業員リスト: 名前(A列)が文字列 かつ 単価(B列)が数値 かつ 30000以下の行のみ
          // ヘッダ・設定項目ラベルを除外するため数値チェックを厳密に
          var inWorkerSection = false;
          var inSubSection    = false;
          allValues.forEach(function(row) {
            var col0 = String(row[0] || '').trim();
            var col1 = row[1];

            // セクションヘッダの検出
            if (col0 === '【作業員単価】') { inWorkerSection = true;  inSubSection = false; return; }
            if (col0 === '【下請け業者リスト】') { inSubSection = true; inWorkerSection = false; return; }
            if (col0.startsWith('【')) { inWorkerSection = false; inSubSection = false; return; }

            // 作業員行: 名前が存在 かつ 単価が正の整数
            if (inWorkerSection && col0 && col0 !== '作業員名' && typeof col1 === 'number' && col1 > 0) {
              workers.push({ name: col0, unitPrice: col1 });
            }

            // 下請け業者行: 名前が存在 かつ「業者名」ヘッダ以外
            if (inSubSection && col0 && col0 !== '業者名') {
              subcontractors.push(col0);
            }
          });
        }
      } catch (settingErr) {
        Logger.log('getMaster setting error: ' + settingErr);
      }

      var vehicles = ['ハイエース', 'キャラバン', 'プロボックス', 'その他'];

      var result = JSON.stringify({
        sites:          sites,
        workers:        workers,
        subcontractors: subcontractors,
        vehicles:       vehicles,
      });
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
//  LINE Webhook エントリポイント
// ============================================================
function doPost(e) {
  try {
    const body = JSON.parse(e.postData.contents);

    // ── LIFFフォームからの日報送信 ──
    if (body.action === 'submitReport') {
      return handleLiffReport(body);
    }

    const events = body.events || [];

    events.forEach(event => {
      const replyTo = event.replyToken;

      // ── postbackイベント（ボタン押下）──
      if (event.type === 'postback') {
        handlePostback(event.postback.data, replyTo);
        return;
      }

      if (event.type !== 'message') return;
      const msg = event.message;

      if (msg.type === 'text' && msg.text.trim() === 'グループID') {
        const groupId = event.source?.groupId || 'グループ外（個人チャット）';
        replyLine(replyTo, 'グループID: ' + groupId);
        return;
      }

      // 現場一覧コマンド
      if (msg.type === 'text' && msg.text.trim() === '現場一覧') {
        handleSiteListCommand(replyTo);
        return;
      }

      // 現場マッピング確認コマンド
      if (msg.type === 'text' && msg.text.trim() === '現場マッピング') {
        sendSiteNameMappingList(replyTo);
        return;
      }

      // 手動対応リストコマンド
      if (msg.type === 'text' && msg.text.trim() === '手動対応リスト') {
        sendManualTodoList(replyTo);
        return;
      }

      // 手動対応完了コマンド（例: 「手動対応完了 1」）
      if (msg.type === 'text' && msg.text.trim().startsWith('手動対応完了')) {
        var numStr = msg.text.trim().replace('手動対応完了', '').trim();
        completeManualTodo(numStr, replyTo);
        return;
      }

      try {
        if (msg.type === 'text') {
          handleTextMessage(msg.text, replyTo);
        } else if (msg.type === 'image') {
          handleLineFileMessage(msg.id, 'image/jpeg', replyTo);
        } else if (msg.type === 'file') {
          handleLineFileMessage(msg.id, msg.fileName, replyTo);
        }
      } catch (innerErr) {
        replyLine(replyTo, '❌ 内部エラー: ' + innerErr.toString());
      }
    });

  } catch (err) {
    Logger.log('doPost error: ' + err);
  }

  return ContentService.createTextOutput(JSON.stringify({ status: 'ok' }))
    .setMimeType(ContentService.MimeType.JSON);
}

// ============================================================
//  postbackイベントハンドラ（ボタン押下時）
// ============================================================
function handlePostback(data, replyTo) {
  try {
    const params = JSON.parse(data);

    // 請求書: 現場名を確定して登録
    if (params.action === 'register_invoice') {
      const fileId   = params.fileId;
      const siteName = params.siteName;
      const uploader = params.uploader;

      // 同じfileId+siteNameの二重登録を防止
      const processedKey = 'invoice_done_' + fileId + '_' + siteName.replace(/[^a-zA-Z0-9]/g, '_');
      const props = PropertiesService.getScriptProperties();
      if (props.getProperty(processedKey)) {
        replyOrPush(replyTo, '「' + siteName + '」はすでに登録済みです。');
        return;
      }

      const now = new Date();
      const ss  = getMonthlySpreadsheet(now.getFullYear(), now.getMonth() + 1);
      const sheet = getCaseSheet(ss, siteName);

      // Drive保存はonFormSubmit時に済み → ここでは転記のみ
      const file = DriveApp.getFileById(fileId);
      const invoiceList = parseInvoiceWithGeminiDirect(file, file.getMimeType());

      if (!invoiceList || invoiceList.length === 0) {
        replyOrPush(replyTo, '❌ 再解析に失敗しました。\n現場: ' + siteName + '\n手動で台帳に入力してください。');
        return;
      }

      invoiceList.forEach(function(invoiceData) {
        invoiceData.siteName = siteName;
        appendInvoiceRow(sheet, invoiceData, uploader);
      });

      // 処理済みフラグを保存（同一ファイル+現場名の重複登録を防止）
      props.setProperty(processedKey, new Date().toISOString());
      // 古いフラグを定期清掃（30日以上前のものを削除）
      cleanOldProcessedFlags(props);

      // 請求書の現場名もマッピング保存（AIが読み取った表記 → 正式シート名）
      saveSiteNameMapping(params.originalSiteName || siteName, siteName);

      var doneMsg = '✅ 登録完了！\n📍 現場: ' + siteName + '\n📄 ' + cleanFileName(file.getName());
      replyOrPush(replyTo, doneMsg);
      return;
    }

    // 日報: 現場名選択後の書き込み
    if (params.action === 'report_with_site') {
      // 再パース前にAI正規化を通す（初回と同じ処理を再現）
      const normalizedForReparse = normalizeReportWithAI(params.originalText);
      const allParsed = parseMultipleReports(normalizedForReparse);
      // 元の現場名（未正規化）で一致するものを探す、なければ最初のブロックを使用
      let parsed = allParsed.find(function(p) {
        return p.siteName === params.originalSiteName || p.siteName === params.siteName;
      }) || allParsed[0];

      if (!parsed) {
        replyOrPush(replyTo, '❌ 日報の再解析に失敗しました。もう一度送り直してください。');
        return;
      }
      // 選択した現場名で上書き＋マッピングを保存（次回から自動変換）
      const originalSiteName = parsed.siteName;
      parsed.siteName = params.siteName;
      saveSiteNameMapping(originalSiteName, params.siteName);
      const now = new Date();
      const ss2 = getMonthlySpreadsheet(parsed.year || now.getFullYear(), parsed.month || now.getMonth() + 1);
      const sheet2 = getCaseSheet(ss2, params.siteName);
      const existing = getExistingDayData(sheet2, parsed.day);
      if (existing) {
        const flexMsg = buildOverwriteFlex(parsed, existing);
        replyLineMessages(replyTo, [flexMsg]);
        return;
      }
      writeAndReply(sheet2, parsed, replyTo);
      return;
    }

    // 手動対応リスト: 追加（日報の手動ボタン）
    if (params.action === 'manual_todo_add') {
      var detail = [];
      if (params.workers && params.workers.length > 0) detail.push('作業員: ' + params.workers.join('、'));
      if (params.expenses && params.expenses.length > 0) detail.push('経費: ' + params.expenses.join('、'));
      var note = (params.date || '') + (detail.length > 0 ? '\n' + detail.join('\n') : '');
      addManualTodo(params.siteName, 'report', note);
      replyOrPush(replyTo, '📝 「' + params.siteName + '」を手動対応リストに追加しました。\n「手動対応リスト」で確認できます。');
      return;
    }

    // 手動対応リスト: 完了ボタン
    if (params.action === 'manual_todo_done') {
      completeManualTodo(params.id, replyTo);
      return;
    }

    // 日報: 上書き確認
    if (params.action === 'overwrite_report') {
      // 再処理前にAI正規化を通す
      const normalizedForOverwrite = normalizeReportWithAI(params.originalText);
      handleOverwriteConfirmed(normalizedForOverwrite, replyTo);
      return;
    }

  } catch (err) {
    Logger.log('handlePostback error: ' + err);
    replyOrPush(replyTo, '❌ ボタン処理でエラーが発生しました: ' + err.toString());
  }
}

/**
 * replyTokenがあればreply（カードへの返信）、なければpush通知にフォールバック
 */
function replyOrPush(replyTo, message) {
  if (replyTo) {
    replyLine(replyTo, message);
  } else {
    notifyAdmin(message);
  }
}

/**
 * 管理者にpush通知を送るユーティリティ
 * replyTokenがない場面でも確実に届ける
 */
function notifyAdmin(message) {
  var msg = [{ type: 'text', text: message }];
  if (CONFIG.LINE_PUSH_USER_ID) pushLineMessages(CONFIG.LINE_PUSH_USER_ID, msg);
  (CONFIG.NOTIFY_GROUP_IDS || []).forEach(function(id) { pushLineMessages(id, msg); });
}

/**
 * ⑥ PropertiesService の古い処理済みフラグを削除する
 * 30日以上前に登録されたフラグを清掃
 */
function cleanOldProcessedFlags(props) {
  try {
    const allProps = props.getProperties();
    const thirtyDaysAgo = Date.now() - 30 * 24 * 60 * 60 * 1000;
    Object.keys(allProps).forEach(function(key) {
      if (!key.startsWith('invoice_done_')) return;
      const ts = new Date(allProps[key]).getTime();
      if (!isNaN(ts) && ts < thirtyDaysAgo) {
        props.deleteProperty(key);
      }
    });
  } catch (e) {
    Logger.log('cleanOldProcessedFlags error: ' + e);
  }
}

/**
 * Googleドライブが自動付与する「 - アカウント名」をファイル名から除去する
 * 例: 「【VendorG工業】 - REMOVED_NAME.pdf」→「【VendorG工業】.pdf」
 */
function cleanFileName(fileName) {
  // 「 - 英字名前.拡張子」パターンを除去
  return fileName.replace(/\s+-\s+[A-Za-z][A-Za-z\s]+(?=\.[^.]+$)/, '').trim();
}


// ============================================================
//  LINE テキスト日報ハンドラ
// ============================================================
function handleTextMessage(text, replyTo) {
  // ── ボタン押下で送信されるシステムメッセージは無視 ──
  // ボタン押下で送信されるシステムメッセージの処理
  const trimmed = text.trim();

  // 「〇〇」は手動で対応します → リストに追加してから無視
  if (trimmed.endsWith('は手動で対応します')) {
    const siteMatch = trimmed.match(/^「(.+)」は手動で対応します$/);
    if (siteMatch) {
      addManualTodo(siteMatch[1], 'report', '');
      replyLine(replyTo, '📝 「' + siteMatch[1] + '」を手動対応リストに追加しました。\n「手動対応リスト」で確認できます。');
    }
    return;
  }

  // その他のシステムメッセージは無視
  if (
    trimmed === '手動対応します' ||
    trimmed === 'キャンセルします' ||
    trimmed === '上書きして登録します' ||
    trimmed === '現場一覧' ||
    trimmed === '現場マッピング' ||
    trimmed === '手動対応リスト' ||
    trimmed.startsWith('手動対応完了') ||
    trimmed.startsWith('「')
  ) return;

  // ① 「上書き confirmed:...」形式の確認応答を処理
  const overwriteMatch = trimmed.match(/^上書き\s+confirmed:(.+)$/s);
  if (overwriteMatch) {
    handleOverwriteConfirmed(overwriteMatch[1].trim(), replyTo);
    return;
  }

  // 日報らしいテキストかどうかを事前判定（普通の会話を誤検知しない）
  // 条件: 「〇日」または「YYYY/MM/DD」で始まる行が含まれている
  const hasDateLine = /(?:^|\n)\s*(?:\d{1,2}月\d{1,2}日|\d{1,2}日|\d{4}[\/\-]\d{1,2}[\/\-]\d{1,2}|[\u2193\u2192\u25BC]\s*\d{1,2}日|[\uFF10-\uFF19]{1,2}日)/.test(text);
  if (!hasDateLine) return; // 日付行がなければ日報ではない→無視

  // AI正規化 → 複数現場対応パーサ
  const normalizedText = normalizeReportWithAI(text);
  const parsedList = parseMultipleReports(normalizedText);

  // パース失敗 = 通常の会話として無視（エラーを返さない）
  if (parsedList.length === 0) return;

  let ss;
  try {
    const first = parsedList[0];
    ss = getMonthlySpreadsheet(first.year, first.month);
  } catch (e) {
    replyLine(replyTo, e.message);
    return;
  }

  // 現場ごとに処理（複数現場でも1件ずつ）
  const successNames = [];
  const replyMessages = [];

  parsedList.forEach(function(parsed) {
    let sheet;
    try {
      sheet = getCaseSheet(ss, parsed.siteName);
    } catch (e) {
      // 現場名が見つからない → Flex Messageをキューに積む
      const candidates = extractCandidates(e.message);
      replyMessages.push(buildReportSiteSelectFlex(parsed, text, candidates));
      return;
    }

    // 二重送信チェック
    const existing = getExistingDayData(sheet, parsed.day);
    if (existing) {
      replyMessages.push(buildOverwriteFlex(parsed, existing));
      return;
    }

    writeDayBlock(sheet, parsed);
    successNames.push(parsed.siteName);

    // 翌日サマリ用に登録内容を記録
    saveDailyReportLog(parsed);
  });

  // サイレントモード: 正常登録はLINEに返信しない
  // 現場名不明・上書き確認のみ返信する
  const replyMsgs = [];

  // 要確認メッセージ（Flex）のみ返信
  replyMessages.slice(0, 5).forEach(function(m) { replyMsgs.push(m); });

  if (replyMsgs.length > 0) {
    replyLineMessages(replyTo, replyMsgs.slice(0, 5));
  }
}

/**
 * 「上書き confirmed:...」の応答を処理
 */
function handleOverwriteConfirmed(originalText, replyTo) {
  const parsed = parseDailyReport(originalText);
  if (!parsed) {
    replyLine(replyTo, '❌ 元の日報テキストが読み取れませんでした。もう一度最初から送り直してください。');
    return;
  }
  let ss, sheet;
  try {
    ss = getMonthlySpreadsheet(parsed.year, parsed.month);
    sheet = getCaseSheet(ss, parsed.siteName);
  } catch (e) {
    replyLine(replyTo, e.message);
    return;
  }
  writeAndReply(sheet, parsed, replyTo, true);
}

/**
 * 実際の書き込みと完了返信（内容サマリ付き）
 */
function writeAndReply(sheet, parsed, replyTo, isOverwrite = false) {
  writeDayBlock(sheet, parsed);

  const lines = [];
  lines.push((isOverwrite ? '🔄 上書き登録完了！' : '✅ 登録完了！'));
  lines.push('📍 ' + parsed.siteName + '　' + parsed.month + '/' + parsed.day);

  // 作業員（金額は表示しない）
  if (parsed.entries.length > 0) {
    parsed.entries.forEach(function(e) {
      let line = '  👷 ' + e.name + ' ' + e.days + '日';
      if (e.overtime150) line += ' 残業' + (e.overtime150 * 8).toFixed(1) + 'h';
      lines.push(line);
    });
  }

  // 経費
  if (parsed.expenses.length > 0) {
    parsed.expenses.forEach(function(ex) {
      lines.push('  💴 ' + ex.label + '　¥' + ex.amount.toLocaleString());
    });
  }

  replyLine(replyTo, lines.join('\n'));
}

/**
 * 指定日ブロックに既存の作業員データがあるか確認する。
 * データがあればその概要文字列を、なければ null を返す。
 */
function getExistingDayData(sheet, day) {
  const blockCol = getDayBlockCol(day);
  const ROW_D = detectSheetRows(sheet, blockCol);
  const existing = [];

  // 現場側作業員列をスキャン
  for (let row = ROW_D.WORKER_START; row <= ROW_D.WORKER_END; row++) {
    const name = sheet.getRange(row, blockCol + COL.SITE_NAME).getValue();
    const days = sheet.getRange(row, blockCol + COL.SITE_DAYS).getValue();
    if (name && days !== '' && days !== 0) {
      existing.push(`👷 ${name} ${days}日`);
    }
    // 工場側も確認
    const fname = sheet.getRange(row, blockCol + COL.FACTORY_NAME).getValue();
    const fdays = sheet.getRange(row, blockCol + COL.FACTORY_DAYS).getValue();
    if (fname && fdays !== '' && fdays !== 0) {
      existing.push(`👷 ${fname} ${fdays}日（工場）`);
    }
  }

  // 経費確認（ガソリン距離計）
  const gasKm = sheet.getRange(ROW_D.GAS_DIST_TOTAL, blockCol + 1).getValue();
  if (gasKm) existing.push(`🚗 走行距離 往復${gasKm}km`);

  return existing.length > 0 ? existing.join('\n') : null;
}


// ============================================================
//  手動対応リスト
//  「手動で対応する」ボタンを押した案件を記録・管理する
// ============================================================

var MANUAL_LIST_KEY = 'manual_todo_list';

/**
 * 手動対応リストに追加する
 * @param {string} siteName  現場名
 * @param {string} type      'report'（日報）| 'invoice'（請求書）
 * @param {string} note      補足情報（日付・ファイル名等）
 */
function addManualTodo(siteName, type, note) {
  try {
    var props = PropertiesService.getScriptProperties();
    var raw = props.getProperty(MANUAL_LIST_KEY);
    var list = raw ? JSON.parse(raw) : [];

    // 同じ現場名・タイプの重複は上書き
    list = list.filter(function(item) {
      return !(item.siteName === siteName && item.type === type);
    });

    list.push({
      id:       list.length > 0 ? Math.max.apply(null, list.map(function(i){return i.id;})) + 1 : 1,
      siteName: siteName,
      type:     type,
      note:     note || '',
      date:     Utilities.formatDate(new Date(), 'Asia/Tokyo', 'M/d HH:mm'),
      done:     false,
    });

    props.setProperty(MANUAL_LIST_KEY, JSON.stringify(list));
    Logger.log('手動対応追加: ' + siteName);
  } catch (e) {
    Logger.log('addManualTodo error: ' + e);
  }
}

/**
 * 手動対応リストをFlex Message（完了ボタン付き）でLINEに送信する
 */
function sendManualTodoList(replyTo) {
  try {
    var props = PropertiesService.getScriptProperties();
    var raw = props.getProperty(MANUAL_LIST_KEY);
    var list = raw ? JSON.parse(raw) : [];
    var pending = list.filter(function(item) { return !item.done; });
    var done    = list.filter(function(item) { return item.done; });

    if (pending.length === 0 && done.length === 0) {
      replyLine(replyTo, '✅ 手動対応の未完了案件はありません。');
      return;
    }

    var messages = [];

    // 未完了: 件ごとにFlexカード（完了ボタン付き）
    pending.forEach(function(item) {
      var typeLabel = item.type === 'invoice' ? '請求書' : '日報';
      var headerColor = item.type === 'invoice' ? '#E67E22' : '#2C7BB6';
      messages.push({
        type: 'flex',
        altText: '【手動対応】' + item.siteName,
        contents: {
          type: 'bubble',
          header: {
            type: 'box', layout: 'vertical',
            backgroundColor: headerColor,
            contents: [{
              type: 'text',
              text: '📋 手動対応待ち【' + typeLabel + '】',
              color: '#FFFFFF', weight: 'bold', size: 'sm',
            }],
          },
          body: {
            type: 'box', layout: 'vertical', spacing: 'sm',
            contents: [
              { type: 'text', text: item.siteName, weight: 'bold', size: 'lg', wrap: true, color: '#1E293B' },
              { type: 'text', text: item.date, size: 'sm', color: '#64748B' },
              ...(item.note ? item.note.split('\n').filter(Boolean).map(function(n) {
                return { type: 'text', text: n.trim(), size: 'sm', color: '#475569', margin: 'xs', wrap: true };
              }) : []),
            ],
          },
          footer: {
            type: 'box', layout: 'vertical',
            contents: [{
              type: 'button', style: 'primary', color: '#10B981',
              action: {
                type: 'postback',
                label: '✅ 完了にする',
                data: JSON.stringify({ action: 'manual_todo_done', id: item.id }),
                displayText: item.siteName + ' を完了にします',
              },
            }],
          },
        },
      });
    });

    // 完了済みはテキストでまとめて表示
    if (done.length > 0) {
      var doneMsg = '✅ 完了済み（' + done.length + '件）\n';
      done.slice(-5).forEach(function(item) {
        var typeLabel = item.type === 'invoice' ? '請求書' : '日報';
        doneMsg += '  ✓ 【' + typeLabel + '】' + item.siteName + '\n';
      });
      messages.push({ type: 'text', text: doneMsg.trim() });
    }

    if (messages.length === 0) return;
    replyLineMessages(replyTo, messages.slice(0, 5));

  } catch (e) {
    replyLine(replyTo, '手動対応リスト取得エラー: ' + e.message);
  }
}

/**
 * 手動対応リストの指定番号を完了にする
 * @param {string|number} id  完了にするアイテムのID
 */
function completeManualTodo(id, replyTo) {
  try {
    var props = PropertiesService.getScriptProperties();
    var raw = props.getProperty(MANUAL_LIST_KEY);
    var list = raw ? JSON.parse(raw) : [];
    var targetId = parseInt(id, 10);
    var target = list.find(function(item) { return item.id === targetId && !item.done; });

    if (!target) {
      replyLine(replyTo, '番号 ' + id + ' の未完了案件が見つかりません。\n「手動対応リスト」で番号を確認してください。');
      return;
    }

    target.done = true;
    target.doneAt = Utilities.formatDate(new Date(), 'Asia/Tokyo', 'M/d HH:mm');
    props.setProperty(MANUAL_LIST_KEY, JSON.stringify(list));

    var typeLabel = target.type === 'invoice' ? '請求書' : '日報';
    replyLine(replyTo,
      '✅ 完了にしました！\n' +
      '【' + typeLabel + '】' + target.siteName + '\n' +
      '（' + target.date + ' 登録）'
    );
  } catch (e) {
    replyLine(replyTo, '完了処理エラー: ' + e.message);
  }
}

// ============================================================
//  現場名マッピング（学習機能）
//  ユーザーがFlexボタンで正しい現場名を選択した時に
//  「入力表記 → 正式シート名」を記憶する
// ============================================================

/**
 * 現場名マッピングを保存する
 * @param {string} inputName   ユーザーが送った表記（例: "ギフトサクラステージ"）
 * @param {string} sheetName   正式なシート名（例: "ギフト桜ステージ"）
 */
function saveSiteNameMapping(inputName, sheetName) {
  if (!inputName || !sheetName || inputName === sheetName) return;
  try {
    var props = PropertiesService.getScriptProperties();
    var key = 'sitemap_' + normalizeName(inputName);
    props.setProperty(key, sheetName);
    Logger.log('現場名マッピング保存: "' + inputName + '" → "' + sheetName + '"');
  } catch (e) {
    Logger.log('saveSiteNameMapping error: ' + e);
  }
}

/**
 * 保存済みマッピングから正式シート名を取得する
 * @param {string} inputName  ユーザーが送った表記
 * @returns {string|null}     正式シート名、なければ null
 */
function getSiteNameMapping(inputName) {
  try {
    var props = PropertiesService.getScriptProperties();
    var key = 'sitemap_' + normalizeName(inputName);
    return props.getProperty(key) || null;
  } catch (e) {
    return null;
  }
}

/**
 * 保存済みマッピングの一覧をLINEに送る（確認用コマンド）
 */
function sendSiteNameMappingList(replyTo) {
  try {
    var props = PropertiesService.getScriptProperties();
    var all = props.getProperties();
    var lines = [];
    Object.keys(all).forEach(function(key) {
      if (key.startsWith('sitemap_')) {
        lines.push('  ' + all[key] + ' ← ' + key.replace('sitemap_', ''));
      }
    });
    if (lines.length === 0) {
      replyLine(replyTo, '現場名の登録済みマッピングはありません。');
    } else {
      replyLine(replyTo, '📋 現場名マッピング一覧（' + lines.length + '件）\n' + lines.join('\n'));
    }
  } catch (e) {
    replyLine(replyTo, 'マッピング取得エラー: ' + e.message);
  }
}

// ============================================================
//  Gemini 日報テキスト正規化（AI前処理）
//  記入フォーマットの揺れをAIで統一してから既存パーサに渡す
// ============================================================

/**
 * 日報テキストをGeminiで正規フォーマットに変換する
 * 変換失敗した場合は元テキストをそのまま返す（フォールバック）
 *
 * 対応する揺れの例:
 *   ↓１１日 → 11日
 *   ギフトサクラステージ夜勤 → ギフトサクラステージ（夜勤は除去）
 *   小島（工数なし）→ 小島 1.0
 *   ハイエース４キロ → 往復4km
 *   Ｐ代2900円 → 駐車場代 2900
 *   毛利１＋残業２ → 毛利 1.0 残業2時間
 *   鵜飼　残業のみ０.５ → 鵜飼 残業のみ 0.5
 *   全角数字・全角スペース → 半角に統一
 */
function normalizeReportWithAI(text) {
  try {
    var rules = [
      '1. 全角数字・全角英字・全角スペースはすべて半角に変換',
      '2. 日付: 「4月21日」「4/21」「↓11日」「11日目」「21日火曜日」などは「21日」のように日付のみに統一（月・曜日・矢印も除去）',
      '3. 現場名: 「夜勤」という言葉が現場名についている場合は除去する（例:「ギフトサクラステージ 夜勤」→「ギフトサクラステージ」「ギフト桜ステージ夜勤」→「ギフト桜ステージ」）。「現場」「製作」などその他の付加語はそのまま残す',
      '4. 作業員が「・」区切りで複数書かれている場合は1人1行に分割する。例:「野村・佐藤」→「野村 1.0」と「佐藤 1.0」を別行に',
      '5. 作業員と工数: 工数がない場合は「作業員名 1.0」とする',
      '6. 作業員と工数の間のスペースは必ず1つ入れる（「今井1.0」→「今井 1.0」）',
      '7. 残業: 「毛利１＋残業２」→「毛利 1.0 残業2時間」、「残業のみ０.５」→「残業のみ 0.5」',
      '8. ガソリン・車両名: 「ハイエース４キロ」「距離 往復10キロ」→「ハイエース 往復10km」、「往復4キロ」→「往復4km」。車両名だけの行（キャラバン・ハイエース等）と距離行が別れている場合は「キャラバン 往復〇km」に統合する',
      '9. 駐車場: 「駐車場 3700円+400円」→合計して「駐車場代 4100」。「Ｐ代2900」→「駐車場代 2900」。「P代なし」は行ごと削除',
      '10. 高速代: 「高速2500」「高速代2500円」→「高速代 2500」',
      '11. 電車・交通費: 「方南町→渋谷 290円×2」→掛け算を計算して「電車 580」。「〇〇→〇〇 金額」形式はすべて電車代として処理',
      '12. 担当者: 「担当:今井」「担当：今井」→「担当: 今井」',
      '13. 複数現場の区切りのみ空行を維持する。同じ現場の作業員・経費行の間にある空行は除去して1つのブロックにまとめる。現場が変わる場合のみ空行で区切る',
      '14. 下請け業者名（VendorA・VendorB・VendorC・VendorD・リベロ・名鏡・岩橋・水野ガラス・VendorE・マルナ・正徳・中部メンテナンス・VendorF・GSテクノ・カミムラ・VendorG・VendorHなど）が書かれている場合は「下請け: 業者名 人数」形式に変換する。人数が書かれていない場合は1とする。例:「VendorA」→「下請け: VendorA 1」、「VendorA 3人」→「下請け: VendorA 3」',
      '15. 「見積」「確認」「打合せ」などの業務メモ行（作業員・経費・日付・現場名以外）は行ごと削除する',
      '16. 変換できない行はそのまま残す',
    ].join('\n');

    var prompt =
      '以下の施工現場の日報テキストを、指定のフォーマットに変換してください。\n\n' +
      '【変換ルール】\n' + rules + '\n\n' +
      '【出力形式】\n' +
      '変換後のテキストのみ出力。説明・前置き・コードブロックは不要。\n\n' +
      '【入力テキスト】\n' + text;

    var payload = {
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: { temperature: 0 },
    };

    var res = UrlFetchApp.fetch(
      'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=' + CONFIG.GEMINI_API_KEY,
      {
        method: 'post',
        contentType: 'application/json',
        payload: JSON.stringify(payload),
        muteHttpExceptions: true,
      }
    );

    if (res.getResponseCode() !== 200) {
      Logger.log('normalizeReportWithAI: HTTP ' + res.getResponseCode());
      return text;
    }

    var json = JSON.parse(res.getContentText());
    var normalized = json.candidates &&
                     json.candidates[0] &&
                     json.candidates[0].content &&
                     json.candidates[0].content.parts &&
                     json.candidates[0].content.parts[0] &&
                     json.candidates[0].content.parts[0].text;
    if (!normalized || normalized.trim().length === 0) return text;

    Logger.log('AI正規化前: ' + text.slice(0, 100));
    Logger.log('AI正規化後: ' + normalized.trim().slice(0, 100));
    return normalized.trim();

  } catch (e) {
    Logger.log('normalizeReportWithAI error: ' + e);
    return text;
  }
}

// ============================================================
//  複数現場対応パーサ
// ============================================================

/**
 * 1メッセージに複数現場が含まれる場合を分割してパースする。
 *
 * フォーマット例:
 *   11日
 *   ギフトサクラステージ   ← 現場①
 *   伊藤 0.8
 *   ジェイ 0.5
 *                          ← 空行で区切り
 *   BLH名古屋              ← 現場②
 *   片岡 1.0
 *   往復18km
 *
 * @returns {Array} parseDailyReport の結果の配列。1現場の場合も配列で返す。
 */
function parseMultipleReports(text) {
  const trimmed = text.trim();

  // 空行で分割してブロックに分ける（\r\n・スペースのみ行・連続空行に対応）
  const blocks = trimmed.split(/(?:\r?\n){2,}|\n[ \t]*\n/).map(b => b.trim()).filter(b => b.length > 0);

  if (blocks.length <= 1) {
    // 空行なし → 従来の1現場パース
    const parsed = parseDailyReport(trimmed);
    return parsed ? [parsed] : [];
  }

  // 先頭ブロックから日付を取得（全現場共通）
  const now = new Date();
  let sharedYear  = now.getFullYear();
  let sharedMonth = now.getMonth() + 1;
  let sharedDay   = null;

  const datePatterns = [
    /^(\d{4})[\/\-](\d{1,2})[\/\-](\d{1,2})/,  // YYYY/MM/DD
    /^(\d{1,2})月(\d{1,2})日/,                        // MM月DD日
    /^(\d{1,2})日/,                                    // DD日
  ];
  const firstLine = blocks[0].split('\n')[0].trim();
  for (const pat of datePatterns) {
    const m = firstLine.match(pat);
    if (m) {
      if (m.length === 4) { sharedYear = +m[1]; sharedMonth = +m[2]; sharedDay = +m[3]; }
      else if (m.length === 3) { sharedMonth = +m[1]; sharedDay = +m[2]; }
      else { sharedDay = +m[1]; }
      break;
    }
  }
  if (!sharedDay) sharedDay = now.getDate();

  const results = [];

  blocks.forEach(function(block) {
    const lines = block.split('\n').map(function(l) { return l.trim(); }).filter(Boolean);
    if (lines.length === 0) return;

    // このブロックに日付行があれば使う、なければ共有日付
    let blockYear  = sharedYear;
    let blockMonth = sharedMonth;
    let blockDay   = sharedDay;
    let lineStart  = 0;

    for (const pat of datePatterns) {
      const m = lines[0].match(pat);
      if (m) {
        if (m.length === 4) { blockYear = +m[1]; blockMonth = +m[2]; blockDay = +m[3]; }
        else if (m.length === 3) { blockMonth = +m[1]; blockDay = +m[2]; }
        else { blockDay = +m[1]; }
        lineStart = 1;
        break;
      }
    }

    // 現場名がない・無効なパターンはスキップ
    if (lineStart >= lines.length) return;
    const siteName = lines[lineStart];
    const INVALID_SITE_RE = [
      /^往復/, /km$/i, /キロ$/,
      /^(駐車場|高速|ガソリン|電車|ホテル|ゴミ|P代|Ｐ代)/i,
      /^(担当|報告)/,
      /^\d+(\.\d+)?$/,
      /^[\d.]+\s*日?$/,
      /^[^\d\s]+\s*[\d.]+$/,
      /^[^\d\s]+\s+[\d.]+$/,
    ];
    if (!siteName || INVALID_SITE_RE.some(p => p.test(siteName.trim()))) return;

    // 残りの行を日報テキストとして再構築して既存パーサに渡す
    const rebuiltText = blockYear + '/' + blockMonth + '/' + blockDay + '\n' + lines.slice(lineStart).join('\n');
    const parsed = parseDailyReport(rebuiltText);
    if (parsed) results.push(parsed);
  });

  return results;
}

// ============================================================
//  日報テキストのパーサ（拡張版）
// ============================================================
function parseDailyReport(text) {
  try {
    const lines = text.trim().split('\n').map(l => l.trim()).filter(l => l);
    if (lines.length < 2) return null;

    const now = new Date();
    let year = now.getFullYear();
    let month = now.getMonth() + 1;
    let day = null;
    let reporter = '';

    // 日付パース
    const datePatterns = [
      /^(\d{4})[\/\-](\d{1,2})[\/\-](\d{1,2})/,
      /^(\d{1,2})月(\d{1,2})日/,
      /^(\d{1,2})日/,
    ];
    let lineIdx = 0;
    for (const pat of datePatterns) {
      const m = lines[0].match(pat);
      if (m) {
        if (m.length === 4) { year = +m[1]; month = +m[2]; day = +m[3]; } // YYYY/MM/DD
        else if (m.length === 3) { month = +m[1]; day = +m[2]; }           // MM月DD日
        else { day = +m[1]; }                                               // DD日
        lineIdx = 1;
        break;
      }
    }
    if (!day) day = now.getDate();

    // 月またぎ対応: 日付が今日より大幅に未来なら先月のデータとみなす
    // 例: 今日が4/3で「31日」と送られてきたら3月31日と判断
    if (day > now.getDate() + 5 && month === now.getMonth() + 1) {
      month = month - 1;
      if (month === 0) { month = 12; year = year - 1; }
    }

    // 現場名の取得とバリデーション
    // 経費行・作業員行・数字のみ → 現場名ではないのでnullを返す
    const siteName = lines[lineIdx];
    lineIdx++;

    // 現場名として無効なパターンを弾く
    const INVALID_SITE_PATTERNS = [
      /^往復/,                          // 往復〇km
      /km$/i,                           // 〇km
      /キロ$/,                          // 〇キロ
      /^(駐車場|高速|ガソリン|電車|ホテル|ゴミ|P代|Ｐ代)/i, // 経費行
      /^(担当|報告)/,                   // 担当者行
      /^\d+(\.\d+)?$/,                  // 数字のみ
      /^[\d.]+\s*日?$/,                 // 〇日・〇.〇
      /^[^\d\s]+\s*[\d.]+$/,           // 作業員名+工数（例: 香田0.5）
      /^[^\d\s]+\s+[\d.]+$/,           // 作業員名 + 工数（例: 香田 0.5）
    ];
    if (!siteName || INVALID_SITE_PATTERNS.some(p => p.test(siteName.trim()))) {
      return null;
    }

    // 担当者（報告者）行のパース
    if (lineIdx < lines.length) {
      const repMatch = lines[lineIdx].match(/^担当[:：]\s*(.+)/);
      if (repMatch) {
        reporter = repMatch[1].trim();
        lineIdx++;
      }
    }

    const entries = [];
    const expenses = [];
    const settings = getSettings();

    for (let i = lineIdx; i < lines.length; i++) {
      const line = lines[i];

      // 走行距離（ガソリン）＋車両名対応
      // 「ハイエース 往復58km」「プロボックス 往復74km」→ 車両名＋km
      // 「往復58km」→ 車両名なし
      const vehicleKmMatch = line.match(/^([^\d\s]+)\s+往復\s*(\d+(\.\d+)?)\s*(km|キロ)/i);
      if (vehicleKmMatch) {
        const vehicleName = vehicleKmMatch[1];
        const km = parseFloat(vehicleKmMatch[2]);
        const amount = Math.round(km * settings.pricePerKm);
        expenses.push({ type: 'gasoline', label: `走行距離 往復${km}km`, km, amount, vehicleName });
        continue;
      }
      const kmMatch = line.match(/往復\s*(\d+(\.\d+)?)\s*(km|キロ)/i);
      if (kmMatch) {
        const km = parseFloat(kmMatch[1]);
        const amount = Math.round(km * settings.pricePerKm);
        expenses.push({ type: 'gasoline', label: `走行距離 往復${km}km`, km, amount });
        continue;
      }

      // 高速代
      const highwayMatch = line.match(/^高速[代]?\s+(\d+)/);
      if (highwayMatch) {
        expenses.push({ type: 'highway', label: '高速代', amount: +highwayMatch[1] });
        continue;
      }

      // 駐車場
      const parkingMatch = line.match(/^駐車場[代]?\s+(\d+)/);
      if (parkingMatch) {
        expenses.push({ type: 'parking', label: '駐車場', amount: +parkingMatch[1] });
        continue;
      }

      // 電車・交通費
      const trainMatch = line.match(/^(電車|交通費)[代]?\s+(\d+)/);
      if (trainMatch) {
        expenses.push({ type: 'train', label: trainMatch[1], amount: +trainMatch[2] });
        continue;
      }

      // ホテル・宿泊
      const hotelMatch = line.match(/^(ホテル|宿泊|レオパレス)[代]?\s+(\d+)/);
      if (hotelMatch) {
        expenses.push({ type: 'hotel', label: hotelMatch[1], amount: +hotelMatch[2] });
        continue;
      }

      // ゴミ
      const garbageMatch = line.match(/^ゴミ[（(]?(工場|現場)?[）)]?\s+(\d+)/);
      if (garbageMatch) {
        const gtype = garbageMatch[1] === '工場' ? 'garbage_factory' : 'garbage_site';
        expenses.push({ type: gtype, label: `ゴミ(${garbageMatch[1] || '現場'})`, amount: +garbageMatch[2] });
        continue;
      }

      // 下請け業者行（「下請け: 業者名 人数」形式）
      const subMatch = line.match(/^下請け[:：]\s*(.+?)\s+(\d+)$/);
      if (subMatch) {
        expenses.push({ type: 'subcontractor', label: subMatch[1].trim(), amount: +subMatch[2] });
        continue;
      }
      // 人数なし（1人）
      const subMatchNoNum = line.match(/^下請け[:：]\s*(.+)$/);
      if (subMatchNoNum) {
        expenses.push({ type: 'subcontractor', label: subMatchNoNum[1].trim(), amount: 1 });
        continue;
      }

      // 汎用経費行（ラベル + 金額）
      const expMatch = line.match(/^(.+?)\s+(\d{3,7})$/);
      if (expMatch && isNaN(expMatch[1].trim()) && !expMatch[1].match(/^[\d.]+$/)) {
        expenses.push({ type: 'other', label: expMatch[1].trim(), amount: +expMatch[2] });
        continue;
      }

      // ── 作業員行の解析（優先順位順）──

      // 1) 残業のみ
      const otMatch = line.match(/^([^\d\s]+)\s*残業のみ\s*([\d.]+)/);
      if (otMatch) {
        entries.push({ name: otMatch[1], days: 0, overtime125: 0, overtime150: parseFloat(otMatch[2]) });
        continue;
      }

      // 2) 自然な残業表記: 「片岡 1.0 残業2時間」「片岡1.0 残業2h」「片岡 1.0 OT2」
      //    ※ workerFullMatch より先にチェックしないとマッチされて無視される
      const naturalOtMatch = line.match(/^([^\d\s]+)\s*([\d.]+)\s+(?:残業|OT|ot)\s*([\d.]+)\s*(?:時間|h|H)?$/);
      if (naturalOtMatch) {
        const otHours = parseFloat(naturalOtMatch[3]);
        const otDays  = otHours / 8; // 8時間=1日換算で1.5倍扱い
        entries.push({
          name: naturalOtMatch[1],
          days: parseFloat(naturalOtMatch[2]),
          overtime125: 0,
          overtime150: otDays,
        });
        continue;
      }

      // 3) +1.25×・+1.5×形式の残業付き作業員
      // 例: 「片岡 1.0 +1.25×0.5 +1.5×1.0」「片岡1.0+1.5×1.0」
      const workerFullMatch = line.match(
        /^([^\d\s]+)\s*([\d.]+)(?:\s*[+＋]\s*1\.25[×x]([\d.]+))?(?:\s*[+＋]\s*1\.5[×x]([\d.]+))?$/
      );
      if (workerFullMatch && (workerFullMatch[3] || workerFullMatch[4])) {
        // 残業指定がある場合のみここで処理（ない場合はシンプル行として処理）
        entries.push({
          name: workerFullMatch[1],
          days: parseFloat(workerFullMatch[2]),
          overtime125: workerFullMatch[3] ? parseFloat(workerFullMatch[3]) : 0,
          overtime150: workerFullMatch[4] ? parseFloat(workerFullMatch[4]) : 0,
        });
        continue;
      }

      // 4) シンプルな作業員行（名前 + 日数のみ）スペースあり・なし両対応
      const simpleWorkerMatch = line.match(/^([^\d\s]+)\s*([\d.]+)$/);
      if (simpleWorkerMatch && !isNaN(simpleWorkerMatch[2])) {
        entries.push({
          name: simpleWorkerMatch[1],
          days: parseFloat(simpleWorkerMatch[2]),
          overtime125: 0,
          overtime150: 0,
        });
      }
    }

    return { year, month, day, siteName, reporter, entries, expenses };

  } catch (err) {
    Logger.log('parseDailyReport error: ' + err);
    return null;
  }
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
      sheet.getRange(matched.row, matched.daysCol).setValue(entry.days || '');
      if (entry.overtime125) sheet.getRange(matched.row, matched.daysCol + 1).setValue(entry.overtime125);
      if (entry.overtime150) sheet.getRange(matched.row, matched.daysCol + 2).setValue(entry.overtime150);
    } else {
      const emptyRow = findEmptyWorkerRow(sheet, blockCol, ROW_D);
      if (emptyRow) {
        const price = workerPrices[entry.name] || settings.defaultWorkerPrice;
        sheet.getRange(emptyRow, blockCol + COL.SITE_NAME).setValue(entry.name);
        sheet.getRange(emptyRow, blockCol + COL.SITE_PRICE).setValue(price);
        sheet.getRange(emptyRow, blockCol + COL.SITE_DAYS).setValue(entry.days || '');
        if (entry.overtime125) sheet.getRange(emptyRow, blockCol + COL.SITE_1_25).setValue(entry.overtime125);
        if (entry.overtime150) sheet.getRange(emptyRow, blockCol + COL.SITE_1_5).setValue(entry.overtime150);
        const pCell  = sheet.getRange(emptyRow, blockCol + COL.SITE_PRICE).getA1Notation();
        const dCell  = sheet.getRange(emptyRow, blockCol + COL.SITE_DAYS).getA1Notation();
        const o1Cell = sheet.getRange(emptyRow, blockCol + COL.SITE_1_25).getA1Notation();
        const o2Cell = sheet.getRange(emptyRow, blockCol + COL.SITE_1_5).getA1Notation();
        sheet.getRange(emptyRow, blockCol + COL.SITE_TOTAL).setFormula(
          `=IF(${dCell}="","",${pCell}*(${dCell}+IF(${o1Cell}="",0,${o1Cell}*1.25)+IF(${o2Cell}="",0,${o2Cell}*1.5)))`
        );
      }
    }
  });

  // ── 経費データ書き込み ──
  writeExpensesToBlock(sheet, blockCol, expenses, settings, ROW_D);
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
    var SUB_ROW_END   = 60;
    // 業者名は offset9・11・13 に固定、人数は offset10・12・14
    var NAME_OFFSETS = [9, 11, 13];
    var NUM_OFFSETS  = [10, 12, 14];

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
      return { row, daysCol: blockCol + COL.FACTORY_DAYS };
    }
    const siteVal = sheet.getRange(row, blockCol + COL.SITE_NAME).getValue();
    if (siteVal === workerName || normalizeName(String(siteVal)) === normalizedInput) {
      return { row, daysCol: blockCol + COL.SITE_DAYS };
    }
  }
  return null;
}

function findEmptyWorkerRow(sheet, blockCol, ROW_D) {
  const R = ROW_D || ROW_DEFAULT;
  // まずWORKER_START〜WORKER_ENDの範囲で探す
  for (let row = R.WORKER_START; row <= R.WORKER_END; row++) {
    if (!sheet.getRange(row, blockCol + COL.SITE_NAME).getValue()) return row;
  }
  // 範囲内に空きがない場合は最大30行まで延長して探す
  for (let row = R.WORKER_END + 1; row <= 30; row++) {
    const siteVal    = sheet.getRange(row, blockCol + COL.SITE_NAME).getValue();
    const factoryVal = sheet.getRange(row, blockCol + COL.FACTORY_NAME).getValue();
    if (!siteVal && !factoryVal) return row;
  }
  return null;
}

/**
 * 経費データをブロックの所定行に書き込む
 */
function writeExpensesToBlock(sheet, blockCol, expenses, settings, ROW_D) {
  // ROW_DEFAULT を必ずベースにして、ROW_D で上書きする（nullが混入しないよう保護）
  const R = Object.assign({}, ROW_DEFAULT, ROW_D || {});

  const AMT_COL = 1;  // 駐車場・高速代の金額列オフセット（ラベルの次列）
  const AMT_R   = 13; // 右側経費の金額列オフセット

  expenses.forEach(function(exp) {
    try {
      switch (exp.type) {
        case 'gasoline':
          // 行27（車両名）に車両名を書く（ある場合のみ）
          if (exp.vehicleName && R.VEHICLE1_NAME) {
            sheet.getRange(R.VEHICLE1_NAME, blockCol + 1).setValue(exp.vehicleName);
          }
          // 行28（1号車ガソリン入力欄）のoffset1にkm値を書く
          // 行47（ガソリン距離計）は数式（=C28+C33+C38+C43）で自動集計されるので書き込み不要
          if (R.GASOLINE1) {
            sheet.getRange(R.GASOLINE1, blockCol + 1).setValue(exp.km);
          }
          break;
        case 'highway':
          if (R.HIGHWAY1) sheet.getRange(R.HIGHWAY1, blockCol + AMT_COL).setValue(exp.amount);
          break;
        case 'parking':
          if (R.PARKING1) sheet.getRange(R.PARKING1, blockCol + AMT_COL).setValue(exp.amount);
          break;
        case 'train':
          if (R.ROW_TRAIN) sheet.getRange(R.ROW_TRAIN, blockCol + AMT_R).setValue(exp.amount);
          break;
        case 'hotel':
          if (R.ROW_HOTEL) sheet.getRange(R.ROW_HOTEL, blockCol + AMT_R).setValue(exp.amount);
          break;
        case 'garbage_factory':
          if (R.ROW_GARBAGE_FACTORY) sheet.getRange(R.ROW_GARBAGE_FACTORY, blockCol + AMT_R).setValue(exp.amount);
          break;
        case 'garbage_site':
          if (R.ROW_GARBAGE_SITE) sheet.getRange(R.ROW_GARBAGE_SITE, blockCol + AMT_R).setValue(exp.amount);
          break;
        case 'subcontractor':
          // 下請け業者の人数を該当業者の人数欄に書き込む
          writeSubcontractorCount(sheet, blockCol, exp.label, exp.amount);
          break;
        default:
          if (R.ROW_OTHER) sheet.getRange(R.ROW_OTHER, blockCol + AMT_R).setValue(exp.amount);
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
  const hotelTotal    = collectSumAcrossBlocks(sheet, ROW.VEHICLE1_NAME, RIGHT_COL.GARBAGE_F_AMT, numBlocks);
  const garbageTotal  = collectSumAcrossBlocks(sheet, ROW.GARBAGE_FACTORY, RIGHT_COL.GARBAGE_F_AMT, numBlocks)
                      + collectSumAcrossBlocks(sheet, ROW.GARBAGE_SITE, RIGHT_COL.GARBAGE_S_AMT, numBlocks);
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
 * 例: 14日 → 14日目ブロック → 開始列 = (14-1)*16 + 1 = 209列目
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

function getDayIndex(sheet, blockCol) {
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
  titleCell.setNote(dateStr).setValue(`${getDayIndex(sheet, startCol)}日目`)
    .setFontWeight('bold').setBackground('#4A90D9').setFontColor('#FFFFFF');

  // ── 4行目: 列ヘッダ ──
  sheet.getRange(ROW.HEADER, startCol, 1, DAY_BLOCK_COLS - 1).setValues([[
    '作業員', '工場・事務所作業員名', '単価', '工数(日)', '1.25', '1.5', '計', 'その他',
    '現場作業員名', '単価', '工数(日)', '1.25', '1.5', '計', 'その他',
  ]]).setFontWeight('bold').setBackground('#D3D1C7');

  // ── 作業員名と単価をプリセット（設定シートから） ──
  // 工場側：前半の作業員
  const factoryWorkers = workerNames.slice(0, 14);
  const siteWorkers    = workerNames.slice(14, 34);

  factoryWorkers.forEach((name, i) => {
    const row = ROW.WORKER_START + i;
    sheet.getRange(row, startCol + COL.FACTORY_NAME).setValue(name);
    sheet.getRange(row, startCol + COL.FACTORY_PRICE).setValue(workerPrices[name]);
    // 計の数式
    const pCell = sheet.getRange(row, startCol + COL.FACTORY_PRICE).getA1Notation();
    const dCell = sheet.getRange(row, startCol + COL.FACTORY_DAYS).getA1Notation();
    const o1Cell = sheet.getRange(row, startCol + COL.FACTORY_1_25).getA1Notation();
    const o2Cell = sheet.getRange(row, startCol + COL.FACTORY_1_5).getA1Notation();
    sheet.getRange(row, startCol + COL.FACTORY_TOTAL).setFormula(
      `=IF(${dCell}="","",${pCell}*(${dCell}+IF(${o1Cell}="",0,${o1Cell}*1.25)+IF(${o2Cell}="",0,${o2Cell}*1.5)))`
    );
    sheet.getRange(row, startCol + COL.FACTORY_TOTAL).setNumberFormat('#,##0');
  });

  siteWorkers.forEach((name, i) => {
    const row = ROW.WORKER_START + i;
    sheet.getRange(row, startCol + COL.SITE_NAME).setValue(name);
    sheet.getRange(row, startCol + COL.SITE_PRICE).setValue(workerPrices[name]);
    const pCell  = sheet.getRange(row, startCol + COL.SITE_PRICE).getA1Notation();
    const dCell  = sheet.getRange(row, startCol + COL.SITE_DAYS).getA1Notation();
    const o1Cell = sheet.getRange(row, startCol + COL.SITE_1_25).getA1Notation();
    const o2Cell = sheet.getRange(row, startCol + COL.SITE_1_5).getA1Notation();
    sheet.getRange(row, startCol + COL.SITE_TOTAL).setFormula(
      `=IF(${dCell}="","",${pCell}*(${dCell}+IF(${o1Cell}="",0,${o1Cell}*1.25)+IF(${o2Cell}="",0,${o2Cell}*1.5)))`
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
    [ROW.GARBAGE_FACTORY, 'ゴミ工場'],
    [ROW.GARBAGE_SITE,  'ゴミ現場'],
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
  sheet.getRange(ROW.VEHICLE1_NAME, startCol + RIGHT_COL.HOTEL).setValue('ホテル');
  sheet.getRange(ROW.GASOLINE1,     startCol + RIGHT_COL.LEOPALACE).setValue('レオパレス等');
  sheet.getRange(ROW.PARKING1,      startCol + RIGHT_COL.GARBAGE_FACTORY).setValue('ゴミ（工場');
  sheet.getRange(ROW.HIGHWAY1,      startCol + RIGHT_COL.GARBAGE_SITE_L).setValue('ゴミ（現場');
  sheet.getRange(ROW.DIESEL1,       startCol + RIGHT_COL.TRAIN_NAME).setValue('電車');
  sheet.getRange(ROW.VEHICLE2_NAME, startCol + RIGHT_COL.OTHER_NAME).setValue('その他（資材等');
  sheet.getRange(ROW.VEHICLE3_NAME, startCol + RIGHT_COL.ENTERTAINMENT_N).setValue('接待費');

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
    if (files.hasNext()) return SpreadsheetApp.open(files.next());
  }

  // Drive全体を検索（サブフォルダ対応）
  for (const name of patterns) {
    const allFiles = DriveApp.searchFiles(`title = "${name}" and trashed = false`);
    if (allFiles.hasNext()) return SpreadsheetApp.open(allFiles.next());
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

  // ③ 学習済みマッピングを参照（ユーザーが過去にFlexボタンで選択した対応を記憶）
  const mapped = getSiteNameMapping(siteName);
  if (mapped) {
    const mappedSheet = ss.getSheetByName(mapped);
    if (mappedSheet) {
      Logger.log('現場名マッピング適用: "' + siteName + '" → "' + mapped + '"');
      return mappedSheet;
    }
  }

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

function saveFileToDrive(blob, mimeType, siteName, year, month) {
  const folder = createSiteDriveFolder(siteName, year, month);
  const fileName = `invoice_${Utilities.formatDate(new Date(), 'Asia/Tokyo', 'yyyyMMdd_HHmmss')}`;
  return folder.createFile(blob.setName(fileName)).getUrl();
}


// ============================================================
//  Googleフォーム送信トリガー（請求書）
// ============================================================
function onFormSubmit(e) {
  try {
    const response = e.response;
    const itemResps = response.getItemResponses();
    let uploaderName = '';
    let fileIds = [];

    itemResps.forEach(itemResp => {
      const title = itemResp.getItem().getTitle();
      const value = itemResp.getResponse();
      if (title.includes('会社名') || title.includes('送信者')) {
        uploaderName = value;
      } else if (title.includes('請求書') || title.includes('ファイル')) {
        if (Array.isArray(value)) {
          fileIds = value.map(url => extractFileIdFromUrl(url));
        } else {
          fileIds = [extractFileIdFromUrl(value)];
        }
      }
    });

    if (fileIds.length === 0) return;

    fileIds.forEach(fileId => {
      if (!fileId) return;
      let fileName = fileId;
      try {
        const file = DriveApp.getFileById(fileId);
        fileName = cleanFileName(file.getName());
        const mimeType = file.getMimeType();

        // ── Gemini解析（1回だけ） ──
        const invoiceList = parseInvoiceWithGeminiDirect(file, mimeType);
        if (!invoiceList || invoiceList.length === 0) {
          sendInvoiceNotification(uploaderName, fileName, fileId, [], [], ['PDFの読み取りができませんでした。手動で台帳に入力してください。']);
          return;
        }

        // ── Drive保存（1回だけ・専用フォルダへ） ──
        const now = new Date();
        const inboxFolder = getOrCreateInboxFolder(now.getFullYear(), now.getMonth() + 1);
        const savedFile = file.makeCopy(fileName, inboxFolder);
        const driveUrl = savedFile.getUrl();

        // ── 各現場シートへの転記（複数現場でも請求書は1枚） ──
        const ss = getMonthlySpreadsheet(now.getFullYear(), now.getMonth() + 1);
        const successSites = [];   // { siteName, amount, date }
        const failedSites  = [];   // { siteName, candidates, fileId }

        invoiceList.forEach(invoiceData => {
          try {
            const sheet = getCaseSheet(ss, invoiceData.siteName);
            appendInvoiceRow(sheet, invoiceData, uploaderName);
            successSites.push({
              siteName: invoiceData.siteName,
              amount:   invoiceData.totalAmount,
              date:     invoiceData.date,
            });
          } catch (siteErr) {
            const errMsg = siteErr.message || siteErr.toString();
            failedSites.push({
              siteName:   invoiceData.siteName,
              candidates: extractCandidates(errMsg),
              fileId:     fileId,
              driveUrl:   driveUrl || '',
            });
          }
        });

        // ── まとめてLINE通知（1通） ──
        sendInvoiceNotification(uploaderName, fileName, fileId, successSites, failedSites, [], driveUrl);

      } catch (fileErr) {
        const errMsg = fileErr.message || fileErr.toString();
        sendInvoiceNotification(uploaderName, fileName, fileId, [], [], [formatErrorForLine(errMsg)]);
      }
    });

  } catch (err) {
    Logger.log('onFormSubmit error: ' + err.toString());
  }
}

/**
 * 「受信済み請求書/YYYY-MM」フォルダを取得または作成する
 */
function getOrCreateInboxFolder(year, month) {
  const root = DriveApp.getFolderById(CONFIG.DRIVE_ROOT_FOLDER_ID);
  const inboxName = '受信済み請求書';
  const monthName = year + '-' + String(month).padStart(2, '0');

  // 受信済み請求書フォルダ
  let inbox;
  const inboxIter = root.getFoldersByName(inboxName);
  inbox = inboxIter.hasNext() ? inboxIter.next() : root.createFolder(inboxName);

  // 月別サブフォルダ
  const monthIter = inbox.getFoldersByName(monthName);
  return monthIter.hasNext() ? monthIter.next() : inbox.createFolder(monthName);
}

/**
 * 請求書処理結果をまとめてLINE通知する（1枚の請求書につき1通）
 * @param {string}   uploaderName
 * @param {string}   fileName       クリーニング済みファイル名
 * @param {string}   fileId         元ファイルID（未登録現場の再試行用）
 * @param {Array}    successSites   登録成功した現場リスト
 * @param {Array}    failedSites    現場名が見つからなかったリスト
 * @param {string[]} errors         その他エラーメッセージ
 * @param {string}   [driveUrl]     Drive保存先URL
 */
function sendInvoiceNotification(uploaderName, fileName, fileId, successSites, failedSites, errors, driveUrl) {
  try {
    const messages = [];

    // ── 1通目: 登録結果サマリ（テキスト） ──
    let text = '📬 請求書が届きました！\n';
    text += '送信者: ' + (uploaderName || '不明') + '\n';
    text += '📄 ' + fileName + '\n';
    if (driveUrl) text += '🔗 ' + driveUrl + '\n';

    if (successSites.length > 0) {
      text += '\n✅ 登録完了（' + successSites.length + '現場）\n';
      successSites.forEach(s => {
        text += '  📍 ' + s.siteName + '：¥' + s.amount.toLocaleString() + '（' + s.date + '）\n';
      });
    }

    if (failedSites.length > 0) {
      text += '\n⚠️ 要確認（' + failedSites.length + '現場）\n';
      failedSites.forEach(s => {
        text += '  「' + s.siteName + '」が見つかりません\n';
      });
      text += '下のボタンから現場を選択してください';
    }

    if (errors.length > 0) {
      text += '\n❌ エラー\n';
      errors.forEach(e => { text += '  ' + e + '\n'; });
      text += '台帳への記入は手動でお願いします';
    }

    messages.push({ type: 'text', text });

    // ── 2通目以降: 現場不明の場合のみFlex Message ──
    // 同じ現場名が複数明細にある場合は1枚にまとめる
    var seen = {};
    failedSites.forEach(function(s) {
      if (seen[s.siteName]) return;
      seen[s.siteName] = true;
      messages.push(buildSiteSelectFlex(uploaderName, {
        fileName:   fileName,
        siteName:   s.siteName,
        candidates: s.candidates,
        fileId:     s.fileId,
        driveUrl:   s.driveUrl || '',
      }));
    });

    if (messages.length === 0) return;
    const limited = messages.slice(0, 5);
    if (CONFIG.LINE_PUSH_USER_ID) pushLineMessages(CONFIG.LINE_PUSH_USER_ID, limited);
    (CONFIG.NOTIFY_GROUP_IDS || []).forEach(id => pushLineMessages(id, limited));

  } catch (err) {
    Logger.log('sendInvoiceNotification error: ' + err);
  }
}

/**
 * 請求書データを現場シートのまとめ商社欄に追記
 */
function appendInvoiceRow(sheet, invoiceData, uploaderName) {
  // まとめセクション下の商社欄へ追記
  const detailRow = findNextDetailRow(sheet);
  sheet.getRange(detailRow, 1, 1, 4).setValues([[
    uploaderName || '',
    invoiceData.totalAmount,
    invoiceData.date,
    invoiceData.workContent || '',
  ]]);
}

function findNextDetailRow(sheet) {
  const lastRow = sheet.getLastRow();
  for (let r = ROW.DETAIL_START; r <= lastRow + 1; r++) {
    if (!sheet.getRange(r, 1).getValue()) return r;
  }
  return lastRow + 1;
}


// ============================================================
//  Gemini 請求書解析
// ============================================================
function parseInvoiceWithGeminiDirect(file, mimeType) {
  try {
    const now = new Date();
    const blob = file.getBlob();
    const base64 = Utilities.base64Encode(blob.getBytes());
    const supportedTypes = ['application/pdf', 'image/jpeg', 'image/png', 'image/webp', 'image/heic'];
    if (!supportedTypes.includes(mimeType)) return null;

    const prompt =
      'この請求書から明細情報を読み取り、JSONのみ返してください。\n' +
      '前置き・説明・コードブロック（```）は一切不要です。\n\n' +
      '出力形式：\n' +
      '[{"date":"YYYY/MM/DD","siteName":"現場名","workContent":"工事内容","amount":金額の数値}]\n\n' +
      'ルール：\n' +
      '- 令和n年 = 西暦(2018+n)年として日付を補完\n' +
      '- 値引き行（▲や「値引」）は除外\n' +
      '- 合計・小計・消費税・ヘッダ行は除外\n' +
      '- 現場名が空の行は直前の現場名を引き継ぐ\n' +
      '- 金額は税抜き金額を使用';

    const payload = {
      contents: [{ parts: [
        { inline_data: { mime_type: mimeType, data: base64 } },
        { text: prompt }
      ]}],
      generationConfig: { temperature: 0 },
    };

    const res = UrlFetchApp.fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${CONFIG.GEMINI_API_KEY}`,
      { method: 'post', contentType: 'application/json', payload: JSON.stringify(payload), muteHttpExceptions: true }
    );

    if (res.getResponseCode() !== 200) return null;

    const json = JSON.parse(res.getContentText());
    const rawAnswer = json.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!rawAnswer) return null;

    const jsonStr = rawAnswer.replace(/```json/g, '').replace(/```/g, '').trim();
    const arrayMatch = jsonStr.match(/\[[\s\S]*\]/);
    if (!arrayMatch) return null;

    const parsed = JSON.parse(arrayMatch[0]);
    return parsed.map(row => ({
      siteName: row.siteName || '未分類',
      totalAmount: row.amount || 0,
      date: row.date || Utilities.formatDate(now, 'Asia/Tokyo', 'yyyy/MM/dd'),
      workContent: row.workContent || '',
    }));
  } catch (err) {
    Logger.log('parseInvoiceWithGeminiDirect error: ' + err);
    return null;
  }
}


// ============================================================
//  LINE 送受信
// ============================================================
function replyLine(replyToken, message) {
  replyLineMessages(replyToken, [{ type: 'text', text: message }]);
}

function replyLineMessages(replyToken, messages) {
  try {
    UrlFetchApp.fetch('https://api.line.me/v2/bot/message/reply', {
      method: 'post',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${CONFIG.LINE_CHANNEL_ACCESS_TOKEN}` },
      payload: JSON.stringify({ replyToken, messages: messages.slice(0, 5) }),
    });
  } catch (err) { Logger.log('replyLine error: ' + err); }
}

function sendLinePushNotification(uploaderName, results) {
  try {
    const successList      = results.filter(r => r.status === '成功');
    const siteNotFoundList = results.filter(r => r.status === 'site_not_found');
    const otherFailList    = results.filter(r => r.status !== '成功' && r.status !== 'site_not_found');

    const messages = [];

    // ── 登録完了メッセージ（テキスト） ──
    if (successList.length > 0) {
      let text = `📬 請求書が届きました！\n送信者: ${uploaderName || '不明'}\n\n✅ 自動登録完了（${successList.length}件）`;
      successList.forEach(r => {
        text += `\n\n📄 ${r.fileName}`;
        r.sites.forEach(s => {
          text += `\n  📍 ${s.label}`;
        });
      });
      messages.push({ type: 'text', text });
    }

    // ── 現場名が見つからない → Flex Messageでボタン表示 ──
    siteNotFoundList.forEach(r => {
      const flexMsg = buildSiteSelectFlex(uploaderName, r);
      messages.push(flexMsg);
    });

    // ── その他エラー（テキスト） ──
    if (otherFailList.length > 0) {
      let text = `⚠️ 手動確認をお願いします（${otherFailList.length}件）`;
      otherFailList.forEach(r => {
        text += `\n\n📄 ${r.fileName}\n  → ${r.status}`;
      });
      text += '\n\n台帳への記入は手動でお願いします';
      messages.push({ type: 'text', text });
    }

    // 何もなければ終了
    if (messages.length === 0) return;

    // 最大5件まで（LINE制限）
    const limitedMessages = messages.slice(0, 5);
    if (CONFIG.LINE_PUSH_USER_ID) pushLineMessages(CONFIG.LINE_PUSH_USER_ID, limitedMessages);
    (CONFIG.NOTIFY_GROUP_IDS || []).forEach(id => pushLineMessages(id, limitedMessages));

  } catch (err) { Logger.log('sendLinePushNotification error: ' + err); }
}

/**
 * 現場名が見つからない場合のFlex Message（候補ボタン付き）
 */
function buildSiteSelectFlex(uploaderName, r) {
  const candidateButtons = (r.candidates || []).map(candidateName => ({
    type: 'button',
    style: 'primary',
    color: '#2C7BB6',
    action: {
      type: 'postback',
      label: candidateName.length > 20 ? candidateName.slice(0, 20) + '…' : candidateName,
      data: JSON.stringify({
        action: 'register_invoice',
        fileId:   r.fileId,
        siteName: candidateName,
        uploader: uploaderName || '',
        driveUrl: r.driveUrl || '',
      }),
      displayText: `「${candidateName}」として登録`,
    },
  }));

  // 手動対応ボタン（請求書：postbackで情報を保存）
  candidateButtons.push({
    type: 'button',
    style: 'secondary',
    action: {
      type: 'postback',
      label: '手動で対応する',
      displayText: '「' + r.siteName + '」は手動で対応します',
      data: JSON.stringify({
        action: 'manual_todo_add',
        siteName: r.siteName,
        date: '',
        workers: [],
        expenses: r.fileName ? ['📄 ' + r.fileName] : [],
      }),
    },
  });

  return {
    type: 'flex',
    altText: `⚠️ 現場「${r.siteName}」が見つかりません - 候補を選択してください`,
    contents: {
      type: 'bubble',
      header: {
        type: 'box', layout: 'vertical',
        backgroundColor: '#E67E22',
        contents: [{
          type: 'text', text: '⚠️ 現場名の確認', color: '#FFFFFF',
          weight: 'bold', size: 'md',
        }],
      },
      body: {
        type: 'box', layout: 'vertical', spacing: 'sm',
        contents: [
          { type: 'text', text: `送信者: ${uploaderName || '不明'}`, size: 'sm', color: '#555555' },
          { type: 'text', text: `📄 ${r.fileName}`, size: 'sm', wrap: true },
          ...(r.driveUrl ? [{
            type: 'button', style: 'link', height: 'sm',
            action: { type: 'uri', label: '📂 請求書を開く', uri: r.driveUrl },
          }] : []),
          { type: 'separator', margin: 'md' },
          { type: 'text', text: `「${r.siteName}」`, weight: 'bold', size: 'md', wrap: true, color: '#C0392B' },
          { type: 'text', text: 'この現場名が台帳に見つかりませんでした。', size: 'sm', wrap: true, color: '#555555' },
          ...(r.candidates && r.candidates.length > 0 ? [
            { type: 'separator', margin: 'md' },
            { type: 'text', text: 'もしかして？', size: 'sm', weight: 'bold', color: '#2C7BB6' },
          ] : []),
        ],
      },
      footer: {
        type: 'box', layout: 'vertical', spacing: 'sm',
        contents: candidateButtons,
      },
    },
  };

}
/**
 * 日報の現場名が見つからない場合のFlex Message（候補ボタン付き）
 */
function buildReportSiteSelectFlex(parsed, originalText, candidates) {
  const candidateButtons = candidates.map(function(candidateName) {
    return {
      type: 'button',
      style: 'primary',
      color: '#2C7BB6',
      action: {
        type: 'postback',
        label: candidateName.length > 20 ? candidateName.slice(0, 20) + '…' : candidateName,
        data: JSON.stringify({
          action: 'report_with_site',
          siteName: candidateName,
          originalSiteName: parsed.siteName, // 元の（見つからなかった）現場名
          originalText: originalText,
        }),
        displayText: '「' + candidateName + '」として登録',
      },
    };
  });

  // 手動対応ボタン（日報：postbackで作業員・経費情報を保存）
  var workerLines = (parsed.entries || []).map(function(e) {
    var s = e.name + ' ' + e.days + '日';
    if (e.overtime150) s += ' 残業' + (e.overtime150 * 8) + 'h';
    return s;
  });
  var expenseLines = (parsed.expenses || []).map(function(ex) {
    return ex.label + ' ¥' + ex.amount.toLocaleString();
  });
  candidateButtons.push({
    type: 'button',
    style: 'secondary',
    action: {
      type: 'postback',
      label: '手動で対応する',
      displayText: '「' + parsed.siteName + '」は手動で対応します',
      data: JSON.stringify({
        action: 'manual_todo_add',
        siteName: parsed.siteName,
        date: parsed.month + '/' + parsed.day,
        workers: workerLines,
        expenses: expenseLines,
      }),
    },
  });

  return {
    type: 'flex',
    altText: '⚠️ 現場「' + parsed.siteName + '」が見つかりません',
    contents: {
      type: 'bubble',
      header: {
        type: 'box', layout: 'vertical',
        backgroundColor: '#E67E22',
        contents: [{ type: 'text', text: '⚠️ 現場名の確認', color: '#FFFFFF', weight: 'bold', size: 'md' }],
      },
      body: {
        type: 'box', layout: 'vertical', spacing: 'sm',
        contents: (function() {
          var rows = [
            { type: 'text', text: parsed.month + '/' + parsed.day + ' の日報', size: 'sm', color: '#555555' },
            { type: 'separator', margin: 'md' },
            { type: 'text', text: '「' + parsed.siteName + '」', weight: 'bold', size: 'md', wrap: true, color: '#C0392B' },
            { type: 'text', text: 'この現場名が台帳に見つかりませんでした。', size: 'sm', wrap: true, color: '#555555' },
          ];
          // 作業員一覧
          if (parsed.entries && parsed.entries.length > 0) {
            rows.push({ type: 'separator', margin: 'md' });
            rows.push({ type: 'text', text: '👷 作業員', size: 'sm', weight: 'bold', color: '#1E293B' });
            parsed.entries.forEach(function(e) {
              var label = e.name + '　' + e.days + '日';
              if (e.overtime150) label += '　残業' + (e.overtime150 * 8) + 'h';
              rows.push({ type: 'text', text: label, size: 'sm', color: '#334155', margin: 'xs' });
            });
          }
          // 経費一覧
          if (parsed.expenses && parsed.expenses.length > 0) {
            rows.push({ type: 'separator', margin: 'md' });
            rows.push({ type: 'text', text: '💴 経費', size: 'sm', weight: 'bold', color: '#1E293B' });
            parsed.expenses.forEach(function(ex) {
              rows.push({ type: 'text', text: ex.label + '　¥' + ex.amount.toLocaleString(), size: 'sm', color: '#334155', margin: 'xs' });
            });
          }
          // 候補ヘッダ
          if (candidates.length > 0) {
            rows.push({ type: 'separator', margin: 'md' });
            rows.push({ type: 'text', text: 'もしかして？', size: 'sm', weight: 'bold', color: '#2C7BB6' });
          }
          return rows;
        })(),
      },
      footer: {
        type: 'box', layout: 'vertical', spacing: 'sm',
        contents: candidateButtons,
      },
    },
  };
}


/**
 * 二重送信確認用のFlex Message（上書きボタン付き）
 */
function buildOverwriteFlex(parsed, existing) {
  return {
    type: 'flex',
    altText: `⚠️ ${parsed.siteName} ${parsed.day}日目にデータがあります`,
    contents: {
      type: 'bubble',
      header: {
        type: 'box', layout: 'vertical',
        backgroundColor: '#E67E22',
        contents: [{ type: 'text', text: '⚠️ データが既にあります', color: '#FFFFFF', weight: 'bold', size: 'md' }],
      },
      body: {
        type: 'box', layout: 'vertical', spacing: 'sm',
        contents: [
          { type: 'text', text: `📍 ${parsed.siteName}　${parsed.month}/${parsed.day}`, weight: 'bold', size: 'md' },
          { type: 'separator', margin: 'md' },
          { type: 'text', text: '【登録済みデータ】', size: 'sm', weight: 'bold', color: '#555555' },
          ...existing.split('\n').map(line => ({
            type: 'text', text: line, size: 'sm', color: '#333333', wrap: true,
          })),
          { type: 'separator', margin: 'md' },
          { type: 'text', text: '上書きしますか？', size: 'sm', color: '#555555' },
        ],
      },
      footer: {
        type: 'box', layout: 'vertical', spacing: 'sm',
        contents: [
          {
            type: 'button', style: 'primary', color: '#C0392B',
            action: {
              type: 'postback',
              label: '🔄 上書きする',
              data: JSON.stringify({
                action: 'overwrite_report',
                originalText: (function() {
                  var lines = [parsed.day + '日', parsed.siteName];
                  // 作業員（残業も含める）
                  parsed.entries.forEach(function(e) {
                    var line = e.name + ' ' + e.days;
                    if (e.overtime150) line += ' 残業' + (e.overtime150 * 8) + '時間';
                    if (e.overtime125) line += ' +1.25×' + e.overtime125;
                    lines.push(line);
                  });
                  // 経費（ガソリン・駐車場・高速等）
                  parsed.expenses.forEach(function(ex) {
                    if (ex.type === 'gasoline') {
                      lines.push((ex.vehicleName ? ex.vehicleName + ' ' : '') + '往復' + ex.km + 'km');
                    } else if (ex.type === 'parking') {
                      lines.push('駐車場代 ' + ex.amount);
                    } else if (ex.type === 'highway') {
                      lines.push('高速代 ' + ex.amount);
                    } else if (ex.type === 'train') {
                      lines.push('電車 ' + ex.amount);
                    } else if (ex.type === 'hotel') {
                      lines.push('ホテル ' + ex.amount);
                    } else if (ex.type === 'garbage_factory') {
                      lines.push('ゴミ（工場） ' + ex.amount);
                    } else if (ex.type === 'garbage_site') {
                      lines.push('ゴミ（現場） ' + ex.amount);
                    } else {
                      lines.push(ex.label + ' ' + ex.amount);
                    }
                  });
                  return lines.join('\n');
                })(),
              }),
              displayText: '上書きして登録します',
            },
          },
          {
            type: 'button', style: 'secondary',
            action: { type: 'message', label: 'キャンセル', text: 'キャンセルします' },
          },
        ],
      },
    },
  };
}

/**
 * エラーメッセージから現場名候補リストを抽出する
 */
function extractCandidates(errMsg) {
  const idx = errMsg.indexOf('【もしかして？】');
  if (idx === -1) return [];
  return errMsg.slice(idx + 8).trim().split('\n')
    .map(s => s.replace(/^\d+\.\s*/, '').trim())
    .filter(Boolean);
}

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

/**
 * システムエラーメッセージをLINE通知用の人が読める文言に変換する
 */
function formatErrorForLine(errMsg) {
  // 現場が見つからない
  var siteMatch = errMsg.match(/現場「(.+?)」が見つかりません/);
  if (siteMatch) {
    var siteName = siteMatch[1];
    var candIdx = errMsg.indexOf('【もしかして？】');
    var candidates = candIdx !== -1
      ? errMsg.slice(candIdx + 8).trim().split('\n').map(function(s){ return s.replace(/^\d+\.\s*/, ''); }).filter(Boolean).join(' / ')
      : '台帳のシート名を確認してください';
    return '現場名「' + siteName + '」が台帳に見つかりませんでした。\n候補: ' + candidates;
  }

  // スプシが見つからない
  if (errMsg.indexOf('がDriveに見つかりません') !== -1) {
    return '台帳ファイルが見つかりませんでした。月初めのアップロードを確認してください。';
  }

  // 解析失敗
  if (errMsg.indexOf('解析失敗') !== -1 || !errMsg) {
    return 'PDFの読み取りができませんでした。画質・形式を確認して再送してください。';
  }

  // その他
  return '処理中にエラーが発生しました。内容を確認して再送してください。';
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

function fetchLineContent(messageId) {
  const res = UrlFetchApp.fetch(
    `https://api-data.line.me/v2/bot/message/${messageId}/content`,
    { headers: { 'Authorization': `Bearer ${CONFIG.LINE_CHANNEL_ACCESS_TOKEN}` } }
  );
  return res.getBlob();
}

function handleLineFileMessage(messageId, fileNameOrType, replyTo) {
  try {
    const blob = fetchLineContent(messageId);
    const isPdf = (typeof fileNameOrType === 'string' && fileNameOrType.toLowerCase().endsWith('.pdf'));
    const mimeType = isPdf ? 'application/pdf' : 'image/jpeg';
    const now = new Date();
    saveFileToDrive(blob, mimeType, '未分類_請求書確認待ち', now.getFullYear(), now.getMonth() + 1);
    replyLine(replyTo,
      `📎 ${isPdf ? 'PDF' : '画像'}を受け取りました！\n✅ Driveの「未分類_請求書確認待ち」フォルダに保存しました。\n\n📝 請求書はGoogleフォームから送っていただくと自動登録されます。`
    );
  } catch (e) {
    replyLine(replyTo, '❌ ファイル保存でエラーが発生しました: ' + e.toString());
  }
}


// ============================================================
//  セットアップ・トリガー
// ============================================================
function setupInvoiceForm() {
  const file = DriveApp.getFolderById(CONFIG.DRIVE_ROOT_FOLDER_ID)
    .createFile(Utilities.newBlob('', 'application/vnd.google-apps.form', '請求書送付フォーム'));
  const form = FormApp.openById(file.getId());
  form.setDescription('請求書をこちらのフォームからお送りください。自動で台帳に登録されます。');
  form.setCollectEmail(true);
  form.addTextItem().setTitle('会社名・送信者名').setRequired(true);
  form.addFileUploadItem().setTitle('請求書ファイル（PDF・画像）').setRequired(true);
  form.addParagraphTextItem().setTitle('備考・メモ（任意）').setRequired(false);
  Logger.log('✅ フォーム作成完了: ' + form.getPublishedUrl());
  Logger.log('フォームID: ' + form.getId());
}

function setupFormTrigger() {
  ScriptApp.getProjectTriggers().forEach(t => {
    if (t.getHandlerFunction() === 'onFormSubmit') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('onFormSubmit')
    .forForm(FormApp.openById(CONFIG.FORM_ID))
    .onFormSubmit().create();
  Logger.log('✅ フォームトリガー設定完了');
}

function createNextMonthFile() {
  const now = new Date();
  const next = new Date(now.getFullYear(), now.getMonth() + 1, 1);
  getOrCreateMonthlySpreadsheet(next.getFullYear(), next.getMonth() + 1);
  Logger.log('翌月ファイル作成完了');
}


// ============================================================
//  翌日サマリ通知
//  日報登録をサイレントにして、翌日正午にまとめて通知する
// ============================================================

var DAILY_LOG_KEY = 'daily_report_log';

/**
 * 日報登録をPropertiesに記録する（翌日サマリ用）
 */
function saveDailyReportLog(parsed) {
  try {
    var props = PropertiesService.getScriptProperties();
    var raw = props.getProperty(DAILY_LOG_KEY);
    var logs = raw ? JSON.parse(raw) : [];

    var today = Utilities.formatDate(new Date(), 'Asia/Tokyo', 'yyyy/MM/dd');
    var ws = (parsed.entries || []).map(function(e) {
      var s = e.name + ' ' + e.days + '日';
      if (e.overtime150) s += ' 残業' + (e.overtime150 * 8) + 'h';
      return s;
    });
    var es = (parsed.expenses || []).map(function(ex) { return ex.label; });

    logs.push({
      date:     today,
      siteName: parsed.siteName,
      day:      parsed.day,
      workers:  ws,
      expenses: es,
      savedAt:  Utilities.formatDate(new Date(), 'Asia/Tokyo', 'HH:mm'),
    });

    // 3日分を超えたら古いものを削除
    var threeDaysAgo = new Date();
    threeDaysAgo.setDate(threeDaysAgo.getDate() - 3);
    var cutoff = Utilities.formatDate(threeDaysAgo, 'Asia/Tokyo', 'yyyy/MM/dd');
    logs = logs.filter(function(l) { return l.date >= cutoff; });

    props.setProperty(DAILY_LOG_KEY, JSON.stringify(logs));
  } catch (e) {
    Logger.log('saveDailyReportLog error: ' + e);
  }
}

/**
 * 翌日正午に前日分の登録サマリをLINEに通知する
 * トリガー: setupDailySummaryTrigger() で毎日正午に設定
 */
function sendDailySummary() {
  try {
    var props = PropertiesService.getScriptProperties();
    var raw = props.getProperty(DAILY_LOG_KEY);
    var logs = raw ? JSON.parse(raw) : [];

    // 昨日の日付
    var yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    var yDate = Utilities.formatDate(yesterday, 'Asia/Tokyo', 'yyyy/MM/dd');
    var yLabel = Utilities.formatDate(yesterday, 'Asia/Tokyo', 'M/d');

    var yLogs = logs.filter(function(l) { return l.date === yDate; });

    if (yLogs.length === 0) {
      notifyAdmin('📋 ' + yLabel + ' の日報登録はありませんでした。');
      return;
    }

    // 現場ごとにまとめる
    var siteMap = {};
    yLogs.forEach(function(l) {
      if (!siteMap[l.siteName]) siteMap[l.siteName] = [];
      siteMap[l.siteName].push(l);
    });

    var lines = ['📋 ' + yLabel + ' の日報サマリ（' + Object.keys(siteMap).length + '現場）', '─────────────────'];

    Object.keys(siteMap).forEach(function(siteName) {
      var entries = siteMap[siteName];
      lines.push('');
      lines.push('📍 ' + siteName);
      entries.forEach(function(l) {
        if (l.workers.length > 0) lines.push('  👷 ' + l.workers.join(' / '));
        if (l.expenses.length > 0) lines.push('  💴 ' + l.expenses.join(' / '));
        lines.push('  （' + l.savedAt + ' 登録）');
      });
    });

    lines.push('');
    lines.push('─────────────────');
    lines.push('✅ 合計 ' + yLogs.length + '件 登録済み');

    notifyAdmin(lines.join('\n'));
    Logger.log('翌日サマリ送信完了: ' + yLabel);

  } catch (e) {
    Logger.log('sendDailySummary error: ' + e);
    notifyAdmin('❌ 日報サマリの送信でエラーが発生しました: ' + e.message);
  }
}

/**
 * 毎日正午に sendDailySummary を実行するトリガーを設定する
 * GASエディタで setupDailySummaryTrigger() を1回実行するだけでOK
 */
function setupDailySummaryTrigger() {
  // 既存トリガーを削除
  ScriptApp.getProjectTriggers().forEach(function(t) {
    if (t.getHandlerFunction() === 'sendDailySummary') ScriptApp.deleteTrigger(t);
  });
  // 毎日正午に実行
  ScriptApp.newTrigger('sendDailySummary')
    .timeBased()
    .everyDays(1)
    .atHour(12)
    .create();
  Logger.log('✅ 翌日サマリトリガー設定完了（毎日正午）');
}

/**
 * 5. 月初めリマインド通知（毎月1日に実行するトリガーに設定）
 * GASエディタ: setupMonthlyReminderTrigger() を1回実行してトリガー登録
 */
function sendMonthlyReminder() {
  const now   = new Date();
  const year  = now.getFullYear();
  const month = now.getMonth() + 1;
  const msg   =
    '📅 月初めのお知らせ\n\n' +
    year + '年' + month + '月の案件台帳をアップロードしてください。\n\n' +
    '【手順】\n' +
    '1. エクセル（' + year + '.' + month + '）をDriveにアップロード\n' +
    '2. ファイルを右クリック → アプリで開く → Googleスプレッドシート\n' +
    '3. ファイル → Googleスプレッドシートとして保存\n' +
    '4. ファイル名が「' + year + '.' + month + '」になっているか確認\n\n' +
    'アップロード後はLINEから日報を送信できるようになります。';

  notifyAdmin(msg);
  Logger.log('月初めリマインド送信完了');
}

function setupMonthlyReminderTrigger() {
  // 既存の同名トリガーを削除
  ScriptApp.getProjectTriggers().forEach(function(t) {
    if (t.getHandlerFunction() === 'sendMonthlyReminder') ScriptApp.deleteTrigger(t);
  });
  // 毎月1日 午前9時に実行
  ScriptApp.newTrigger('sendMonthlyReminder')
    .timeBased()
    .onMonthDay(1)
    .atHour(9)
    .create();
  Logger.log('✅ 月初めリマインドトリガー設定完了（毎月1日9時）');
}

/**
 * 3. 「現場一覧」コマンドの処理
 */
function handleSiteListCommand(replyTo) {
  try {
    const now = new Date();
    const ss  = getMonthlySpreadsheet(now.getFullYear(), now.getMonth() + 1);
    const excludeSheets = ['外注', '提出確認', '金額集計', '事務、工場、その他', '設定', '月次サマリ'];
    const sites = ss.getSheets()
      .map(function(s) { return s.getName().trim(); })
      .filter(function(n) {
        return n && !excludeSheets.includes(n) && !n.match(/^\s*\(\d+\)\s*$/);
      });

    if (sites.length === 0) {
      replyLine(replyTo, '現在登録されている現場はありません。');
      return;
    }

    const msg =
      '📋 今月の現場一覧（' + sites.length + '件）\n\n' +
      sites.map(function(s, i) { return (i + 1) + '. ' + s; }).join('\n') + '\n\n' +
      '日報を送る時はこの名前をそのまま使ってください。';

    replyLine(replyTo, msg);
  } catch (e) {
    replyLine(replyTo, '現場一覧の取得に失敗しました。\n' + e.message);
  }
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
//  ユーティリティ
// ============================================================
function extractFileIdFromUrl(url) {
  if (!url) return null;
  const match = url.match(/[-\w]{25,}/);
  return match ? match[0] : null;
}


// ============================================================
//  テスト関数
// ============================================================
function testDailyReport() {
  const sampleText = `14日\nBLH名古屋\n担当: 今井\n片岡 1.0\n往復18km\n駐車場代 1100`;
  const parsed = parseDailyReport(sampleText);
  Logger.log('パース結果: ' + JSON.stringify(parsed));
  const ss = getOrCreateMonthlySpreadsheet(new Date().getFullYear(), new Date().getMonth() + 1);
  const sheet = getOrCreateCaseSheet(ss, parsed.siteName);
  writeDayBlock(sheet, parsed);
  Logger.log('✅ テスト完了: ' + parsed.siteName);
}

function testMultipleReports() {
  const reports = [
    `11日\nギフトサクラステージ\n担当: 今井\n伊藤 0.8\nジェイ 0.5`,
    `11日\n北新宿製作\n担当: 今井\n伊藤 0.2 +1.5×3.5\n鵜飼 0\n電車 580`,
    `14日\nさぼてん豊田\n佐谷 1.0\n往復74km\n高速代 2440`,
    `14日\nBLH名古屋\n担当: 今井\n片岡 1.0\n往復18km\n駐車場代 1100`,
    `24日\n西新宿美容院\n毛利 1.0`,
  ];

  const ss = getOrCreateMonthlySpreadsheet(new Date().getFullYear(), new Date().getMonth() + 1);
  reports.forEach(r => {
    const parsed = parseDailyReport(r);
    if (!parsed) { Logger.log('パース失敗: ' + r); return; }
    const sheet = getOrCreateCaseSheet(ss, parsed.siteName);
    writeDayBlock(sheet, parsed);
    Logger.log('✅ 書き込み完了: ' + parsed.siteName);
  });
}


// ============================================================
//  テストスイート v2.1
//  GASエディタで各関数を選択して「実行」するだけでOK
//  結果はログ（表示 → ログ）で確認
// ============================================================

// ------------------------------------------------------------
//  【T01】パーサ単体テスト（スプシ不要・安全に実行可）
//  基本フォーマット・各経費・残業パターンを全網羅
// ------------------------------------------------------------
function testT01_parser() {
  const cases = [
    // ── 正常系 ──
    {
      label: 'T01-01 基本（作業員+ガソリン+駐車場）',
      input: '14日\nBLH名古屋\n片岡 1.0\n往復18km\n駐車場代 1100',
      expect: { day: 14, siteName: 'BLH名古屋', workers: 1, expenses: 2 },
    },
    {
      label: 'T01-02 担当者あり',
      input: '14日\nBLH名古屋\n担当: 今井\n片岡 1.0\n往復18km',
      expect: { day: 14, reporter: '今井', workers: 1, expenses: 1 },
    },
    {
      label: 'T01-03 複数作業員',
      input: '11日\nギフトサクラステージ\n伊藤 0.8\nジェイ 0.5\nWorker18 1.0',
      expect: { day: 11, workers: 3, expenses: 0 },
    },
    {
      label: 'T01-04 1.5倍残業',
      input: '11日\n北新宿製作\n伊藤 0.2 +1.5×3.5',
      expect: { day: 11, workers: 1, overtime150: 3.5 },
    },
    {
      label: 'T01-05 1.25倍残業',
      input: '20日\nサボテン\n毛利 1.0 +1.25×2.0',
      expect: { day: 20, workers: 1, overtime125: 2.0 },
    },
    {
      label: 'T01-06 高速代',
      input: '14日\nさぼてん豊田\n佐谷 1.0\n往復74km\n高速代 2440',
      expect: { day: 14, workers: 1, expenses: 2, hasHighway: true },
    },
    {
      label: 'T01-07 電車代',
      input: '11日\n北新宿製作\n鵜飼 1.0\n電車 580',
      expect: { day: 11, expenses: 1, expType: 'train' },
    },
    {
      label: 'T01-08 ホテル代',
      input: '3日\nWOOC月島\n今井 1.0\nホテル 8000',
      expect: { day: 3, expenses: 1, expType: 'hotel' },
    },
    {
      label: 'T01-09 ゴミ（工場）',
      input: '5日\nBLH名古屋\n野村 1.0\nゴミ（工場） 8000',
      expect: { day: 5, expenses: 1, expType: 'garbage_factory' },
    },
    {
      label: 'T01-10 ゴミ（現場）',
      input: '5日\nBLH名古屋\n野村 1.0\nゴミ（現場） 14000',
      expect: { day: 5, expenses: 1, expType: 'garbage_site' },
    },
    {
      label: 'T01-11 全部入り',
      input: '14日\nBLH名古屋\n担当: 今井\n片岡 1.0\n伊藤 0.5 +1.25×2.0 +1.5×1.0\n往復18km\n高速代 2440\n駐車場代 1100\n電車 580',
      expect: { day: 14, reporter: '今井', workers: 2, expenses: 4 },
    },
    // ── 日付形式バリエーション ──
    {
      label: 'T01-12 日付フォーマット YYYY/MM/DD',
      input: '2026/04/14\nBLH名古屋\n片岡 1.0',
      expect: { year: 2026, month: 4, day: 14, workers: 1 },
    },
    {
      label: 'T01-13 日付なし（当日扱い）',
      input: 'BLH名古屋\n片岡 1.0',
      expect: { workers: 1 },  // dayは当日の日付
    },
    // ── 残業自然表記 ──
    {
      label: 'T01-18 残業2時間（自然表記）',
      input: '14日\nBLH名古屋\n片岡 1.0 残業2時間',
      expect: { workers: 1, overtime150: 0.25 },  // 2時間/8時間=0.25日
    },
    {
      label: 'T01-19 残業2h（英字表記）',
      input: '14日\nBLH名古屋\n片岡 1.0 残業2h',
      expect: { workers: 1, overtime150: 0.25 },
    },
    {
      label: 'T01-20 月またぎ（4/3に31日と送信→3月扱い）',
      input: '31日\nBLH名古屋\n片岡 1.0',
      expect: { workers: 1 },  // dayは31、monthは前月になる
    },
    // ── 正規化系 ──
    {
      label: 'T01-16 全角英字の現場名',
      input: '14日\nＢＬＨ名古屋\n片岡 1.0',
      expect: { day: 14, siteName: 'ＢＬＨ名古屋', workers: 1 },
    },
    {
      label: 'T01-17 全角数字の日付',
      input: '１４日\nBLH名古屋\n片岡 1.0',
      expect: { workers: 1 },  // 日付パースできなくても作業員は取れる
    },
    // ── 異常系 ──
    {
      label: 'T01-14 空文字 → null',
      input: '',
      expect: null,
    },
    {
      label: 'T01-15 1行だけ → null',
      input: 'BLH名古屋',
      expect: null,
    },
  ];

  let passed = 0, failed = 0;
  cases.forEach(({ label, input, expect }) => {
    const result = parseDailyReport(input);

    if (expect === null) {
      if (result === null) {
        Logger.log(`✅ ${label}`);
        passed++;
      } else {
        Logger.log(`❌ ${label} → null期待だがパース成功: ${JSON.stringify(result)}`);
        failed++;
      }
      return;
    }

    if (!result) {
      Logger.log(`❌ ${label} → パース失敗（null）`);
      failed++;
      return;
    }

    const errors = [];
    if (expect.day     !== undefined && result.day      !== expect.day)     errors.push(`day: ${result.day} ≠ ${expect.day}`);
    if (expect.month   !== undefined && result.month    !== expect.month)   errors.push(`month: ${result.month} ≠ ${expect.month}`);
    if (expect.year    !== undefined && result.year     !== expect.year)    errors.push(`year: ${result.year} ≠ ${expect.year}`);
    if (expect.siteName !== undefined && result.siteName !== expect.siteName) errors.push(`siteName: ${result.siteName} ≠ ${expect.siteName}`);
    if (expect.reporter !== undefined && result.reporter !== expect.reporter) errors.push(`reporter: ${result.reporter} ≠ ${expect.reporter}`);
    if (expect.workers !== undefined && result.entries.length !== expect.workers) errors.push(`workers: ${result.entries.length} ≠ ${expect.workers}`);
    if (expect.expenses !== undefined && result.expenses.length !== expect.expenses) errors.push(`expenses: ${result.expenses.length} ≠ ${expect.expenses}`);
    if (expect.overtime150 !== undefined && result.entries[0]?.overtime150 !== expect.overtime150) errors.push(`overtime150: ${result.entries[0]?.overtime150} ≠ ${expect.overtime150}`);
    if (expect.overtime125 !== undefined && result.entries[0]?.overtime125 !== expect.overtime125) errors.push(`overtime125: ${result.entries[0]?.overtime125} ≠ ${expect.overtime125}`);
    if (expect.expType !== undefined && result.expenses[0]?.type !== expect.expType) errors.push(`expType: ${result.expenses[0]?.type} ≠ ${expect.expType}`);
    if (expect.hasHighway && !result.expenses.some(e => e.type === 'highway')) errors.push('高速代が見つからない');

    if (errors.length === 0) {
      Logger.log(`✅ ${label}`);
      passed++;
    } else {
      Logger.log(`❌ ${label} → ${errors.join(' / ')}`);
      failed++;
    }
  });

  Logger.log(`\n📊 T01パーサテスト結果: ${passed}/${passed + failed} 件合格`);
}


// ------------------------------------------------------------
//  【T02】列位置テスト（スプシ不要・計算ロジックの確認）
// ------------------------------------------------------------
function testT02_columnPosition() {
  const cases = [
    // { day, expectedBlockCol, label }
    { day: 1,  expectedBlockCol: 2,   label: '1日目 → B列(2)' },
    { day: 2,  expectedBlockCol: 18,  label: '2日目 → R列(18)' },
    { day: 14, expectedBlockCol: 210, label: '14日目 → HB列(210)' },
    { day: 31, expectedBlockCol: 482, label: '31日目 → RN列(482)' },
  ];

  let passed = 0, failed = 0;
  cases.forEach(({ day, expectedBlockCol, label }) => {
    const actual = getDayBlockCol(day);
    if (actual === expectedBlockCol) {
      Logger.log(`✅ T02 ${label} → ${actual}列`);
      passed++;
    } else {
      Logger.log(`❌ T02 ${label} → 実際: ${actual}列, 期待: ${expectedBlockCol}列`);
      failed++;
    }
  });

  // 14日目の主要セル列名も確認
  const day14 = getDayBlockCol(14); // 210
  function numToCol(n) {
    let s = '';
    while (n > 0) { const r = (n - 1) % 26; s = String.fromCharCode(65 + r) + s; n = Math.floor((n - 1) / 26); }
    return s;
  }
  const checks = [
    { name: 'SITE_NAME',  offset: 8,  expected: 'HJ' },
    { name: 'SITE_PRICE', offset: 9,  expected: 'HK' },
    { name: 'SITE_DAYS',  offset: 10, expected: 'HL' },
    { name: 'SITE_1_25',  offset: 11, expected: 'HM' },
    { name: 'SITE_1_5',   offset: 12, expected: 'HN' },
    { name: 'SITE_TOTAL', offset: 13, expected: 'HO' },
  ];
  checks.forEach(({ name, offset, expected }) => {
    const actual = numToCol(day14 + offset);
    if (actual === expected) {
      Logger.log(`✅ T02 14日目 ${name} → ${actual}列`);
      passed++;
    } else {
      Logger.log(`❌ T02 14日目 ${name} → 実際: ${actual}列, 期待: ${expected}列`);
      failed++;
    }
  });

  Logger.log(`\n📊 T02列位置テスト結果: ${passed}/${passed + failed} 件合格`);
}


// ------------------------------------------------------------
//  【T03】スプシ書き込みテスト（実際のスプシに書き込む・要Drive）
//  ★実行前に必ずスプシが正しくDriveにあることを確認！
//  ★書き込み先: BLH名古屋シートの14日目
// ------------------------------------------------------------
function testT03_writeToSheet() {
  Logger.log('T03 スプシ書き込みテスト開始...');

  const testCases = [
    {
      label: 'T03-01 基本書き込み（片岡1日+ガソリン+駐車場）',
      text: '14日\nBLH名古屋\n担当: 今井\n片岡 1.0\n往復18km\n駐車場代 1100',
    },
    {
      label: 'T03-02 複数作業員',
      text: '11日\nBLH名古屋\n今井 1.0\n伊藤 0.8\n往復18km',
    },
    {
      label: 'T03-03 残業あり',
      text: '15日\nBLH名古屋\n伊藤 0.5 +1.5×2.0\n高速代 2440',
    },
  ];

  const now = new Date();
  let passed = 0, failed = 0;

  testCases.forEach(({ label, text }) => {
    try {
      const parsed = parseDailyReport(text);
      if (!parsed) throw new Error('パース失敗');

      const ss = getMonthlySpreadsheet(now.getFullYear(), now.getMonth() + 1);
      const sheet = getCaseSheet(ss, parsed.siteName);
      writeDayBlock(sheet, parsed);

      // 書き込み確認: 作業員名が正しい列に入ったかチェック
      const blockCol = getDayBlockCol(parsed.day);
      parsed.entries.forEach(entry => {
        const found = findWorkerRowInBlock(sheet, blockCol, entry.name);
        if (!found) throw new Error(`${entry.name} が書き込まれていない`);
        const daysVal = sheet.getRange(found.row, found.daysCol).getValue();
        if (daysVal !== entry.days) throw new Error(`${entry.name} の工数 ${daysVal} ≠ ${entry.days}`);
      });

      Logger.log(`✅ ${label}`);
      passed++;
    } catch (e) {
      Logger.log(`❌ ${label} → ${e.message}`);
      failed++;
    }
  });

  Logger.log(`\n📊 T03書き込みテスト結果: ${passed}/${passed + failed} 件合格`);
}


// ------------------------------------------------------------
//  【T04】シート名の表記揺れテスト（スプシ不要）
// ------------------------------------------------------------
function testT04_sheetNameFuzzy() {
  Logger.log('T04 シート名表記揺れテスト...');
  const cases = [
    { input: 'BLH名古屋',   normalized: 'BLH名古屋' },
    { input: 'BLH 名古屋',  normalized: 'BLH名古屋' },   // スペースあり
    { input: ' サボテン',   normalized: 'サボテン' },     // 先頭スペース
    { input: 'サボテン ',   normalized: 'サボテン' },     // 末尾スペース
  ];

  let passed = 0, failed = 0;
  cases.forEach(({ input, normalized }) => {
    const actual = input.replace(/\s/g, '');
    if (actual === normalized) {
      Logger.log(`✅ T04 「${input}」→「${actual}」`);
      passed++;
    } else {
      Logger.log(`❌ T04 「${input}」→「${actual}」（期待:「${normalized}」）`);
      failed++;
    }
  });
  Logger.log(`\n📊 T04表記揺れテスト結果: ${passed}/${passed + failed} 件合格`);
}


// ------------------------------------------------------------
//  【T06】正規化テスト（スプシ不要）
// ------------------------------------------------------------
function testT06_normalization() {
  Logger.log('T06 正規化テスト...');
  const cases = [
    // 現場名の正規化
    { input: 'ＢＬＨ名古屋',   expected: 'blh名古屋',    label: '全角英字→半角' },
    { input: 'BLH 名古屋',     expected: 'blh名古屋',    label: '半角スペース除去' },
    { input: 'BLH　名古屋',    expected: 'blh名古屋',    label: '全角スペース除去' },
    { input: ' WOOC',          expected: 'wooc',          label: '先頭スペース除去' },
    { input: 'ＧＬＲ星ヶ丘',   expected: 'glr星ヶ丘',    label: '全角英字複数' },
    { input: 'BLH名古屋',      expected: 'blh名古屋',    label: '半角英字（基準）' },
    // 作業員名の正規化
    { input: '片岡',           expected: '片岡',          label: '作業員名（変化なし）' },
    { input: '片　岡',         expected: '片岡',          label: '作業員名スペース除去' },
    { input: 'Worker19',      expected: 'Worker19',    label: 'カタカナ（変化なし）' },
  ];

  let passed = 0, failed = 0;
  cases.forEach(({ input, expected, label }) => {
    const actual = normalizeName(input);
    if (actual === expected) {
      Logger.log(`✅ T06 ${label}: 「${input}」→「${actual}」`);
      passed++;
    } else {
      Logger.log(`❌ T06 ${label}: 「${input}」→「${actual}」（期待:「${expected}」）`);
      failed++;
    }
  });

  // 候補リスト検索のテスト
  Logger.log('\nT06 候補リスト検索テスト...');
  try {
    const now = new Date();
    const ss = getMonthlySpreadsheet(now.getFullYear(), now.getMonth() + 1);
    const allSheets = ss.getSheets();
    const candidateCases = [
      { input: 'BLH',          label: 'BLHだけ入力' },
      { input: 'サボテン',      label: 'サボテン' },
      { input: 'ＢＬＨ名古屋', label: '全角で入力' },
      { input: 'ぶるはーとなごや', label: '全然違う誤字' },
    ];
    candidateCases.forEach(({ input, label }) => {
      const candidates = findCandidateSheets(allSheets, input);
      Logger.log(`  「${label}」→ 候補: ${candidates.length > 0 ? candidates.join(' / ') : 'なし'}`);
      passed++;
    });
  } catch (e) {
    Logger.log(`  候補検索テストスキップ（Drive未接続）: ${e.message}`);
  }

  Logger.log(`\n📊 T06正規化テスト結果: ${passed}/${passed + failed} 件合格`);
}

// ------------------------------------------------------------
//  【T05】ファイル名検索テスト（実Drive接続・要Drive）
//  スプシが実際に見つかるか確認
// ------------------------------------------------------------
function testT05_findSpreadsheet() {
  Logger.log('T05 スプシ検索テスト開始...');
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth() + 1;

  try {
    const ss = getMonthlySpreadsheet(year, month);
    Logger.log(`✅ T05 スプシ発見: 「${ss.getName()}」`);
    Logger.log(`   シート数: ${ss.getSheets().length}`);
    Logger.log(`   シート一覧: ${ss.getSheets().map(s => s.getName()).join(' / ')}`);
  } catch (e) {
    Logger.log(`❌ T05 スプシ未発見: ${e.message}`);
  }
}


// ------------------------------------------------------------
//  【全テスト一括実行】
//  T01・T02はスプシ不要、T03・T05はDrive接続が必要
// ------------------------------------------------------------
// ------------------------------------------------------------
//  【T07】動的行番号検出テスト（Drive必要）
// ------------------------------------------------------------
function testT07_dynamicRowDetection() {
  Logger.log('T07 動的行番号検出テスト...');
  try {
    const now = new Date();
    const ss = getMonthlySpreadsheet(now.getFullYear(), now.getMonth() + 1);
    const testSheets = ['BLH名古屋', 'サボテン', ' WOOC'];
    let passed = 0, failed = 0;

    testSheets.forEach(name => {
      const sheet = ss.getSheetByName(name) || ss.getSheets().find(s => normalizeName(s.getName()) === normalizeName(name));
      if (!sheet) { Logger.log(`  スキップ: ${name}（シートなし）`); return; }

      const blockCol = getDayBlockCol(14); // 14日目で検証
      const ROW_D = detectSheetRows(sheet, blockCol);

      const errors = [];
      if (!ROW_D.WORKER_START || ROW_D.WORKER_START < 3) errors.push(`WORKER_START異常: ${ROW_D.WORKER_START}`);
      if (!ROW_D.GAS_DIST_TOTAL || ROW_D.GAS_DIST_TOTAL < 10) errors.push(`GAS_DIST_TOTAL異常: ${ROW_D.GAS_DIST_TOTAL}`);
      if (!ROW_D.HIGHWAY_TOTAL) errors.push('HIGHWAY_TOTAL未検出');
      if (!ROW_D.PARKING_TOTAL) errors.push('PARKING_TOTAL未検出');

      if (errors.length === 0) {
        Logger.log(`  ✅ ${name}: WORKER_START=${ROW_D.WORKER_START}, GAS=${ROW_D.GAS_DIST_TOTAL}, 高速=${ROW_D.HIGHWAY_TOTAL}, 駐車場=${ROW_D.PARKING_TOTAL}`);
        passed++;
      } else {
        Logger.log(`  ❌ ${name}: ${errors.join(' / ')}`);
        failed++;
      }
    });

    Logger.log(`\n📊 T07動的行番号テスト結果: ${passed}/${passed + failed} 件合格`);
  } catch (e) {
    Logger.log('T07 エラー: ' + e.message);
  }
}

// ------------------------------------------------------------
//  【T08】二重送信チェックテスト（Drive必要）
// ------------------------------------------------------------
function testT08_duplicateCheck() {
  Logger.log('T08 二重送信チェックテスト...');
  try {
    const now = new Date();
    const ss = getMonthlySpreadsheet(now.getFullYear(), now.getMonth() + 1);
    const sheet = getCaseSheet(ss, 'BLH名古屋');
    let passed = 0, failed = 0;

    // データが入っている日（14日）で既存データ検出テスト
    const existing14 = getExistingDayData(sheet, 14);
    if (existing14 !== null) {
      Logger.log(`  ✅ T08-01 14日目: 既存データ検出OK\n     → ${existing14.split('\n')[0]}`);
      passed++;
    } else {
      Logger.log('  ⚠️ T08-01 14日目: データなし（テスト用に先にT03を実行してください）');
    }

    // データが入っていない日（28日）で null 確認
    const existing28 = getExistingDayData(sheet, 28);
    if (existing28 === null) {
      Logger.log('  ✅ T08-02 28日目: データなし → null 正常');
      passed++;
    } else {
      Logger.log(`  ❌ T08-02 28日目: 予期しないデータあり → ${existing28}`);
      failed++;
    }

    Logger.log(`\n📊 T08二重送信チェックテスト結果: ${passed}/${passed + failed} 件合格`);
  } catch (e) {
    Logger.log('T08 エラー: ' + e.message);
  }
}


// ============================================================
//  テストデータクリア関数
//  GASエディタから clearTestData() を実行するだけでOK
// ============================================================

/**
 * 指定シートの指定日のブロックにある「書き込み値」だけを消去する。
 * 作業員名・単価・数式（=数式セル）はそのまま残す。
 */
function clearDayBlock(sheet, day) {
  const blockCol = getDayBlockCol(day);
  const ROW_D = detectSheetRows(sheet, blockCol);

  // 作業員の工数・残業列をクリア（名前・単価・数式は残す）
  for (let row = ROW_D.WORKER_START; row <= ROW_D.WORKER_END; row++) {
    // 工場側：工数・1.25・1.5列
    sheet.getRange(row, blockCol + COL.FACTORY_DAYS).clearContent();
    sheet.getRange(row, blockCol + COL.FACTORY_1_25).clearContent();
    sheet.getRange(row, blockCol + COL.FACTORY_1_5).clearContent();
    // 現場側：工数・1.25・1.5列
    sheet.getRange(row, blockCol + COL.SITE_DAYS).clearContent();
    sheet.getRange(row, blockCol + COL.SITE_1_25).clearContent();
    sheet.getRange(row, blockCol + COL.SITE_1_5).clearContent();
  }

  // 担当者行をクリア
  const reporterRow = ROW_D.REPORTER || ROW_DEFAULT.REPORTER;
  sheet.getRange(reporterRow, blockCol + COL.FACTORY_NAME).clearContent();

  // 経費をクリア（数式セルは除く）
  const expenseRows = [
    [ROW_D.GASOLINE1  || ROW_DEFAULT.GASOLINE1,  2],  // ガソリンkm
    [ROW_D.PARKING1   || ROW_DEFAULT.PARKING1,   2],  // 駐車場円
    [ROW_D.HIGHWAY1   || ROW_DEFAULT.HIGHWAY1,   2],  // 高速代円
    [ROW_D.GAS_DIST_TOTAL, 1],  // ガソリン距離計km
    [ROW_D.GAS_DIST_TOTAL, 3],  // ガソリン単価
    // 右側経費（電車・ゴミ・ホテル等）
    [ROW_D.ROW_TRAIN            || ROW_DEFAULT.ROW_TRAIN,            13],
    [ROW_D.ROW_GARBAGE_FACTORY  || ROW_DEFAULT.ROW_GARBAGE_FACTORY,  13],
    [ROW_D.ROW_GARBAGE_SITE     || ROW_DEFAULT.ROW_GARBAGE_SITE,     13],
    [ROW_D.ROW_HOTEL            || ROW_DEFAULT.ROW_HOTEL,            13],
    [ROW_D.ROW_OTHER            || ROW_DEFAULT.ROW_OTHER,            13],
    [ROW_D.ROW_ENTERTAINMENT    || ROW_DEFAULT.ROW_ENTERTAINMENT,    13],
  ];

  expenseRows.forEach(function([row, offset]) {
    if (!row) return;
    const cell = sheet.getRange(row, blockCol + offset);
    // 数式セルは残す（集計行）
    const val = cell.getValue();
    if (val !== '' && val !== null && val !== 0) {
      cell.clearContent();
    }
  });
}

/**
 * テスト用データクリア関数
 * GASエディタから実行する。指定シートの指定日のデータを消去する。
 *
 * 使い方:
 *   1. GASエディタで clearTestData() を選択して実行
 *   2. ログで消去結果を確認
 *   3. LINEで再度テストメッセージを送信
 */

// ============================================================
//  全データリセット関数
//  GASエディタから resetAllData() を実行する
//  ※ 本番運用中は絶対に実行しないこと！
// ============================================================

function resetAllData() {
  Logger.log('========================================');
  Logger.log('  ⚠️  全データリセット開始');
  Logger.log('========================================');

  var props = PropertiesService.getScriptProperties();
  var all = props.getProperties();
  var counts = { sitemap: 0, invoice: 0, manual: 0, rowDetect: 0, other: 0 };

  // PropertiesService の全キーを分類してカウント・削除
  Object.keys(all).forEach(function(key) {
    if (key.startsWith('sitemap_')) {
      counts.sitemap++;
    } else if (key.startsWith('invoice_done_')) {
      counts.invoice++;
    } else if (key === MANUAL_LIST_KEY) {
      counts.manual++;
    } else if (key.startsWith('rowDetect_')) {
      counts.rowDetect++;
    } else {
      counts.other++;
      Logger.log('  その他キー: ' + key + ' = ' + all[key]);
    }
  });

  // 全削除
  props.deleteAllProperties();
  Logger.log('✅ PropertiesService 削除完了');
  Logger.log('  現場名マッピング: ' + counts.sitemap + '件');
  Logger.log('  請求書処理済みフラグ: ' + counts.invoice + '件');
  Logger.log('  手動対応リスト: ' + counts.manual + '件');
  Logger.log('  行番号キャッシュ: ' + counts.rowDetect + '件');
  Logger.log('  その他: ' + counts.other + '件');

  // CacheService（行番号キャッシュ）もクリア
  try {
    CacheService.getScriptCache().removeAll([]);
    Logger.log('✅ CacheService クリア完了');
  } catch(e) {
    Logger.log('⚠️ CacheService クリアスキップ: ' + e.message);
  }

  Logger.log('========================================');
  Logger.log('  ✅ リセット完了！');
  Logger.log('  現場名マッピング … ' + counts.sitemap + '件 削除');
  Logger.log('  請求書処理済み … ' + counts.invoice + '件 削除');
  Logger.log('  手動対応リスト … ' + counts.manual + '件 削除');
  Logger.log('  行番号キャッシュ … ' + counts.rowDetect + '件 削除');
  Logger.log('========================================');
}

function clearTestData() {
  // ── クリア設定 ──────────────────────────────────
  const TARGET_SHEETS = [
    'ギフト桜ステージ', 'BLH名古屋', 'サボテン', 'TANAKA',
    ' スタバ大田川', 'GLR星ヶ丘', '宝石の八神', 'colorus東銀座',
    'アルペン梅田', '麻布台レジデンス', 'アディダス宮下パーク',
    'イオンモール木曽川', 'イオン　ドーム前', 'かつ雅', 'GLM増床',
    'スクエアエニくす', 'Zカフェ', 'テレビ朝日', '桃源郷',
    'nowhire北新宿)', 'fynpy名古屋西店', '丸亀製麺', '皆吉台CC',
    '守山カフェ', 'ルルレモン', 'レンフロ什器', 'LOGIFLAGTECK野跡',
    'LOGIFLAGTECK東扇じま', ' WOOC',
  ];
  const TARGET_DAYS = [
    1,  2,  3,  4,  5,  6,  7,  8,  9, 10,
    11, 12, 13, 14, 15, 16, 17, 18, 19, 20,
    21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31,
  ];
  // ────────────────────────────────────────────────

  Logger.log('🧹 テストデータクリア開始...');

  try {
    const now = new Date();
    const ss  = getMonthlySpreadsheet(now.getFullYear(), now.getMonth() + 1);

    TARGET_SHEETS.forEach(function(sheetName) {
      var sheet;
      try {
        sheet = getCaseSheet(ss, sheetName);
      } catch(e) {
        Logger.log('⚠️ シート「' + sheetName + '」が見つかりません: ' + e.message);
        return;
      }

      TARGET_DAYS.forEach(function(day) {
        try {
          clearDayBlock(sheet, day);
          Logger.log('  ✅ ' + sheetName + ' ' + day + '日目: クリア完了');
        } catch(e) {
          Logger.log('  ❌ ' + sheetName + ' ' + day + '日目: エラー - ' + e.message);
        }
      });
    });

    // 請求書明細行（行64以降）もクリア
    TARGET_SHEETS.forEach(function(sheetName) {
      var sheet;
      try {
        sheet = getCaseSheet(ss, sheetName);
      } catch(e) { return; }
      var lastRow = sheet.getLastRow();
      if (lastRow >= ROW_DEFAULT.DETAIL_START) {
        sheet.getRange(ROW_DEFAULT.DETAIL_START, 1, lastRow - ROW_DEFAULT.DETAIL_START + 1, 5).clearContent();
        Logger.log('  🗑️ ' + sheetName + ' 請求書明細クリア（行' + ROW_DEFAULT.DETAIL_START + '〜' + lastRow + '）');
      }
    });

    // PropertiesServiceの処理済みフラグも削除（二重送信チェックをリセット）
    var props = PropertiesService.getScriptProperties();
    var allProps = props.getProperties();
    var cleared = 0;
    Object.keys(allProps).forEach(function(key) {
      if (key.startsWith('invoice_done_')) {
        props.deleteProperty(key);
        cleared++;
      }
    });
    if (cleared > 0) Logger.log('  🗑️ 請求書処理済みフラグを ' + cleared + ' 件削除');

    // detectSheetRowsのキャッシュもクリア
    try {
      CacheService.getScriptCache().removeAll(
        Object.keys(CacheService.getScriptCache().getAll(['dummy'])).filter(function(k) {
          return k.startsWith('rowDetect_');
        })
      );
    } catch(e) { /* キャッシュクリアは失敗しても続行 */ }

    Logger.log('\n✅ クリア完了！LINEで再テストしてください。');

  } catch(e) {
    Logger.log('❌ クリアエラー: ' + e.message);
  }
}
function testAll() {
  Logger.log('========================================');
  Logger.log('  バナナデザイン GAS テストスイート v2.1');
  Logger.log('========================================\n');

  Logger.log('--- T01: パーサ単体テスト ---');
  testT01_parser();

  Logger.log('\n--- T02: 列位置テスト ---');
  testT02_columnPosition();

  Logger.log('\n--- T04: シート名表記揺れテスト ---');
  testT04_sheetNameFuzzy();

  Logger.log('\n--- T05: スプシ検索テスト（Drive必要）---');
  testT05_findSpreadsheet();

  Logger.log('\n--- T06: 正規化テスト ---');
  testT06_normalization();

  Logger.log('\n--- T07: 動的行番号検出テスト（Drive必要）---');
  testT07_dynamicRowDetection();

  Logger.log('\n--- T08: 二重送信チェックテスト（Drive必要）---');
  testT08_duplicateCheck();

  Logger.log('\n--- T03: 書き込みテスト（Drive必要）---');
  Logger.log('⚠️ T03は実スプシに書き込みます。確認後 testT03_writeToSheet() を個別実行してください。');

  Logger.log('\n========================================');
  Logger.log('  テスト完了！ログを確認してください');
  Logger.log('========================================');
}