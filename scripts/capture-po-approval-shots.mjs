#!/usr/bin/env node
// ============================================================
//  capture-po-approval-shots.mjs
//  お客様説明用に「注文書発行」と「承認まわり」の実画面を撮る。
//
//  ★本番は絶対に見ない。ローカルスタック固定（他社のデータを資料に写さないため）。
//  ★本番では見積もり機能フラグがOFFで注文書の画面に入れないので、
//   ローカル（フラグON）で撮る。撮れる画面＝実装は出来ている、の証拠にもなる。
//
//  使い方: node scripts/capture-po-approval-shots.mjs
//  出力:   docs/reports/shots/*.png
// ============================================================
import { chromium } from 'playwright'
import { mkdirSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'

function loadEnv(p) {
  try {
    const out = {}
    for (const line of readFileSync(p, 'utf8').split('\n')) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/)
      if (m) out[m[1]] = m[2].replace(/^["']|["']$/g, '')
    }
    return out
  } catch { return {} }
}
const env = { ...loadEnv(resolve('apps/admin/.env')), ...loadEnv(resolve('apps/admin/.env.local')) }
if (!/127\.0\.0\.1|localhost/.test(String(env.VITE_SUPABASE_URL))) {
  console.error(`本番/リモートには繋がない: ${env.VITE_SUPABASE_URL}`); process.exit(1)
}

const OUT = 'docs/reports/shots'
mkdirSync(OUT, { recursive: true })

/** 画面を撮る。固定ナビ・devtools を消してから、指定の高さだけ切り出す */
async function shot(page, name, height = 620, { keepFixed = false } = {}) {
  await page.evaluate((keep) => {
    // ★モーダルは position:fixed のオーバーレイ。固定要素を一律に消すと
    //  「モーダルを撮りたいのにモーダルだけ消える」（実際に踏んだ）。
    if (!keep) {
      for (const el of document.querySelectorAll('body *')) {
        if (getComputedStyle(el).position === 'fixed') el.style.display = 'none'
      }
    }
    for (const el of document.querySelectorAll('#nuxt-devtools-container')) el.remove()
  }, keepFixed)
  await page.waitForTimeout(200)
  // ★要素指定は「その画面に無い/隠した」時に無言で固まる（実際に踏んだ）。
  //  座標で切る方が、何が写るか予測できて安定する。
  await page.screenshot({ path: `${OUT}/${name}.png`, clip: { x: 216, y: 0, width: 1056, height } })
  console.log(`✓ ${OUT}/${name}.png`)
}

// ── 承認画面の説明用データ（二重承認のバッジが写るようにする）──
//  ★空の画面を貼っても「どう見えるか」が伝わらない。説明用に1件だけ作る。
const SRV = env.SUPABASE_SERVICE_ROLE_KEY || env.VITE_SUPABASE_SERVICE_ROLE_KEY
const srest = async (path, init = {}) => {
  const r = await fetch(`${env.VITE_SUPABASE_URL}/rest/v1/${path}`, {
    ...init,
    headers: { apikey: SRV, Authorization: `Bearer ${SRV}`, 'Content-Type': 'application/json', ...(init.headers || {}) },
  })
  const t = await r.text()
  if (!r.ok) throw new Error(`${r.status} ${path} ${t}`)
  return t ? JSON.parse(t) : null
}
const acct = (await srest(`accounts?slug=eq.${env.VITE_ACCOUNT_SLUG || 'test'}&select=id`))[0].id
const anyUser = (await srest(`users?account_id=eq.${acct}&select=id&limit=1`))[0].id
const DEMO_DATE = '2026-02-20'
await srest(`daily_report_pending_edits?report_date=eq.${DEMO_DATE}&account_id=eq.${acct}`, { method: 'DELETE' }).catch(() => {})
await srest('daily_report_pending_edits', {
  method: 'POST', headers: { Prefer: 'return=minimal' },
  body: JSON.stringify({
    account_id: acct, report_id: null, report_user_id: anyUser, report_date: DEMO_DATE,
    kind: 'late_new', status: 'pending', reason: '打刻を忘れていたため、後から提出します',
    submitted_by_user_id: anyUser, submitted_by_name: '山田 太郎',
    submitted_at: new Date().toISOString(), requires_dual: true, approvals: [],
    payload: { is_working: true, sites: [{ siteName: '説明用現場', workers: [], subcontractors: [],
               expenses: { others: [{ label: '資材', yen: 12000 }] } }] },
  }),
})
console.log('説明用の承認待ちを1件用意した')

const browser = await chromium.launch()
try {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, deviceScaleFactor: 2 })
  const page = await ctx.newPage()
  await page.goto('http://localhost:3001/login?id=e2e&pass=e2e-pass-1234', { waitUntil: 'networkidle' })
  await page.waitForTimeout(1500)

  // ── 1. 注文書発行の一覧 ──
  await page.goto('http://localhost:3001/purchase-orders', { waitUntil: 'networkidle' })
  await page.waitForTimeout(1200)
  await shot(page, 'po-list', 560)

  // ── 2. 「＋ 注文書を発行」のモーダル（何を選ぶのかを見せる） ──
  //  ★click しただけで撮ると、モーダルが出る前のフレームが写る（実際に踏んだ）。
  //   モーダルが可視になるまで待ってから撮る。
  await page.locator('[data-testid="po-add"], button:has-text("注文書を発行")').first().click()
  const modal = page.locator('.modal, [class*="modal"]').first()
  await modal.waitFor({ state: 'visible', timeout: 8000 }).catch(() => {})
  await page.waitForTimeout(600)
  await shot(page, 'po-issue-modal', 760, { keepFixed: true })

  // ── 3. 承認まわり: 日報編集の承認画面 ──
  await page.goto('http://localhost:3001/report-edit-review', { waitUntil: 'networkidle' })
  await page.waitForTimeout(1200)
  await shot(page, 'approval-review', 700)
} finally {
  await browser.close()
  // 説明用データは残さない（共有DBなので他のテストに混ざる）
  await srest(`daily_report_pending_edits?report_date=eq.${DEMO_DATE}&account_id=eq.${acct}`, { method: 'DELETE' }).catch(() => {})
}
