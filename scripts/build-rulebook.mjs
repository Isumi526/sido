// 従業員向けルールブックPDFを生成（liff画面キャプチャ＋HTML→PDF・Playwright）
//  使い方: liff dev(localhost:3000)起動中に  node scripts/build-rulebook.mjs
//  出力: docs/従業員向けルールブック.pdf ／ キャプチャ: docs/rulebook-assets/
import { chromium } from '@playwright/test'
import fs from 'fs'
import path from 'path'

const LIFF = process.env.LIFF_URL || 'http://localhost:3000'
const ASSETS = 'docs/rulebook-assets'
const OUT = 'docs/従業員向けルールブック.pdf'
fs.mkdirSync(ASSETS, { recursive: true })

const SHOTS = [
  { route: '/',        name: 'home',     wait: 2500, caption: 'ホーム画面のメニュー（「出退勤」「残業申請」など）' },
  { route: '/checkin', name: 'checkin',  wait: 2500, caption: '出退勤：QRが無い現場はメニューから選択（元請け・現場名で絞り込み）' },
  { route: '/overtime',name: 'overtime', wait: 2500, caption: '残業申請：希望の終了時刻と理由を入力（当日15:00まで）' },
]

const browser = await chromium.launch()

// ── 1) liff画面キャプチャ（スマホ幅・テスターユーザー）──
const mob = await browser.newContext({ viewport: { width: 420, height: 900 }, deviceScaleFactor: 2 })
const mp = await mob.newPage()
const shots = []
for (const s of SHOTS) {
  try {
    await mp.goto(LIFF + s.route, { waitUntil: 'networkidle', timeout: 25000 })
    await mp.waitForTimeout(s.wait)
    const file = path.join(ASSETS, s.name + '.png')
    await mp.screenshot({ path: file, fullPage: false })
    shots.push({ ...s, b64: fs.readFileSync(file).toString('base64') })
    console.log('✓ shot', s.name)
  } catch (e) { console.log('✗ shot', s.name, String(e).slice(0, 80)) }
}
await mob.close()

// ── 2) ルールブックHTML（rules.vue と同内容＋キャプチャ）──
const today = new Date().toISOString().split('T')[0]
const sec = (n, title, items) => `
  <section class="card">
    <h2 class="sec"><span class="num">${n}</span>${title}</h2>
    <ul>${items.map(i => `<li>${i}</li>`).join('')}</ul>
  </section>`
const shot = (s) => s ? `
  <figure class="shot">
    <img src="data:image/png;base64,${s.b64}" />
    <figcaption>${s.caption}</figcaption>
  </figure>` : ''
const byName = (n) => shots.find(s => s.name === n)

const html = `<!doctype html><html lang="ja"><head><meta charset="utf-8"><style>
  * { box-sizing: border-box; }
  body { font-family: -apple-system, "Hiragino Kaku Gothic ProN", "Noto Sans JP", sans-serif; color: #1f2937; margin: 0; }
  .page { padding: 28px 32px; }
  h1.ttl { font-size: 24px; font-weight: 800; margin: 0 0 4px; color: #0f172a; }
  .lead { font-size: 13px; color: #4b5563; line-height: 1.8; margin: 0 0 18px; }
  .card { background: #fff; border: 1px solid #e5e7eb; border-radius: 12px; padding: 14px 18px; margin-bottom: 12px; page-break-inside: avoid; }
  .sec { display: flex; align-items: center; gap: 8px; font-size: 16px; font-weight: 700; color: #0f172a; margin: 0 0 10px; }
  .num { display: inline-flex; align-items: center; justify-content: center; width: 24px; height: 24px; border-radius: 6px; background: #0d9488; color: #fff; font-size: 14px; font-weight: 700; }
  ul { margin: 0; padding-left: 20px; }
  li { font-size: 13px; line-height: 1.85; margin-bottom: 6px; }
  strong { color: #0f172a; }
  .shots { display: flex; gap: 16px; flex-wrap: wrap; margin-top: 6px; page-break-inside: avoid; }
  .shot { margin: 0; width: 31%; }
  .shot img { width: 100%; border: 1px solid #e5e7eb; border-radius: 10px; }
  .shot figcaption { font-size: 10.5px; color: #6b7280; line-height: 1.5; margin-top: 6px; }
  .shots-title { font-size: 16px; font-weight: 700; color: #0f172a; margin: 22px 0 10px; }
  .note { font-size: 11px; color: #6b7280; line-height: 1.6; margin-top: 18px; }
  .meta { font-size: 11px; color: #94a3b8; margin: 0 0 16px; }
</style></head><body><div class="page">
  <h1 class="ttl">従業員向けルールブック</h1>
  <p class="meta">最終更新: ${today}</p>
  <p class="lead">日々の運用ルールをまとめています。提出・申請の期限を守って、正確な記録にご協力ください。</p>
  ${sec(1, '日報・経費の提出と編集', [
    '提出・編集ができるのは<strong>「当日を含む過去3日以内」</strong>です（本日／前日／前々日まで）。',
    'それより前の日付は<strong>ロックされ、提出・編集できません</strong>。日報・経費のどちらも対象です。',
    'やむを得ず期限を過ぎた分を直したいときは、<strong>管理者へ許可を依頼</strong>してください。許可されると、その日に限り再度入力できます。',
    '提出忘れを防ぐため、未提出のリマインドが届きます。早めの提出をお願いします。',
  ])}
  ${sec(2, '残業の申請', [
    '残業が発生する日は、<strong>当日の15:00までに残業申請</strong>を行ってください。',
    'メニューの<strong>「残業申請」</strong>から、希望の終了時刻と理由を入力して申請します。管理者が承認すると、その日だけ定時を超える終了時刻を入力できます。',
    '未申請の日は、<strong>定時（終了時刻）以降の入力ができません</strong>。',
  ])}
  ${sec(3, '勤務時間の基準', [
    '勤務時間は、<strong>現場ごとに担当者が設定した開始／終了時刻が基準</strong>になります。',
    '早朝搬入など例外的に時間がずれる場合は、残業申請で対応してください。',
  ])}
  ${sec(4, '出退勤の打刻', [
    '現場への<strong>到着時と退出時の打刻は必須</strong>です。忘れずに行ってください。',
    '打刻は<strong>現場のQRコードを読み取る</strong>か、メニューの<strong>「出退勤」</strong>から行えます。',
    'QRコードが無い現場は、<strong>「出退勤」から現場を選んで</strong>打刻してください（元請けや現場名で絞り込めます）。',
    '確認事項（チェック項目）が設定された現場では、出退勤時に確認のうえチェックしてください。',
  ])}
  <div class="shots-title">📱 アプリの画面</div>
  <div class="shots">
    ${shot(byName('home'))}
    ${shot(byName('checkin'))}
    ${shot(byName('overtime'))}
  </div>
  <p class="note">※ 本ルールは運用に合わせて更新されることがあります。最新の内容はアプリの「ルールブック」ページでご確認ください。</p>
</div></body></html>`

// ── 3) HTML→PDF ──
const pctx = await browser.newContext()
const pp = await pctx.newPage()
await pp.setContent(html, { waitUntil: 'networkidle' })
await pp.pdf({ path: OUT, format: 'A4', printBackground: true, margin: { top: '12mm', bottom: '12mm', left: '10mm', right: '10mm' } })
await browser.close()
console.log('\n✓ PDF生成:', OUT, '（キャプチャ', shots.length, '枚）')
