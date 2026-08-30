<template>
  <div>
    <div class="page-header">
      <h1 class="page-title">データの一括ダウンロード</h1>
    </div>
    <p class="hint">
      自社のデータをまとめてCSV（ZIP）で取り出します。解約後や利用を止めている間でも
      手元に記録を残せるようにするためのものです。
      <br>労働基準法109条で、日報・賃金台帳などは<b>5年間（当面3年）の保存義務</b>があります。
    </p>

    <div v-if="!canManageAuth" class="empty" data-testid="export-forbidden">
      この操作はオーナー権限のアカウントのみ行えます。
    </div>

    <template v-else>
      <div class="reminder-box">
        <div class="reminder-title">取り出す範囲</div>
        <div class="reminder-config">
          <label v-for="t in TARGETS" :key="t.key" class="pick-row">
            <input v-model="picked" type="checkbox" :value="t.key" :data-testid="`pick-${t.key}`" />
            <span class="pick-label">{{ t.label }}</span>
            <span class="pick-note">{{ t.note }}</span>
          </label>

          <div class="config-row" style="margin-top:12px">
            <button
              class="btn-save" :disabled="busy || !picked.length"
              data-testid="export-run" @click="run"
            >{{ busy ? `作成中… ${progress}` : 'ZIPをダウンロード' }}</button>
          </div>
          <p v-if="msg" class="hint" data-testid="export-result">{{ msg }}</p>
        </div>
      </div>
    </template>
  </div>
</template>

<script setup lang="ts">
// ============================================================
//  会社アカウント単位の全データ一括エクスポート（契約対応③）
//
//  ★なぜ要るか: 契約 別紙1§10 が「勤怠・日報・経費・台帳・取引先をCSV一括出力できる」と
//   書いているのに、実装は画面ごとのCSV/ZIPしか無く、契約と実態がズレていた。
//   解約時・利用停止中のデータ取得権（労基法109条の保存義務）への布石でもある。
//
//  ★権限はオーナーのみ（canManageAuth）。全社のデータを丸ごと持ち出す操作なので、
//   経理(office)や現場管理者には開かない。
//
//  ★他テナントが混ざらないこと: 取得は必ず account_id で絞る。ここを緩めると
//   「自社のデータを取ったつもりで他社のものが入っている」になる。
//
//  ★件数が多くても落ちないように、1000件ずつページングして取る
//   （PostgREST の既定上限で黙って千件で切れるのを防ぐ）。
// ============================================================
import { ref, computed } from 'vue'
import JSZip from 'jszip'
import { supabase } from '../lib/supabase'
import { getAccountId } from '../lib/account'
import { canManageAuth } from '../lib/auth'

type Target = { key: string; label: string; note: string; table: string; columns: string }

// ★契約 別紙1§10 の記載（勤怠・日報・経費・台帳・取引先）に対応させる。
//  増やす時は契約の記載と食い違わないか確認すること。
const TARGETS: Target[] = [
  { key: 'daily_reports', label: '日報', note: '稼働・作業時間・経費・備考', table: 'daily_reports', columns: '*' },
  { key: 'attendance_logs', label: '出退勤の打刻', note: '出勤/退勤の記録', table: 'attendance_logs', columns: '*' },
  { key: 'workers', label: '作業員', note: '氏名・雇用条件・賃金', table: 'workers', columns: '*' },
  { key: 'sites', label: '現場', note: '現場台帳', table: 'sites', columns: '*' },
  { key: 'contractors', label: '元請け業者', note: '取引先（元請け）', table: 'contractors', columns: '*' },
  { key: 'subcontractors', label: '協力業者', note: '取引先（下請け）', table: 'subcontractors', columns: '*' },
  { key: 'subcontractor_invoices', label: '協力業者の請求', note: '請求書の記録', table: 'subcontractor_invoices', columns: '*' },
  { key: 'personal_expenses', label: '個人経費', note: '立替の申請', table: 'personal_expenses', columns: '*' },
  { key: 'paid_leave_grants', label: '有給の付与', note: '付与・失効', table: 'paid_leave_grants', columns: '*' },
  { key: 'overtime_requests', label: '残業申請', note: '申請と承認の記録', table: 'overtime_requests', columns: '*' },
]

const picked = ref<string[]>(TARGETS.map(t => t.key))
const busy = ref(false)
const progress = ref('')
const msg = ref('')

