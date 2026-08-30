// ============================================================
//  useVoiceInput — 日報の音声入力（8/19会議）
//  ブラウザ標準の SpeechRecognition で音声→テキスト化する薄いラッパ。
//  ・isSupported: 使えない環境（LINE内ブラウザ等で未対応）を検出する
//    → 呼び出し側はこれが false なら音声ボタンを出さず従来入力にフォールバック（AC）。
//  ・解析（テキスト→フォーム項目）は report-voice-parse EF 側。ここは録って文字化するだけ。
// ============================================================
import { ref } from 'vue'

type SpeechRecognitionLike = {
  lang: string
  interimResults: boolean
  continuous: boolean
  start: () => void
  stop: () => void
  abort: () => void
  onresult: ((e: any) => void) | null
  onerror: ((e: any) => void) | null
  onend: (() => void) | null
}

function getCtor(): (new () => SpeechRecognitionLike) | null {
  if (typeof window === 'undefined') return null
  const w = window as any
  return w.SpeechRecognition || w.webkitSpeechRecognition || null
}

export function useVoiceInput() {
  const isSupported = ref(!!getCtor())
  const listening = ref(false)
  const transcript = ref('')
  const error = ref<string | null>(null)
  let rec: SpeechRecognitionLike | null = null

  // 開始。onFinal は「話し終えて確定したテキスト」で1回呼ばれる。
  function start(onFinal: (text: string) => void) {
    const Ctor = getCtor()
    if (!Ctor) { isSupported.value = false; return }
    error.value = null
    transcript.value = ''
    try {
      rec = new Ctor()
      rec.lang = 'ja-JP'
      rec.interimResults = true
      rec.continuous = false
      let finalText = ''
      rec.onresult = (e: any) => {
        let interim = ''
        for (let i = e.resultIndex; i < e.results.length; i++) {
          const r = e.results[i]
          if (r.isFinal) finalText += r[0].transcript
          else interim += r[0].transcript
        }
        transcript.value = (finalText + interim).trim()
      }
      rec.onerror = (e: any) => {
        error.value = e?.error ? String(e.error) : 'speech-error'
        listening.value = false
      }
      rec.onend = () => {
        listening.value = false
        const t = (finalText || transcript.value).trim()
        if (t) onFinal(t)
      }
      listening.value = true
      rec.start()
    } catch (e) {
      error.value = String(e)
      listening.value = false
    }
  }

  function stop() {
    try { rec?.stop() } catch { /* noop */ }
  }
  function cancel() {
    try { rec?.abort() } catch { /* noop */ }
    listening.value = false
    transcript.value = ''
  }

  return { isSupported, listening, transcript, error, start, stop, cancel }
}
