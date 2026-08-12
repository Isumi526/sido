// ============================================================
//  liff.train-registration-number.spec.ts
//  電車経費(trains)の登録番号（インボイス登録番号）が保存→再読込で復元されること。
//   実装自体は統合先チケット「経費明細の登録番号 手入力」で全経費種別に入っており、
//   本specは電車代について AC を実機で担保する回帰テスト。
//  Notion: 3900ff81c56b8002882ce6150d826fdc（統合先: 3900ff81c56b80bcba14c8986031d3b3）
// ============================================================
import { test, expect } from '@playwright/test'
import { rest, getDevUserId, getAccountId } from './helpers'

test('AC: 電車経費の登録番号が保存され、再読込後も復元される', async ({ page }) => {
  const uid = (await getDevUserId())!
  const accountId = await getAccountId()
  const now = new Date()
  // 編集期限（当日含む過去3日）内の日付にする。期限外だとロック画面になり経費欄まで到達しない。
  const y = new Date(now); y.setDate(y.getDate() - 1)
  const d = `${y.getFullYear()}-${String(y.getMonth()+1).padStart(2,'0')}-${String(y.getDate()).padStart(2,'0')}`
  const REG = 'T9999888877776'

  // 電車代（登録番号あり）を持つ日報をseed
  await rest('daily_reports?on_conflict=user_id,date', { method:'POST',
    headers:{ Prefer:'resolution=merge-duplicates,return=representation' },
    body: JSON.stringify({ account_id: accountId, user_id: uid, date: d, is_working:true, note:'E2E電車登録番号',
      sites:[{ siteName:'テスト現場A', workers:[], subcontractors:[],
        expenses:{ vehicles:[], others:[], trains:[{ label:'品川→新横浜', yen:480, payee:'JR東日本', registrationNumber: REG, fileUrls:[] }] } }] }) })

  // 編集画面で開く → 登録番号が復元されている
  await page.goto(`/report?edit=${d}`, { waitUntil:'networkidle' })
  await page.waitForTimeout(2500)
  // 登録番号は input の value に復元される（allInnerTextsでは拾えないので inputValue で確認）
  const regInputs = page.locator('input.input')
  await expect.poll(async () => {
    const vals = await regInputs.evaluateAll(els => els.map(e => (e as HTMLInputElement).value))
    return vals.includes(REG)
  }, { timeout: 20000, message: '保存済みの登録番号が編集画面に復元される' }).toBe(true)

  // DBにも保持されている
  const [rep] = await rest(`daily_reports?user_id=eq.${uid}&date=eq.${d}&select=sites`)
  expect(rep.sites[0].expenses.trains[0].registrationNumber).toBe(REG)

  await rest(`daily_reports?user_id=eq.${uid}&date=eq.${d}`, { method:'DELETE' }).catch(()=>{})
})
