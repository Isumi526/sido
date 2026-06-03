// ============================================================
//  plugins/supabase-host.client.ts
//  起動時に「接続中の Supabase ホスト」を1行表示する保険。
//  localhost:54321（🟢 LOCAL）か *.supabase.co（☁️ CLOUD）か一目で分かる。
//  ※ local dev のみの話。Vercel(preview/prod) は Vercel 環境変数を使うため、
//     その場合は本番URLが表示されるだけで挙動には無関係。
// ============================================================
export default defineNuxtPlugin(() => {
  const url = (useRuntimeConfig().public.supabaseUrl as string) || '(unset)'
  let host = url
  try { host = new URL(url).host } catch { /* keep raw */ }
  const local = /localhost|127\.0\.0\.1/.test(url)
  console.log(
    `%c[Supabase] ${host} ${local ? '🟢 LOCAL' : '☁️ CLOUD'}`,
    `color:${local ? '#06C755' : '#e67e22'};font-weight:bold`,
  )
})
