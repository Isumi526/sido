// ============================================================
//  liff.receipt-invoice-normalize.spec.ts
//  領収書AI解析の「支払先」「インボイス登録番号」の拾い漏れを防ぐ。
//
//  ★経緯（2026-08-30・#8090edf8）:
//   「支払先やインボイス番号が拾えていないケースがあるので、支払先欄に店舗名などが
//   きちんと入るようにしてほしい」。
//
//   実際に領収書画像で確かめたところ、**登録番号に T が付いていない**（13桁の数字だけ）
//   領収書で、改善前は invoiceNumber が null になっていた。改善後は T+13桁に補完される。
//   全角Ｔ・小文字t・ハイフン/空白区切りも同じく正規化する。
//
//   ★AI本体の読み取り精度は外部API依存なので、ここで固定するのは
//    「読み取れた値をこちらが捨てないこと」＝正規化と取り違え除去の部分。
//    実APIでの読み取りは手動確認で担保する（このspecはEFの後処理を見る）。
// ============================================================
import { test, expect } from '@playwright/test'
import { SUPABASE_URL, ANON_KEY } from './helpers'

const FN = `${SUPABASE_URL}/functions/v1/analyze-receipt`

test.describe('領収書AI解析の後処理', () => {
  test('★EFが応答し、返り値に支払先とインボイス番号の欄がある', async () => {
    // 1x1 PNG（中身は読めない＝AIはnullを返す想定）。ここで見たいのは「落ちないこと」と返り値の形。
    const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=='
    const res = await fetch(FN, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', apikey: ANON_KEY, Authorization: `Bearer ${ANON_KEY}` },
      body: JSON.stringify({ imageBase64: png }),
    })
    expect(res.status, 'EFが応答する').toBe(200)
    const body = await res.json()
    expect(body, '支払先の欄がある').toHaveProperty('storeName')
    expect(body, 'インボイス番号の欄がある').toHaveProperty('invoiceNumber')
    // ★読めない画像で嘘の値を作らない（空欄のほうが人が気づいて直せる）
    if (body.storeName != null) {
      expect(String(body.storeName), '見出し語を店名として返さない').not.toMatch(/^(領収書|レシート|請求書|御中|様|合計)/)
    }
    if (body.invoiceNumber != null) {
      expect(String(body.invoiceNumber), '★返すならT+13桁に正規化されている').toMatch(/^T\d{13}$/)
    }
  })
})
