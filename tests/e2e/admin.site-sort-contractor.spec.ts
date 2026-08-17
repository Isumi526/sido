// ============================================================
//  admin.site-sort-contractor.spec.ts
//  現場マスタの並び替えに「元請け順」を足す（2026-08-17 運用者要望）
//
//  背景: 現場が300件以上あり、五十音順だと同じ元請けの現場がバラバラに散る。
//   「この元請けの現場をまとめて見たい」ができなかった。
//
//  ★このspecが守るもの
//   - 同じ元請けの現場がひとかたまりになる
//   - 元請け未設定の現場は末尾へ（間に挟まると設定漏れに気づけない）
//   - 同じ元請けの中は五十音（毎回同じ順＝目で追える）
//   - 並び替えは「順番を変えるだけ」で、表示される件数を変えない
// ============================================================
import { test, expect } from '@playwright/test'
import { restSrv, getAccountId } from './helpers'

const TS = Date.now()
// 元請け名は 甲 < 乙 にならないので、並びが確定するよう明示的に A/B を付ける
const PRIME_A = `E2E並A元請_${TS}`
const PRIME_B = `E2E並B元請_${TS}`

// 五十音では「あ < さ < ま」。元請けは A に あ・ま、B に さ を付けて、
// 五十音順と元請け順で並びが必ず変わるようにする。
const SITE_A1 = `E2E並あさひ_${TS}`      // 元請けA
const SITE_B1 = `E2E並さくら_${TS}`      // 元請けB
const SITE_A2 = `E2E並まつば_${TS}`      // 元請けA
const SITE_NONE = `E2E並いろは_${TS}`    // 元請け未設定（五十音なら2番目に来る）

let accountId = ''

test.describe('現場マスタ: 元請け順の並び替え', () => {
  test.beforeAll(async () => {
    accountId = await getAccountId()
    const mk = async (name: string) => (await restSrv('contractors', {
      method: 'POST', headers: { Prefer: 'return=representation' },
      body: JSON.stringify({ account_id: accountId, name, active: true, sort_order: 0 }),
    }))[0].id
    const a = await mk(PRIME_A)
    const b = await mk(PRIME_B)
    const site = async (name: string, contractor_id: string | null) => restSrv('sites', {
      method: 'POST', headers: { Prefer: 'return=minimal' },
      body: JSON.stringify({ account_id: accountId, name, name_kana: null, active: true, contractor_id }),
    })
    await site(SITE_A1, a)
    await site(SITE_B1, b)
    await site(SITE_A2, a)
    await site(SITE_NONE, null)
  })

  test.afterAll(async () => {
    await restSrv(`sites?name=like.E2E%E4%B8%A6*${TS}`, { method: 'DELETE' }).catch(() => {})
    await restSrv(`contractors?name=like.E2E%E4%B8%A6*${TS}`, { method: 'DELETE' }).catch(() => {})
  })

  test('★同じ元請けがまとまり、未設定は末尾へ。件数は変わらない', async ({ page }) => {
    // 検索でこのspecのデータだけに絞る（本番同様300件あるので目視できる範囲へ）
    await page.goto(`/sites?q=${encodeURIComponent(`E2E並`)}&sort=kana`, { waitUntil: 'networkidle' })
    const rows = page.locator('.table-wrap tbody tr')
    await expect(rows.first()).toBeVisible({ timeout: 15000 })

    const namesKana = await rows.locator('td:nth-child(1)').allInnerTexts()
    const kanaOnly = namesKana.map(t => t.trim()).filter(t => t.includes(`_${TS}`))
    expect(kanaOnly.length, '4件シードした').toBe(4)

    // 五十音順では 元請け未設定の「いろは」が2番目に来る＝元請けでまとまっていない
    expect(kanaOnly[1], '五十音順では未設定が途中に挟まる').toContain('いろは')

    // 元請け順へ切り替え
    await page.locator('select.filter-input').selectOption('contractor')
    await page.waitForTimeout(400)

    const after = (await rows.locator('td:nth-child(1)').allInnerTexts())
      .map(t => t.trim()).filter(t => t.includes(`_${TS}`))
    expect(after.length, '★並び替えても件数は変わらない').toBe(kanaOnly.length)

    // 元請けA(あさひ・まつば) → 元請けB(さくら) → 未設定(いろは)
    expect(after[0]).toContain('あさひ')
    expect(after[1], '同じ元請けの中は五十音').toContain('まつば')
    expect(after[2]).toContain('さくら')
    expect(after[3], '★元請け未設定は末尾へ').toContain('いろは')
  })
})
