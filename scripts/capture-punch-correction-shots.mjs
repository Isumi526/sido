#!/usr/bin/env node
// ============================================================
//  capture-punch-correction-shots.mjs
//  「打刻を間違えた時の直し方」を説明する資料用のキャプチャを撮る。
//  押す場所に赤丸／赤枠を重ねてから撮る（言葉で位置を説明しなくて済む）。
//
//  ★本番は絶対に見ない。ローカルスタック(56321)固定。
//  ★撮るデータもローカルで作る（他社の情報が混ざらないように）。
//
//  使い方: node --env-file=.env scripts/capture-punch-correction-shots.mjs
//  出力:   docs/reports/shots/punch-correction/*.png
//  前提:   liff(3000) と admin(3001) の dev サーバーが起動していること
// ============================================================
import { chromium } from 'playwright'
import { mkdirSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { execFileSync } from 'node:child_process'

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
const SUPABASE_URL = env.VITE_SUPABASE_URL
if (!/127\.0\.0\.1|localhost/.test(String(SUPABASE_URL))) {
  console.error(`本番/リモートには繋がない: ${SUPABASE_URL}`); process.exit(1)
}
const DB = process.env.LOCAL_DB_URL
if (!DB || !/127\.0\.0\.1|localhost/.test(DB)) { console.error('LOCAL_DB_URL がローカルではありません'); process.exit(1) }
const psql = (sql) => execFileSync('psql', [DB, '-tAc', sql], { encoding: 'utf8' }).trim()

const OUT = 'docs/reports/shots/punch-correction'
mkdirSync(OUT, { recursive: true })

// ── 説明用データ: 実際に起きた「押し間違いの連鎖」を再現する ──
const workerId = psql(`select w.id from users u join workers w on w.id = u.worker_id where u.line_user_id = 'dev-user-id' limit 1`)
psql(`delete from attendance_correction_requests where log_id in (
        select id from attendance_logs where worker_id='${workerId}' and checked_at > now() - interval '7 days')`)
psql(`delete from attendance_logs where worker_id='${workerId}' and checked_at > now() - interval '7 days'`)
for (const [offset, hhmm, type, back] of [[1,'17:45','checkout',true],[1,'17:58','checkin',false],[0,'08:05','checkout',false]]) {
  psql(`insert into attendance_logs (worker_id, type, checked_at, agreed_rule_texts, backdated)
        values ('${workerId}','${type}',
          (((now() at time zone 'Asia/Tokyo')::date - ${offset}) + time '${hhmm}') at time zone 'Asia/Tokyo','{}',${back})`)
}
console.log('説明用データを用意しました（押し間違いの連鎖を再現）')

/** 画面から邪魔なものを消す（下部固定ナビ・Nuxt devtools） */
async function clean(p, { keepFixed = false } = {}) {
  await p.evaluate((keep) => {
    if (!keep) {
      for (const el of document.querySelectorAll('body *')) {
        const pos = getComputedStyle(el).position
        if (pos === 'fixed' || pos === 'sticky') el.style.display = 'none'
      }
    }
    for (const el of document.querySelectorAll('#nuxt-devtools-container, nuxt-devtools-frame, nuxt-devtools-inspect-panel')) el.remove()
  }, keepFixed)
  await p.waitForTimeout(150)
}

/**
 * 押す場所に赤丸/赤枠を重ねる。★要素の位置に絶対配置で被せるだけ（画面自体は変えない）。
 * shape: 'circle'=丸で囲む / 'box'=角丸の枠で囲む
 */
async function mark(p, selector, { shape = 'circle', pad = 8, label = '', place = 'auto' } = {}) {
  await p.evaluate(({ selector, shape, pad, label, place }) => {
    const el = document.querySelector(selector)
    if (!el) return
    const r = el.getBoundingClientRect()
    const d = document.createElement('div')
    d.className = 'shot-marker'
    Object.assign(d.style, {
      position: 'absolute', zIndex: '99999', pointerEvents: 'none',
      left: `${r.left + window.scrollX - pad}px`, top: `${r.top + window.scrollY - pad}px`,
      width: `${r.width + pad * 2}px`, height: `${r.height + pad * 2}px`,
      border: '3px solid #e11d48',
      borderRadius: shape === 'circle' ? '999px' : '10px',
      boxShadow: '0 0 0 3px rgba(225,29,72,.18)',
    })
    document.body.appendChild(d)
    if (!label) return
    const t = document.createElement('div')
    t.className = 'shot-marker'
    t.textContent = label
    Object.assign(t.style, {
      position: 'absolute', zIndex: '99999', pointerEvents: 'none',
      background: '#e11d48', color: '#fff', fontSize: '13px', fontWeight: '700',
      padding: '3px 10px', borderRadius: '999px', whiteSpace: 'nowrap',
      fontFamily: '"Hiragino Sans", "Hiragino Kaku Gothic ProN", sans-serif',
      boxShadow: '0 2px 6px rgba(0,0,0,.2)',
    })
    document.body.appendChild(t)
    // ★ラベルは枠の外側に出す。枠の上に重ねると、その下の本文が読めなくなる
    //  （最初これで「何を直しますか」の見出しが隠れた）。右に余白があれば右、
    //  無ければ枠の上、それも無ければ枠の下に置く。
    const lw = t.getBoundingClientRect().width
    const boxRight = r.right + pad
    if (boxRight + 8 + lw < window.innerWidth) {
      t.style.left = `${boxRight + 8 + window.scrollX}px`
      t.style.top = `${r.top + window.scrollY + r.height / 2 - 12}px`
    } else if (r.top - pad - 30 > 0) {
      // ★上に置く時は右寄せ。項目名（「何を直しますか」等）は左揃えなので、
      //  左寄せにすると項目名を隠してしまう（最初これで隠れた）。
      t.style.left = `${Math.max(4, r.right + pad - lw) + window.scrollX}px`
      t.style.top = `${r.top + window.scrollY - pad - 28}px`
    } else {
      t.style.left = `${r.left + window.scrollX - pad}px`
      t.style.top = `${r.bottom + window.scrollY + pad + 6}px`
    }
  }, { selector, shape, pad, label, place })
  await p.waitForTimeout(100)
}

/** マーカーを全部消す（撮り直す前に必ず呼ぶ） */
const clearMarks = (p) => p.evaluate(() => document.querySelectorAll('.shot-marker').forEach(e => e.remove()))

/** 対象が画面に収まるところまでスクロールする（画面外のものに赤丸を付けても伝わらない） */
async function scrollTo(p, selector) {
  await p.evaluate((sel) => {
    const el = document.querySelector(sel)
    if (el) el.scrollIntoView({ block: 'center' })
  }, selector)
  await p.waitForTimeout(400)
}

const shot = async (p, name) => { await p.screenshot({ path: `${OUT}/${name}.png` }); console.log(`✓ ${OUT}/${name}.png`) }

const browser = await chromium.launch()
try {
  // ── 作業員側（スマホ） ──
  const phone = await browser.newContext({ viewport: { width: 390, height: 780 }, deviceScaleFactor: 2 })
  const p = await phone.newPage()
  await p.goto('http://localhost:3000/checkin', { waitUntil: 'networkidle' })
  await p.waitForTimeout(2500)
  await clean(p, { keepFixed: true })

  // 1) 入口
  await mark(p, '[data-testid="more-actions"] summary', { shape: 'box', label: '① ここを開く' })
  await shot(p, '01-entry')

  // 2) 修正申請を開く
  await p.reload({ waitUntil: 'networkidle' }); await p.waitForTimeout(2200); await clean(p, { keepFixed: true })
  await p.locator('[data-testid="more-actions"] summary').click()
  await p.waitForTimeout(500)
  await mark(p, '[data-testid="fix-open"]', { shape: 'box', label: '② 修正申請を開く' })
  await shot(p, '02-open-fix')

  // 3) 直したい打刻を選ぶ
  await p.reload({ waitUntil: 'networkidle' }); await p.waitForTimeout(2200); await clean(p, { keepFixed: true })
  await p.locator('[data-testid="more-actions"] summary').click(); await p.waitForTimeout(400)
  await p.locator('[data-testid="fix-open"]').click(); await p.waitForTimeout(1500)
  const firstLog = await p.evaluate(() => document.querySelector('[data-testid^="fix-pick-"]')?.getAttribute('data-testid') ?? '')
  await mark(p, `[data-testid="${firstLog}"]`, { shape: 'circle', pad: 10, label: '③ 直したい打刻を選ぶ' })
  await shot(p, '03-pick')

  // 4) 内容と理由を入れて申請
  await p.locator(`[data-testid="${firstLog}"]`).check(); await p.waitForTimeout(600)
  await clearMarks(p)
  await p.locator('[data-testid="fix-reason"]').fill('出勤のつもりで退勤を押してしまった')
  await p.waitForTimeout(300)
  await scrollTo(p, '[data-testid="fix-submit"]')
  await mark(p, '[data-testid="fix-kind"]', { shape: 'box', pad: 6, label: '④ 何を直すか' })
  await mark(p, '[data-testid="fix-reason"]', { shape: 'box', pad: 6, label: '⑤ 理由' })
  await mark(p, '[data-testid="fix-submit"]', { shape: 'box', pad: 6, label: '⑥ 申請' })
  await shot(p, '04-submit')

  // 5) 申請後（申請中の表示）
  await clearMarks(p)
  await p.locator('[data-testid="fix-submit"]').click()
  await p.waitForTimeout(2500)
  const pendingId = await p.evaluate(() => document.querySelector('[data-testid^="fix-pending-"]')?.getAttribute('data-testid') ?? '')
  if (pendingId) await mark(p, `[data-testid="${pendingId}"]`, { shape: 'box', pad: 6, label: '承認待ち' })
  await shot(p, '05-requested')
  await phone.close()

  // ── 管理者側（PC） ──
  const desk = await browser.newContext({ viewport: { width: 1180, height: 860 }, deviceScaleFactor: 2 })
  const a = await desk.newPage()
  await a.goto('http://localhost:3001/login?id=e2e&pass=e2e-pass-1234', { waitUntil: 'networkidle' })
  await a.waitForTimeout(3000)
  await a.goto('http://localhost:3001/punch-corrections', { waitUntil: 'networkidle' })
  await a.waitForTimeout(2500)

  // 6) メニューの入口（バッジ付き）
  await mark(a, 'a[href="/punch-corrections"]', { shape: 'box', pad: 6, label: '① メニュー' })
  const approveId = await a.evaluate(() => document.querySelector('[data-testid^="pc-approve-"]')?.getAttribute('data-testid') ?? '')
  if (approveId) await mark(a, `[data-testid="${approveId}"]`, { shape: 'box', pad: 8, label: '② 内容を見て承認' })
  await shot(a, '06-approve')

  // 7) 承認したあとの勤怠ログ（元の値が残っていることを見せる）
  if (approveId) { await a.locator(`[data-testid="${approveId}"]`).click(); await a.waitForTimeout(2500) }
  await a.goto('http://localhost:3001/attendance', { waitUntil: 'networkidle' })
  await a.waitForTimeout(2500)
  await scrollTo(a, '[data-testid="log-corrected"]')
  // ★右に置くと「元: 退勤」や作業員名の上に重なる。ここは下に置く
  await mark(a, '[data-testid="log-corrected"]', { shape: 'box', pad: 6, label: '直った打刻（元の値も残る）', place: 'below' })
  await shot(a, '07-after')
  await desk.close()
} finally {
  await browser.close()
}
console.log('完了')