/** CSVの1セルを安全にする。改行・カンマ・引用符を含む値でも壊れないようにする */
function cell(v: unknown): string {
  if (v == null) return ''
  const s = typeof v === 'object' ? JSON.stringify(v) : String(v)
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

function toCsv(rows: Record<string, unknown>[]): string {
  if (!rows.length) return ''
  const cols = Object.keys(rows[0])
  const head = cols.map(cell).join(',')
  const body = rows.map(r => cols.map(c => cell(r[c])).join(',')).join('\n')
  return `${head}\n${body}`
}

/**
 * 1テーブルを全件取る。
 * ★PostgREST は既定で上限があり、range を使わないと黙って途中で切れる。
 *  「エクスポートしたのに一部しか入っていない」は気づけないので必ずページングする。
 */
async function fetchAll(table: string, accountId: string): Promise<Record<string, unknown>[]> {
  const PAGE = 1000
  const out: Record<string, unknown>[] = []
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase.from(table).select('*')
      .eq('account_id', accountId)             // ★他テナントを混ぜない
      .range(from, from + PAGE - 1)
    if (error) throw new Error(`${table}: ${error.message}`)
    out.push(...((data ?? []) as Record<string, unknown>[]))
    if (!data || data.length < PAGE) break
  }
  return out
}

async function run() {
  busy.value = true; msg.value = ''; progress.value = ''
  try {
    const accountId = await getAccountId()
    if (!accountId) throw new Error('アカウントを特定できませんでした')

    const zip = new JSZip()
    const targets = TARGETS.filter(t => picked.value.includes(t.key))
    const summary: string[] = ['ファイル名,種別,件数']

    for (let i = 0; i < targets.length; i++) {
      const t = targets[i]
      progress.value = `(${i + 1}/${targets.length}) ${t.label}`
      let rows: Record<string, unknown>[] = []
      try {
        rows = await fetchAll(t.table, accountId)
      } catch (e) {
        // 1つ失敗しても全体を捨てない。取れなかったことは中に書き残す（黙って欠落させない）
        summary.push(`${t.key}.csv,${t.label},取得できませんでした(${String((e as Error).message).slice(0, 80)})`)
        continue
      }
      summary.push(`${t.key}.csv,${t.label},${rows.length}`)
      // ★ファイル名は英字にする。日本語のファイル名を入れると、標準の解凍ソフト
      //  （macOSのアーカイブユーティリティ・Windowsのエクスプローラ）で文字化けしたり
      //  そもそも展開に失敗する（実際にテストで展開できなかった）。
      //  何のファイルかは同梱の _index.csv で対応づける。
      //  中身はBOM付き＝Excelで開いても文字化けしない。
      zip.file(`${t.key}.csv`, '﻿' + toCsv(rows))
    }

    // ★何がどれだけ入っているかを同梱する。空のCSVを見て「取れていない」のか
    //  「元から0件」なのか分からなくなるのを防ぐ。
    zip.file('_index.csv', '﻿' + summary.join('\n'))

    const blob = await zip.generateAsync({ type: 'blob' })
    const a = document.createElement('a')
    const stamp = new Date().toISOString().slice(0, 10)
    a.href = URL.createObjectURL(blob)
    a.download = `genlinks-export-${stamp}.zip`   // ★ZIP名も英字（解凍ソフトの文字化け回避）
    a.click()
    URL.revokeObjectURL(a.href)
    msg.value = `${targets.length}種類のデータをダウンロードしました`
  } catch (e) {
    msg.value = `作成できませんでした: ${String((e as Error).message)}`
  } finally {
    busy.value = false; progress.value = ''
  }
}
</script>

<style scoped>
.page-header { display: flex; align-items: baseline; gap: 12px; margin-bottom: 8px; }
.page-title { font-size: 22px; font-weight: 700; }
.hint { color: #6b7280; font-size: 13px; margin-bottom: 16px; line-height: 1.7; }
.empty { color: #6b7280; padding: 24px; text-align: center; }
.reminder-box { background: #fff; border-radius: 12px; box-shadow: 0 1px 4px rgba(0,0,0,.06); overflow: hidden; max-width: 720px; }
.reminder-title { padding: 10px 14px; font-weight: 700; font-size: 14px; background: #f9fafb; }
.reminder-config { padding: 14px; }
.pick-row { display: flex; align-items: center; gap: 10px; padding: 6px 0; font-size: 13px; }
.pick-label { font-weight: 600; min-width: 140px; }
.pick-note { color: #6b7280; font-size: 12px; }
.config-row { display: flex; gap: 10px; align-items: center; }
.btn-save { background: #047857; color: #fff; border: none; border-radius: 8px; padding: 8px 18px; font-size: 13px; font-weight: 700; cursor: pointer; }
.btn-save:disabled { opacity: .5; cursor: default; }
</style>
