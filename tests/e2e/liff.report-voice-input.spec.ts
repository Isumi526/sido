// ============================================================
//  liff.report-voice-input.spec.ts
//  日報の音声入力（8/19会議）: 話す→AI解釈→「この内容で反映していいですか」確認→反映。
//   - SpeechRecognition と Gemini(EF) は headless で動かないので、両方スタブする:
//       * window.SpeechRecognition … addInitScript で偽実装（開始で確定transcriptを1回返す）
//       * report-voice-parse EF   … page.route で解析結果JSONを返す
//   - AC: 確認画面を必ず挟む／反映で備考に入る／非対応環境ではボタンを出さない(フォールバック)
// ============================================================
import { test, expect } from '@playwright/test'

const TODAY = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Tokyo' }).format(new Date())

// 「話し終えたら確定テキストを1回返す」偽 SpeechRecognition
const FAKE_SPEECH = `
window.__voiceTranscript = '今日は東京現場で8時から17時まで内装工事をしました';
class FakeRecognition {
  constructor(){ this.lang=''; this.interimResults=false; this.continuous=false;
    this.onresult=null; this.onerror=null; this.onend=null; }
  start(){
    setTimeout(()=>{
      if(this.onresult) this.onresult({ resultIndex:0,
        results:[{ 0:{ transcript: window.__voiceTranscript }, isFinal:true, length:1 }] });
      if(this.onend) this.onend();
    }, 30);
  }
  stop(){ if(this.onend) this.onend(); }
  abort(){}
}
window.SpeechRecognition = FakeRecognition;
window.webkitSpeechRecognition = FakeRecognition;
`

const PARSED = {
  siteName: null,          // 現場はマスタ依存なので触らない（備考で検証）
  workCategoryId: null,
  workCategoryName: null,
  startTime: '08:00',
  endTime: '17:00',
  note: '内装工事（音声入力）',
  raw: '今日は東京現場で8時から17時まで内装工事をしました',
}

test.describe('日報の音声入力', () => {
  // ★EF本体（Gemini解析）も実際に叩く。スタブだけだとエンドポイント違いのような
  //  「実機でしか出ない失敗」を拾えない（2026-08-30: v1ではJSONモードが使えず
  //  全ての音声入力が「うまく読み取れませんでした」になっていた）。
  test('★EFが話した内容を項目に分解できる（Geminiまで実際に通す）', async ({ request }) => {
    const res = await request.post(`${process.env.SUPABASE_URL || 'http://127.0.0.1:56321'}/functions/v1/report-voice-parse`, {
      headers: { 'Content-Type': 'application/json' },
      data: {
        transcript: '今日はテスト現場1で8時から17時まで内装工事をしました',
        sites: ['テスト現場1', 'テスト現場A'],
        workCategories: [{ id: 'cat-1', name: '現場作業' }, { id: 'cat-2', name: '見積' }],
      },
    })
    expect(res.status(), 'Gemini解析が通る（v1/v1beta違い等で500/502にならない）').toBe(200)
    const j = await res.json()
    expect(j.siteName, '現場を候補に寄せる').toBe('テスト現場1')
    expect(j.startTime, '開始時刻').toBe('08:00')
    expect(j.endTime, '終了時刻').toBe('17:00')
    expect(j.note, '作業内容').toBeTruthy()
  })

  test('音声→確認画面→反映で備考に入る（確認を必ず挟む）', async ({ page }) => {
    await page.addInitScript(FAKE_SPEECH)
    // 解析EFをスタブ（Geminiに行かせない）
    await page.route('**/report-voice-parse', route =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(PARSED) }))

    await page.goto(`/report?date=${TODAY}`, { waitUntil: 'networkidle' })
    // 稼働=あり にして現場ブロックを出す
    await page.locator('select:has(option[value="working"])').first().selectOption('working')

    // 音声ボタンが出る（対応環境）
    const btn = page.getByTestId('voice-input-btn')
    await expect(btn).toBeVisible({ timeout: 10000 })

    // 押す→（偽）認識→EF→確認モーダル
    await btn.click()
    const modal = page.getByTestId('voice-confirm')
    await expect(modal).toBeVisible({ timeout: 10000 })
    // 聞き取り内容と解析結果（備考）が確認画面に出ている
    await expect(modal).toContainText('内装工事')
    await expect(page.getByTestId('voice-note')).toHaveValue('内装工事（音声入力）')

    // ★確認を挟むまで本体フォームには入っていない
    await expect(page.getByTestId('report-note')).toHaveValue('')

    // 「この内容で反映」→ 備考に入る
    await page.getByTestId('voice-apply').click()
    await expect(modal).toBeHidden()
    await expect(page.getByTestId('report-note')).toHaveValue(/内装工事（音声入力）/)
  })

  test('SpeechRecognition非対応の環境では音声ボタンを出さない（従来入力にフォールバック）', async ({ page }) => {
    await page.addInitScript(`
      try { delete window.SpeechRecognition; } catch(e){}
      try { delete window.webkitSpeechRecognition; } catch(e){}
      Object.defineProperty(window,'SpeechRecognition',{value:undefined,configurable:true});
      Object.defineProperty(window,'webkitSpeechRecognition',{value:undefined,configurable:true});
    `)
    await page.goto(`/report?date=${TODAY}`, { waitUntil: 'networkidle' })
    await page.locator('select:has(option[value="working"])').first().selectOption('working')
    // 従来の入力（備考）は出るが、音声ボタンは出ない
    await expect(page.getByTestId('report-note')).toBeVisible({ timeout: 10000 })
    await expect(page.getByTestId('voice-input-btn')).toHaveCount(0)
  })
})
