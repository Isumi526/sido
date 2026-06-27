// send-estimate-upload: 見積アップロード依頼メールを本送信（verify_jwt=true）。中核は _shared/estimate-upload-mail.ts。
// キーは subcontractor_id（業者ごと再利用リンク）。mode: prepare/copy/send。subject/body は send 時の上書き。
import { sendEstimateUpload } from '../_shared/estimate-upload-mail.ts'
function cors(){return{'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'authorization, x-client-info, apikey, content-type','Access-Control-Allow-Methods':'POST, OPTIONS'}}
function json(b:unknown,s=200){return new Response(JSON.stringify(b),{status:s,headers:{...cors(),'Content-Type':'application/json'}})}
Deno.serve(async(req)=>{
  if(req.method==='OPTIONS')return new Response('ok',{headers:cors()})
  if(req.method!=='POST')return json({error:'Method not allowed'},405)
  let subcontractor_id='',mode='send',subject='',body='',to:string[]=[]
  try{const b=await req.json();subcontractor_id=(b.subcontractor_id??'').toString();mode=(b.mode??'send').toString();subject=(b.subject??'').toString();body=(b.body??'').toString();to=Array.isArray(b.to)?b.to.map((x:any)=>String(x)):[]}catch{}
  const{status,body:resBody}=await sendEstimateUpload({subcontractor_id,mode:mode as any,subject,body,to,dryRun:false,callerAuth:req.headers.get('Authorization')})
  return json(resBody,status)
})
