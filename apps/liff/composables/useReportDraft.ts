// ============================================================
//  composables/useReportDraft.ts
//  日報フォームの「下書き自動保存／復元」（スコープA：自動保存だけ・複数日跨ぎは別）
//   - 新規入力中のフォーム状態を localStorage に自動保存し、再訪時に復元する。
//     （LINEで中断→戻ると最初から、を解消）。LIFF/ブラウザ共通（同じ report.vue）。
//   - ユーザー×日付 でキー分離。送信成功で破棄。編集/代理モードでは使わない（呼び元でガード）。
//   - File[]（領収書）は localStorage に入らない＝ストリップして保存（復元後は再添付）。
//  ※ submit/save ロジックには一切触れない（読み取りと復元のみ）＝日報送信への影響を限定。
// ============================================================

const PREFIX = 'sido:report-draft:v1'

// localStorage に保存できない File[] フィールドを除去（useReport.stripFiles と同方針）
const FILE_KEYS = ['vehicleFiles', 'trainFiles', 'hotelFiles', 'leopalaceFiles', 'otherFiles', 'entertainmentFiles', 'garbagePhotos'] as const
const PER_ITEM_FILE_ARRAYS = ['parkings', 'highways', 'trains', 'others', 'entertainments'] as const

function stripExpenseFiles(expenses: any): any {
  if (!expenses || typeof expenses !== 'object') return expenses
  const out: any = { ...expenses }
  for (const k of FILE_KEYS) delete out[k]
  for (const arrKey of PER_ITEM_FILE_ARRAYS) {
    if (Array.isArray(out[arrKey])) {
      out[arrKey] = out[arrKey].map(({ files, ...rest }: any) => rest)
    }
  }
  return out
}

// form を JSON-safe（File を含まない）な素のオブジェクトに変換
function toSerializableForm(form: any): any {
  return {
    ...form,
    sites: (form?.sites ?? []).map((site: any) => ({
      ...site,
      expenses: stripExpenseFiles(site?.expenses),
    })),
  }
}

export interface ReportDraft {
  form:         any
  isWorkingStr: string
  siteUsage:    any[]
  savedAt:      number
}

export const useReportDraft = () => {
  const keyOf = (userId: string, date: string) => `${PREFIX}:${userId}:${date}`
  const available = () => typeof window !== 'undefined' && !!window.localStorage

  function save(userId: string, date: string, data: { form: any; isWorkingStr: string; siteUsage: any[] }): void {
    if (!available() || !userId || !date) return
    try {
      const payload: ReportDraft = {
        form:         toSerializableForm(data.form),
        isWorkingStr: data.isWorkingStr,
        siteUsage:    JSON.parse(JSON.stringify(data.siteUsage ?? [])),
        savedAt:      Date.now(),
      }
      window.localStorage.setItem(keyOf(userId, date), JSON.stringify(payload))
    } catch (e) {
      // 容量超過等は握りつぶす（下書きは best-effort・本流を止めない）
      console.warn('[reportDraft] save failed:', e instanceof Error ? e.message : e)
    }
  }

  function load(userId: string, date: string): ReportDraft | null {
    if (!available() || !userId || !date) return null
    try {
      const raw = window.localStorage.getItem(keyOf(userId, date))
      if (!raw) return null
      const d = JSON.parse(raw) as ReportDraft
      if (!d || !d.form) return null
      return d
    } catch {
      return null
    }
  }

  function clear(userId: string, date: string): void {
    if (!available() || !userId || !date) return
    try { window.localStorage.removeItem(keyOf(userId, date)) } catch { /* ignore */ }
  }

  // ── IndexedDB（File/Blob 保存用・localStorage は文字列のみのため画像は入らない）──
  //  領収書画像（File[]）を「パス→File[]」マップで保存し、復元時にフォームへ再注入する。
  const IDB_NAME = 'sido-report-draft'
  const IDB_STORE = 'files'
  function idbOpen(): Promise<IDBDatabase> | null {
    if (typeof indexedDB === 'undefined') return null
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(IDB_NAME, 1)
      req.onupgradeneeded = () => {
        if (!req.result.objectStoreNames.contains(IDB_STORE)) req.result.createObjectStore(IDB_STORE)
      }
      req.onsuccess = () => resolve(req.result)
      req.onerror = () => reject(req.error)
    })
  }
  async function idbRun<T>(mode: IDBTransactionMode, fn: (store: IDBObjectStore) => IDBRequest | null): Promise<T | null> {
    const p = idbOpen(); if (!p) return null
    const db = await p
    try {
      return await new Promise<T | null>((resolve, reject) => {
        const tx = db.transaction(IDB_STORE, mode)
        const req = fn(tx.objectStore(IDB_STORE))
        tx.oncomplete = () => resolve((req && (req as IDBRequest).result) ?? null)
        tx.onerror = () => reject(tx.error)
        tx.onabort = () => reject(tx.error)
      })
    } finally { db.close() }
  }

  // files: { [path]: File[] }（path 例: "0::vehicleFiles" / "0::parkings::1"）。
  async function saveFiles(userId: string, date: string, files: Record<string, File[]>): Promise<void> {
    if (!userId || !date) return
    try { await idbRun('readwrite', (s) => s.put(files, keyOf(userId, date))) }
    catch (e) { console.warn('[reportDraft] saveFiles failed:', e instanceof Error ? e.message : e) }
  }
  async function loadFiles(userId: string, date: string): Promise<Record<string, File[]> | null> {
    if (!userId || !date) return null
    try { return await idbRun<Record<string, File[]>>('readonly', (s) => s.get(keyOf(userId, date))) }
    catch { return null }
  }
  async function clearFiles(userId: string, date: string): Promise<void> {
    if (!userId || !date) return
    try { await idbRun('readwrite', (s) => s.delete(keyOf(userId, date))) } catch { /* ignore */ }
  }

  return { save, load, clear, saveFiles, loadFiles, clearFiles }
}
