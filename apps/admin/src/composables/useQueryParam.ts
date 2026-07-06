// ============================================================
//  useQueryParam
//  フィルタ/選択などの画面状態を URL クエリに同期する（ページ跨ぎ/戻る/リロードで復元）。
//  使い方: const selectedWorker = useQueryParam('worker', '')  ← 通常の ref と同じように使える。
//  ・初期値は URL クエリ優先（無ければ default）。
//  ・変更時に router.replace で ?key=value を更新（既定=空/デフォルト値なら該当キーを消す＝URLを汚さない）。
// ============================================================
import { ref, watch, type Ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'

export function useQueryParam<T extends string>(key: string, defaultVal: T): Ref<T> {
  const route  = useRoute()
  const router = useRouter()
  const initial = (route.query[key] as string | undefined) ?? defaultVal
  const state = ref(initial) as Ref<T>

  watch(state, (v) => {
    const next = { ...route.query } as Record<string, any>
    if (v == null || v === '' || v === defaultVal) delete next[key]   // デフォルト/空はキーを消す
    else next[key] = v
    // 同値なら書き込まない（無駄な履歴/リロードを避ける）
    if ((route.query[key] ?? '') !== (next[key] ?? '')) router.replace({ query: next })
  })

  return state
}
