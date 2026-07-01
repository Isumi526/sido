// 従業員向けルールブックPDFを生成（liff画面キャプチャ＋HTML→PDF・Playwright）
//  使い方: liff dev(localhost:3000)起動中に  node scripts/build-rulebook.mjs
//  出力: docs/従業員向けルールブック.pdf ／ キャプチャ: docs/rulebook-assets/
//  - 該当ナビ（出退勤/残業申請カード）に赤丸を重ねて撮影。
//  - キャプチャは各セクション内に配置。重要フレーズは赤線（HTML側 .hl）。
import { chromium } from '@playwright/test'
import fs from 'fs'
import path from 'path'

const LIFF = process.env.LIFF_URL || 'http://localhost:3000'
const ASSETS = 'docs/rulebook-assets'
const OUT = 'docs/従業員向けルールブック.pdf'
fs.mkdirSync(ASSETS, { recursive: true })

const browser = await chromium.launch()
const mob = await browser.newContext({ viewport: { width: 420, height: 820 }, deviceScaleFactor: 2 })
const mp = await mob.newPage()
const assets = {}
const b64 = (file) => fs.readFileSync(file).toString('base64')

// ホーム画面で指定ナビカードに赤丸を重ねて撮影
async function shotHomeRing(cardText, name) {
  await mp.goto(LIFF + '/', { waitUntil: 'networkidle', timeout: 25000 })
  await mp.waitForTimeout(2200)
  const card = mp.locator('.menu-card', { hasText: cardText }).first()
  const box = await card.boundingBox()
  if (box) {
    await mp.evaluate(({ x, y, w, h }) => {
      const d = document.createElement('div')
      d.id = '__ring__'
      d.style.cssText = `position:fixed;left:${x - 7}px;top:${y - 7}px;width:${w + 14}px;height:${h + 14}px;border:4px solid #ef4444;border-radius:16px;z-index:99999;pointer-events:none;box-shadow:0 0 0 4px rgba(239,68,68,.22)`
      document.body.appendChild(d)
    }, { x: box.x, y: box.y, w: box.width, h: box.height })
  }
  const file = path.join(ASSETS, name + '.png')
  await mp.screenshot({ path: file, fullPage: false })
  await mp.evaluate(() => document.getElementById('__ring__')?.remove())
  assets[name] = b64(file)
  console.log('✓ shot', name)
}
async function shot(route, name, wait = 2200) {
  await mp.goto(LIFF + route, { waitUntil: 'networkidle', timeout: 25000 })
  await mp.waitForTimeout(wait)
  const file = path.join(ASSETS, name + '.png')
  await mp.screenshot({ path: file, fullPage: false })
  assets[name] = b64(file)
  console.log('✓ shot', name)
}
// 履歴: ロック済み日報の「編集の許可を依頼」ボタンに赤丸を重ねて撮影
async function shotHistoryButton(name) {
  await mp.goto(LIFF + '/history', { waitUntil: 'networkidle', timeout: 25000 })
  await mp.waitForTimeout(2500)
  const btn = mp.locator('.btn-unlock').first()
  const box = await btn.boundingBox().catch(() => null)
  if (box) {
    await btn.scrollIntoViewIfNeeded().catch(() => {})
    const b2 = await btn.boundingBox()
    await mp.evaluate(({ x, y, w, h }) => {
      const d = document.createElement('div'); d.id = '__ring__'
      d.style.cssText = `position:fixed;left:${x - 6}px;top:${y - 6}px;width:${w + 12}px;height:${h + 12}px;border:3px solid #ef4444;border-radius:10px;z-index:99999;pointer-events:none;box-shadow:0 0 0 3px rgba(239,68,68,.22)`
      document.body.appendChild(d)
    }, { x: b2.x, y: b2.y, w: b2.width, h: b2.height })
  }
  const file = path.join(ASSETS, name + '.png')
  await mp.screenshot({ path: file, fullPage: false })
  await mp.evaluate(() => document.getElementById('__ring__')?.remove())
  assets[name] = b64(file)
  console.log('✓ shot', name)
}
// 履歴: 「編集の許可を依頼」モーダル（理由入力）を開いて撮影
async function shotHistoryModal(name) {
  await mp.goto(LIFF + '/history', { waitUntil: 'networkidle', timeout: 25000 })
  await mp.waitForTimeout(2500)
  await mp.locator('.btn-unlock').first().click().catch(() => {})
  await mp.waitForTimeout(800)
  const file = path.join(ASSETS, name + '.png')
  await mp.screenshot({ path: file, fullPage: false })
  assets[name] = b64(file)
  console.log('✓ shot', name)
}
// 初回オンボーディング（使い方ガイド）が出ていたら閉じる
async function dismissOnboarding() {
  const skip = mp.locator('.ob-skip')
  if (await skip.count().catch(() => 0)) { await skip.first().click().catch(() => {}); await mp.waitForTimeout(400) }
}
// 新規日報(未送信×期限切れ): /report のロックバナーの「編集の許可を依頼」ボタンに赤丸
async function shotReportLockedButton(name) {
  await mp.goto(LIFF + '/report', { waitUntil: 'networkidle', timeout: 25000 })
  await mp.waitForTimeout(3500)
  await dismissOnboarding()
  const btn = mp.locator('.btn-unlock').first()
  const box = await btn.boundingBox().catch(() => null)
  if (box) {
    await mp.evaluate(({ x, y, w, h }) => {
      const d = document.createElement('div'); d.id = '__ring__'
      d.style.cssText = `position:fixed;left:${x - 6}px;top:${y - 6}px;width:${w + 12}px;height:${h + 12}px;border:3px solid #ef4444;border-radius:10px;z-index:99999;pointer-events:none;box-shadow:0 0 0 3px rgba(239,68,68,.22)`
      document.body.appendChild(d)
    }, { x: box.x, y: box.y, w: box.width, h: box.height })
  }
  const file = path.join(ASSETS, name + '.png')
  await mp.screenshot({ path: file, fullPage: false })
  await mp.evaluate(() => document.getElementById('__ring__')?.remove())
  assets[name] = b64(file)
  console.log('✓ shot', name)
}
// /report の依頼モーダル
async function shotReportModal(name) {
  await mp.goto(LIFF + '/report', { waitUntil: 'networkidle', timeout: 25000 })
  await mp.waitForTimeout(3500)
  await dismissOnboarding()
  await mp.locator('.btn-unlock').first().click().catch(() => {})
  await mp.waitForTimeout(800)
  const file = path.join(ASSETS, name + '.png')
  await mp.screenshot({ path: file, fullPage: false })
  assets[name] = b64(file)
  console.log('✓ shot', name)
}

