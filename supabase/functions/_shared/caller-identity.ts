// ============================================================
//  _shared/caller-identity.ts
//  Edge Function の呼び出し元の身元を「検証してから」解決する。
//
//  ★なぜ関数内で認可するのか（config.toml の verify_jwt に頼れない）:
//   本番は CI が **全関数を --no-verify-jwt でデプロイ**する運用なので、
//   config.toml の verify_jwt はローカル用の飾りでしかない。
//   実際に効くのは各関数の in-code 認可だけ。
//
//  ★大原則: **クライアントが申告した accountSlug / user_id / account_id は一切信じない**。
//   検証済みの身元（Supabase JWT の app_metadata、または署名検証した LINE ID token の sub）
//   からサーバ側で引き直す。ここを守らないと「slug を書き換えれば他社のデータを触れる」
//   クロステナントの穴になる（実際に send-expense-application で起きていた）。
//
//  身元の経路は3つ:
//   (1) Supabase JWT … admin / email-pw ログインの作業員
//   (2) LINE ID token … LINE 作業員（anon で叩くので JWT を持たない）
//   (3) dev_line_user_id … **ローカルスタックに繋がっている時だけ**有効な検証用の抜け道。
//       LIFF は開発モードで LINE ID token を発行しないため、これが無いとローカルE2Eを通せない。
//       本番の SUPABASE_URL は 127.0.0.1 ではないので、デプロイ後にこの経路は開かない。
// ============================================================
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { createRemoteJWKSet, jwtVerify } from 'https://esm.sh/jose@5'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? ''
const ANON_KEY     = Deno.env.get('SUPABASE_ANON_KEY') ?? ''

const LINE_CHANNEL_ID = Deno.env.get('LINE_LOGIN_CHANNEL_ID') ?? ''
const LINE_ISSUER = 'https://access.line.me'
const LINE_JWKS = createRemoteJWKSet(new URL('https://api.line.me/oauth2/v2.1/certs'))

/** ローカルスタックに繋がっている時だけ true（本番のURLはホスト名付きなので false） */
export const IS_LOCAL = /(^|\/\/)(127\.0\.0\.1|localhost|kong)(:|\/|$)/.test(SUPABASE_URL)

export type Caller = {
  accountId: string
  /** users.id（LINE作業員は必ず、JWT経路は workers 経由で引けた時のみ） */
  userId: string | null
  /** workers.id */
  workerId: string | null
  name: string | null
}

/** LINE ID token を JWKS で署名検証して sub を返す。検証できなければ null。 */
export async function verifyLineIdToken(idToken: string): Promise<string | null> {
  try {
    const { payload } = await jwtVerify(idToken, LINE_JWKS, {
      issuer: LINE_ISSUER,
      ...(LINE_CHANNEL_ID ? { audience: LINE_CHANNEL_ID } : {}),
    })
    return (payload.sub as string) ?? null
  } catch {
    return null
  }
}

async function callerFromLineUserId(svc: any, lineUserId: string): Promise<Caller | null> {
  const { data: u } = await svc.from('users')
    .select('id, account_id, worker_id, real_name')
    .eq('line_user_id', lineUserId).maybeSingle()
  if (!u?.account_id) return null
  return { accountId: u.account_id, userId: u.id ?? null, workerId: u.worker_id ?? null, name: u.real_name ?? null }
}

/**
 * 呼び出し元の身元を解決する。解決できなければ null（＝呼び出し側は 401 で拒否する）。
 * svc は service_role クライアント（RLSを跨いで身元を引き直すため）。
 */
