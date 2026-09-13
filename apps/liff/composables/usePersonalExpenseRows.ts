// ============================================================
//  apps/liff/composables/usePersonalExpenseRows.ts
//  日報の中から個人経費（現場に紐づかない経費）を出すための状態と登録処理。
//  2026-09-04 運用者GO。出所は 2026-08 の議事録:
//   「ゆくゆくはこの日報送信の中に組み込みたい」
//   「個人経費枠が与えられているユーザーに関しては…個人経費の申請も一括できるかな」
//
//  ★保存先は既存の personal_expenses（新しいテーブルは作らない）。
//   書き込みは既存方針どおり EF `personal-expense-submit` 経由（usePersonalExpense）。
//   これで既存の個人経費ページ・月額枠の集計・経費PDFがそのまま効く。
//  ★client_token は行ごとに1つ持ち、再送しても二重計上しない（EF側で同一tokenは1行）。
// ============================================================
import { ref, computed } from 'vue'

export interface PersonalExpenseRow {
  date: string
  account_category: string
  amount: number | null
  payee: string
  companions: string
  note: string
  tategae: boolean
  files: File[]
  /** 紐付け先のオフィス・工場（任意・2026-09-13）。既定は作業員マスタの所属拠点。null=拠点未設定 */
  site_id: string | null
  site_name: string | null
  /** 1行につき1つ。再送で二重計上しないための冪等キー */
  token: string
}

export function newPersonalExpenseRow(date: string, office?: { id: string; name: string } | null): PersonalExpenseRow {
  return {
    site_id: office?.id ?? null,
    site_name: office?.name ?? null,
    date,
    account_category: '旅費交通費',
    amount: null,
    payee: '',
    companions: '',
    note: '',
    tategae: true,   // 個人経費は立替が既定（会社払いなら本人が切り替える）
    files: [],
    token: crypto.randomUUID(),
  }
}

export const usePersonalExpenseRows = () => {
  const rows = ref<PersonalExpenseRow[]>([])
  const usage = ref<{ used: number; limit: number } | null>(null)
  /** 枠を持っていて申請できるか（EF が権限と枠から判定した結果） */
  const canSubmit = ref(false)
  /** 紐付け先の候補（オフィス・工場）と所属拠点の既定。EF `state` が返す */
  const offices = ref<{ id: string; name: string; kind: string }[]>([])
  const baseSiteId = ref<string | null>(null)
  /** 新しい行に入れる既定の拠点。所属拠点があればそれ、無くて候補が1つならそれ、他は未設定 */
  const defaultOffice = computed(() => {
    const base = offices.value.find(o => o.id === baseSiteId.value)
    if (base) return base
    return offices.value.length === 1 ? offices.value[0] : null
  })

  /** 金額が入っている行だけが登録対象（空行は無視して送信を止めない） */
  const filled = computed(() => rows.value.filter(r => Number(r.amount) > 0))

  function add(date: string) { rows.value.push(newPersonalExpenseRow(date, defaultOffice.value)) }
  function remove(i: number) { rows.value.splice(i, 1) }
  function reset() { rows.value = [] }

  /**
   * 日報の日付が変わった時に、まだ触られていない行の日付を追従させる。
   * ★本人が個別に日付を変えた行（date が日報の日付と違う）は動かさない。
   */
  function syncDate(oldDate: string, newDate: string) {
    for (const r of rows.value) if (r.date === oldDate) r.date = newDate
  }

  /** 接待交際費・会議費で同行者名が空の行を返す（税務要件・現場経費と同じ規則） */
  function findMissingCompanions(): PersonalExpenseRow | null {
    return filled.value.find(r =>
      (r.account_category === '接待交際費' || r.account_category === '会議費') && !r.companions.trim(),
    ) ?? null
  }

  return { rows, usage, canSubmit, offices, baseSiteId, defaultOffice, filled, add, remove, reset, syncDate, findMissingCompanions }
}
