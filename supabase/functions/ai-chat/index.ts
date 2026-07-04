// ============================================================
//  ai-chat
//  アプリ内AIヘルプ（管理者向け）。アプリ仕様を理解したAIが操作Q&Aに回答する。
//  - verify_jwt=true（admin等の認証必須）＝コスト面を管理者利用に限定。
//  - Gemini(GEMINI_REVIEW_API_KEY/MODEL流用)へ systemInstruction(アプリ仕様)＋会話履歴 を渡す。
//  ※ ユーザー入力はそのまま回答用。チケット起票は別EF(ai-create-ticket)で管理者の明示操作のみ。
// ============================================================
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const API_KEY = Deno.env.get('GEMINI_REVIEW_API_KEY') ?? ''
const MODEL   = Deno.env.get('GEMINI_REVIEW_MODEL') ?? 'gemini-3.5-flash'
const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? ''
const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY') ?? ''

// in-code認可：有効なユーザーJWT（ログイン済み管理者セッション）必須。
// CIが --no-verify-jwt でデプロイするため、anon鍵単体の匿名呼び出しをここで弾く（コスト悪用防止）。
// 併せて、FAQナレッジのテナント絞り込みに使う account_slug を app_metadata から返す。
async function getUser(req: Request): Promise<{ ok: boolean; accountSlug: string }> {
  const jwt = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '')
  if (!jwt || jwt === ANON_KEY) return { ok: false, accountSlug: '' }
  try {
    const { data, error } = await createClient(SUPABASE_URL, ANON_KEY).auth.getUser(jwt)
    if (!data?.user || error) return { ok: false, accountSlug: '' }
    const meta = (data.user.app_metadata ?? {}) as Record<string, unknown>
    const accountSlug = typeof meta.account_slug === 'string' ? meta.account_slug : ''
    return { ok: true, accountSlug }
  } catch { return { ok: false, accountSlug: '' } }
}

// テナントの有効FAQ（faq_entries）を取得し、systemInstruction に注入するテキストにする。
// account_slug が無い/取得0件なら空文字（＝従来どおり固定SYSTEMのみで動く＝後方互換）。
async function buildFaqBlock(accountSlug: string): Promise<string> {
  if (!accountSlug) return ''
  try {
    const sb = createClient(SUPABASE_URL, ANON_KEY)
    const { data: account } = await sb.from('accounts').select('id').eq('slug', accountSlug).maybeSingle()
    if (!account?.id) return ''
    const { data: rows } = await sb
      .from('faq_entries')
      .select('question, answer, category, variations')
      .eq('account_id', account.id)
      .eq('is_active', true)
      .order('sort_order')
      .limit(200)
    if (!rows || rows.length === 0) return ''
    const items = rows.map((r: any, i: number) => {
      const vars = Array.isArray(r.variations) && r.variations.length
        ? `\n  （言い換え: ${r.variations.map((v: any) => String(v)).join(' / ')}）` : ''
      const cat = r.category ? `[${r.category}] ` : ''
      return `${i + 1}. ${cat}Q: ${r.question}\n  A: ${r.answer}${vars}`
    }).join('\n')
    return `\n\n【このテナント固有のFAQ（最優先で根拠に使う。該当が無ければ一般知識で答える）】\n${items}`
  } catch { return '' }
}

