// ============================================================
//  admin.test-functions-not-deployed.spec.ts
//  【権限】test-* Edge Function を本番に出さないことを「仕組みで」担保する
//
//  ★経緯（2026-08-01 独立レビューのcritical指摘）:
//   test-send-drawing-pages は verify_jwt=false でありながら DB へ書き込む
//   （_shared/drawing-mail.ts 経由で estimate_drawing_sends / estimate_quote_requests）。
//   本番に露出していないのは **CIが test-* をデプロイ対象から外しているから** だけで、
//   その除外ルールが消えた瞬間に未認証の書き込み口になる＝暗黙の依存だった。
//
//  ★本番は全関数を --no-verify-jwt でデプロイする運用なので、config.toml の
//   verify_jwt はローカル用でしかない。本番で効くのは
//     (1) 各関数の in-code 認可
//     (2) test-* を本番に出さないこと
//   の2つ。(2) を人の記憶ではなくテストで固定する。
//
//  ※このspecはブラウザを使わない（リポジトリの構成を検査する）。
// ============================================================
import { test, expect } from '@playwright/test'
import fs from 'fs'
import path from 'path'

const ROOT = path.resolve(__dirname, '../..')
const WORKFLOW = path.join(ROOT, '.github/workflows/deploy.yml')
const FUNCTIONS_DIR = path.join(ROOT, 'supabase/functions')

test('★本番デプロイのループが test-* を除外している（除外を消したら落ちる）', () => {
  const yml = fs.readFileSync(WORKFLOW, 'utf8')

  // main（本番）へのデプロイを行うステップを取り出す
  const idx = yml.indexOf('Deploy Edge Functions (main → production)')
  expect(idx, '本番デプロイのステップがある').toBeGreaterThan(-1)
  const prodStep = yml.slice(idx, idx === -1 ? undefined : idx + 1600)

  // ★ここが本体: test-* をスキップする分岐が消えていないこと
  expect(prodStep, '★test-* を本番デプロイから除外する分岐がある').toMatch(/test-\*\)\s*[^\n]*continue/)
  expect(prodStep, '_shared も除外している').toMatch(/_shared\)/)
  // 固定リストに戻すと新規関数のデプロイ漏れが起きるので、全量ループのままであること
  expect(prodStep, '全量ループでデプロイしている').toContain('supabase/functions/*/')
})

test('★test-* 関数には必ず本番側の実体がある（test版だけが存在する機能を作らない）', () => {
  const dirs = fs.readdirSync(FUNCTIONS_DIR, { withFileTypes: true })
    .filter((d) => d.isDirectory() && d.name.startsWith('test-'))
    .map((d) => d.name)
  expect(dirs.length, 'test-* 関数が存在する').toBeGreaterThan(0)

  const missing = dirs.filter((n) => !fs.existsSync(path.join(FUNCTIONS_DIR, n.replace(/^test-/, ''))))
  // test版しか無い機能があると、本番に出ない＝誰も使えない機能を作っていることになる。
  // 逆に「本番に出したいのに test- を付けてしまった」取り違えもここで気付ける。
  expect(missing, `本番側の実体が無い test 関数: ${missing.join(', ')}`).toEqual([])
})

test('★DBへ書き込む test-* は未認証で通らない（in-code認可がある）', async () => {
  // 本番は --no-verify-jwt なので config.toml の verify_jwt には頼れない。
  // 実際に認証なしで叩いて拒否されることを確かめる。
  const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || 'http://127.0.0.1:56321'
  const ANON = process.env.VITE_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY || ''

  const res = await fetch(`${SUPABASE_URL}/functions/v1/test-send-drawing-pages`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', apikey: ANON },   // ★Authorization を付けない
    body: JSON.stringify({
      project_id: '00000000-0000-0000-0000-000000000001',
      pages: [1],
      subcontractor_contact_ids: ['00000000-0000-0000-0000-000000000002'],
    }),
  })
  const body = await res.json().catch(() => null)
  // 未認証では案件を読めない＝越境/未存在として拒否される（403）。
  // ここが 200 になったら、未認証でDBに行を作れる状態になっている。
  expect([401, 403], `未認証は拒否される（実際: ${res.status} ${JSON.stringify(body)}）`).toContain(res.status)
  expect(body?.error, '拒否理由が返る').toBeTruthy()
})
