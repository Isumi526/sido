// ============================================================
//  liff.master-kana-order.spec.ts
//  プルダウンの並びは「読み仮名の五十音順」。漢字の名前でソートしない。
//
//  ★なぜ（2026-08-17 全画面を洗って分かったこと）:
//   `name.localeCompare(name, 'ja')` は五十音順にならない。ICU の ja 照合は
//   漢字を部首・画数で並べるので、読みを完全に無視する。
//   例: 「一之瀬」は「いちのせ」なので「あ行」に来るべきだが、漢字順だと別の場所へ飛ぶ。
//   人は読みで探すので、目的の1人を見つけられない（作業員が数十人いる会社で実害）。
//
//   作業員マスタには name_kana があるのに、EF が select すらしていなかった。
//   これを直したので、二度と漢字ソートへ戻らないよう固定する。
//
//  ★このspecが守るもの
//   - 作業員のプルダウンが読み仮名順（漢字の並びとは違うことを、わざと逆順の漢字で確かめる）
//   - 読み仮名が無い作業員は末尾（並びから消えない）
// ============================================================
import { test, expect } from '@playwright/test'
import { restSrv, getAccountId } from './helpers'

const TS = Date.now()
// ★漢字の見た目の順と、読みの順が逆になるように作る。
//  漢字コードポイント/ICU順では 渡辺 < 阿部 になりやすいが、読みは あべ < わたなべ。
const W_A = { name: `E2E順_阿部_${TS}`, kana: `いーつーあべ${TS}` }   // 読み: い…
const W_B = { name: `E2E順_渡辺_${TS}`, kana: `いーつーわたなべ${TS}` } // 読み: い…わ
const W_NOKANA = { name: `E2E順_あああ読み無し_${TS}`, kana: null }

let accountId = ''

test.describe('マスタの並び順', () => {
  test.beforeAll(async () => {
    accountId = await getAccountId()
    for (const w of [W_B, W_A, W_NOKANA]) {   // ★わざと読みの逆順で登録する（登録順に引きずられないことを見る）
      await restSrv('workers', {
        method: 'POST', headers: { Prefer: 'return=minimal' },
        body: JSON.stringify({
          account_id: accountId, name: w.name, name_kana: w.kana,
          active: true, role: 'site', sort_order: 0,
        }),
      })
    }
  })

  test.afterAll(async () => {
    await restSrv(`workers?name=like.E2E%E9%A0%86*${TS}`, { method: 'DELETE' }).catch(() => {})
  })

  test('★作業員は読み仮名の五十音順で並ぶ（漢字順でも登録順でもない）', async ({ page }) => {
    await page.goto('/register', { waitUntil: 'networkidle' })
    const sel = page.locator('select').filter({ has: page.locator(`option:text-is("${W_A.name}")`) }).first()
    await expect(sel).toBeVisible({ timeout: 15000 })

    const opts = (await sel.locator('option').allInnerTexts()).map(t => t.trim())
    const iA = opts.indexOf(W_A.name)
    const iB = opts.indexOf(W_B.name)
    const iN = opts.indexOf(W_NOKANA.name)
    expect(iA, '阿部が選択肢に居る').toBeGreaterThan(-1)
    expect(iB, '渡辺が選択肢に居る').toBeGreaterThan(-1)

    // 読み: あべ < わたなべ。登録は渡辺が先だったが、並びは阿部が先になる
    expect(iA, '★読み仮名順（あべ → わたなべ）').toBeLessThan(iB)

    // 読み仮名が無い人も選択肢から消えない（末尾へ回る）
    expect(iN, '★読み仮名が無くても選択肢に残る').toBeGreaterThan(-1)
    expect(iN, '読み仮名の無い人は後ろ').toBeGreaterThan(iA)
  })
})
