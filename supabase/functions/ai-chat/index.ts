// ============================================================
//  ai-chat
//  アプリ内AIヘルプ（管理者向け）。アプリ仕様を理解したAIが操作Q&Aに回答する。
//  - verify_jwt=true（admin等の認証必須）＝コスト面を管理者利用に限定。
//  - Gemini(GEMINI_REVIEW_API_KEY/MODEL流用)へ systemInstruction(アプリ仕様)＋会話履歴 を渡す。
//  ※ ユーザー入力はそのまま回答用。チケット起票は別EF(ai-create-ticket)で管理者の明示操作のみ。
// ============================================================
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
// 画面カタログ（apps/admin のルート/画面名/HelpButton から自動生成＝手書きの二重管理を作らない）。
// scripts/build-screen-catalog.mjs が生成。画面を足したら再生成する（CIは --check でズレを検知）。
import { SCREEN_CATALOG } from './screen-catalog.gen.ts'

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

// テナントの現在の利用状態（機能フラグ）を取得し systemInstruction に注入する。
// これが無いと「注文書どこ？」に対し、御社で見積もり機能が未開放でも画面を案内してしまう
// （このEFが生まれた元の不具合）。★account.id で厳格にスコープ＝他テナントの状態は混ぜない。
// 読み取り専用（settings を読むだけ・書き込みは一切しない）。取得失敗/未設定なら空文字で後方互換。
async function buildTenantStateBlock(accountSlug: string): Promise<string> {
  if (!accountSlug) return ''
  try {
    const sb = createClient(SUPABASE_URL, ANON_KEY)
    const { data: account } = await sb.from('accounts').select('id').eq('slug', accountSlug).maybeSingle()
    if (!account?.id) return ''
    const { data: rows } = await sb
      .from('settings').select('key, value')
      .eq('account_id', account.id)
      .in('key', ['estimate_feature_enabled'])
    const map: Record<string, string> = Object.fromEntries((rows ?? []).map((r: any) => [r.key, String(r.value)]))
    // 既定は未開放（フラグ行が無い＝OFF・estimate-feature-flag の既定と一致）
    const estimateOn = map['estimate_feature_enabled'] === 'true'
    const lines = [
      `- 見積・注文書・請求（見積もり機能）: ${estimateOn
        ? '開放済み（該当画面を案内してよい）'
        : '未開放（見積/注文書/請求などの画面リンクは出さず、「御社ではまだこの機能が開放されていません」と理由を伝える）'}`,
    ]
    return `\n\n【御社（このテナント）の現在の利用状態（最優先で考慮する。未開放の機能は画面リンクを出さず理由を伝える）】\n${lines.join('\n')}`
  } catch { return '' }
}

const SYSTEM = `あなたは内装施工会社向け業務システム「sido」の操作ヘルプAIです。日本語で簡潔に、手順は箇条書きで答えてください。
主な機能:
- LIFF日報: 作業員がLINEから日報を入力。稼働区分→現場→経費(交通/宿泊(ホテル・レオパレス等は複数登録可)/ガソリン/ゴミ/その他)→送信。途中離脱しても自動保存。領収書はAI解析で自動入力可。
- 管理画面(admin)の画面一覧・各画面の表示条件(権限/機能フラグ)・概要は、systemInstruction 末尾の【画面カタログ】を唯一の根拠にする(そこに無い画面名やパスは案内しない)。
- 見積→注文書→請求の流れ: 見積書を業者・現場に紐付け(業者選択で紐付く現場に絞込)。注文書は業者がトークンURLで承諾(署名)。変更注文書は再承諾で金額更新。承諾済み注文書に請求依頼→業者がフォームで請求(注文書残額照合・超過弾き)。見積書は業者がポータルからアップロードも可。
- 工程管理: 現場ごとの工程(タスク)を開始/終了/担当/進捗でガント表示。
- ガソリン按分: 月次実費を現場の走行距離比で実績配賦(見込み/実績/差異)。
- 賃金: 作業員ごとに日当/時給を選択、発効日付きの賃金変更履歴で過去日報も正しく計算。
- リマインド: 日報未送信や車検期限の通知。

【バグ検知】ユーザーのメッセージが「操作の質問・使い方」ではなく「不具合・想定外の挙動・エラー・データがおかしい等の報告」だと判断したら isBug=true とし、bugTitle(短い要約・60字以内)と bugSummary(どの画面で/何をしたら/どうなったか・期待との差 を簡潔に)を埋めてください。単なる使い方の質問なら isBug=false で bugTitle/bugSummary は空。answer には常にユーザー向けの回答を入れ、isBug=true のときは末尾に「不具合の可能性があるのでバックログに記録できます」と添えてください。`

