// ============================================================
//  施工台帳自動化システム
//
//  機能:
//    1. LIFFフォーム日報 → GAS POST → Drive保存 + LINE push通知
//    2. LIFFアプリ → GAS GET → Supabaseからマスタデータ返却
//
//  ※ スプレッドシートへの書き込み・読み取りは廃止（Supabase管理に移行）
// ============================================================

// ── 本番デフォルト値（Script Propertiesで上書き可能）──
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
    SUPABASE_URL:       p.SUPABASE_URL       || 'https://SAMPLE_SUPABASE_REF.supabase.co',
    SUPABASE_ANON_KEY:  p.SUPABASE_ANON_KEY  || 'REMOVED_SUPABASE_ANON_KEY',
    ACCOUNT_SLUG:       p.ACCOUNT_SLUG       || 'seed',
  };
})();


// ============================================================
//  doGet - LIFFフォーム用マスタデータAPI
//  GETリクエスト: ?action=getMaster で Supabase からデータ取得
// ============================================================
function doGet(e) {
  try {
    var action = e && e.parameter && e.parameter.action;

    if (action === 'getMaster') {
      var masterCacheKey = 'master_data_v2';
      try {
        var cachedMaster = CacheService.getScriptCache().get(masterCacheKey);
        if (cachedMaster) {
          return ContentService.createTextOutput(cachedMaster).setMimeType(ContentService.MimeType.JSON);
        }
      } catch(cacheErr) { /* キャッシュ取得失敗は無視 */ }

      // account_id を slug から取得（1時間キャッシュ）
      var accountId = getAccountId(CONFIG.ACCOUNT_SLUG);
      if (!accountId) {
        return ContentService.createTextOutput(JSON.stringify({ error: 'account not found: ' + CONFIG.ACCOUNT_SLUG }))
          .setMimeType(ContentService.MimeType.JSON);
      }

      // Supabase から並列取得
      var sitesRaw    = supabaseGet('sites',         'select=name&active=eq.true&account_id=eq.' + accountId + '&order=sort_order.asc');
      var workersRaw  = supabaseGet('workers',       'select=name,role,unit_price&active=eq.true&account_id=eq.' + accountId + '&order=sort_order.asc');
      var subsRaw     = supabaseGet('subcontractors','select=name&active=eq.true&account_id=eq.' + accountId + '&order=sort_order.asc');
      var vehiclesRaw = supabaseGet('vehicles',      'select=name&active=eq.true&account_id=eq.' + accountId + '&order=sort_order.asc');

      var result = JSON.stringify({
        sites:          Array.isArray(sitesRaw)    ? sitesRaw.map(function(r) { return r.name; })                                          : [],
        workers:        Array.isArray(workersRaw)  ? workersRaw.map(function(r) { return { name: r.name, role: r.role, unitPrice: r.unit_price }; }) : [],
        subcontractors: Array.isArray(subsRaw)     ? subsRaw.map(function(r) { return r.name; })                                           : [],
        vehicles:       Array.isArray(vehiclesRaw) ? vehiclesRaw.map(function(r) { return r.name; })                                       : [],
      });

      try { CacheService.getScriptCache().put(masterCacheKey, result, 3600); } catch(e) {}
      return ContentService.createTextOutput(result).setMimeType(ContentService.MimeType.JSON);
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
//  Supabase REST API ヘルパー
// ============================================================

/**
 * Supabase REST API GET
 * @param {string} table  テーブル名
 * @param {string} query  クエリ文字列 (例: 'select=name&active=eq.true')
 * @returns {Array|Object} レスポンスJSON
 */
function supabaseGet(table, query) {
  var url = CONFIG.SUPABASE_URL + '/rest/v1/' + table + '?' + query;
  var res = UrlFetchApp.fetch(url, {
    method: 'get',
    headers: {
      'apikey':        CONFIG.SUPABASE_ANON_KEY,
      'Authorization': 'Bearer ' + CONFIG.SUPABASE_ANON_KEY,
    },
    muteHttpExceptions: true,
  });
  var text = res.getContentText();
  try {
    return JSON.parse(text);
  } catch (e) {
    Logger.log('supabaseGet parse error [' + table + ']: ' + text);
    return [];
  }
}

/**
 * account slug から account_id (UUID) を取得（1時間キャッシュ）
 */
function getAccountId(slug) {
  var cacheKey = 'account_id_' + slug;
  try {
    var cached = CacheService.getScriptCache().get(cacheKey);
    if (cached) return cached;
  } catch(e) {}

  var rows = supabaseGet('accounts', 'select=id&slug=eq.' + encodeURIComponent(slug));
  if (!Array.isArray(rows) || rows.length === 0) {
    Logger.log('getAccountId: not found for slug=' + slug);
    return null;
  }
  var id = rows[0].id;
  try { CacheService.getScriptCache().put(cacheKey, id, 3600); } catch(e) {}
  return id;
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
    if (body.action === 'notifyEdit') {
      return handleEditNotification(body);
    }
    if (body.action === 'notifyError') {
      return handleErrorNotification(body);
    }
  } catch (err) {
    Logger.log('doPost error: ' + err);
  }
  return ContentService.createTextOutput(JSON.stringify({ status: 'ok' }))
    .setMimeType(ContentService.MimeType.JSON);
}

/**
 * 日報編集通知ハンドラ
 * LIFF側で計算した差分テキストをLINEグループに送信する
 */
function handleEditNotification(body) {
  try {
    var sender     = body.sender    || '不明';
    var date       = body.date      || '';
    var editedAt   = body.editedAt  || '';
    var diffs      = body.diffs     || [];
    var devGroupId = body._devNotifyGroupId || null;

    if (diffs.length === 0) {
      return ContentService.createTextOutput(JSON.stringify({ status: 'no_changes' }))
        .setMimeType(ContentService.MimeType.JSON);
    }

    var weekdays  = ['日', '月', '火', '水', '木', '金', '土'];
    var d         = new Date(date + 'T00:00:00');
    var dateLabel = (d.getMonth() + 1) + '月' + d.getDate() + '日（' + weekdays[d.getDay()] + '）';

    var lines = [
      '✏️ 日報を修正しました',
      '📅 ' + dateLabel,
      '👤 ' + sender,
      '🕐 ' + editedAt + ' 更新',
      '─────────────────',
    ].concat(diffs);

    var msg      = [{ type: 'text', text: lines.join('\n') }];
    var groupIds = devGroupId ? [devGroupId] : (CONFIG.NOTIFY_GROUP_IDS || []);
    groupIds.forEach(function(id) { pushLineMessages(id, msg); });

  } catch (err) {
    Logger.log('handleEditNotification error: ' + err);
  }
  return ContentService.createTextOutput(JSON.stringify({ status: 'ok' }))
    .setMimeType(ContentService.MimeType.JSON);
}


// ============================================================
//  LIFFフォーム日報送信ハンドラ
//  LIFF → GAS POST → Drive保存 + LINE通知
//  ※ スプレッドシートへの書き込みなし
// ============================================================
function handleLiffReport(body) {
  try {
    var sender = body.sender || '不明';
    var date   = body.date;
    var sites  = body.sites || [];
    var note   = body.note  || '';

    if (!date) {
      return jsonResponse({ success: false, error: '日付が指定されていません' });
    }

    // 稼働なし
    if (body.isWorking === false) {
      if (body.senderId) saveSubmitter(body.senderId, sender, date);
      sendLiffReportNotification(sender, date, [], [], [], note || '稼働なし', body._devNotifyGroupId || null);
      return jsonResponse({ success: true, successSites: [], failedSites: [] });
    }

    if (sites.length === 0) {
      return jsonResponse({ success: false, error: '現場データがありません' });
    }

    var successSites = sites.map(function(s) { return s.siteName; }).filter(Boolean);
    var garbageFolderUrls = {};
    var expenseFileUrls   = {};

    // Drive保存（ゴミ写真・経費ファイル）
    sites.forEach(function(site) {
      if (!site.siteName || !site.expenses) return;
      var exp = site.expenses;

      if ((exp.garbageFactoryM3 || exp.garbageSiteM3) && exp.garbagePhotos && exp.garbagePhotos.length > 0) {
        var folderUrl = saveGarbagePhotos(exp.garbagePhotos, date, sender, site.siteName);
        if (folderUrl) garbageFolderUrls[site.siteName] = folderUrl;
      }

      var siteFileUrls = {};
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
          var urls = saveExpenseFiles(files, date, sender, site.siteName, cat.label);
          if (urls && urls.length) siteFileUrls[cat.key] = urls;
        }
      });
      if (Object.keys(siteFileUrls).length > 0) expenseFileUrls[site.siteName] = siteFileUrls;
    });

    if (body.senderId) saveSubmitter(body.senderId, sender, date);
    sendLiffReportNotification(sender, date, body.sites, successSites, [], note, body._devNotifyGroupId || null, garbageFolderUrls, expenseFileUrls);

    return jsonResponse({ success: true, successSites: successSites, failedSites: [] });

  } catch (err) {
    Logger.log('handleLiffReport error: ' + err);
    try {
      var errMsg = [
        '🚨 日報処理エラー',
        '送信者: ' + (body.sender || '不明'),
        '日付: ' + (body.date || '不明'),
        'エラー: ' + String(err).split('\n')[0],
      ].join('\n');
      var groupIds = (body._devNotifyGroupId ? [body._devNotifyGroupId] : (CONFIG.NOTIFY_GROUP_IDS || []));
      groupIds.forEach(function(id) { pushLineMessages(id, [{ type: 'text', text: errMsg }]); });
    } catch (notifyErr) {
      Logger.log('エラー通知の送信失敗: ' + notifyErr);
    }
    return jsonResponse({ success: false, error: err.toString() });
  }
}

