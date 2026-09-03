// ============================================================
//  billing-trial.spec.ts
//  無償満了日＝契約成立日の月の「翌月末日」（45日固定ではない・2026-09-03訂正）。
//  弁護士向け連絡事項 1-2: 「無償期間は締結月の翌月末まで（最短1か月強〜最長2か月）」。
//  ★純関数の単体テスト。DB/ブラウザ不要（Playwrightのtest runnerで軽く回す）。
// ============================================================
import { test, expect } from '@playwright/test'
import { computeTrialEndsAt, daysUntil } from '../../shared/billing-trial'

test.describe('無償満了日の計算', () => {
  test('月初の契約→翌月末日', () => {
    expect(computeTrialEndsAt('2026-09-01')).toBe('2026-10-31')
  })
  test('★月末の契約でも翌々月に繰り上がらない（同じ翌月末日）', () => {
    expect(computeTrialEndsAt('2026-09-28')).toBe('2026-10-31')
    expect(computeTrialEndsAt('2026-09-30')).toBe('2026-10-31')
  })
  test('2月末（うるう年でない）を正しく扱う', () => {
    expect(computeTrialEndsAt('2026-01-31')).toBe('2026-02-28')
  })
  test('年をまたぐ契約', () => {
    expect(computeTrialEndsAt('2026-12-15')).toBe('2027-01-31')
  })
  test('daysUntil: 満了日の20日前判定に使える', () => {
    expect(daysUntil('2026-10-31', '2026-10-11')).toBe(20)
    expect(daysUntil('2026-10-31', '2026-11-01')).toBe(-1)
  })
})