// 画面カタログ(自動生成)を systemInstruction 用テキストにする。
// 表示条件(権限/機能フラグ)を必ず併記する＝「注文書はどこ？」に対し、見積もり機能フラグが
// OFFなら開けないことまで含めて正しく案内できるようにする（このEFが生まれた元の不具合）。
const SCREEN_CATALOG_BLOCK = (() => {
  if (!SCREEN_CATALOG.length) return ''
  const lines = SCREEN_CATALOG.map((s) => {
    const cond: string[] = []
    if (s.requiresEstimate) cond.push('見積もり機能ONのときのみ')
    if (s.requiresManagement) cond.push('管理者のみ')
    const condText = cond.length ? `〔${cond.join('・')}〕` : ''
    const desc = (s.help && s.help.length ? s.help[0] : s.title) || ''
    return `- ${s.name}（${s.path}）${condText}${desc ? ` … ${desc}` : ''}`
  }).join('\n')
  return `\n\n【管理画面(admin) 画面カタログ（自動生成・これだけを根拠にする。ここに無い画面名/パスは案内しない）】\n各画面の表示条件（権限・機能フラグ）を満たさないユーザーには表示されず、URL直打ちもホームへ戻される。案内時は条件を必ず添えること。\n${lines}`
})()

// 聞き返し（曖昧な質問の絞り込み）。質問者に頑張らせず、AIが1回だけ選択肢を出して絞る。
// allowClarify=false（直前が聞き返し＝2回目以降）のときはこのルールを付けない＝必ず即答させる（ループ防止）。
const CLARIFY_RULE = `

【聞き返し（絞り込み）】ユーザーの質問が曖昧・情報不足で、どのFAQ/機能の話か確信を持って特定できないときは、憶測で答えず needClarify=true にして、answer に「どれについて知りたいですか？」等の短い1文を入れ、options に2〜5個の短い選択肢（各12字以内・可能なら上記FAQのカテゴリや機能名）を入れてください。質問が明確なときは needClarify=false・options=[] で即答してください。聞き返しは1回だけ。`