await shotHomeRing('残業申請', 'home-overtime')
await shotHomeRing('出退勤', 'home-checkin')
await shot('/checkin', 'checkin')
await shot('/overtime', 'overtime')
await shotReportLockedButton('report-locked')
await shotReportModal('report-modal')
await shotHistoryButton('history-button')
await shotHistoryModal('history-modal')
await mob.close()

// ── ルールブックHTML（rules.vue と同内容＋セクション内キャプチャ＋赤線）──
const today = new Date().toISOString().split('T')[0]
const fig = (name, caption) => assets[name]
  ? `<figure class="shot"><img src="data:image/png;base64,${assets[name]}"/><figcaption>${caption}</figcaption></figure>`
  : ''
const card = (n, title, bodyHtml, figsHtml = '', keep = false) => `
  <section class="card${keep ? ' card-keep' : ''}">
    <h2 class="sec"><span class="num">${n}</span>${title}</h2>
    ${bodyHtml}
    ${figsHtml ? `<div class="shots">${figsHtml}</div>` : ''}
  </section>`
const ul = (items) => `<ul>${items.map(i => `<li>${i}</li>`).join('')}</ul>`

const html = `<!doctype html><html lang="ja"><head><meta charset="utf-8"><style>
  * { box-sizing: border-box; }
  body { font-family: -apple-system, "Hiragino Kaku Gothic ProN", "Noto Sans JP", sans-serif; color: #1f2937; margin: 0; }
  .page { padding: 26px 30px; }
  h1.ttl { font-size: 24px; font-weight: 800; margin: 0 0 4px; color: #0f172a; }
  .meta { font-size: 11px; color: #94a3b8; margin: 0 0 14px; }
  .lead { font-size: 13px; color: #4b5563; line-height: 1.8; margin: 0 0 16px; }
  .card { background: #fff; border: 1px solid #e5e7eb; border-radius: 12px; padding: 14px 18px; margin-bottom: 14px; }
  .card-keep { page-break-inside: avoid; }  /* ②残業・④出退勤 はヘッダー＋キャプチャごと同一ページに */
  .sec { display: flex; align-items: center; gap: 8px; font-size: 16px; font-weight: 700; color: #0f172a; margin: 0 0 10px; }
  .num { display: inline-flex; align-items: center; justify-content: center; width: 24px; height: 24px; border-radius: 6px; background: #0d9488; color: #fff; font-size: 14px; font-weight: 700; }
  ul { margin: 0; padding-left: 20px; }
  li { font-size: 13px; line-height: 1.9; margin-bottom: 6px; }
  strong { color: #0f172a; }
  /* 重要フレーズの赤線 */
  .hl { background: linear-gradient(transparent 60%, #fecaca 60%); border-bottom: 2px solid #ef4444; font-weight: 700; color: #b91c1c; padding: 0 1px; }
  .shots { display: flex; gap: 14px; flex-wrap: wrap; margin-top: 12px; }
  .shot { margin: 0; width: 47%; page-break-inside: avoid; }
  .shot img { width: 100%; border: 1px solid #e5e7eb; border-radius: 10px; }
  .shot figcaption { font-size: 10.5px; color: #6b7280; line-height: 1.5; margin-top: 6px; }
  .note { font-size: 11px; color: #6b7280; line-height: 1.6; margin-top: 16px; }
</style></head><body><div class="page">
  <h1 class="ttl">従業員向けルールブック</h1>
  <p class="meta">最終更新: ${today}</p>
  <p class="lead">日々の運用ルールをまとめています。提出・申請の期限を守って、正確な記録にご協力ください。</p>

  ${card(1, '日報・経費の提出と編集', ul([
    '提出・編集ができるのは<span class="hl">「当日を含む過去3日以内」</span>です（本日／前日／前々日まで）。',
    'それより前の日付は<strong>ロックされ、提出・編集できません</strong>。日報・経費のどちらも対象です。',
    'やむを得ず期限を過ぎた分を直したいときは、<strong>管理者へ許可を依頼</strong>してください。許可されると、その日に限り再度入力できます。',
    '提出忘れを防ぐため、未提出のリマインドが届きます。早めの提出をお願いします。',
  ]),
    fig('report-locked', '未送信×期限切れの日報: /report で「編集の許可を依頼」（赤丸）') +
    fig('report-modal', '理由を入力して依頼。管理者が承認すると提出でき、画面は自動で反映されます') +
    fig('history-button', '送信済みの日報を編集したい時は日報履歴から依頼（赤丸）') +
    fig('history-modal', 'こちらも理由を添えて依頼します'))}

  ${card(2, '残業の申請', ul([
    '残業が発生する日は、<span class="hl">当日の15:00までに残業申請</span>を行ってください。',
    'メニューの<strong>「残業申請」</strong>から、希望の終了時刻と理由を入力して申請します。管理者が承認すると、その日だけ定時を超える終了時刻を入力できます。',
    '未申請の日は、<strong>定時（終了時刻）以降の入力ができません</strong>。',
  ]),
    fig('home-overtime', 'ホームの「残業申請」（赤丸）から申請') +
    fig('overtime', '希望の終了時刻と理由を入力（当日15:00まで）'), true)}

  ${card(3, '勤務時間の基準', ul([
    '勤務時間は、<strong>現場ごとに担当者が設定した開始／終了時刻が基準</strong>になります。',
    '早朝搬入など例外的に時間がずれる場合は、残業申請で対応してください。',
  ]), '', true)}

  ${card(4, '出退勤の打刻', ul([
    '現場への<strong>到着時と退出時の打刻は必須</strong>です。忘れずに行ってください。',
    '打刻は<strong>現場のQRコードを読み取る</strong>か、メニューの<strong>「出退勤」</strong>から行えます。',
    'QRコードが無い現場は、<strong>「出退勤」から現場を選んで</strong>打刻してください（元請けや現場名で絞り込めます）。',
    '確認事項（チェック項目）が設定された現場では、出退勤時に確認のうえチェックしてください。',
  ]),
    fig('home-checkin', 'ホームの「出退勤」（赤丸）から打刻') +
    fig('checkin', 'QRが無い現場はメニューから選択（元請け・現場名で絞り込み）'), true)}

  <p class="note">※ 本ルールは運用に合わせて更新されることがあります。最新の内容はアプリの「ルールブック」ページでご確認ください。</p>
</div></body></html>`

const pctx = await browser.newContext()
const pp = await pctx.newPage()
await pp.setContent(html, { waitUntil: 'networkidle' })
await pp.pdf({ path: OUT, format: 'A4', printBackground: true, margin: { top: '12mm', bottom: '12mm', left: '10mm', right: '10mm' } })
await browser.close()
console.log('\n✓ PDF生成:', OUT)