const SYSTEM = `あなたは内装施工会社向け業務システム「sido」の操作ヘルプAIです。日本語で簡潔に、手順は箇条書きで答えてください。
主な機能:
- LIFF日報: 作業員がLINEから日報を入力。稼働区分→現場→経費(交通/宿泊(ホテル・レオパレス等は複数登録可)/ガソリン/ゴミ/その他)→送信。途中離脱しても自動保存。領収書はAI解析で自動入力可。
- 管理画面(admin): ダッシュボード/日報一覧/現場別集計/予定管理/工程管理/出面/有給/見積書/注文書/協力業者請求/経費/作業員/現場(詳細ページ・現場責任者設定)/車両/元請け/操作ログ/ガソリン按分。
- 見積→注文書→請求の流れ: 見積書を業者・現場に紐付け(業者選択で紐付く現場に絞込)。注文書は業者がトークンURLで承諾(署名)。変更注文書は再承諾で金額更新。承諾済み注文書に請求依頼→業者がフォームで請求(注文書残額照合・超過弾き)。見積書は業者がポータルからアップロードも可。
- 工程管理: 現場ごとの工程(タスク)を開始/終了/担当/進捗でガント表示。
- ガソリン按分: 月次実費を現場の走行距離比で実績配賦(見込み/実績/差異)。
- 賃金: 作業員ごとに日当/時給を選択、発効日付きの賃金変更履歴で過去日報も正しく計算。
- リマインド: 日報未送信や車検期限の通知。

【バグ検知】ユーザーのメッセージが「操作の質問・使い方」ではなく「不具合・想定外の挙動・エラー・データがおかしい等の報告」だと判断したら isBug=true とし、bugTitle(短い要約・60字以内)と bugSummary(どの画面で/何をしたら/どうなったか・期待との差 を簡潔に)を埋めてください。単なる使い方の質問なら isBug=false で bugTitle/bugSummary は空。answer には常にユーザー向けの回答を入れ、isBug=true のときは末尾に「不具合の可能性があるのでバックログに記録できます」と添えてください。`

function cors(){return{'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'authorization, x-client-info, apikey, content-type','Access-Control-Allow-Methods':'POST, OPTIONS'}}
function json(b:unknown,s=200){return new Response(JSON.stringify(b),{status:s,headers:{...cors(),'Content-Type':'application/json'}})}

Deno.serve(async(req)=>{
  if(req.method==='OPTIONS')return new Response('ok',{headers:cors()})
  if(req.method!=='POST')return json({ok:false,error:'method'},405)
  const auth=await getUser(req)
  if(!auth.ok)return json({ok:false,error:'unauthorized'},401)
  if(!API_KEY)return json({ok:false,error:'ai_unconfigured'},503)
  let message='';let history:any[]=[]
  try{const b=await req.json();message=(b.message??'').toString().slice(0,2000);history=Array.isArray(b.history)?b.history.slice(-8):[]}catch{}
  if(!message.trim())return json({ok:false,error:'empty'},400)
  const faqBlock=await buildFaqBlock(auth.accountSlug)
  const contents=[...history.filter((h:any)=>h&&h.text).map((h:any)=>({role:h.role==='ai'?'model':'user',parts:[{text:String(h.text).slice(0,2000)}]})),{role:'user',parts:[{text:message}]}]
  try{
    const res=await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`,{
      method:'POST',headers:{'x-goog-api-key':API_KEY,'Content-Type':'application/json'},
      body:JSON.stringify({systemInstruction:{parts:[{text:SYSTEM+faqBlock}]},contents,generationConfig:{temperature:0.3,responseMimeType:'application/json',responseSchema:{type:'object',properties:{answer:{type:'string'},isBug:{type:'boolean'},bugTitle:{type:'string'},bugSummary:{type:'string'}},required:['answer','isBug']}}}),
    })
    if(!res.ok){const t=await res.text();console.error('[ai-chat] gemini',res.status,t.slice(0,200));return json({ok:false,error:'ai_unavailable'},502)}
    const j=await res.json()
    const raw=j?.candidates?.[0]?.content?.parts?.map((p:any)=>p.text).join('')??''
    let answer=raw,isBug=false,bugTitle='',bugSummary=''
    try{const o=JSON.parse(raw);answer=(o.answer??'').toString();isBug=!!o.isBug;bugTitle=(o.bugTitle??'').toString();bugSummary=(o.bugSummary??'').toString()}catch{/* JSONでなければ素のテキストをanswerに */}
    return json({ok:true,answer:answer||'うまく回答できませんでした。',isBug,bugTitle,bugSummary})
  }catch(e){console.error('[ai-chat]',e instanceof Error?e.message:String(e));return json({ok:false,error:'ai_error'},500)}
})