/**
 * LIFFフォーム送信後のLINE通知
 */
function sendLiffReportNotification(sender, date, sites, successSites, failedSites, note, devGroupId, garbageFolderUrls, expenseFileUrls) {
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
          if (parts.length) lines.push('・' + parts.join(' + '));
        });
      }

      // 経費
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

    if (failedSites && failedSites.length > 0) {
      lines.push('\n⚠️ 未登録: ' + failedSites.join('、'));
    }

    var msg = [{ type: 'text', text: lines.join('\n') }];
    var groupIds = devGroupId ? [devGroupId] : (CONFIG.NOTIFY_GROUP_IDS || []);
    groupIds.forEach(function(id) { pushLineMessages(id, msg); });

  } catch (err) {
    Logger.log('sendLiffReportNotification error: ' + err);
  }
}

/**
 * エラー通知ハンドラ
 * LIFF側でのDB保存エラー等をLINEグループに通知する
 */
function handleErrorNotification(body) {
  try {
    var sender     = body.sender     || '不明';
    var date       = body.date       || '';
    var actionName = body.actionName || '操作';
    var errorMsg   = body.error      || '不明なエラー';
    var devGroupId = body._devNotifyGroupId || null;

    var weekdays = ['日', '月', '火', '水', '木', '金', '土'];
    var datePart = '';
    if (date) {
      var d = new Date(date + 'T00:00:00');
      datePart = '\n📅 ' + (d.getMonth() + 1) + '月' + d.getDate() + '日（' + weekdays[d.getDay()] + '）';
    }

    var text = [
      '🚨 日報エラー通知',
      '👤 ' + sender + datePart,
      '操作: ' + actionName,
      '─────────────────',
      errorMsg,
    ].join('\n');

    var msg      = [{ type: 'text', text: text }];
    var groupIds = devGroupId ? [devGroupId] : (CONFIG.NOTIFY_GROUP_IDS || []);
    groupIds.forEach(function(id) { pushLineMessages(id, msg); });

  } catch (err) {
    Logger.log('handleErrorNotification error: ' + err);
  }
  return ContentService.createTextOutput(JSON.stringify({ status: 'ok' }))
    .setMimeType(ContentService.MimeType.JSON);
}

