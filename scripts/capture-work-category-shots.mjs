#!/usr/bin/env node
// ============================================================
//  capture-work-category-shots.mjs
//  お客様への説明資料に入れる「実際の画面」を撮る。
//
//  ★なぜスクリプトにするか（2026-08-17）:
//   文章だけの報告書だと、何がどう変わったのか読む側が想像するしかない。
//   実画面を貼れば一目で伝わる。ただし手で撮ると、
//    - 撮り直すたびに写っているデータが違う
//    - 本番テナントで撮ってしまい他社の情報が混ざる
//   ので、ローカルに説明用のデータを作って撮る、を機械化する。
//
//  ★本番は絶対に見ない。ローカルスタック(56321)固定。
//
//  使い方: node scripts/capture-work-category-shots.mjs
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
const env = {
  ...loadEnv(resolve('apps/admin/.env')),
  ...loadEnv(resolve('apps/admin/.env.local')),
}
const SUPABASE_URL = env.VITE_SUPABASE_URL
const SRV = env.SUPABASE_SERVICE_ROLE_KEY || env.VITE_SUPABASE_SERVICE_ROLE_KEY
const SLUG = env.VITE_ACCOUNT_SLUG || 'test'

if (!/127\.0\.0\.1|localhost/.test(String(SUPABASE_URL))) {
  console.error(`本番/リモートには繋がない: ${SUPABASE_URL}`); process.exit(1)
}

const OUT = 'docs/reports/shots'
mkdirSync(OUT, { recursive: true })

async function rest(path, init = {}) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...init,
    headers: { apikey: SRV, Authorization: `Bearer ${SRV}`, 'Content-Type': 'application/json', ...(init.headers || {}) },
  })
  const t = await r.text()
  if (!r.ok) throw new Error(`${r.status} ${path} ${t}`)
  return t ? JSON.parse(t) : null
}

// ── 説明用データ: シード様と同じ形（事務所（名古屋）は事務が 08:00-18:30）──
const accountId = (await rest(`accounts?slug=eq.${SLUG}&select=id`))[0].id
const SITE = '事務所（名古屋）'

let site = (await rest(`sites?account_id=eq.${accountId}&name=eq.${encodeURIComponent(SITE)}&select=id`))[0]
if (!site) {
  site = (await rest('sites', {
    method: 'POST', headers: { Prefer: 'return=representation' },
    body: JSON.stringify({ account_id: accountId, name: SITE, active: true, sort_order: 1 }),
  }))[0]
}
const cats = await rest(`work_categories?account_id=eq.${accountId}&select=id,name`)
const jimu = cats.find(c => c.name === 'その他事務')
if (jimu) {
  await rest('site_category_hours?on_conflict=site_id,category_id', {
    method: 'POST',
    headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
    body: JSON.stringify({
      account_id: accountId, site_id: site.id, category_id: jimu.id,
      default_start_time: '08:00', default_end_time: '18:30',
    }),
  })
}
console.log(`説明用データを用意: ${SITE}（${cats.length}区分）`)

const browser = await chromium.launch()
try {
  // ── 1. 日報の画面（作業員が見るもの）──
  const phone = await browser.newContext({ viewport: { width: 420, height: 900 }, deviceScaleFactor: 2 })
  const p = await phone.newPage()
  await p.goto('http://localhost:3000/report', { waitUntil: 'networkidle' })
  await p.locator('[data-testid="site-select-0"]').waitFor({ timeout: 20000 })
  await p.locator('[data-testid="site-select-0"]').selectOption(SITE)
  await p.locator('[data-testid="work-category-0"]').waitFor({ timeout: 10000 })
  // 区分を「その他事務」にする。この現場×区分に 08:00-18:30 を入れてあるので、
  // 「区分で定時が変わる」ことが1枚で伝わる
  const jimuId = jimu?.id
  if (jimuId) await p.locator('[data-testid="work-category-0"]').selectOption(jimuId)
  await p.waitForTimeout(700)

  // ★画面下に固定のナビ（と中央の丸いホームボタン）が居る。fullPage で撮ると
  //  本文の上に重なって写る。クラス名で狙うと取りこぼすので、実際の計算済みスタイルが
  //  fixed/sticky のものを全部消す
  await p.evaluate(() => {
    for (const el of document.querySelectorAll('body *')) {
      const pos = getComputedStyle(el).position
      if (pos === 'fixed' || pos === 'sticky') el.style.display = 'none'
    }
    // Nuxt devtools のバッジ。dev サーバーで撮るので必ず写り込む。
    // 実体は #nuxt-devtools-container / nuxt-devtools-* のカスタム要素（shadow root）
    for (const el of document.querySelectorAll('#nuxt-devtools-container, nuxt-devtools-frame, nuxt-devtools-inspect-panel')) el.remove()
  })
  await p.waitForTimeout(200)

  // 現場・区分・作業時刻・定時の注意書きが1枚に入るところを切り出す。
  // ★boundingBox は画面内座標、fullPage の clip はページ座標なので scrollY を足す
  const clip = await p.evaluate(() => {
    const q = (t) => document.querySelector(`[data-testid="${t}"]`)
    const top = q('site-select-0').getBoundingClientRect()
    const bot = q('end-time-0').getBoundingClientRect()
    // 「この現場の固定終了時刻は…」の注意書きまで入れると、定時が効いていることが伝わる
    const hint = [...document.querySelectorAll('div,p')].find(e => /固定終了時刻/.test(e.textContent || '')
      && e.getBoundingClientRect().top > bot.top)
    const bottom = hint ? hint.getBoundingClientRect().bottom : bot.bottom
    const y = top.top + window.scrollY - 84
    return { x: 6, y: Math.max(0, y), width: 408, height: (bottom + window.scrollY + 6) - y }
  })
  await p.screenshot({ path: `${OUT}/report-category.png`, fullPage: true, clip })
  console.log(`✓ ${OUT}/report-category.png`)
  await phone.close()

  // ── 2. 管理画面の作業区分マスタ ──
  const desk = await browser.newContext({ viewport: { width: 1180, height: 900 }, deviceScaleFactor: 2 })
  const a = await desk.newPage()
  await a.goto('http://localhost:3001/login?id=e2e&pass=e2e-pass-1234', { waitUntil: 'networkidle' })
  await a.waitForTimeout(1500)
  await a.goto('http://localhost:3001/work-categories', { waitUntil: 'networkidle' })
  await a.waitForTimeout(1500)
  // ★左のサイドバーを座標で切ろうとすると、肝心の「区分名」列まで切ってしまう（実際にやった）。
  //  本文の要素そのものを撮る。
  //  要素ぴったりで撮ると見出しの1文字目が欠けるので、撮影用に余白を足す
  await a.addStyleTag({ content: '.page-header { padding-top: 0 !important; } .page-header { margin-left: 6px }' })
  const main = a.locator('.page-header').locator('xpath=..')
  await main.evaluate(el => { el.style.padding = '10px 14px'; el.style.background = '#fff' })
  await main.screenshot({ path: `${OUT}/admin-work-categories.png` })
  console.log(`✓ ${OUT}/admin-work-categories.png`)
  await desk.close()
} finally {
  await browser.close()
}
