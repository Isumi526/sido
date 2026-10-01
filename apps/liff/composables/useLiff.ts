// ============================================================
//  composables/useLiff.ts
//  LINE LIFF SDK の初期化と認証を管理する
// ============================================================
interface LiffState {
  initialized: boolean
  loggedIn: boolean
  isTester: boolean
  profile: { userId: string; displayName: string; pictureUrl?: string; statusMessage?: string } | null
  error: string | null
  // Phase 2a: 認証経路。'line'=従来のLINE(anon相当)、'password'=email/pwのSupabase Authセッション
  authMode: 'line' | 'password' | null
  // Phase 2a: email/pw セッションの worker_id（app_metadata.worker_id）。LINE経路では null。
  workerId: string | null
}

// ── 開発モードの自動ログイン（2026-09-27・RLS第2段B）──────────────────────────
//  RLS第2段Bで公開キー(anon)の読み書きが0になり、下の「ログイン無しの開発モード（dev-user-id）」では
//  users / workers / settings が読めず画面が成り立たなくなった。ローカルで `npm run dev:liff` を開いた時、
//  セッションが無ければテスト用の作業員（seed の Worker 01・E2E と同じログイン）で自動ログインする。
//  ★本番・ステージングでは絶対に動かさない。三重のガード:
//   1) import.meta.dev … nuxt dev の時だけ true。本番ビルドではこの分岐ごと消える
//   2) appEnv === 'development'
//   3) Supabase URL がローカル（127.0.0.1 / localhost）… 本番の .env には development と本番URLが
//      同居しているので、appEnv だけで判定してはいけない（CLAUDE.md STAGING 節）
//  テスト用作業員のログインが無い環境（db reset 直後等）は scripts/setup-liff-dev-login.mjs で用意する。
//  止めたい時: localStorage.dev_autologin = 'off'（E2E のログイン無し spec はこれで外す）。
//  ?dev_line_uid / localStorage.dev_line_uid を指定した時も従来の LINE 経路の検証なので止める。
//  ★呼び出し側でも `import.meta.dev &&` を先に書く。そうしないと本番ビルドで分岐が残り、
//   ログイン情報（ローカル専用のテスト値）が配信物に載る（2026-09-27 ビルド成果物で確認）。

function isLocalSupabaseUrl(url: string): boolean {
  try {
    const h = new URL(url).hostname
    return h === '127.0.0.1' || h === 'localhost' || h === '[::1]'
  } catch { return false }
}

function devAutoLoginAllowed(appEnv: string, supabaseUrl: string): boolean {
  if (!import.meta.dev) return false
  if (appEnv !== 'development') return false
  if (!isLocalSupabaseUrl(supabaseUrl)) return false
  try {
    if (window.localStorage?.getItem('dev_autologin') === 'off') return false
    if (new URL(window.location.href).searchParams.get('dev_line_uid')) return false
    if (window.localStorage?.getItem('dev_line_uid')) return false
  } catch { /* URL/localStorage が使えない時は既定（許可） */ }
  return true
}

