// ============================================================
//  liff.worker-guides.spec.ts
//  作業員アプリの画面ごとの「使い方」（2026-10-02 設計「見やすさと分かりやすさ」II-4）。
//
//  ★守ること:
//   1. 日報・出退勤・やること（お知らせ・承認）・予定の見出しの横に「使い方」があり、押すとその画面の手順が出る
//   2. やることの使い方に、打刻修正の承認の仕方が入っている
//   3. 英語表示では英語で出る
//   4. 使い方に書いたボタン名が、画面の実際のボタン名と食い違っていない（ボタン名を変えたら使い方も直す）
// ============================================================
import { test, expect } from './liff-test'
import { WORKER_GUIDES } from '../../shared/worker-guides'
import jaCheckin from '../../apps/liff/i18n/locales/ja/checkin.json'
import enCheckin from '../../apps/liff/i18n/locales/en/checkin.json'
import jaPunch from '../../apps/liff/i18n/locales/ja/punchApproval.json'
import enPunch from '../../apps/liff/i18n/locales/en/punchApproval.json'
import jaNotif from '../../apps/liff/i18n/locales/ja/notifications.json'

async function openGuide(page: import('@playwright/test').Page, path: string) {
  await page.goto(path, { waitUntil: 'networkidle' })
  await page.getByTestId('nav-guide').click()
  const sheet = page.getByTestId('guide-sheet')
  await expect(sheet).toBeVisible({ timeout: 10000 })
  return sheet
}

test('★出退勤・日報・予定・やることの見出しの横に「使い方」があり、その画面の手順が出る', async ({ page }) => {
  let sheet = await openGuide(page, '/checkin')
  await expect(sheet).toContainText('使い方：出退勤')
  await expect(sheet).toContainText('打刻を忘れた・間違えたとき')
  await page.getByTestId('guide-close').click()
  await expect(sheet).toBeHidden()

  sheet = await openGuide(page, '/report')
  await expect(sheet).toContainText('使い方：日報')

  sheet = await openGuide(page, '/calendar')
  await expect(sheet).toContainText('使い方：予定')

  sheet = await openGuide(page, '/notifications')
  await expect(sheet).toContainText('使い方：やること（承認）')
  await expect(sheet, 'やることには打刻修正の承認の仕方が入る').toContainText('打刻修正の承認の仕方')
  await expect(sheet).toContainText('「承認する」')

  // 承認の画面にも同じ使い方が出る
  sheet = await openGuide(page, '/approvals/punch')
  await expect(sheet).toContainText('打刻修正の承認の仕方')
})

test('★英語表示では英語で出る', async ({ page }) => {
  await page.addInitScript(() => { try { localStorage.setItem('app_locale', 'en') } catch { /* noop */ } })
  const sheet = await openGuide(page, '/checkin')
  await expect(sheet).toContainText('How to use: Check in / out')
  await expect(sheet).toContainText(`"${enCheckin.submitCheckin}"`)
})

test('使い方の無い画面には出さない', async ({ page }) => {
  await page.goto('/settings', { waitUntil: 'networkidle' })
  await expect(page.getByTestId('nav-guide')).toHaveCount(0)
})

test('★使い方に書いたボタン名が、画面の実際のボタン名と一致している', () => {
  const all = (lang: 'ja' | 'en') => WORKER_GUIDES.map(g => [g.summary[lang], ...g.sections.flatMap(s => s.steps[lang])].join('\n')).join('\n')
  const ja = all('ja')
  const en = all('en')
  for (const label of [jaCheckin.submitCheckin, jaCheckin.submitCheckout, jaCheckin.moreActions, jaCheckin.lateOpen, jaCheckin.fixOpen, jaCheckin.againTitle, jaPunch.approve, jaPunch.reject, jaNotif.tabTodo, jaNotif.todoPunchApprovalTitle]) {
    expect(ja, `使い方（日本語）に「${label}」が今の名前で出ている`).toContain(`「${label}」`)
  }
  for (const label of [enCheckin.submitCheckin, enCheckin.submitCheckout, enCheckin.moreActions, enCheckin.lateOpen, enCheckin.fixOpen, enCheckin.againTitle, enPunch.approve, enPunch.reject]) {
    expect(en, `使い方（英語）に "${label}" が今の名前で出ている`).toContain(`"${label}"`)
  }
})
