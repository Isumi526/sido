// ============================================================
//  admin.retention-dryrun.spec.ts
//  保持期間の「削除候補」を数えるドライラン（契約対応④）
//
//  ★契約 別紙2 は「退職3年後・解約後にデータを復元不能に削除」と書いているが、
//   保持期間の確定値がまだ無い。先に候補の件数が見えたほうが期間を決めやすいので、
//   期間をパラメータにして試算できる形にした（/ball 2026-08-30 の方針）。
//
//  ★このテストが守る一番大事なこと:
//   **ドライランが1行も削除しないこと。** ここが壊れると、試算のつもりで
//   本番のデータが消える。削除は不可逆なので、機械で毎回確かめる。
// ============================================================
import { test, expect } from '@playwright/test'
import { DB_URL } from './helpers'
import { execFileSync } from 'node:child_process'

const psql = (sql: string) =>
  execFileSync('psql', [DB_URL, '-t', '-A', '-c', sql], { encoding: 'utf8' }).trim()

test('★ドライランは1行も削除しない', () => {
  const before = psql(`
    select (select count(*) from daily_reports)||'/'||(select count(*) from attendance_logs)
        ||'/'||(select count(*) from overtime_requests)||'/'||(select count(*) from paid_leave_grants)`)

  // 保持期間0年＝全件が候補になる条件で回す。ここで消えるなら確実に検出できる
  const out = execFileSync('node', ['--env-file=.env', 'scripts/retention-dryrun.mjs', '--years', '0.001'],
    { encoding: 'utf8', cwd: process.cwd() })

  const after = psql(`
    select (select count(*) from daily_reports)||'/'||(select count(*) from attendance_logs)
        ||'/'||(select count(*) from overtime_requests)||'/'||(select count(*) from paid_leave_grants)`)

  expect(after, `★ドライランで件数が変わった＝削除している。実行結果:\n${out}`).toBe(before)
  expect(out, '削除しないことを画面にも書いている').toContain('1行も削除しません')
})

test('保持期間を変えると候補の件数が変わる（試算として機能する）', () => {
  const run = (years: string) =>
    execFileSync('node', ['--env-file=.env', 'scripts/retention-dryrun.mjs', '--years', years],
      { encoding: 'utf8', cwd: process.cwd() })

  const short = run('0.001')   // ほぼ全部が候補
  const long = run('100')      // 何も候補にならない

  const num = (s: string) => Number((s.match(/合計 (\d+) 件/) ?? [])[1] ?? -1)
  expect(num(short), '短い期間なら候補が出る').toBeGreaterThan(0)
  expect(num(long), '長い期間なら候補は0').toBe(0)
})

test('★決めるべきことを黙って飛ばさない（退職日が無いこと・法定保存期間）', () => {
  const out = execFileSync('node', ['--env-file=.env', 'scripts/retention-dryrun.mjs'],
    { encoding: 'utf8', cwd: process.cwd() })
  expect(out, '退職日を持っていないことを伝える').toContain('退職日を持つ列がありません')
  expect(out, '法定保存期間との関係を伝える').toContain('労基法109条')
})