/**
 * ファイルアップロード専用ハンドラ
 * Driveへの保存 + LINEフォローアップ通知
 */
function handleFileUploads(body) {
  try {
    var sender     = body.sender || '不明';
    var date       = body.date;
    var sites      = body.sites || [];
    var devGroupId = body._devNotifyGroupId || null;

    var notifyLines = [];

    sites.forEach(function(site) {
      if (!site.siteName || !site.expenses) return;
      try {
        var exp       = site.expenses;
        var siteLines = [];

        // ゴミ写真
        if ((exp.garbageFactoryM3 || exp.garbageSiteM3) && exp.garbagePhotos && exp.garbagePhotos.length > 0) {
          var folderUrl = saveGarbagePhotos(exp.garbagePhotos, date, sender, site.siteName);
          if (folderUrl) {
            siteLines.push('📸 写真フォルダ ' + folderUrl);
          }
        }

        // 各経費ファイル
        var expFileLabelMap = {
          vehicleFiles:       '車両領収書',
          trainFiles:         '電車領収書',
          hotelFiles:         'ホテル領収書',
          leopalaceFiles:     'レオパレス領収書',
          otherFiles:         'その他経費',
          entertainmentFiles: '雑経費領収書',
        };
        Object.keys(expFileLabelMap).forEach(function(key) {
          var files = exp[key];
          if (!files || !files.length) return;
          var urls = saveExpenseFiles(files, date, sender, site.siteName, expFileLabelMap[key]);
          if (urls && urls.length) {
            urls.forEach(function(url, i) {
              siteLines.push('📎 ' + expFileLabelMap[key] + (urls.length > 1 ? '(' + (i + 1) + ')' : '') + ' ' + url);
            });
          }
        });

        if (siteLines.length > 0) {
          notifyLines.push('📍 ' + site.siteName);
          siteLines.forEach(function(l) { notifyLines.push('・' + l); });
          notifyLines.push('');
        }

      } catch (siteErr) {
        Logger.log('handleFileUploads site error [' + site.siteName + ']: ' + siteErr);
      }
    });

    if (notifyLines.length > 0) {
      var d2       = new Date((date || '') + 'T00:00:00');
      var weekdays = ['日','月','火','水','木','金','土'];
      var dateLabel = (d2.getMonth()+1) + '/' + d2.getDate() + '（' + weekdays[d2.getDay()] + '）';
      var msg = ['📎 ' + dateLabel + ' 添付ファイル', '👤 ' + sender, '─────────────────', ''].concat(notifyLines).join('\n');
      var msgObj = [{ type: 'text', text: msg }];
      var groupIds = devGroupId ? [devGroupId] : (CONFIG.NOTIFY_GROUP_IDS || []);
      groupIds.forEach(function(id) { pushLineMessages(id, msgObj); });
    }

  } catch (err) {
    Logger.log('handleFileUploads error: ' + err);
  }
  return jsonResponse({ success: true });
}

