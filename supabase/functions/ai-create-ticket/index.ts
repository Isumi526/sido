// ============================================================
//  ai-create-ticket
//  AIヘルプから「バグとして報告」した内容を Notion バックログに『未整理』で起票する。
//  - verify_jwt=true（管理者の明示操作のみ＝スパム/無認可起票を防ぐ）。
//  - NOTION_TOKEN・BACKLOG_DATA_SOURCE を使う。
//  ※ 案件名relationは設定しない（integrationトークンが案件DBに未共有だと relation先404で
//    起票自体が失敗するため）。起票はバックログ data_source 直下に『未整理』で着地。
//    案件紐付けは案件DBを共有後に別途付与する（本文に印を残す）。
//  ※ 作成のみ（タイトル/本文を許可フィールドに限定）。安全のため status は常に『未整理』。
// ============================================================
const NOTION_TOKEN = Deno.env.get('NOTION_TOKEN') ?? ''
const DS = Deno.env.get('BACKLOG_DATA_SOURCE') ?? 'a7f5a28f-22af-4bc1-a512-4d427a934f31'

function cors(){return{'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'authorization, x-client-info, apikey, content-type','Access-Control-Allow-Methods':'POST, OPTIONS'}}
function json(b:unknown,s=200){return new Response(JSON.stringify(b),{status:s,headers:{...cors(),'Content-Type':'application/json'}})}

Deno.serve(async(req)=>{
  if(req.method==='OPTIONS')return new Response('ok',{headers:cors()})
  if(req.method!=='POST')return json({ok:false,error:'method'},405)
  if(!NOTION_TOKEN)return json({ok:false,error:'notion_unconfigured'},503)
  let title='';let body=''
  try{const b=await req.json();title=(b.title??'').toString().slice(0,200);body=(b.body??'').toString().slice(0,4000)}catch{}
  if(!title.trim())return json({ok:false,error:'title_required'},400)
  const props:any={
    'タスク名':{title:[{type:'text',text:{content:title}}]},
    'ステータス':{status:{name:'未整理'}},
    'タグ':{multi_select:[{name:'バグ'}]},
  }
  const children=[{object:'block',type:'callout',callout:{icon:{emoji:'🐛'},rich_text:[{type:'text',text:{content:'AIヘルプからの報告（案件未紐付け＝確認後に案件を設定してください）:\n'+(body||'(詳細なし)')}}]}}]
  try{
    const res=await fetch('https://api.notion.com/v1/pages',{method:'POST',headers:{Authorization:`Bearer ${NOTION_TOKEN}`,'Notion-Version':'2025-09-03','Content-Type':'application/json'},body:JSON.stringify({parent:{type:'data_source_id',data_source_id:DS},properties:props,children})})
    const j=await res.json()
    if(!res.ok){console.error('[ai-create-ticket] notion',res.status,JSON.stringify(j).slice(0,200));return json({ok:false,error:'notion_error'},502)}
    return json({ok:true,url:j.url??null,id:j.id??null})
  }catch(e){console.error('[ai-create-ticket]',e instanceof Error?e.message:String(e));return json({ok:false,error:'error'},500)}
})
