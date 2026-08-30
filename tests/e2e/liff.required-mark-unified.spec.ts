// ============================================================
//  liff.required-mark-unified.spec.ts
//  必須項目の表示を「※付き赤文字」に統一する（2026-08-03 /review で指摘）
//
//  直す前は3系統に分かれていた:
//   ・FormSection … 枠と背景つきの赤バッジ
//   ・Field        … 赤文字（枠なし）
//   ・編集理由/遅れた理由 … ラベル本文に「（必須）」を直書き（i18n の文字列側）
//
//  ★AC3「表示を1か所に寄せ、以後バラつかないようにする」を守るのがこのテストの主眼。
//   見た目が今たまたま揃っているかではなく、
//   「※ を含む文言が common.required 1か所から来ていること」と
//   「ラベル本文に（必須）を直書きしていないこと」を固定する。
//   ここが崩れると、また画面ごとに独自表記が生える。
//
//  ★必須バリデーション自体は変えていない（見た目だけ）。それも併せて確認する。
// ============================================================
import { test, expect } from '@playwright/test'

const EDIT_DATE = '2026-10-16'

test.describe('必須表示の統一', () => {
  test('★必須マークは全部「※」を含む赤文字（バッジ/カッコ書きが混ざらない）', async ({ page }) => {
    await page.goto('/report', { waitUntil: 'networkidle' })
    await expect(page.locator('.date-fixed')).toBeVisible({ timeout: 20000 })

    const marks = page.locator('.required, .required-badge')
    const n = await marks.count()
    expect(n, '必須マークが1つ以上ある（0だと何も検証していない）').toBeGreaterThan(0)

    for (let i = 0; i < n; i++) {
      const el = marks.nth(i)
      await expect(el, '※ を含む').toContainText('※')
      const color = await el.evaluate((e) => getComputedStyle(e).color)
      // --danger 由来の赤。グレーや黒になっていないこと
      const [r, g, b] = (color.match(/\d+/g) ?? ['0', '0', '0']).map(Number)
      expect(r, `赤である（実際: ${color}）`).toBeGreaterThan(g + 40)
      expect(r, `赤である（実際: ${color}）`).toBeGreaterThan(b + 40)
    }
  })

  test('★ラベル本文に「（必須）」を直書きしていない（表示側に一本化されている）', async ({ page }) => {
    await page.goto(`/report?edit=${EDIT_DATE}`, { waitUntil: 'networkidle' })
    await expect(page.getByTestId('edit-reason')).toBeVisible({ timeout: 20000 })

    // 編集理由のラベル。以前は文字列そのものが「編集理由（必須）」だった。
    const label = page.locator('.edit-reason-label').filter({ hasText: '編集理由' }).first()
    await expect(label).toBeVisible()
    await expect(label, '★カッコ書きの（必須）が残っていない').not.toContainText('（必須）')
    await expect(label.locator('.required'), '共通の必須マークが付いている').toContainText('※')
  })

  test('見た目を変えただけで、必須バリデーションは変えていない', async ({ page }) => {
    await page.goto(`/report?edit=${EDIT_DATE}`, { waitUntil: 'networkidle' })
    await expect(page.getByTestId('edit-reason')).toBeVisible({ timeout: 20000 })
    // 編集理由が空なら送信できないまま（今まで通り）
    await page.getByTestId('edit-reason').fill('')
    await expect(page.getByTestId('report-submit'), '理由が空だと送れない').toBeDisabled()
  })
})

// ============================================================
//  文言そのものを見張る（2026-08-30 追加）
//
//  ★画面を1つずつ開いて確かめる形だと、触っていない画面の取りこぼしに気づけない。
//   実際 calendar/groups/overtime/report のラベルには「現場 *」「修正の理由（必須）」の
//   ように独自表記が残っていた（2026-08-13 の統一時に i18n 側が漏れていた）。
//   ここでは **i18n の文言ファイル全体** を舐めて、必須マークの表記ゆれを禁止する。
// ============================================================
import { readFileSync, readdirSync } from 'node:fs'
import { resolve } from 'node:path'

test.describe('必須表示の文言（i18n）', () => {
  test('★ラベルに「（必須）」や末尾の「 *」を直書きしない（common.required に寄せる）', () => {
    const base = resolve(process.cwd(), 'apps/liff/i18n/locales/ja')
    const files = readdirSync(base).filter(f => f.endsWith('.json'))
    expect(files.length, '文言ファイルがある').toBeGreaterThan(0)

    const bad: string[] = []
    for (const f of files) {
      const json = JSON.parse(readFileSync(resolve(base, f), 'utf8')) as Record<string, unknown>
      for (const [k, v] of Object.entries(json)) {
        if (typeof v !== 'string') continue
        if (k === 'required') continue                 // common.required だけが正本
        if (/（必須）|\(必須\)/.test(v)) bad.push(`${f}:${k} = ${v}`)
        if (/\s\*$/.test(v)) bad.push(`${f}:${k} = ${v}`)
      }
    }
    expect(bad, `★必須マークの直書きが残っている:\n${bad.join('\n')}`).toEqual([])
  })
})
