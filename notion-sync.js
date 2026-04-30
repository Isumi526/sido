#!/usr/bin/env node
const https = require("https");

const CONFIG = {
  NOTION_API_KEY: process.env.NOTION_API_KEY,
  TASK_DB_ID: "REMOVED_NOTION_DB_ID",
  DEFAULT_PROJECT_URL: "https://notion.com/REMOVED_NOTION_PROJECT_ID",
  AILAB_PROJECT_URL: "https://notion.com/REMOVED_NOTION_AILAB_ID",
};

function parseArgs(args) {
  const result = { taskName: null, status: "完了", memo: "", project: CONFIG.DEFAULT_PROJECT_URL };
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--status" && args[i+1]) result.status = args[++i];
    else if (args[i] === "--memo" && args[i+1]) result.memo = args[++i];
    else if (args[i] === "--project" && args[i+1]) {
      const p = args[++i];
      result.project = (p === "ailab" || p === "全力AIラボ") ? CONFIG.AILAB_PROJECT_URL : p;
    } else if (!args[i].startsWith("--") && !result.taskName) result.taskName = args[i];
  }
  return result;
}

function extractPageId(urlOrId) {
  const match = urlOrId.match(/([a-f0-9]{32})/);
  if (!match) return urlOrId;
  const raw = match[1];
  return `${raw.slice(0,8)}-${raw.slice(8,12)}-${raw.slice(12,16)}-${raw.slice(16,20)}-${raw.slice(20)}`;
}

function notionRequest(method, path, body) {
  return new Promise((resolve, reject) => {
    if (!CONFIG.NOTION_API_KEY) {
      reject(new Error("❌ NOTION_API_KEY が未設定です\n  export NOTION_API_KEY='secret_...'"));
      return;
    }
    const payload = body ? JSON.stringify(body) : null;
    const req = https.request({
      hostname: "api.notion.com", path, method,
      headers: {
        "Authorization": `Bearer ${CONFIG.NOTION_API_KEY}`,
        "Notion-Version": "2022-06-28",
        "Content-Type": "application/json",
        ...(payload && { "Content-Length": Buffer.byteLength(payload) }),
      },
    }, (res) => {
      let data = "";
      res.on("data", chunk => data += chunk);
      res.on("end", () => {
        const json = JSON.parse(data);
        json.object === "error" ? reject(new Error(json.message)) : resolve(json);
      });
    });
    req.on("error", reject);
    if (payload) req.write(payload);
    req.end();
  });
}

async function main() {
  const args = process.argv.slice(2);
  if (!args.length || args[0] === "--help") {
    console.log(`使い方: node notion-sync.js "タスク名" [--status 完了|進行中|未着手] [--memo "詳細"] [--project seed|ailab]`);
    return;
  }
  const opts = parseArgs(args);
  if (!opts.taskName) { console.error("❌ タスク名を指定してください"); process.exit(1); }

  console.log(`\n📝 Notionに登録中...`);
  console.log(`   タスク名: ${opts.taskName}`);
  console.log(`   ステータス: ${opts.status}`);
  if (opts.memo) console.log(`   メモ: ${opts.memo}`);

  const result = await notionRequest("POST", "/v1/pages", {
    parent: { database_id: CONFIG.TASK_DB_ID },
    properties: {
      "タスク名": { title: [{ text: { content: opts.taskName } }] },
      "ステータス": { status: { name: opts.status } },
      ...(opts.memo && { "メモ": { rich_text: [{ text: { content: opts.memo } }] } }),
      "案件": { relation: [{ id: extractPageId(opts.project) }] },
    },
  });
  console.log(`\n✅ 登録完了！\n   ${result.url}`);
}

main().catch(err => { console.error(`\n${err.message}`); process.exit(1); });
