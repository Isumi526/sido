// 現場チャットの新着を、購読している端末（招待リンクのゲスト等）へ配る。
//
// ★fire-and-forget。投稿自体はもう成立しているので、ここは絶対に throw しない
//  ＝通知の失敗で「送信できませんでした」と誤解させない。
// ★VAPID鍵が本番secretに無ければ EF 側が no-op で 200 を返す＝この呼び出しは無害。
import { supabase } from './supabase'

export function notifySiteChatPush(opts: { siteId: string; senderName: string; body: string }): void {
  const efUrl = import.meta.env.VITE_SUPABASE_EDGE_URL
  if (!efUrl || !opts.siteId) return
  void (async () => {
    try {
      const { data: { session } } = await supabase.auth.getSession()
      if (!session) return   // 管理画面は必ずログイン済み。無ければ EF 側で 401 になるだけ
      await fetch(`${efUrl}/send-site-chat-push`, {
        method: 'POST',
        keepalive: true,
        headers: {
          'Content-Type': 'application/json',
          apikey: import.meta.env.VITE_SUPABASE_ANON_KEY,
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({ site_id: opts.siteId, sender_name: opts.senderName, body: opts.body }),
      })
    } catch (e) {
      console.warn('[push] 新着通知の送信をスキップ:', e)
    }
  })()
}
