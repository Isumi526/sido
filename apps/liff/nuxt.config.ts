// ============================================================
//  apps/liff / nuxt.config.ts
// ============================================================
export default defineNuxtConfig({
  ssr: false,                    // LIFF はクライアントサイドのみ
  devtools: { enabled: true },

  app: {
    head: {
      title: 'Construction Daily Report',
      meta: [
        { charset: 'utf-8' },
        { name: 'viewport', content: 'width=device-width, initial-scale=1, viewport-fit=cover' },
        { name: 'theme-color', content: '#0F0F0F' },
      ],
      link: [
        { rel: 'preconnect', href: 'https://fonts.googleapis.com' },
        { rel: 'stylesheet', href: 'https://fonts.googleapis.com/css2?family=Noto+Sans+JP:wght@400;500;700;900&display=swap' },
        { rel: 'stylesheet', href: 'https://fonts.googleapis.com/css2?family=Material+Symbols+Rounded:opsz,wght,FILL,GRAD@20..48,100..700,0..1,-50..200' },
      ],
    },
  },

  runtimeConfig: {
    public: {
      liffId: '',
      gasUrl: '',
      appEnv: process.env.NUXT_PUBLIC_APP_ENV || '',
      devNotifyGroupId: '',
      testerLineIds: '',        // カンマ区切りのLINE User ID（例: Uabc123,Udef456）
      supabaseUrl: process.env.NUXT_PUBLIC_SUPABASE_URL || '',
      supabaseAnonKey: process.env.NUXT_PUBLIC_SUPABASE_ANON_KEY || '',
      accountSlug: process.env.NUXT_PUBLIC_ACCOUNT_SLUG || 'sample-construction',
      edgeFunctionUrl: process.env.NUXT_PUBLIC_EDGE_FUNCTION_URL || '',
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