/**
 * JSONレスポンスを返すユーティリティ
 */
function jsonResponse(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}


// ============================================================
//  Google Drive 保存（ゴミ写真・経費ファイル）
// ============================================================

/**
 * ゴミ写真をDriveに保存してフォルダURLを返す
 */
function saveGarbagePhotos(base64Photos, date, senderName, siteName) {
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
 * 経費ファイル（JPEG/PDF）をDriveに保存してURLリストを返す
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
        var header   = dataUrl.slice(0, commaIdx);
        base64Data   = dataUrl.slice(commaIdx + 1);
        var mimeMatch = header.match(/data:([^;]+);/);
        if (mimeMatch) mimeType = mimeMatch[1];
      }
      var ext  = mimeType === 'application/pdf' ? '.pdf' : '.jpg';
      var blob = Utilities.newBlob(
        Utilities.base64Decode(base64Data),
        mimeType,
        date + '_' + siteName + '_' + category + '_' + senderName + '_' + (idx + 1) + ext
      );
      var file = subFolder.createFile(blob);
      fileUrls.push(file.getUrl());
    });

    return fileUrls;
  } catch (e) {
    Logger.log('saveExpenseFiles error: ' + e);
    return null;
  }
}


// ============================================================
//  LINE 送受信
// ============================================================

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


