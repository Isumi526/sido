// ============================================================
//  apps/liff / nuxt.config.ts
// ============================================================
export default defineNuxtConfig({
  ssr: false,                    // LIFF はクライアントサイドのみ
  devtools: { enabled: true },

  // Nuxt 3.21.7+ の SPA(ssr:false) dev で発生する
  // 「No entry found in rollupOptions.input」(resolveServerEntry) 回避。
  // viteEnvironmentApi を有効化すると環境別configに ssr.input が定義され、
  // SPA でも server entry が解決できる（dev/build 共通で安定）。
  experimental: { viteEnvironmentApi: true },

  app: {
    head: {
      title: 'GENLINKS',
      meta: [
        { charset: 'utf-8' },
        { name: 'viewport', content: 'width=device-width, initial-scale=1, viewport-fit=cover' },
        { name: 'theme-color', content: '#0F0F0F' },
        { 'http-equiv': 'Cache-Control', content: 'no-cache, no-store, must-revalidate' },
        { 'http-equiv': 'Pragma', content: 'no-cache' },
        { 'http-equiv': 'Expires', content: '0' },
        // ホーム画面追加時のアイコン/名称をGENLINKS固定にする（未設定だとaccount名の頭文字が使われてしまうため）
        { name: 'apple-mobile-web-app-title', content: 'GENLINKS' },
        { name: 'apple-mobile-web-app-capable', content: 'yes' },
      ],
      // ★CSSが当たる前のブラウザ既定（body に 8px の余白）で、初回描画だけ全体が8pxずれる。
      //  リンクしたCSSの適用を待つ隙間があるので、ここにインラインで先に潰す。
      //  （`children` は Unhead の型に無いので innerHTML で渡す。型を通すためだけの差で出力は同じ）
      style: [{ innerHTML: 'html,body{margin:0;padding:0}' }],
      link: [
        { rel: 'preconnect', href: 'https://fonts.googleapis.com' },
        // ★display=optional（swap ではない）。swap だと代替フォント→Webフォントに切り替わる瞬間に
        //  文字の高さが変わり、ページ全体が数十px跳ねる。本番で42pxずれ、押そうとしたものと
        //  別のボタンを踏む状態だった（2026-09-01 実測）。
        //  optional は「間に合わなければその表示では使わない・後から差し替えない」＝ずれない。
        //  読み込み済み（2回目以降・PWA）では通常どおり適用される。
        { rel: 'stylesheet', href: 'https://fonts.googleapis.com/css2?family=Noto+Sans+JP:wght@400;500;700;900&display=optional' },
        { rel: 'stylesheet', href: 'https://fonts.googleapis.com/css2?family=Material+Symbols+Rounded:opsz,wght,FILL,GRAD@20..48,100..700,0..1,-50..200&display=block' },
        { rel: 'manifest', href: '/manifest.json' },
        { rel: 'icon', href: '/favicon.ico' },
        { rel: 'apple-touch-icon', href: '/apple-touch-icon.png' },
      ],
    },
  },

  runtimeConfig: {
    public: {
      liffId: '',
      appEnv: process.env.NUXT_PUBLIC_APP_ENV || '',
      devNotifyGroupId: '',
      testerLineIds: '',        // カンマ区切りのLINE User ID（例: Uabc123,Udef456）
      supabaseUrl: process.env.NUXT_PUBLIC_SUPABASE_URL || '',
      supabaseAnonKey: process.env.NUXT_PUBLIC_SUPABASE_ANON_KEY || '',
      accountSlug: process.env.NUXT_PUBLIC_ACCOUNT_SLUG || 'sample-construction',
      edgeFunctionUrl: process.env.NUXT_PUBLIC_EDGE_FUNCTION_URL || '',
      // 脱LINE: 日報送信時の submit-report(LINE通知)呼び出しは既定オフ。
      //   'true' を明示した時のみ通知する。submit-report EF が全社共通グループへ送る
      //   クロステナント漏洩バグがあるため、EF側を per-tenant 化して修正するまでは絶対に有効化しない。
      reportLineNotify: process.env.NUXT_PUBLIC_REPORT_LINE_NOTIFY === 'true',
      // 現場チャット新着の web push。未設定なら購読も配信もしない（no-op）＝
      // 鍵を配るまでは今までどおり realtime/ポーリングだけで動く。
      vapidPublicKey: process.env.NUXT_PUBLIC_VAPID_PUBLIC_KEY || '',
    },
  },

  typescript: {
    strict: true,
  },

  vite: {
    resolve: {
      alias: {
        // #app-manifest の pre-transform エラーを抑制（dev/prod 共通スタブ）
        '#app-manifest': new URL('./app-manifest-stub.mjs', import.meta.url).pathname,
      },
    },
    optimizeDeps: {
      include: ['@line/liff', '@supabase/supabase-js'],
    },
  },
})