export const useLiff = () => {
  const config = useRuntimeConfig()
  const state = useState<LiffState>('liff', () => ({
    initialized: false,
    loggedIn: false,
    isTester: false,
    profile: null,
    error: null,
    authMode: null,
    workerId: null,
  }))

  function checkTester(userId: string) {
    const ids = config.public.testerLineIds
      .split(',')
      .map((id: string) => id.trim())
      .filter(Boolean)
    state.value.isTester = ids.includes(userId)
  }

  async function init() {
    if (state.value.initialized) return

    if (typeof window === 'undefined') return

    // Phase 2a: email/password の Supabase Auth セッションがあれば LINE より優先して採用。
    //   /login で signInWithPassword 済み → ここで identity を確立し LINE 誘導をスキップ。
    //   既存LINE経路は無改変（セッションが無ければ従来どおり dev/LINE フローへ）。
    const adoptSession = (user: { id: string; email?: string; app_metadata?: Record<string, unknown> }) => {
      const meta = (user.app_metadata ?? {}) as Record<string, unknown>
      state.value.profile = {
        userId: `auth:${(meta.worker_id as string) ?? user.id}`,
        displayName: (user.email ?? '作業員'),
        pictureUrl: '',
        statusMessage: '',
      }
      state.value.authMode = 'password'
      state.value.workerId = (meta.worker_id as string) ?? null
      state.value.loggedIn = true
      state.value.initialized = true
    }

    try {
      const supabase = useSupabase()
      const { data: { session } } = await supabase.auth.getSession()
      // 開発モードだけ、手元のセッションがサーバ側で生きているかも確かめる。ローカルDBは E2E と共有で、
      // E2E のログアウト（全端末ログアウト）等でテスト用作業員のセッションが消されると、手元には
      // 期限内のトークンが残ったまま全部 401 になる。死んでいたら捨てて下の自動ログインでやり直す。
      if (session?.user && import.meta.dev && devAutoLoginAllowed(config.public.appEnv as string, config.public.supabaseUrl as string)) {
        const { error } = await supabase.auth.getUser()
        if (error) {
          console.warn('[LIFF] 開発モード: 保存済みのセッションが無効（', error.message, '）→ 自動ログインし直します')
          await supabase.auth.signOut({ scope: 'local' }).catch(() => {})
        } else {
          adoptSession(session.user)
          return
        }
      } else if (session?.user) {
        adoptSession(session.user)
        return
      }
    } catch (e) {
      console.warn('[LIFF] auth session 取得失敗（LINE/devへフォールバック）', e)
    }

    // 開発モードの自動ログイン（ガードと理由は上の devAutoLoginAllowed を参照）
    if (import.meta.dev && devAutoLoginAllowed(config.public.appEnv as string, config.public.supabaseUrl as string)) {
      // seed の Worker 01（E2E の liff.worker-login と同じログイン。scripts/setup-liff-dev-login.mjs が用意する）
      const DEV_LOGIN_EMAIL = 'worker01.login.e2e@example.com'
      const DEV_LOGIN_PASS = 'worker-login-1234'
      try {
        const { data, error } = await useSupabase().auth.signInWithPassword({
          email: DEV_LOGIN_EMAIL, password: DEV_LOGIN_PASS,
        })
        if (data?.session?.user) {
          console.warn(`[LIFF] 開発モード: テスト用作業員（${DEV_LOGIN_EMAIL}）で自動ログインしました`)
          adoptSession(data.session.user)
          return
        }
        console.warn(
          `[LIFF] 開発モードの自動ログインに失敗（${error?.message ?? '不明'}）。` +
          'テスト用作業員のログインを `node scripts/setup-liff-dev-login.mjs` で用意してください。' +
          'ログイン無しの開発モードで続行します（公開キーでは読めない画面があります）',
        )
      } catch (e) {
        console.warn('[LIFF] 開発モードの自動ログインで例外（ログイン無しで続行）', e)
      }
    }

    // 開発モードはLIFF初期化をスキップしてダミープロフィールを使用
    if (config.public.appEnv === 'development') {
      console.warn('[LIFF] 開発モードで動作中（LIFF未接続）')
      // E2E/開発用: ?dev_line_uid=<line_user_id> で LINE userId を差し替え可能。
      // マルチテナントの実行時解決（line_user_id→account）を別テナントの作業員で検証する用途。
      // ★ development モード限定（本番の LIFF 経路 L82- には一切影響しない）。
      // ★localStorage からも受ける（2026-08-30 追加）。E2Eは page.goto を何十箇所も
      //  持っていて全部にクエリを足すのは現実的でない。ブラウザコンテキストに一度置けば
      //  spec ごとに専用の作業員を使えるようになり、1人の共有作業員を奪い合って
      //  「単独なら通るのに並列だと落ちる」テストが出る問題が消える。
      let devUserId = 'dev-user-id'
      try {
        const q = new URL(window.location.href).searchParams.get('dev_line_uid')
        const ls = window.localStorage?.getItem('dev_line_uid')
        if (q) devUserId = q
        else if (ls) devUserId = ls
      } catch { /* URL/localStorage 解析失敗時は既定 */ }
      state.value.profile = {
        userId: devUserId,
        displayName: '開発テストユーザー',
        pictureUrl: '',
        statusMessage: '',
      }
      state.value.isTester = true
      state.value.loggedIn = true
      state.value.authMode = 'line'
      state.value.initialized = true
      return
    }

    try {
      const liff = (await import('@line/liff')).default
      await liff.init({ liffId: config.public.liffId })

      if (!liff.isLoggedIn()) {
        // LINE未ログイン（外部ブラウザの作業員等）→ LINEのログイン画面ではなく、
        // アプリの email/password ログインページ(/login)へ誘導する。
        // ※ navigateTo はマウント前(init中)だとクライアント遷移が正しく走らず / のスプラッシュが
        //   残ることがあるため、ハード遷移(location.replace)で /login を読み込み直す（確実に着地）。
        // ※ LINEアプリ内で開いた場合は isLoggedIn()=true のためここは通らず、従来どおりLINE経路。
        if (typeof window !== 'undefined') window.location.replace('/login')
        return
      }

      state.value.profile = await liff.getProfile()
      checkTester(state.value.profile.userId)
      state.value.loggedIn = true
      state.value.authMode = 'line'
      state.value.initialized = true

      console.log('[LIFF] 初期化完了:', state.value.profile?.displayName, state.value.isTester ? '(テスター)' : '')
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e)
      state.value.error = msg
      console.error('[LIFF] 初期化エラー:', e)
    }
  }

  // LINE ID token（サーバ側で改ざん検証可能な署名済みトークン）。
  // email/pw セッション時は null（Supabase JWT を使う）。dev/未初期化時も null。
  async function getIdToken(): Promise<string | null> {
    if (state.value.authMode === 'password') return null
    if (config.public.appEnv === 'development') return null
    try {
      const liff = (await import('@line/liff')).default
      return liff.getIDToken() ?? null
    } catch {
      return null
    }
  }

  // 身元状態をまっさらに戻す（ログイン/ログアウト時に呼ぶ）。
  //  これをしないと init() の「if (initialized) return」で前のユーザーの profile/workerId が残り、
  //  別ユーザーで再ログインしても前のユーザーとして表示・解決されてしまう。
  function reset() {
    state.value = {
      initialized: false, loggedIn: false, isTester: false,
      profile: null, error: null, authMode: null, workerId: null,
    }
  }

  return {
    state: readonly(state),
    init,
    reset,
    getIdToken,
    initialized: computed(() => state.value.initialized),
    profile:     computed(() => state.value.profile),
    isLoggedIn:  computed(() => state.value.loggedIn),
    isTester:    computed(() => state.value.isTester),
    authMode:    computed(() => state.value.authMode),
    workerId:    computed(() => state.value.workerId),
  }
}
