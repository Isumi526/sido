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

// 対象月（Date）を ?ym=YYYY-MM で URL 同期する。月ナビ(shiftMonth)を持つ集計ページ用。
//  ・初期値は ?ym= があればその月の1日、無ければ今月。
//  ・baseDate 変更時に ?ym を更新（今月ならキーを消す＝URLを汚さない）。
export function useYearMonthParam(): Ref<Date> {
  const route  = useRoute()
  const router = useRouter()
  const now = new Date()
  const thisYm = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
  function ymOf(d: Date) { return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}` }
  function parse(ym: string | undefined): Date {
    const m = (ym ?? '').match(/^(\d{4})-(\d{2})$/)
    if (!m) return new Date()
    return new Date(Number(m[1]), Number(m[2]) - 1, 1)
  }
  const state = ref(parse(route.query.ym as string | undefined)) as Ref<Date>

  watch(state, (d) => {
    const ym = ymOf(d)
    const next = { ...route.query } as Record<string, any>
    if (ym === thisYm) delete next.ym                                  // 今月はキーを消す
    else next.ym = ym
    if ((route.query.ym ?? '') !== (next.ym ?? '')) router.replace({ query: next })
  })

  return state
}
