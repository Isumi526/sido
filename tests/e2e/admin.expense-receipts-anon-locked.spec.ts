// ============================================================
//  admin.expense-receipts-anon-locked.spec.ts
//  旧バケット expense-receipts が匿名から読めないことを固定する。
//
//  ★経緯（2026-08-30・本番で実測）:
//   このバケットは public=true のままで、キーを一切付けない curl で
//   発注書PDFが HTTP 200 / 7626 bytes で落ちた。さらに storage.objects の
//   expense_receipts_select が **anon に無条件 SELECT** を許可していたため、
//   匿名キーだけでフォルダ一覧（estimates / expense-applications / 各社slug…）が
//   取れた＝URLを推測する必要すら無い。テナント跨ぎ。303オブジェクト。
//   下請け請求書・発注書・経費申請PDFを含み、少なくとも3ヶ月この状態だった。
//
//   ★バケットの public=false だけでは閉じない（RLSが残っていると list も download も
//    通る）。両方塞いで初めて閉じる。ここは「両方」を見る。
// ============================================================
import { test, expect } from '@playwright/test'
import { SUPABASE_URL, ANON_KEY, DB_URL } from './helpers'
import { execFileSync } from 'node:child_process'

const BUCKET = 'expense-receipts'

const psql = (sql: string) =>
  execFileSync('psql', [DB_URL, '-t', '-A', '-c', sql], { encoding: 'utf8' }).trim()

test.describe('旧バケット expense-receipts は匿名から触れない', () => {
  test('★バケットが非公開になっている（/object/public/ 経路を閉じる）', async () => {
    const pub = psql(`select public::text from storage.buckets where id='${BUCKET}';`)
    expect(pub, '★public=true に戻してはいけない（URLだけで誰でも読める状態になる）').toBe('false')
  })

  test('★storage のポリシーが anon を含まない（公開キーでの list/download を塞ぐ）', async () => {
    const roles = psql(
      `select roles::text from pg_policies where schemaname='storage' and tablename='objects' and policyname='expense_receipts_select';`,
    )
    expect(roles, 'ポリシーが存在する').not.toBe('')
    expect(roles, '★anon を含めてはいけない').not.toContain('anon')
  })

  test('★公開キーではフォルダを列挙できない（URL推測すら不要だった穴）', async () => {
    const res = await fetch(`${SUPABASE_URL}/storage/v1/object/list/${BUCKET}`, {
      method: 'POST',
      headers: { apikey: ANON_KEY, Authorization: `Bearer ${ANON_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ prefix: '', limit: 5 }),
    })
    const text = await res.text()
    const rows = res.ok ? JSON.parse(text) : []
    expect(Array.isArray(rows) ? rows.length : 0, `★公開キーで中身が見えてはいけない (返答: ${text.slice(0, 150)})`).toBe(0)
  })
})