export async function resolveCaller(
  svc: any,
  authHeader: string,
  lineIdToken: string,
  devLineUserId: string,
): Promise<Caller | null> {
  // (1) Supabase JWT。anon キーそのものは「認証済み」ではないので除外する。
  if (authHeader && ANON_KEY && !authHeader.endsWith(ANON_KEY)) {
    const cli = createClient(SUPABASE_URL, ANON_KEY, { global: { headers: { Authorization: authHeader } } })
    const { data } = await cli.auth.getUser()
    const meta = (data?.user?.app_metadata ?? {}) as Record<string, unknown>
    const slug = meta.account_slug as string | undefined
    const authUserId = data?.user?.id
    if (slug && authUserId) {
      const { data: acct } = await svc.from('accounts').select('id').eq('slug', slug).maybeSingle()
      const accountId = acct?.id
      if (accountId) {
        // ★account_id でも絞る。同じ人が複数テナントの worker として登録されている場合に
        //   別テナント側の行を拾わないため。
        const { data: w } = await svc.from('workers').select('id, name')
          .eq('auth_user_id', authUserId).eq('account_id', accountId).maybeSingle()
        const { data: u } = w?.id
          ? await svc.from('users').select('id, real_name')
              .eq('worker_id', w.id).eq('account_id', accountId).maybeSingle()
          : { data: null }
        return { accountId, userId: u?.id ?? null, workerId: w?.id ?? null, name: u?.real_name ?? w?.name ?? null }
      }
    }
  }
  // (2) LINE ID token。sub は署名検証済み＝改ざん不可。
  if (lineIdToken) {
    const sub = await verifyLineIdToken(lineIdToken)
    if (sub) return await callerFromLineUserId(svc, sub)
  }
  // (3) ローカル検証用（本番では開かない）
  if (IS_LOCAL && devLineUserId) return await callerFromLineUserId(svc, devLineUserId)
  return null
}

/** 承認を行える権限。apps/admin/src/lib/auth.ts の ADMIN_ALLOWED_ROLES と揃える。 */
export const APPROVER_ROLES = ['owner', 'admin', 'office', 'site_manager']

export type Approver = {
  accountId: string
  authUserId: string
  /** workers.id。worker行を持たない純オーナーは null */
  workerId: string | null
  /** 'owner' | 'admin' | 'office' | 'site_manager' | 'worker' */
  role: string
}

/**
 * 「承認する人」の身元と権限を、Supabase JWT からサーバ側で解決する。
 *
 * ★なぜ resolveCaller と別関数なのか:
 *  承認は **管理画面（Supabase JWT）専用**の操作で、LINE ID token 経路や
 *  ローカル用の dev_line_user_id で通してはいけない。resolveCaller は3経路を
 *  受け付けるので、そのまま承認に使うと LINE 作業員が承認できてしまう。
 *
 * ★権限の判定は apps/admin/src/lib/auth.ts の resolveRole と同じ規則にする:
 *   - workers 行あり → その permission_role（未設定なら 'worker'）
 *   - workers 行なし → accounts.owner_auth_user_id が一致する時だけ 'owner'、それ以外は 'worker'
 *   - 取得に失敗したら 'worker'（フェイルセーフ。フェイルオープンでオーナーにしない）
 *  「worker行が無い＝オーナー」と倒す実装は過去に本番でフェイルオープンの事故を
 *  起こしているので、owner_auth_user_id の明示一致だけをオーナーとみなす。
 *
 * ★画面側にガードがあっても EF 側で必ず検査する。
 *  画面のガードは URL 直打ちや REST 直叩きで迂回できる＝ガードではない。
 */
export async function resolveApprover(svc: any, authHeader: string): Promise<Approver | null> {
  // anon キーそのものは「認証済み」ではない。JWT 経路以外はここで落とす。
  if (!authHeader || !ANON_KEY || authHeader.endsWith(ANON_KEY)) return null

  const cli = createClient(SUPABASE_URL, ANON_KEY, { global: { headers: { Authorization: authHeader } } })
  const { data } = await cli.auth.getUser()
  const authUserId = data?.user?.id
  const slug = ((data?.user?.app_metadata ?? {}) as Record<string, unknown>).account_slug as string | undefined
  if (!authUserId || !slug) return null

  const { data: acct } = await svc.from('accounts').select('id, owner_auth_user_id').eq('slug', slug).maybeSingle()
  if (!acct?.id) return null

  try {
    // ★account_id でも絞る。同じ人が複数テナントの worker として居る場合に別テナント側を拾わない
    const { data: w, error } = await svc.from('workers')
      .select('id, permission_role').eq('auth_user_id', authUserId).eq('account_id', acct.id).maybeSingle()
    if (error) throw error
    if (w?.id) {
      return { accountId: acct.id, authUserId, workerId: w.id, role: (w.permission_role as string) ?? 'worker' }
    }
    const isOwner = !!acct.owner_auth_user_id && acct.owner_auth_user_id === authUserId
    return { accountId: acct.id, authUserId, workerId: null, role: isOwner ? 'owner' : 'worker' }
  } catch {
    return { accountId: acct.id, authUserId, workerId: null, role: 'worker' }
  }
}
