#!/usr/bin/env node
// ============================================================
//  scripts/backup-storage.mjs
//  Supabase Storage の全バケットのオブジェクトを、バックアップ用の
//  非公開バケット `backups` へ日付プレフィックス付きで複製する。
//  併せて、任意の日付スナップショットから元バケットへ書き戻す復元も行う。
//
//  なぜ必要か:
//   Supabase の Database Backups は Storage の実体ファイルを含まない
//   （"Storage objects are not included"）。DB 行は PITR で戻せても、
//   領収書画像・車検証・請求書PDF・添付ファイルの実体は戻らない。
//   このスクリプトが唯一の「ファイル実体の世代バックアップ」になる。
//
//  方式:
//   全バケット（backups 自身は除く）を listBuckets で動的に取得して走査し、
//   各オブジェクトを
//     backups/<YYYY-MM-DD>/<元バケット名>/<元のパス>
//   へコピーする。同じ日に再実行すると upsert で上書き（冪等）。
//   復元は逆向きに backups/<日付>/<バケット>/... を <バケット>/... へ書き戻す。
//
//  ★接続先は環境変数で決まる。既定はローカル。本番を取る時は明示的に
//   本番 URL と service_role キーを渡す（README 参照）。service_role キーは
//   全バケットを跨いで読み書きできる＝ログ/チャット/コミットに残さない。
//
//  使い方:
//    # ローカル（既定）を全バケット バックアップ
//    node --env-file=.env scripts/backup-storage.mjs
//    # 中身を変えずに何が対象か見るだけ
//    node --env-file=.env scripts/backup-storage.mjs --dry-run
//    # 1バケットだけ / 日付を指定
//    node --env-file=.env scripts/backup-storage.mjs --bucket site-attachments
//    node --env-file=.env scripts/backup-storage.mjs --date 2026-08-22
//    # 本番を取る（README の手順で env を渡す。キーはコミット禁止）
//    SUPABASE_URL=https://nrzzesbtvswoiouhldvi.supabase.co \
//      SUPABASE_SERVICE_ROLE_KEY=****  node scripts/backup-storage.mjs
//
//    # 復元: 指定日スナップショットから書き戻す（既定は全バケット）
//    #   ★upsert で現行ファイルを上書きする。まず --dry-run、可能なら --bucket で絞る
//    node scripts/backup-storage.mjs --restore --date 2026-08-22 --dry-run
//    node scripts/backup-storage.mjs --restore --date 2026-08-22 --bucket site-attachments
// ============================================================
import { createClient } from '@supabase/supabase-js'

const BACKUP_BUCKET = 'backups'

// ── 引数 ─────────────────────────────────────────────
const argv = process.argv.slice(2)
const hasFlag = (f) => argv.includes(f)
const getOpt = (f) => { const i = argv.indexOf(f); return i >= 0 ? argv[i + 1] : undefined }

const DRY = hasFlag('--dry-run')
const RESTORE = hasFlag('--restore')
const ONLY_BUCKET = getOpt('--bucket')
const DATE = getOpt('--date') || new Date().toISOString().slice(0, 10)  // YYYY-MM-DD (UTC)

if (!/^\d{4}-\d{2}-\d{2}$/.test(DATE)) {
  console.error(`--date は YYYY-MM-DD 形式で指定する（受領: ${DATE}）`)
  process.exit(1)
}

// ── 接続先（既定ローカル。本番は env で明示）─────────────
const URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || 'http://127.0.0.1:56321'
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!KEY) {
  console.error('SUPABASE_SERVICE_ROLE_KEY が無い。全バケットを跨ぐには service_role キーが要る（README 参照）')
  process.exit(1)
}
const sb = createClient(URL, KEY, { auth: { persistSession: false } })

console.log(`接続先: ${URL}`)
console.log(`モード: ${RESTORE ? '復元(restore)' : 'バックアップ(backup)'}${DRY ? ' [dry-run]' : ''}  日付: ${DATE}`)
if (RESTORE && !DRY) console.log('⚠ 復元は現行ファイルを upsert で上書きします')

// ── バケット内を再帰的に列挙（folder は id=null で返る）──
async function listAll(bucket, prefix = '') {
  const out = []
  const pageSize = 100
  let offset = 0
  for (;;) {
    const { data, error } = await sb.storage.from(bucket).list(prefix, {
      limit: pageSize, offset, sortBy: { column: 'name', order: 'asc' },
    })
    if (error) throw new Error(`list 失敗 ${bucket}/${prefix}: ${error.message}`)
    if (!data || data.length === 0) break
    for (const entry of data) {
      const path = prefix ? `${prefix}/${entry.name}` : entry.name
      if (entry.id === null) {
        // フォルダ → 再帰
        out.push(...await listAll(bucket, path))
      } else {
        out.push(path)
      }
    }
    if (data.length < pageSize) break
    offset += pageSize
  }
  return out
}

