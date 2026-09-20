#!/usr/bin/env node
// ============================================================
//  scripts/check-digest-refs.mjs — 📋レビューダイジェストの鮮度チェッカ
//
//  なぜ要るか（2026-09-05 /review・1セッションで3件+3件）:
//   ダイジェストに書いたファイル名/spec名が実在しない（sites.vue を site-detail.vue と書く等）、
//   「別チケットで対応」と書いたのに受け皿チケットが無い、「ローカルでは検証不可」が誤り——
//   といった **実装より古い/事実と違うダイジェスト** をレビュアーが信じて1〜2手無駄にする。
//   これは運用ルール（cc-pipeline run/review SKILL.md）で止めるのが本筋だが、
//   ファイル名の実在と受け皿の有無は機械で拾えるので、レビュー待ちへ移す直前にこれを回す。
//
//  使い方:
//    node --env-file=.env scripts/check-digest-refs.mjs --page <NotionページID>   # 本文を再帰取得して検査
//    node scripts/check-digest-refs.mjs --file <digest.md>                        # ローカルの md を検査
//    cat digest.md | node scripts/check-digest-refs.mjs                           # stdin
//    オプション: --json（機械可読） / --warn-only（exit 0 固定）
//
//  検査:
//   1. ファイル参照 `xxx.(ts|vue|sql|mjs|cjs|js|py|md|html|json|yml|yaml)` が repo に実在するか
//      （パス付きは存在確認、素の basename は git ls-files の basename 一致で許容）→ 無ければ ❌
//   2. 先送り語（別チケット/別途/Step2/今回は含まない/後で拾う/次回/残りは）の**同じ段落**に
//      Notion のページURL/ID が無い → ⚠️（受け皿の無い先送り）
//   3. 「検証不可/確認できない/本番でしか/本番スモークで確認」→ ⚠️（本当に試したか。AI系は鍵名の流用を確認）
//  exit: ❌が1件でもあれば 1（--warn-only なら 0）。⚠️ だけなら 0。
// ============================================================
import { existsSync, readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { resolve, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { notionToken } from './notion-token.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const opt = (k) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : null; };
const JSON_OUT = args.includes('--json');
const WARN_ONLY = args.includes('--warn-only');

// ── 入力（段落の配列にする＝先送り語と受け皿URLの同居判定は段落単位） ──
async function loadParagraphs() {
  const page = opt('--page');
  const file = opt('--file');
  if (page) return await fetchNotionParagraphs(page.replace(/-/g, ''));
  const text = file ? readFileSync(resolve(file), 'utf8') : readFileSync(0, 'utf8');
  return text.split(/\n/).map((s) => s.trim()).filter(Boolean);
}

function richText(rt) { return (rt ?? []).map((t) => t.plain_text ?? '').join(''); }
function blockText(b) {
  const v = b[b.type] ?? {};
  let t = richText(v.rich_text);
  if (b.type === 'table_row') t = (v.cells ?? []).map(richText).join(' | ');
  return t;
}
// ★has_children を必ず再帰する（1階層目だけ見てネストを見落とした実例: 2026-07-16）
async function fetchNotionParagraphs(pageId) {
  const token = notionToken();
  if (!token) { console.error('[digest-check] NOTION_TOKEN が無い（env か keychain cc-pipeline-notion-token）'); process.exit(2); }
  const H = { Authorization: `Bearer ${token}`, 'Notion-Version': '2022-06-28' };
  const out = [];
  async function walk(id) {
    let cursor = null;
    do {
      const url = `https://api.notion.com/v1/blocks/${id}/children?page_size=100${cursor ? `&start_cursor=${cursor}` : ''}`;
      const r = await fetch(url, { headers: H });
      if (!r.ok) { console.error(`[digest-check] Notion ${r.status}: ${await r.text()}`); process.exit(2); }
      const j = await r.json();
      for (const b of j.results ?? []) {
        const t = blockText(b).trim();
        if (t) out.push(t);
        if (b.has_children) await walk(b.id);
      }
      cursor = j.has_more ? j.next_cursor : null;
    } while (cursor);
  }
  await walk(pageId);
  return out;
}

// ── 1. ファイル参照の実在 ──
const FILE_RE = /(?<![\w@])((?:[\w.\-\[\]]+\/)*[\w.\-\[\]]+\.(?:ts|vue|sql|mjs|cjs|js|py|md|html|json|yml|yaml))(?![\w/])/g;
const IGNORE_FILES = new Set(['CLAUDE.md', 'README.md', 'package.json']);   // 定型で出てくるもの
let trackedBasenames = null;
function trackedHas(name) {
  if (!trackedBasenames) {
    const list = execFileSync('git', ['ls-files'], { cwd: ROOT, encoding: 'utf8' }).split('\n');
    trackedBasenames = new Map();
    for (const p of list) { if (!p) continue; const b = basename(p); if (!trackedBasenames.has(b)) trackedBasenames.set(b, []); trackedBasenames.get(b).push(p); }
  }
  return trackedBasenames.get(name) ?? [];
}
function checkFileRef(ref) {
  // `dev...HEAD` のような git 範囲や URL の一部は除外
  if (/^https?:/.test(ref)) return null;
  if (IGNORE_FILES.has(ref)) return null;
  if (ref.includes('/')) {
    if (existsSync(resolve(ROOT, ref))) return null;
    // 先頭が apps/ 等でないパス片（例: functions/ai-chat/index.ts）は basename で救済
    const hits = trackedHas(basename(ref)).filter((p) => p.endsWith(ref));
    return hits.length ? null : { ref, hint: trackedHas(basename(ref)).slice(0, 3) };
  }
  return trackedHas(ref).length ? null : { ref, hint: [] };
}

// ── 2. 受け皿の無い先送り ──
const DEFER_RE = /(別チケット|別途|Step\s?2|今回は含まない|後で拾う|次回|残りは|別タスク|後続で)/;
const NOTION_REF_RE = /(notion\.(so|com|site)\/|[0-9a-f]{32}|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i;
// ── 3. 「検証不可」の型 ──
const UNVERIFIED_RE = /(検証不可|検証できない|確認できない|本番でしか|本番スモークで確認|本番で確認する)/;

const paras = await loadParagraphs();
const missing = [];
const seen = new Set();
const deferNoTicket = [];
const unverified = [];
for (const p of paras) {
  for (const m of p.matchAll(FILE_RE)) {
    const ref = m[1];
    if (seen.has(ref)) continue; seen.add(ref);
    const r = checkFileRef(ref);
    if (r) missing.push({ ...r, para: p.slice(0, 120) });
  }
  if (DEFER_RE.test(p) && !NOTION_REF_RE.test(p) && !/やらない|対応しない|落とす/.test(p)) deferNoTicket.push(p.slice(0, 160));
  if (UNVERIFIED_RE.test(p)) unverified.push(p.slice(0, 160));
}

const result = { paragraphs: paras.length, fileRefs: seen.size, missing, deferNoTicket, unverified,
  verdict: missing.length ? 'fail' : (deferNoTicket.length || unverified.length ? 'warn' : 'pass') };
if (JSON_OUT) console.log(JSON.stringify(result, null, 2));
else {
  console.log(`[digest-check] 段落 ${paras.length}・ファイル参照 ${seen.size}`);
  for (const m of missing) console.log(`❌ 実在しない: ${m.ref}${m.hint.length ? `（候補: ${m.hint.join(', ')}）` : ''}\n   … ${m.para}`);
  for (const d of deferNoTicket) console.log(`⚠️ 受け皿チケット無しの先送り（URLを貼るか「やらない」と書く）: ${d}`);
  for (const u of unverified) console.log(`⚠️ 「検証不可」の型（本当に試した？ AI系は .env の鍵名流用を確認）: ${u}`);
  console.log(`[digest-check] verdict=${result.verdict}`);
}
process.exit(result.verdict === 'fail' && !WARN_ONLY ? 1 : 0);
