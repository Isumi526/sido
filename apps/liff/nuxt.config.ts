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
      ],
    },
  },

  runtimeConfig: {
    public: {
      liffId: '',
      gasUrl: '',
      appEnv: 'development',
      devNotifyGroupId: '',
      testerLineIds: '',        // カンマ区切りのLINE User ID（例: Uabc123,Udef456）
      supabaseUrl: process.env.NUXT_PUBLIC_SUPABASE_URL || '',
      supabaseAnonKey: process.env.NUXT_PUBLIC_SUPABASE_ANON_KEY || '',
    },
  },

  typescript: {
    strict: true,
  },
})