// ============================================================
//  提出管理・リマインダー
// ============================================================

var REMINDER_EXCLUDE_NAMES = ['REMOVED_HANDLE', 'REMOVED_NAME'];

/**
 * 提出済み記録を保存 & 既知ユーザーに登録
 */
function saveSubmitter(senderId, senderName, date) {
  try {
    var props = PropertiesService.getScriptProperties();

    var key = 'submitters_' + date;
    var existing = props.getProperty(key);
    var ids = existing ? JSON.parse(existing) : [];
    if (ids.indexOf(senderId) === -1) {
      ids.push(senderId);
      props.setProperty(key, JSON.stringify(ids));
    }

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
 * 前日分の未提出者にLINEリマインドを送る（毎朝8時トリガー）
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

    var target = new Date();
    target.setDate(target.getDate() - 1);
    while (target.getDay() === 0) {
      target.setDate(target.getDate() - 1);
    }
    var targetDate = Utilities.formatDate(target, 'Asia/Tokyo', 'yyyy-MM-dd');
    var weekdays = ['日','月','火','水','木','金','土'];
    var dateLabel = (target.getMonth() + 1) + '/' + target.getDate() + '（' + weekdays[target.getDay()] + '）';

    var submittedIds = getSubmitterIds(targetDate);

    var unsubmitted = knownUsers.filter(function(u) {
      if (REMINDER_EXCLUDE_NAMES.indexOf(u.name) !== -1) return false;
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

function getLiffId() {
  var p = PropertiesService.getScriptProperties().getProperties();
  return p.LIFF_ID || '';
}

function setupDailyReminderTrigger() {
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


// ============================================================
//  経費申請リマインダー
// ============================================================
function sendExpenseReminder() {
  var today   = new Date();
  var day     = today.getDate();
  var lastDay = new Date(today.getFullYear(), today.getMonth() + 1, 0).getDate();

  if (day !== 15 && day !== lastDay) {
    Logger.log('経費リマインダー: 本日(' + day + '日)はスキップ');
    return;
  }

  var period = day === 15
    ? '前半（1〜15日）'
    : '後半（16日〜' + lastDay + '日）';

  var liffUrl = PropertiesService.getScriptProperties().getProperty('EXPENSE_LIFF_URL')
             || 'https://liff.line.me/（EXPENSE_LIFF_URLを設定してください）';

  var message = '【経費申請 締め切りのお知らせ】\n\n'
              + '本日は' + period + '分の締め日です。\n'
              + '経費がある方は申請書をダウンロードして経理に提出してください。\n\n'
              + liffUrl;

  CONFIG.NOTIFY_GROUP_IDS.forEach(function(groupId) {
    pushLineMessage(groupId, message);
  });

  Logger.log('経費リマインダー送信完了: ' + period);
}

function setupTriggers() {
  ScriptApp.getProjectTriggers().forEach(function(t) {
    if (t.getHandlerFunction() === 'sendExpenseReminder') {
      ScriptApp.deleteTrigger(t);
    }
  });

  ScriptApp.newTrigger('sendExpenseReminder').timeBased().onMonthDay(15).atHour(9).create();
  ScriptApp.newTrigger('sendExpenseReminder').timeBased().onMonthDay(28).atHour(9).create();
  ScriptApp.newTrigger('sendExpenseReminder').timeBased().onMonthDay(29).atHour(9).create();
  ScriptApp.newTrigger('sendExpenseReminder').timeBased().onMonthDay(30).atHour(9).create();
  ScriptApp.newTrigger('sendExpenseReminder').timeBased().onMonthDay(31).atHour(9).create();

  Logger.log('トリガー設定完了: sendExpenseReminder × 5件（15日 + 28〜31日）');
}