// ── 1 オブジェクトを src バケット→dst バケットへコピー ──
//  Supabase JS の copy はバケット内限定のためクロスバケットは download→upload で行う。
async function copyObject(srcBucket, srcPath, dstBucket, dstPath) {
  const { data, error } = await sb.storage.from(srcBucket).download(srcPath)
  if (error) throw new Error(`download 失敗 ${srcBucket}/${srcPath}: ${error.message}`)
  const buf = new Uint8Array(await data.arrayBuffer())
  const contentType = data.type || 'application/octet-stream'
  const { error: upErr } = await sb.storage.from(dstBucket).upload(dstPath, buf, {
    upsert: true, contentType,
  })
  if (upErr) throw new Error(`upload 失敗 ${dstBucket}/${dstPath}: ${upErr.message}`)
}

// ── バックアップ ─────────────────────────────────────
async function runBackup() {
  const { data: buckets, error } = await sb.storage.listBuckets()
  if (error) { console.error('listBuckets 失敗:', error.message); process.exit(1) }
  let targets = buckets.map(b => b.id).filter(id => id !== BACKUP_BUCKET)
  if (ONLY_BUCKET) targets = targets.filter(id => id === ONLY_BUCKET)
  if (targets.length === 0) { console.error('対象バケットが無い'); process.exit(1) }
  console.log(`対象バケット: ${targets.join(', ')}`)

  let total = 0, failed = 0
  for (const bucket of targets) {
    const paths = await listAll(bucket)
    console.log(`\n[${bucket}] ${paths.length} 件`)
    for (const p of paths) {
      const dst = `${DATE}/${bucket}/${p}`
      if (DRY) { console.log(`  would copy → ${BACKUP_BUCKET}/${dst}`); total++; continue }
      try {
        await copyObject(bucket, p, BACKUP_BUCKET, dst)
        total++
        if (total % 50 === 0) console.log(`  ...${total} 件コピー済み`)
      } catch (e) { failed++; console.error(`  NG ${bucket}/${p}: ${e.message}`) }
    }
  }
  console.log(`\n完了: ${DRY ? '(dry-run) ' : ''}${total} 件${failed ? ` / 失敗 ${failed} 件` : ''}`)
  if (failed) process.exit(1)
}

// ── 復元 ─────────────────────────────────────────────
async function runRestore() {
  const snapshotRoot = DATE
  const snap = await sb.storage.from(BACKUP_BUCKET).list(snapshotRoot, { limit: 1000 })
  if (snap.error) { console.error('スナップショット一覧失敗:', snap.error.message); process.exit(1) }
  let bucketDirs = (snap.data || []).filter(e => e.id === null).map(e => e.name)
  if (bucketDirs.length === 0) { console.error(`backups/${DATE}/ にスナップショットが無い`); process.exit(1) }
  if (ONLY_BUCKET) bucketDirs = bucketDirs.filter(n => n === ONLY_BUCKET)
  if (bucketDirs.length === 0) { console.error(`backups/${DATE}/${ONLY_BUCKET}/ が無い`); process.exit(1) }
  console.log(`復元対象バケット: ${bucketDirs.join(', ')}`)

  let total = 0, failed = 0
  for (const bucket of bucketDirs) {
    const prefix = `${snapshotRoot}/${bucket}`
    const paths = await listAll(BACKUP_BUCKET, prefix)  // backups 内のフルパス
    console.log(`\n[復元 → ${bucket}] ${paths.length} 件`)
    for (const full of paths) {
      const rel = full.slice(prefix.length + 1)  // 元バケット内のパス
      if (DRY) { console.log(`  would restore → ${bucket}/${rel}`); total++; continue }
      try {
        await copyObject(BACKUP_BUCKET, full, bucket, rel)
        total++
        if (total % 50 === 0) console.log(`  ...${total} 件復元済み`)
      } catch (e) { failed++; console.error(`  NG ${full}: ${e.message}`) }
    }
  }
  console.log(`\n復元完了: ${DRY ? '(dry-run) ' : ''}${total} 件${failed ? ` / 失敗 ${failed} 件` : ''}`)
  if (failed) process.exit(1)
}

try {
  await (RESTORE ? runRestore() : runBackup())
} catch (e) {
  console.error('致命的エラー:', e.message)
  process.exit(1)
}
