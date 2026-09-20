// ============================================================
//  useGeolocation — 位置情報の取得（出退勤の打刻と同じ流儀を composable に切り出したもの・道具② 2026-09-20）
//
//  ★状態の意味（checkin/[[siteId]].vue から移設）:
//   idle      : 未取得（ユーザーのタップ待ち。iOS LINE は自動要求だとダイアログ無しで拒否されるため、必ずタップから）
//   pending   : 取得中
//   granted   : 取得済み
//   retryable : タイムアウト／取得不可（geolocation API 無しも含む）→「再取得」で再度ダイアログが出せる
//   blocked   : ハッキリ拒否（ブロック）済み → JS からは再表示不可。端末の設定からの許可が要る
//  ★Permissions API は使わない（iOS/LINE内ブラウザで前回の拒否を引きずるため）。常に実際の取得を試み、その結果だけで判定する。
//  ★道具の持出／返却では位置は「抑止」目的（QR を写真に残して遠隔操作する抜け道を塞ぐ）。
//   取れなくても記録はできる（確認事項2=A・「位置なし」と残る）ので、呼ぶ側が state を見て判断する。
// ============================================================
export type GeoState = 'idle' | 'pending' | 'granted' | 'retryable' | 'blocked'
export type GeoFix = { lat: number; lng: number; accuracy: number | null; locatedAt: string }

export function useGeolocation() {
  const state = ref<GeoState>('idle')
  const lat = ref<number | null>(null)
  const lng = ref<number | null>(null)
  const accuracy = ref<number | null>(null)
  const locatedAt = ref<string | null>(null)

  /** 取得を試みる。結果は state に入る。granted なら fix を返す */
  async function fetch(): Promise<GeoFix | null> {
    state.value = 'pending'
    if (typeof navigator === 'undefined' || !('geolocation' in navigator)) { state.value = 'retryable'; return null }
    try {
      const pos = await new Promise<GeolocationPosition>((resolve, reject) => {
        navigator.geolocation.getCurrentPosition(resolve, reject, { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 })
      })
      lat.value = pos.coords.latitude
      lng.value = pos.coords.longitude
      accuracy.value = Number.isFinite(pos.coords.accuracy) ? pos.coords.accuracy : null
      locatedAt.value = new Date(pos.timestamp || Date.now()).toISOString()
      state.value = 'granted'
      return fix()
    } catch (e: any) {
      // code 1=PERMISSION_DENIED(拒否), 2=POSITION_UNAVAILABLE, 3=TIMEOUT
      if (import.meta.dev) console.warn('[geolocation]', e?.code, e?.message)
      state.value = (e?.code === 1) ? 'blocked' : 'retryable'
      return null
    }
  }

  /** 取得済みの位置（無ければ null） */
  function fix(): GeoFix | null {
    if (state.value !== 'granted' || lat.value === null || lng.value === null) return null
    return { lat: lat.value, lng: lng.value, accuracy: accuracy.value, locatedAt: locatedAt.value ?? new Date().toISOString() }
  }

  return { state, lat, lng, accuracy, locatedAt, fetch, fix }
}
