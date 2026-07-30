// ============================================================
//  extractJobs.ts — 図面の材料抽出を「並行処理できるジョブ」として持つ共有ストア
//
//  なぜページ（コンポーネント）の外に出すか（R53・2026-07-30 レビュー第5回）:
//   54ページの図面は数分かかる。これを見積ビルダーの中の ref に持つと
//     ・モーダルを閉じられない（閉じると状態が消える）
//     ・別の画面（マスタ・担当者）へ移った瞬間に解析が死ぬ
//   となり、実際に「解析が終わるまで他の作業ができない」状態になっていた。
//   モジュールスコープに置くことで、SPA内の画面遷移では解析が止まらない。
//
//  ★タブを閉じた場合（＝JSごと消える場合）は、estimate_drawing_extract_jobs に
//   「何ページまで終わったか＋その結果」を1ページごとに書いているので、
//   次に開いた時に done_pages の次のページから続けられる。
//   （ブラウザを閉じてもサーバー側で完走させるのは R56。Edge Function の
//     実行時間制限があり、定期実行ワーカーの新設が必要なため今回は採らない）
// ============================================================
import { ref, reactive } from 'vue'
import { supabase } from './supabase'
import { getAccountId } from './account'

const DRAWING_BUCKET = 'estimate-drawings'

export type ExtractRow = {
  page: number; part: string; manufacturer: string; code: string
  size: string; spec: string; quantity: string; note: string
}

export type ExtractJob = {
  id: string | null           // DB上のジョブID（作成前は null）
  projectId: string
  attachmentId: string
  path: string                // storage のパス
  sourceName: string
  total: number
  done: number
  status: 'running' | 'paused' | 'done' | 'error'
  rows: ExtractRow[]
  error: string
}

/** 添付図面ID => ジョブ。画面遷移で消えないようモジュールスコープに置く */
const jobs = reactive(new Map<string, ExtractJob>())
/** 実行中フラグ（同じ図面を二重に走らせない） */
const running = new Set<string>()
/** ストアの変更を Vue に伝えるためのカウンタ（Map の中身の入れ替えを検知させる） */
const rev = ref(0)

export function jobFor(attachmentId: string): ExtractJob | null {
  void rev.value
  return jobs.get(attachmentId) ?? null
}
export function isRunning(attachmentId: string): boolean {
  void rev.value
  return running.has(attachmentId)
}
/** この案件で走っているジョブ（進捗の常時表示用） */
export function runningJobsOf(projectId: string): ExtractJob[] {
  void rev.value
  return [...jobs.values()].filter(j => j.projectId === projectId && j.status === 'running')
}

// ── ナビのバッジ（完了したのに人がまだ結果を見ていないジョブ数）──
export const extractDoneCount = ref(0)
export async function refreshExtractBadge() {
  const accountId = await getAccountId()
  if (!accountId) { extractDoneCount.value = 0; return }
  const { count } = await supabase.from('estimate_drawing_extract_jobs')
    .select('id', { count: 'exact', head: true })
    .eq('account_id', accountId).eq('status', 'done').is('acked_at', null)
  extractDoneCount.value = count ?? 0
}
/** 結果を人が見た（＝バッジから落とす） */
export async function ackJob(job: ExtractJob) {
  if (!job.id) return
  await supabase.from('estimate_drawing_extract_jobs').update({ acked_at: new Date().toISOString() }).eq('id', job.id)
  await refreshExtractBadge()
}

/** 案件を開いた時に、前回の続き（中断・完了）を手元に復元する */
export async function loadJobsForProject(projectId: string) {
  const accountId = await getAccountId()
  if (!accountId) return
  const { data } = await supabase.from('estimate_drawing_extract_jobs')
    .select('id, project_id, attachment_id, source_name, total_pages, done_pages, status, rows, error')
    .eq('account_id', accountId).eq('project_id', projectId)
  for (const j of (data ?? []) as any[]) {
    // 走っている最中のジョブは手元の状態のほうが新しいので上書きしない
    if (running.has(j.attachment_id)) continue
    jobs.set(j.attachment_id, {
      id: j.id, projectId: j.project_id, attachmentId: j.attachment_id, path: '',
      sourceName: j.source_name ?? '', total: j.total_pages ?? 0, done: j.done_pages ?? 0,
      // ★running のまま残っているのは「タブを閉じて中断された」もの。中断として見せる。
      status: j.status === 'running' ? 'paused' : j.status,
      rows: Array.isArray(j.rows) ? j.rows : [], error: j.error ?? '',
    })
  }
  rev.value++
}

async function persist(job: ExtractJob) {
  if (!job.id) return
  await supabase.from('estimate_drawing_extract_jobs').update({
    total_pages: job.total, done_pages: job.done, status: job.status,
    rows: job.rows, error: job.error || null, updated_at: new Date().toISOString(),
  }).eq('id', job.id)
}

/**
 * 抽出を開始（または中断したところから再開）する。
 * await しなくてよい（＝呼び出し側は待たずに他の操作へ進める）。
 */
