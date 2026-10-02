// ============================================================
//  liff.english-romaji.spec.ts
//  英語表示で名前をローマ字で出す・日本語のまま残る文言を英語にする（2026-10-02 設計「見やすさと分かりやすさ」II-2）。
//
//  ★守ること:
//   1. 英語表示では、現場名・業者名・作業区分・作業員名を読み仮名からローマ字で出す（山田内装 → Yamada Naisou）
//   2. 読み仮名が無い名前は日本語のまま（AI の仮は使わない＝確認事項5=A）
//   3. 表示だけ変える。選ぶ値（保存に使う値）は変わらない
//   4. 日本語表示は今のまま
//   5. 英語表示で、主な画面に日本語の固定文言が残っていない
// ============================================================
import { test, expect } from './liff-test'
import { restSrv, getAccountId } from './helpers'
import { romanizeName, romanizeKana } from '../../apps/liff/utils/romaji'

test.describe('ローマ字の規則（決まった変換）', () => {
  test('★ヘボン式・語ごとに頭を大文字・英字の名前はそのまま', () => {
    expect(romanizeName('山田内装', 'ヤマダ ナイソウ')).toBe('Yamada Naisou')
    expect(romanizeName('佐藤 龍太郎', 'サトウ　リョウタロウ')).toBe('Satou Ryoutarou')
    expect(romanizeName('札幌', 'サッポロ')).toBe('Sapporo')
    expect(romanizeName('抹茶', 'まっちゃ')).toBe('Matcha')
    expect(romanizeName('チーズガーデン', 'チーズガーデン'), '長音は書かない').toBe('Chizugaden')
    expect(romanizeName('TANAKA', 'タナカ'), '英字だけの名前はそのまま').toBe('TANAKA')
    expect(romanizeName('nowhere　北新宿', 'ノーウェア　キタシンジュク'), '英字の語は名前の綴り').toBe('nowhere Kitashinjuku')
    expect(romanizeName('(株)COSEVATI', 'コセバティ'), '法人の種類は外す').toBe('COSEVATI')
    expect(romanizeName('現場作業', null), '読み仮名が無ければ null（呼ぶ側は日本語のまま）').toBeNull()
    expect(romanizeKana('しんいち')).toBe('Shinichi')
  })
})

const TS = Date.now()
const SITE = `E2E英語表示現場_${TS}`
const SITE_NO_KANA = `E2E読みなし現場_${TS}`
let siteIds: string[] = []

test.beforeAll(async () => {
  const accountId = await getAccountId()
  const rows = await restSrv('sites', {
    method: 'POST', headers: { Prefer: 'return=representation' },
    body: JSON.stringify([
      { account_id: accountId, name: SITE, name_kana: 'ヤマダ ナイソウ', active: true, status: 'in_progress' },
      { account_id: accountId, name: SITE_NO_KANA, name_kana: null, active: true, status: 'in_progress' },
    ]),
  })
  siteIds = [rows.find((r: any) => r.name === SITE).id, rows.find((r: any) => r.name === SITE_NO_KANA).id]
})
test.afterAll(async () => {
  if (siteIds.length) await restSrv(`sites?id=in.(${siteIds.join(',')})`, { method: 'DELETE' }).catch(() => {})
})

async function setLocale(page: import('@playwright/test').Page, l: 'ja' | 'en') {
  await page.addInitScript((loc) => {
    try {
      localStorage.setItem('app_locale', loc)
      localStorage.removeItem('app_master_cache')
      localStorage.removeItem('app_name_readings')
    } catch { /* noop */ }
  }, l)
}

// ★日報の画面は他のテストが今日の日報を出していると「送信済み」になり選択肢が出ないので、
//  いつも現場の一覧が出る経費申請の「紐付け先」で見る（同じ $nm を通る）
test('★英語表示: 現場の選択肢が読み仮名からローマ字になり、選ぶ値は変わらない', async ({ page }) => {
  await setLocale(page, 'en')
  await page.goto('/expense/personal', { waitUntil: 'networkidle' })
  const select = page.getByTestId('pe-site')
  await expect(select).toBeVisible({ timeout: 20000 })
  await expect(select.locator(`option[value="${siteIds[0]}"]`), '読み仮名のある現場はローマ字').toHaveText('Yamada Naisou', { timeout: 15000 })
  await expect(select.locator(`option[value="${siteIds[1]}"]`), '読み仮名の無い現場は日本語のまま').toHaveText(SITE_NO_KANA)
})

test('★日本語表示は今のまま（ローマ字にしない）', async ({ page }) => {
  await setLocale(page, 'ja')
  await page.goto('/expense/personal', { waitUntil: 'networkidle' })
  const select = page.getByTestId('pe-site')
  await expect(select).toBeVisible({ timeout: 20000 })
  await expect(select.locator(`option[value="${siteIds[0]}"]`)).toHaveText(SITE)
})

test('★英語表示で、主な画面に日本語の固定文言が残っていない', async ({ page }) => {
  await setLocale(page, 'en')
  // データ（現場名・作業員名・品名など）はここでは見ない。画面の固定文言だけを見る
  const DATA = /E2E|テスト|確認用|デモ|元請|下請|商社|業者[A-Z]|軽トラ|石膏|ボード|現場[A-Z]|かな_|[枚台]$|カード[①-⑦]/
  for (const path of ['/', '/checkin', '/history', '/settings', '/overtime', '/rules', '/expense/personal', '/notifications']) {
    await page.goto(path, { waitUntil: 'networkidle' })
    await page.waitForTimeout(800)
    const jp: string[] = await page.evaluate(() => {
      const JP = /[぀-ヿ㐀-鿿]/
      const out: string[] = []
      const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT)
      let n: Node | null
      while ((n = w.nextNode())) {
        const el = (n as Text).parentElement
        if (!el || el.closest('script,style,option,select')) continue
        const st = getComputedStyle(el)
        if (st.display === 'none' || st.visibility === 'hidden') continue
        const t = (n.textContent ?? '').trim()
        if (t && JP.test(t)) out.push(t)
      }
      return out
    })
    expect(jp.filter(t => !DATA.test(t)), `${path} に日本語の固定文言が残っていない`).toEqual([])
  }
})
