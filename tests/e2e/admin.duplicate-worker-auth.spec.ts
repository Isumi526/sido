// ============================================================
//  admin.duplicate-worker-auth.spec.ts
//  1ログインに作業員が複数ぶら下がっても、身元判定が fail-open しない（2026-08-10）
//
//  実害（本番障害）:
//   ヒロ木工の牛田さんのログインに workers が2行（牛田 友希 / 日下部 光郎）あった。
//   EF が .maybeSingle() で workers を引いていたので複数行→data=null となり本人を特定できず、
//   「target !== caller.userId(null) ＝ 代理入力だ」と誤判定して 403。
//   8/3〜8/7 の計6回の遅延日報が、一度も承認画面に出ないまま消えた。
//
//  このテストが固定するのは2点:
//   ① DBが重複を受け付けないこと（workers_account_auth_user_unique）＝入口を塞ぐ
//   ② 万一重複しても自己承認ブロックが無言で外れないこと（fail-closed）
//      ★ここが一番危ない。myUserId を単数で引く実装だと重複時に null になり、
//       isMine が常に false ＝ 自分の申請を自分で承認できてしまう（権限の穴）。
//
//  接頭辞 dup-auth- のデータはテスト後に必ず消す（共有DB）。
// ============================================================
import { test, expect } from '@playwright/test'
import { execSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { restSrv, getAccountId, ADMIN_LOGIN_EMAIL, DB_URL } from './helpers'

const TS = Date.now()
const PREFIX = 'dup-auth-'
const ME = `${PREFIX}本人${TS}`
const SHADOW = `${PREFIX}相乗り${TS}`   // 同じログインにぶら下がるもう1人（牛田さんに対する日下部さん）
const OWNER = `${PREFIX}日報主${TS}`
// もう1人の実効オーナー（別ログイン）。これが居ないと「完全ワンオペ」扱いになり
// ソロオーナー例外(canSelfApprove)で自己承認が許可され、fail-closed の検証が成り立たない（#soloOwner・2026-08-22）。
const OTHER_OWNER = `${PREFIX}別オーナー${TS}`
const DATE = '2026-11-21'

let accountId = ''
let authUserId = ''
let myUserId = ''
let ownerUserId = ''
const OTHER_OWNER_EMAIL = `dup-auth-other-${TS}@example.com`

async function purge() {
  for (const n of [ME, SHADOW, OWNER, OTHER_OWNER]) {
    for (const u of (await restSrv(`users?real_name=eq.${encodeURIComponent(n)}&select=id`)) ?? []) {
      await restSrv(`daily_report_pending_edits?submitted_by_user_id=eq.${u.id}`, { method: 'DELETE' }).catch(() => {})
      await restSrv(`daily_report_pending_edits?report_user_id=eq.${u.id}`, { method: 'DELETE' }).catch(() => {})
      await restSrv(`daily_reports?user_id=eq.${u.id}`, { method: 'DELETE' }).catch(() => {})
      await restSrv(`users?id=eq.${u.id}`, { method: 'DELETE' }).catch(() => {})
    }
  }
  await restSrv(`workers?name=like.${PREFIX}*`, { method: 'DELETE' }).catch(() => {})
  const left = (await restSrv(`workers?name=like.${PREFIX}*&select=id`))?.length ?? 0
  if (left) throw new Error(`cleanup 未完了: workers ${left}件 残っている（接頭辞 ${PREFIX}）`)
  // workers を消してから、第2オーナー用に作った auth.users を掃除（FK順序: 参照する workers を先に消す）
  execSync(`psql "${DB_URL}" -c "delete from auth.users where email like 'dup-auth-other-%@example.com'"`, { stdio: 'ignore' })
}

test.describe('1ログインに作業員が複数ぶら下がった時', () => {
  test.beforeAll(async () => {
    await purge()
    accountId = await getAccountId()
    authUserId = execSync(
      `psql "${DB_URL}" -tAc "select id from auth.users where email='${ADMIN_LOGIN_EMAIL}'"`,
      { encoding: 'utf8' },
    ).trim()

    // ログイン中の管理者に紐づく作業員（＝自分）
    const w = await restSrv('workers', {
      method: 'POST', headers: { Prefer: 'return=representation' },
      body: JSON.stringify({ account_id: accountId, name: ME, role: 'site', active: true, auth_user_id: authUserId, permission_role: 'admin' }),
    })
    const mu = await restSrv('users', {
      method: 'POST', headers: { Prefer: 'return=representation' },
      body: JSON.stringify({ account_id: accountId, real_name: ME, worker_id: w[0].id }),
    })
    myUserId = mu[0].id

    // 日報の持ち主（他人）
    const ow = await restSrv('workers', {
      method: 'POST', headers: { Prefer: 'return=representation' },
      body: JSON.stringify({ account_id: accountId, name: OWNER, role: 'site', active: true }),
    })
    const ou = await restSrv('users', {
      method: 'POST', headers: { Prefer: 'return=representation' },
      body: JSON.stringify({ account_id: accountId, real_name: OWNER, worker_id: ow[0].id }),
    })
    ownerUserId = ou[0].id

    // もう1人の実効オーナー（別ログイン）を置く。これで口座は「完全ワンオペ」でなくなり、
    // 自己承認はソロオーナー例外(canSelfApprove)の対象外＝従来どおり禁止される。
    // この土台があって初めて「重複時に自己承認ブロックが外れないか(fail-closed)」を検証できる。
    // ★workers.auth_user_id は auth.users への FK。実在する auth ユーザーを1つ作って紐づける
    //  （token列は NULL 不可のため '' を入れる＝ローカル auth の既知の落とし穴）。
    const otherAuthId = randomUUID()
    execSync(
      `psql "${DB_URL}" -c "insert into auth.users (id, instance_id, aud, role, email, confirmation_token, recovery_token, email_change_token_new, email_change) ` +
      `values ('${otherAuthId}', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', '${OTHER_OWNER_EMAIL}', '', '', '', '')"`,
      { stdio: 'ignore' },
    )
    await restSrv('workers', {
      method: 'POST', headers: { Prefer: 'return=minimal' },
      body: JSON.stringify({ account_id: accountId, name: OTHER_OWNER, role: 'site', active: true, auth_user_id: otherAuthId, permission_role: 'admin' }),
    })
  })

  test.afterAll(async () => { await purge() })

  test('★DBが重複を拒否する（同じログインに2人目の作業員を紐づけられない）', async () => {
    // 本番で起きたのと同じ操作＝同じ auth_user_id を持つ2人目の作業員を作る
    let err: any = null
    try {
      await restSrv('workers', {
        method: 'POST', headers: { Prefer: 'return=representation' },
        body: JSON.stringify({ account_id: accountId, name: SHADOW, role: 'site', active: true, auth_user_id: authUserId }),
      })
    } catch (e) { err = e }

    expect(err, '★重複を作れてしまう＝2026-08-10の障害が再発する').not.toBeNull()
    expect(String(err?.message), 'DBの一意制約で弾かれる').toContain('workers_account_auth_user_unique')

    // 念のため実際に増えていないこと（エラーだけ出して入っている、を許さない）
    const rows = await restSrv(`workers?auth_user_id=eq.${authUserId}&account_id=eq.${accountId}&select=id`)
    expect(rows, '1ログイン=1作業員').toHaveLength(1)
  })

  test('★重複が生き残っていても自己承認ブロックは外れない（fail-closed）', async ({ page }) => {
    // 制約を一時的に外して、本番と同じ「壊れた状態」を再現する。
    // ★これをやらないと、単数引き(maybeSingle)に戻した実装でもテストが素通りしてしまう
    //  ＝守りたいものを守れていないテストになる。
    execSync(`psql "${DB_URL}" -c "drop index if exists workers_account_auth_user_unique"`, { stdio: 'ignore' })
    let shadowWorkerId = ''
    try {
      const sw = await restSrv('workers', {
        method: 'POST', headers: { Prefer: 'return=representation' },
        body: JSON.stringify({ account_id: accountId, name: SHADOW, role: 'site', active: true, auth_user_id: authUserId }),
      })
      shadowWorkerId = sw[0].id
      await restSrv('users', {
        method: 'POST', headers: { Prefer: 'return=minimal' },
        body: JSON.stringify({ account_id: accountId, real_name: SHADOW, worker_id: shadowWorkerId }),
      })

      // 自分が出した申請を1件置く
      const reason = `E2E重複_${TS}`
      await restSrv('daily_report_pending_edits', {
        method: 'POST', headers: { Prefer: 'return=minimal' },
        body: JSON.stringify({
          account_id: accountId, report_id: null, report_user_id: ownerUserId, report_date: DATE,
          kind: 'late_new', status: 'pending', reason,
          submitted_by_user_id: myUserId, submitted_by_name: ME,
          payload: {
            is_working: true, leave_type: null, is_business_trip: false, note: 'E2E重複',
            sites: [{ siteName: 'テスト現場B', workers: [], subcontractors: [], expenses: {
              vehicles: [], parkings: [], highways: [], trains: [], hotels: [],
              others: [{ label: 'E2E資材', yen: 3000, tategae: false, fileUrls: [] }], entertainments: [] } }],
            gasoline_items: [],
          },
        }),
      })

      // 重複状態のまま画面を開く。ここで「自分の申請」と判定できること。
      // ★1回の goto では拾えないことがある（挿入直後の一覧取得と競合する）。
      //  ここで falsy に倒すと「承認ボタンが無い＝合格」に化けるので、必ずカードの実在まで待つ。
      const card = page.locator('[data-testid="pending-card"]', { hasText: reason })
      await expect(async () => {
        await page.goto('/report-edit-review', { waitUntil: 'networkidle' })
        await expect(card).toBeVisible({ timeout: 5000 })
      }).toPass({ timeout: 30000 })

      await expect(card.getByTestId('pending-approve'),
        '★重複があっても自分の申請には承認ボタンを出さない（単数引きだとここで出てしまう）').toHaveCount(0)
      await expect(card.getByTestId('pending-self-blocked')).toBeVisible()
    } finally {
      // 壊れた状態を必ず片付けてから制約を貼り直す（残すと後続の全テストの前提を侵す）
      if (shadowWorkerId) {
        for (const u of (await restSrv(`users?real_name=eq.${encodeURIComponent(SHADOW)}&select=id`)) ?? []) {
          await restSrv(`users?id=eq.${u.id}`, { method: 'DELETE' }).catch(() => {})
        }
        await restSrv(`workers?id=eq.${shadowWorkerId}`, { method: 'DELETE' }).catch(() => {})
      }
      execSync(
        `psql "${DB_URL}" -c "create unique index if not exists workers_account_auth_user_unique on public.workers (account_id, auth_user_id) where auth_user_id is not null"`,
        { stdio: 'ignore' },
      )
      const idx = execSync(
        `psql "${DB_URL}" -tAc "select count(*) from pg_indexes where indexname='workers_account_auth_user_unique'"`,
        { encoding: 'utf8' },
      ).trim()
      if (idx !== '1') throw new Error('一意制約を戻せていない（後続テストの前提が壊れる）')
    }
  })
})