function cors(){return{'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'authorization, x-client-info, apikey, content-type','Access-Control-Allow-Methods':'POST, OPTIONS'}}
function json(b:unknown,s=200){return new Response(JSON.stringify(b),{status:s,headers:{...cors(),'Content-Type':'application/json'}})}

// 画像添付の受け入れ条件（AIチャットの画像対応）
const ALLOWED_IMAGE_MIME=['image/png','image/jpeg','image/webp','image/gif']
const MAX_IMAGES=4                       // 1メッセージあたりの枚数
const MAX_IMAGE_B64_LEN=2_200_000        // base641枚あたり約1.6MB相当（クライアントは圧縮後1.5MBで送る）
const MAX_TOTAL_B64_LEN=5_600_000        // 全画像の合計（これを超えるとEFが受け取る前にタイムアウトする）

Deno.serve(async(req)=>{
  if(req.method==='OPTIONS')return new Response('ok',{headers:cors()})
  if(req.method!=='POST')return json({ok:false,error:'method'},405)
  const auth=await getUser(req)
  if(!auth.ok)return json({ok:false,error:'unauthorized'},401)
  if(!API_KEY)return json({ok:false,error:'ai_unconfigured'},503)
  let message='';let history:any[]=[];let allowClarify=true;let images:{mimeType:string;data:string}[]=[];let screenContext:{path?:string;name?:string}|null=null
  try{
    const b=await req.json()
    message=(b.message??'').toString().slice(0,2000)
    history=Array.isArray(b.history)?b.history.slice(-8):[]
    allowClarify=b.allowClarify!==false
    // 画面文脈（管理画面のどのページから聞いているか）。曖昧な質問をこの画面の話として解決するヒント。
    if(b.screenContext&&typeof b.screenContext==='object')screenContext={path:String(b.screenContext.path??'').slice(0,120),name:String(b.screenContext.name??'').slice(0,60)}
    // 画像添付（複数可）。Gemini の inlineData にそのまま渡す。
    //  ★制限を入れる理由: base64 は EF のリクエスト上限と Gemini のトークンを直に食う。
    //   枚数・1枚あたりのサイズ・MIMEを弾いておかないと 502 になって原因が分かりにくい。
    if(Array.isArray(b.images)){
      images=b.images
        .filter((im:any)=>im&&typeof im.data==='string'&&ALLOWED_IMAGE_MIME.includes(String(im.mimeType)))
        .slice(0,MAX_IMAGES)
        .map((im:any)=>({mimeType:String(im.mimeType),data:String(im.data)}))
        .filter((im:{data:string})=>im.data.length<=MAX_IMAGE_B64_LEN)
      // 合計サイズでも切る（1枚ずつは小さくても4枚合計で溢れることがある）
      let acc=0
      images=images.filter(im=>{acc+=im.data.length;return acc<=MAX_TOTAL_B64_LEN})
    }
  }catch{}
  // 画像だけ送られた場合も通す（「これ何？」と画像だけ投げる使い方があるため）
  if(!message.trim()&&images.length===0)return json({ok:false,error:'empty'},400)
  const faqBlock=await buildFaqBlock(auth.accountSlug)
  const stateBlock=await buildTenantStateBlock(auth.accountSlug)   // 御社の現在の利用状態（機能フラグ）
  const screenBlock=screenContext&&screenContext.name?`\n\n【ユーザーが今いる画面】「${screenContext.name}」（パス: ${screenContext.path}）。ユーザーの質問はこの画面に関する可能性が高い。文脈が曖昧な時はこの画面の機能・操作として答える。`:''
  const system=SYSTEM+SCREEN_CATALOG_BLOCK+stateBlock+screenBlock+faqBlock+(allowClarify?CLARIFY_RULE:'')
  // 最新の user turn にだけ画像を載せる（履歴に画像を積むとトークンが膨らむ）
  const userParts:any[]=[...images.map(im=>({inlineData:{mimeType:im.mimeType,data:im.data}}))]
  userParts.push({text:message.trim()||'この画像について教えてください。'})
  const contents=[...history.filter((h:any)=>h&&h.text).map((h:any)=>({role:h.role==='ai'?'model':'user',parts:[{text:String(h.text).slice(0,2000)}]})),{role:'user',parts:userParts}]
  try{
    const res=await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`,{
      method:'POST',headers:{'x-goog-api-key':API_KEY,'Content-Type':'application/json'},
      body:JSON.stringify({systemInstruction:{parts:[{text:system}]},contents,generationConfig:{temperature:0.3,responseMimeType:'application/json',responseSchema:{type:'object',properties:{answer:{type:'string'},isBug:{type:'boolean'},bugTitle:{type:'string'},bugSummary:{type:'string'},needClarify:{type:'boolean'},options:{type:'array',items:{type:'string'}}},required:['answer','isBug']}}}),
    })
    if(!res.ok){const t=await res.text();console.error('[ai-chat] gemini',res.status,t.slice(0,200));return json({ok:false,error:'ai_unavailable'},502)}
    const j=await res.json()
    const raw=j?.candidates?.[0]?.content?.parts?.map((p:any)=>p.text).join('')??''
    let answer=raw,isBug=false,bugTitle='',bugSummary='',needClarify=false,options:string[]=[]
    try{const o=JSON.parse(raw);answer=(o.answer??'').toString();isBug=!!o.isBug;bugTitle=(o.bugTitle??'').toString();bugSummary=(o.bugSummary??'').toString();needClarify=allowClarify&&!!o.needClarify;options=Array.isArray(o.options)?o.options.map((x:any)=>String(x)).filter((x:string)=>x.trim()).slice(0,5):[]}catch{/* JSONでなければ素のテキストをanswerに */}
    if(!needClarify)options=[]  // 聞き返しでない時は選択肢を出さない
    // 聞き返しなのに選択肢が無ければ通常回答に倒す（空の聞き返しでユーザーを迷わせない）
    if(needClarify&&options.length===0)needClarify=false
    return json({ok:true,answer:answer||'うまく回答できませんでした。',isBug,bugTitle,bugSummary,needClarify,options})
  }catch(e){console.error('[ai-chat]',e instanceof Error?e.message:String(e));return json({ok:false,error:'ai_error'},500)}
})