export async function startExtract(opts: {
  projectId: string; attachmentId: string; path: string; sourceName: string
}): Promise<void> {
  const { projectId, attachmentId, path, sourceName } = opts
  // ★二重起動の防止は「最初のawaitより前」に置く。await の後だと、
  //  ボタンを素早く2回押した時に両方が通り、同じページを2回解析して結果が二重になる。
  if (running.has(attachmentId)) return
  running.add(attachmentId)
  rev.value++
  try {
    await runJob(projectId, attachmentId, path, sourceName)
  } finally {
    running.delete(attachmentId)
    rev.value++
  }
}

async function runJob(projectId: string, attachmentId: string, path: string, sourceName: string) {
  const accountId = await getAccountId()
  if (!accountId) return

  let job = jobs.get(attachmentId)
  // ★done からの再実行は「やり直し」なので0ページ目から。
  //  error は途中で落ちただけなので、済んだページを捨てずに続きから再開する
  //  （54ページの途中で通信が切れた時に全部やり直すのは実用にならない）。
  if (!job || job.status === 'done') {
    const fresh: ExtractJob = {
      id: job?.id ?? null, projectId, attachmentId, path, sourceName,
      total: 0, done: 0, status: 'running', rows: [], error: '',
    }
    jobs.set(attachmentId, fresh)
    // ★Map から取り直す。reactive(Map) に入れた値はプロキシ化されるので、
    //  素のオブジェクト（fresh）を直接書き換えても画面が更新されない。
    job = jobs.get(attachmentId)!
  }
  job.path = path || job.path
  job.status = 'running'
  job.error = ''
  rev.value++

  // DB側のジョブ行を用意（attachment_id に一意indexがあるので upsert で1本に保つ）
  if (!job.id) {
    const { data, error } = await supabase.from('estimate_drawing_extract_jobs')
      .upsert({
        account_id: accountId, project_id: projectId, attachment_id: attachmentId,
        source_name: sourceName, status: 'running', total_pages: job.total, done_pages: job.done,
        rows: job.rows, error: null, acked_at: null,
      }, { onConflict: 'attachment_id' })
      .select('id').single()
    if (error) { job.status = 'error'; job.error = error.message; rev.value++; return }
    job.id = (data as any).id
  } else {
    await supabase.from('estimate_drawing_extract_jobs')
      .update({ status: 'running', done_pages: job.done, rows: job.rows, error: null, acked_at: null })
      .eq('id', job.id)
  }
  await runPages(job)
}

async function runPages(job: ExtractJob) {
  try {
    const { data: file, error } = await supabase.storage.from(DRAWING_BUCKET).download(job.path)
    if (error || !file) throw error ?? new Error('図面を取得できませんでした')
    const buf = new Uint8Array(await file.arrayBuffer())
    const { PDFDocument } = await import('pdf-lib')
    const src = await PDFDocument.load(buf)
    job.total = src.getPageCount()
    rev.value++
    const { data: sess } = await supabase.auth.getSession()

    // ★1ページずつ送る（図面は1枚が重く、まとめて送ると解析精度も落ちる）
    //  中断から再開する場合は done_pages の次のページから始める。
    for (let i = job.done; i < job.total; i++) {
      const one = await PDFDocument.create()
      const [pg] = await one.copyPages(src, [i])
      one.addPage(pg)
      const bytes = await one.save()
      let bin = ''
      const chunk = 0x8000
      for (let k = 0; k < bytes.length; k += chunk) {
        bin += String.fromCharCode.apply(null, Array.from(bytes.subarray(k, k + chunk)) as any)
      }
      const resp = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/drawing-material-extract`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${sess?.session?.access_token ?? ''}`,
          apikey: import.meta.env.VITE_SUPABASE_ANON_KEY,
        },
        body: JSON.stringify({ image_base64: btoa(bin), mime: 'application/pdf', page: i + 1 }),
      })
      const json = await resp.json().catch(() => null)
      if (!resp.ok || json?.error) {
        job.status = 'error'
        job.error = json?.error || `解析エラー(${resp.status})`
        rev.value++
        await persist(job)
        return
      }
      for (const r of (json?.rows ?? []) as any[]) {
        job.rows.push({
          page: i + 1, part: r.part ?? '', manufacturer: r.manufacturer ?? '', code: r.code ?? '',
          size: r.size ?? '', spec: r.spec ?? '', quantity: r.quantity ?? '', note: r.note ?? '',
        })
      }
      job.done = i + 1
      rev.value++
      // ★1ページごとに保存する。タブを閉じられてもここまでの結果は残る。
      await persist(job)
    }
    job.status = 'done'
    rev.value++
    await persist(job)
    await refreshExtractBadge()
  } catch (e: any) {
    job.status = 'error'
    job.error = e?.message ?? '解析に失敗しました'
    rev.value++
    await persist(job)
  }
}

/** 進捗の文言（「12/54ページ」）。UIで何度も組み立てないよう1箇所に置く */
export const progressLabel = (j: ExtractJob) => `${j.done}/${j.total || '?'}ページ`
