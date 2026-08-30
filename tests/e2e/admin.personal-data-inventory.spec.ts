// ============================================================
//  admin.personal-data-inventory.spec.ts
//  「取り扱わない」と契約書に書いたものが、実装では持っていないことを固定する。
//
//  ★経緯（2026-08-31・#980fe456 / #396cb882）:
//   「マイナンバーはシステムで取り扱わない・保管しない方針にしたい」
//   「実際に保管・管理する情報を一覧化し、それ以外は取り扱わないと分かる形で契約書に明記したい」
//
//   docs/personal-data-inventory.md を正本として作った。ただし文書は放っておくと
//   実装とズレる（列を足したのに文書を直し忘れる）。**契約書に「取り扱わない」と
//   書いたものが実は入っている**という状態が一番まずいので、そこだけ機械で見張る。
//
//   ★この spec が落ちたら、列を消すか、契約書と文書を直すかの二択。
//    「テストを緩める」で通してはいけない。
// ============================================================
import { test, expect } from '@playwright/test'
import { DB_URL } from './helpers'
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const psql = (sql: string) =>
  execFileSync('psql', [DB_URL, '-t', '-A', '-c', sql], { encoding: 'utf8' }).trim()

test.describe('取り扱わない個人情報', () => {
  test('★マイナンバー（個人番号）の列を持たない', () => {
    const found = psql(`
      select table_name||'.'||column_name from information_schema.columns
      where table_schema='public'
        and (column_name ilike '%my_number%' or column_name ilike '%mynumber%'
             or column_name ilike '%individual_number%' or column_name ilike '%個人番号%')`)
    expect(found, `★契約書に「取り扱わない」と書いている。列が生えている:\n${found}`).toBe('')
  })

  test('★家族構成・扶養の列を持たない', () => {
    const found = psql(`
      select table_name||'.'||column_name from information_schema.columns
      where table_schema='public'
        and (column_name ilike '%family%' or column_name ilike '%dependent%')`)
    expect(found, `★契約書に「取り扱わない」と書いている。列が生えている:\n${found}`).toBe('')
  })

  test('★健診は受診日だけで、結果そのものは持たない', () => {
    const found = psql(`
      select table_name||'.'||column_name from information_schema.columns
      where table_schema='public'
        and (column_name ilike '%checkup_result%' or column_name ilike '%health_result%'
             or column_name ilike '%diagnosis%')`)
    expect(found, `★要配慮情報。結果を保管する列が生えている:\n${found}`).toBe('')
  })
})

test.describe('一覧の文書が実装に追随しているか', () => {
  test('★workers に列を足したら一覧の文書も直す（文書に載っていない列を見つける）', () => {
    const doc = readFileSync(resolve(process.cwd(), 'docs/personal-data-inventory.md'), 'utf8')
    const cols = psql(`
      select column_name from information_schema.columns
      where table_schema='public' and table_name='workers' order by ordinal_position`)
      .split('\n').map(s => s.trim()).filter(Boolean)

    // id / account_id / created_at のような管理用の列は個人情報ではないので除く
    const SKIP = new Set(['id', 'account_id', 'created_at', 'updated_at'])
    const missing = cols.filter(c => !SKIP.has(c) && !doc.includes(`\`${c}\``))

    expect(missing, `★docs/personal-data-inventory.md に載っていない列がある。
契約書の別紙は この文書を正本にしている＝載せ忘れると「書いていないが実は持っている」になる。
列を足したら文書も直すこと:\n  ${missing.join('\n  ')}`).toEqual([])
  })
})
