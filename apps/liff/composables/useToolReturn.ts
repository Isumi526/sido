// ============================================================
//  useToolReturn — 場所QR → 道具QR の橋渡し（道具②・2026-09-20）
//  返却は「場所QRを読む → どれを返しますか → 道具QRを読む → 確定」。標準カメラで読むと別ページへの遷移になるので、
//  場所ページが「返却先」を sessionStorage に置き、道具ページがそれを見て返却モードになる。
//  ★10分で失効（古い返却先が残ったまま別の道具を読んで、誤った場所に返したことにならないため）。
// ============================================================
const RETURN_KEY = 'sido_tool_return_to'
const TTL_MS = 10 * 60 * 1000

export type ToolReturnTo = { id: string; label: string }

export function useToolReturn() {
  function set(v: ToolReturnTo) {
    try { sessionStorage.setItem(RETURN_KEY, JSON.stringify({ ...v, at: Date.now() })) } catch { /* private mode 等 */ }
  }
  function get(): ToolReturnTo | null {
    try {
      const raw = sessionStorage.getItem(RETURN_KEY)
      if (!raw) return null
      const v = JSON.parse(raw)
      if (!v?.id || !v?.at || Date.now() - Number(v.at) > TTL_MS) { sessionStorage.removeItem(RETURN_KEY); return null }
      return { id: String(v.id), label: String(v.label ?? '') }
    } catch { return null }
  }
  function clear() { try { sessionStorage.removeItem(RETURN_KEY) } catch { /* noop */ } }
  return { set, get, clear }
}
