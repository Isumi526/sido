<script setup lang="ts">
/**
 * 見積Excel連携（株式会社シードの様式）。
 *
 * ★ねらい（2026-09-09 運用者と設計・2026-07-26 打ち合わせ②が出典）
 *  既存のExcelを捨てさせない。入力は今までどおりExcelで行い、
 *  「単価を過去の見積から探す」「全体見積から工種別へ手コピーする」の2つだけを肩代わりする。
 *    「暗記させたいというか、何回も入力してて面倒やなって思うのは、売値と原価」
 *    「グランディールだと二千三百円にする、ジムだと二千円ですとか出てきてくれる」
 *
 * ★画面の流れ
 *   1) 作業用Excelを書き出す … 空テンプレに単価表・候補表を流し込む
 *   2) （Excelで積算する）  … アプリは関与しない
 *   3) 取り込む             … 場所/工種/明細の3層を分解して一覧化
 *   4) 工種別を生成して書き出す … 場所軸→工種軸へ組み替え
 *   5) 工種ごとに発注書へ    … 既存の purchase-orders へ引き渡す
 *
 * ★体裁を壊さないため、Excelの読み書きは lib/xlsxCells.ts（zipのセルXMLだけ差し替え）
 *  を使う。SheetJS/ExcelJS 系は数式・画像・書式を落とすので使わない。
 */
import { ref, computed, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { supabase } from '../lib/supabase'
import { getAccountId } from '../lib/account'
import { currentWorkerId } from '../lib/auth'
import { loadAliases, aliasMapOf, canonicalName, addAlias, removeAlias, type NameAlias } from '../lib/estimateAliases'
import { XlsxTemplate } from '../lib/xlsxCells'
import {
  parseEstimate, writeTradeSheets, writePriceSheets, groupByTrade,
  SEED_FORMAT, type EstimateRow, type PriceRow, type GenerateResult,
} from '../lib/estimateExcel'

const router = useRouter()

/** テンプレの置き場（テナントごとに1本・準備で登録する）。
 *  ★admin-docs のRLSは「パスの先頭が account_id」を要求する。
 *   purchase-orders / estimates と同じ規約に合わせること（slug 始まりだと弾かれる）。 */
const TEMPLATE_BUCKET = 'admin-docs'
const TEMPLATE_DIR = 'estimate-templates'
const templatePath = (accountId: string) => `${accountId}/${TEMPLATE_DIR}/seed-v1.xlsx`

const accountId = ref('')
const accountSlug = ref('')
const busy = ref('')
const err = ref('')
const info = ref('')

// 単価履歴
const prices = ref<PriceRow[]>([])
// 取り込んだ明細
const rows = ref<EstimateRow[]>([])
const genResult = ref<GenerateResult | null>(null)
// 取り込んだファイルを保持（生成時に同じブックへ書き戻すため）
let loaded: XlsxTemplate | null = null
const loadedName = ref('')

const templateReady = ref<boolean | null>(null)

const LOCATIONS = ['（壁面工事）', '（天井工事）', '（床工事）', '（什器工事）', '（共通）']
const TRADES = Object.keys(SEED_FORMAT.tradeSheets).map((t) => `■${t}`)

const byTrade = computed(() => [...groupByTrade(rows.value).entries()]
  .map(([trade, items]) => ({
    trade,
    count: items.length,
    locations: [...new Set(items.map((i) => i.location))].join('・'),
    parts: [...new Set(items.map((i) => i.part).filter(Boolean))].join('・'),
    cost: items.reduce((s, i) => s + (i.quantity ?? 0) * (i.costUnitPrice ?? 0), 0),
    sheet: SEED_FORMAT.tradeSheets[trade] ?? null,
  }))
  .sort((a, b) => b.cost - a.cost))

const totalCost = computed(() => byTrade.value.reduce((s, t) => s + t.cost, 0))
const yen = (n: number) => '¥' + Math.round(n).toLocaleString()

onMounted(async () => {
  accountId.value = await getAccountId()
  const { data: acct } = await supabase.from('accounts').select('slug').eq('id', accountId.value).maybeSingle()
  accountSlug.value = (acct as { slug?: string } | null)?.slug ?? ''
  await Promise.all([loadPrices(), checkTemplate()])
})

async function checkTemplate() {
  if (!accountId.value) { templateReady.value = false; return }
  const { data } = await supabase.storage.from(TEMPLATE_BUCKET)
    .list(`${accountId.value}/${TEMPLATE_DIR}`, { limit: 20 })
  templateReady.value = !!data?.some((f) => f.name === 'seed-v1.xlsx')
}

/** 単価履歴を読む。既存の estimate_price_history ビュー（見積依頼の受領で溜まる）が出所。 */
/** E-3 名寄せ辞書（表記→代表名）。loadPrices で当て、latestPerVendor が統合された履歴を返す */
const aliases = ref<NameAlias[]>([])
const aliasFrom = ref('')
const aliasTo = ref('')
const aliasMsg = ref('')
const aliasBusy = ref(false)
/** 名寄せ前の表記（辞書の「表記」の選択肢に出す） */
const rawWorkNames = ref<string[]>([])
async function loadAliasDict() {
  try { aliases.value = await loadAliases(accountId.value) } catch (e) { err.value = `名寄せ辞書の取得に失敗しました: ${(e as Error).message}` }
}
async function submitAlias() {
  aliasMsg.value = ''
  aliasBusy.value = true
  try {
    await addAlias(accountId.value, aliasFrom.value, aliasTo.value, currentWorkerId.value)
    aliasMsg.value = `「${aliasFrom.value.trim()}」＝「${aliasTo.value.trim()}」を登録しました。次回の作業用Excelから反映されます。`
    aliasFrom.value = ''; aliasTo.value = ''
    await loadPrices()
  } catch (e) { aliasMsg.value = (e as Error).message }
  finally { aliasBusy.value = false }
}
async function deleteAlias(a: NameAlias) {
  if (!confirm(`「${a.alias}」＝「${a.work_name}」の名寄せを取り消しますか？`)) return
  aliasBusy.value = true
  try { await removeAlias(accountId.value, a.id); await loadPrices() } catch (e) { aliasMsg.value = (e as Error).message }
  finally { aliasBusy.value = false }
}

async function loadPrices() {
  await loadAliasDict()
  const map = aliasMapOf(aliases.value)
  const { data, error } = await supabase
    .from('estimate_price_history')
    .select('item_name, unit_price, subcontractor_name, quoted_on, quantity, unit, trade_name, part')
    .eq('account_id', accountId.value)
    .not('unit_price', 'is', null)
    .order('quoted_on', { ascending: false })
    .limit(2000)
  if (error) { err.value = `単価履歴の取得に失敗しました: ${error.message}`; return }
  rawWorkNames.value = [...new Set((data ?? []).map((d: Record<string, unknown>) => String(d.item_name ?? '').trim()).filter(Boolean))].sort()
  prices.value = (data ?? []).map((d: Record<string, unknown>) => ({
    // E-3: 名寄せ辞書を当てて代表名に寄せる＝同じ作業が業者の表記違いで二重に並ばない
    workName: canonicalName(String(d.item_name ?? ''), map),
    unitPrice: Number(d.unit_price ?? 0),
    vendorName: String(d.subcontractor_name ?? '').trim() || '（業者名なし）',
    quotedOn: String(d.quoted_on ?? '').slice(0, 10),
    quantity: d.quantity == null ? null : Number(d.quantity),
    unit: (d.unit as string) ?? null,
    // E-2: 候補を区分（＋部位）で絞る鍵。部位は履歴に無ければ名前から推定（lib 側）
    tradeName: (d.trade_name as string) ?? null,
    part: (d.part as string) ?? null,
  })).filter((p) => p.workName && p.unitPrice > 0)
}

async function openTemplate(): Promise<XlsxTemplate> {
  const { data, error } = await supabase.storage.from(TEMPLATE_BUCKET)
    .download(templatePath(accountId.value))
  if (error || !data) throw new Error('テンプレートが登録されていません。準備タブから登録してください。')
  return XlsxTemplate.load(await data.arrayBuffer())
}

function download(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url; a.download = name; a.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

/** ①作業用Excelを書き出す。 */
async function exportWorkbook() {
  err.value = ''; info.value = ''; busy.value = '作業用Excelを作っています…'
  try {
    const t = await openTemplate()
    const res = await writePriceSheets(t, prices.value, { locations: LOCATIONS, trades: TRADES })
    await t.forceRecalcOnLoad()
    download(await t.toBlob(), `見積_${new Date().toISOString().slice(0, 10)}.xlsx`)
    info.value = `単価表 ${res.priceRows}行・名称の候補 ${res.candidates}件（区分・部位別の候補列 ${res.tradeColumns}本）を入れて書き出しました。`
      + (res.filteredValidation ? ' 名称の候補は行の「工事区分」「部位」で絞られます。' : ' テンプレに「工事区分」列が無いため、名称の候補は全件です（テンプレ v2 で絞り込みが効きます）。')
  } catch (e) { err.value = e instanceof Error ? e.message : String(e) }
  finally { busy.value = '' }
}

/** ③積算済みExcelを取り込む。 */
async function onPickFile(ev: Event) {
  const f = (ev.target as HTMLInputElement).files?.[0]
  if (!f) return
  err.value = ''; info.value = ''; genResult.value = null; busy.value = '取り込んでいます…'
  try {
    loaded = await XlsxTemplate.load(await f.arrayBuffer())
    if (!loaded.has(SEED_FORMAT.mainSheet)) {
      throw new Error(`「${SEED_FORMAT.mainSheet}」シートが見つかりません。様式が違う可能性があります。`)
    }
    rows.value = await parseEstimate(loaded)
    loadedName.value = f.name
    if (!rows.value.length) info.value = '明細が1行も見つかりませんでした。数量か原価が入っている行だけを拾います。'
  } catch (e) { err.value = e instanceof Error ? e.message : String(e); loaded = null }
  finally { busy.value = ''; (ev.target as HTMLInputElement).value = '' }
}

/** ④工種別シートを生成して書き出す。trade を渡すと E-2 の「1工種だけ抜き出す」（大塚「軽鉄工事だけに絞った項目が欲しい」） */
async function generateTradeSheets(trade?: string) {
  if (!loaded) return
  err.value = ''; info.value = ''; busy.value = trade ? `「${trade}」だけを書き出しています…` : '工種別シートを作っています…'
  try {
    const res = await writeTradeSheets(loaded, rows.value, SEED_FORMAT, trade ? { trades: [trade] } : {})
    genResult.value = res
    await loaded.forceRecalcOnLoad()
    const suffix = trade ? `_${trade}` : '_工種別'
    download(await loaded.toBlob(), loadedName.value.replace(/\.xlsx$/i, '') + suffix + '.xlsx')
    info.value = trade ? `「${trade}」のシートだけに書き込みました（他の工種別シートは触っていません）。` : `${res.written.length}シートに書き込みました。`
  } catch (e) { err.value = e instanceof Error ? e.message : String(e) }
  finally { busy.value = '' }
}

/** E-2: 取り込んだ明細のうち「工事区分」列から読めた行数（見出しからの推定でない） */
const tradeFromColumn = computed(() => rows.value.filter((r) => r.tradeSource === 'column').length)

/** ⑤その工種の発注書を作る（既存の発注書画面へ引き渡す）。 */
function toPurchaseOrder(trade: string, amount: number) {
  router.push({ path: '/purchase-orders', query: { trade, amount: String(Math.round(amount)), from: 'estimate-excel' } })
}

/** 準備：テンプレートを登録する。 */
async function onPickTemplate(ev: Event) {
  const f = (ev.target as HTMLInputElement).files?.[0]
  if (!f) return
  err.value = ''; info.value = ''; busy.value = 'テンプレートを登録しています…'
  try {
    const t = await XlsxTemplate.load(await f.arrayBuffer())
    for (const need of [SEED_FORMAT.mainSheet, '単価表', '候補表']) {
      if (!t.has(need)) throw new Error(`「${need}」シートがありません。仕込み済みのテンプレートを選んでください。`)
    }
    const { error } = await supabase.storage.from(TEMPLATE_BUCKET)
      .upload(templatePath(accountId.value), f, { upsert: true, contentType: f.type || 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
    if (error) throw new Error(error.message)
    await checkTemplate()
    info.value = 'テンプレートを登録しました。'
  } catch (e) { err.value = e instanceof Error ? e.message : String(e) }
  finally { busy.value = ''; (ev.target as HTMLInputElement).value = '' }
}
</script>

<template>
  <div class="page">
    <h1 class="page-title">見積Excel連携<span class="beta" data-testid="ee-beta">ベータ</span></h1>
    <p class="lead">
      入力は今までどおりExcelで行い、<b>単価を探す作業</b>と<b>工種別への転記</b>だけをアプリが肩代わりします。
    </p>
    <!-- ★試用中であることを明示する。誤りが混ざる前提で使ってもらうため、
         「何が不確かか」まで書く（ベータの一言だけだと油断させる）。 -->
    <p class="beta-note">
      試用中の機能です。<b>出てきた金額はそのまま使わず、必ず元の見積書と照らし合わせてください。</b>
      読み取りは完全ではなく、実データでも単位を1件読み違えた例があります（㎡ を m）。
    </p>

    <p v-if="err" class="msg err" data-testid="ee-error">{{ err }}</p>
    <p v-if="info" class="msg ok" data-testid="ee-info">{{ info }}</p>
    <p v-if="busy" class="msg busy">{{ busy }}</p>

    <!-- 準備 -->
    <section v-if="templateReady === false" class="card prep">
      <h2 class="card-title">準備：テンプレートを登録してください</h2>
      <p class="hint">
        会社ごとに1回だけの作業です。空の見積Excelに <code>単価表</code> と <code>候補表</code> のシートを
        仕込んだものを登録します。以降アプリはこのファイルの<b>セルに値を書くだけ</b>になります。
        <br>テンプレ v2（任意・<code>scripts/make-estimate-template.py</code> で作れます）: 全体見積の <code>AA列＝工事区分</code>・<code>AB列＝部位</code>（見出し行に「工事区分」「部位」）を持たせると、
        名称の候補が行の区分・部位で絞られ、取り込み時の工種も列が正になります。
      </p>
      <label class="btn">
        テンプレートを選ぶ
        <input type="file" accept=".xlsx" hidden data-testid="ee-template" @change="onPickTemplate">
      </label>
    </section>

    <!-- ① 書き出し -->
    <section class="card">
      <div class="step"><span class="step-no">1</span><h2 class="card-title">作業用Excelを受け取る</h2></div>
      <p class="hint">
        空のテンプレートに、いまアプリにある単価履歴を流し込んで書き出します。
        名称欄に候補が出て、発注先を選ぶと原価が入る状態になります。
      </p>
      <div class="metrics">
        <div><span class="m-label">単価履歴</span><span class="m-val" data-testid="ee-price-count">{{ prices.length }}</span><span class="m-unit">件</span></div>
        <div><span class="m-label">作業内容</span><span class="m-val">{{ new Set(prices.map(p => p.workName)).size }}</span><span class="m-unit">種</span></div>
        <div><span class="m-label">業者</span><span class="m-val">{{ new Set(prices.map(p => p.vendorName)).size }}</span><span class="m-unit">社</span></div>
      </div>
      <p v-if="!prices.length" class="hint warn">
        単価履歴がまだありません。見積依頼の画面で業者の見積を受領登録すると溜まります。
        履歴が空でも、名称の候補（場所・工種）は入った状態で書き出せます。
      </p>
      <button class="btn" :disabled="!!busy || templateReady === false" data-testid="ee-export" @click="exportWorkbook">
        作業用Excelを書き出す
      </button>
    </section>

    <!-- E-3 名寄せ（これ＝これ）: 業者の表記を自社の代表名に寄せる辞書。単価履歴の重複を防ぐ -->
    <section class="card" data-testid="alias-card">
      <h2 class="card-title">名寄せ（これ＝これ）</h2>
      <p class="hint">
        業者ごとに書き方が違う作業内容（例: 「天井LGS下地組」）を自社の代表名（例: 「天井 下地組」）に寄せます。
        登録すると単価履歴が代表名でまとまり、<b>次回の作業用Excelから</b>候補と単価表に反映されます。取り消しもできます。
      </p>
      <div class="alias-form">
        <input v-model="aliasFrom" class="input" list="alias-raw-names" placeholder="表記（業者の書き方）" data-testid="alias-from" />
        <datalist id="alias-raw-names"><option v-for="n in rawWorkNames" :key="n" :value="n" /></datalist>
        <span class="alias-eq">＝</span>
        <input v-model="aliasTo" class="input" list="alias-work-names" placeholder="代表名（自社の正式名称）" data-testid="alias-to" />
        <datalist id="alias-work-names"><option v-for="n in new Set(prices.map(p => p.workName))" :key="n" :value="n" /></datalist>
        <button class="btn" :disabled="aliasBusy || !aliasFrom.trim() || !aliasTo.trim()" data-testid="alias-add" @click="submitAlias">登録</button>
      </div>
      <p v-if="aliasMsg" class="hint" data-testid="alias-msg">{{ aliasMsg }}</p>
      <p v-if="!aliases.length" class="hint" data-testid="alias-empty">まだ名寄せは登録されていません。</p>
      <div v-else class="table-wrap">
        <table class="table" data-testid="alias-list">
          <thead><tr><th>表記</th><th></th><th>代表名</th><th>登録日</th><th></th></tr></thead>
          <tbody>
            <tr v-for="a in aliases" :key="a.id" :data-testid="`alias-row-${a.id}`">
              <td>{{ a.alias }}</td><td class="alias-eq">＝</td><td><b>{{ a.work_name }}</b></td>
              <td class="muted">{{ a.confirmed_at.slice(0, 10) }}</td>
              <td><button class="btn-ghost" :disabled="aliasBusy" :data-testid="`alias-del-${a.id}`" @click="deleteAlias(a)">取り消す</button></td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>

    <!-- ③ 取り込み -->
    <section class="card">
      <div class="step"><span class="step-no">2</span><h2 class="card-title">積算し終えたExcelを取り込む</h2></div>
      <p class="hint">
        「全体見積」シートの <code>（壁面工事）</code>／<code>■軽鉄工事</code>／作業内容 の3層を読み取ります。
        数量も原価も無い行は拾いません。
      </p>
      <label class="btn">
        Excelを選ぶ
        <input type="file" accept=".xlsx" hidden data-testid="ee-import" @change="onPickFile">
      </label>
      <span v-if="loadedName" class="fname">{{ loadedName }}</span>
    </section>

    <!-- ④ 一覧と生成 -->
    <section v-if="rows.length" class="card">
      <div class="step"><span class="step-no">3</span><h2 class="card-title">工種別に組み替える</h2></div>
      <p class="hint">
        全体見積は<b>場所</b>で並んでいますが、発注は<b>工種</b>ごとに業者が分かれます。
        同じ工種が複数の場所に散っていても集め直します。
        <span v-if="tradeFromColumn" data-testid="ee-trade-from-column">「工事区分」列から {{ tradeFromColumn }}行の工種を読みました。</span>
        <span v-else data-testid="ee-trade-from-heading">「工事区分」列が空のため、■見出しから工種を推定しています（テンプレ v2 では列が正になります）。</span>
      </p>
      <div class="table-wrap">
        <table class="table" data-testid="ee-trades">
          <thead>
            <tr><th>工種</th><th>明細</th><th>拾った場所</th><th>部位</th><th class="num">原価計</th><th>書き込み先</th><th></th></tr>
          </thead>
          <tbody>
            <tr v-for="t in byTrade" :key="t.trade">
              <td class="tname">{{ t.trade }}</td>
              <td class="num">{{ t.count }}</td>
              <td class="locs">{{ t.locations }}</td>
              <td class="locs" :data-testid="`ee-parts-${t.trade}`">{{ t.parts || '—' }}</td>
              <td class="num money">{{ yen(t.cost) }}</td>
              <td>
                <span v-if="t.sheet" class="sheet">{{ t.sheet }}</span>
                <span v-else class="sheet none" data-testid="ee-no-sheet">対応シート無し</span>
              </td>
              <td class="actions">
                <!-- E-2: この工種だけ抜き出す（全体見積→1工種の工種別シートだけ書き込んで Excel 返却） -->
                <button class="btn-sm" :disabled="!t.sheet || !!busy" :data-testid="`ee-generate-one-${t.trade}`" @click="generateTradeSheets(t.trade)">この工種だけ書き出す</button>
                <button class="btn-sm" :disabled="!t.cost" @click="toPurchaseOrder(t.trade, t.cost)">発注書へ</button>
              </td>
            </tr>
          </tbody>
          <tfoot>
            <tr><td>合計</td><td class="num">{{ rows.length }}</td><td colspan="2"></td><td class="num money" data-testid="ee-total">{{ yen(totalCost) }}</td><td colspan="2"></td></tr>
          </tfoot>
        </table>
      </div>
      <button class="btn" :disabled="!!busy" data-testid="ee-generate" @click="generateTradeSheets()">
        工種別シートを作って書き出す（全工種）
      </button>

      <div v-if="genResult" class="result">
        <p v-for="w in genResult.written" :key="w.sheet" class="r-ok">
          {{ w.trade }} → 「{{ w.sheet }}」に {{ w.count }}行
        </p>
        <p v-for="o in genResult.overflow" :key="o.sheet" class="r-ng" data-testid="ee-overflow">
          {{ o.trade }}：{{ o.needed }}行ありますが枠は{{ o.capacity }}行です。
          <b>入りきらない分は書いていません</b>（合計式が行を手書きで並べているため、
          勝手に足すと合計から外れたまま体裁だけ整ってしまいます）。
        </p>
        <p v-if="genResult.unknownTrades.length" class="r-ng">
          対応する工種別シートがありません：{{ genResult.unknownTrades.join('、') }}
        </p>
      </div>
    </section>
  </div>
</template>

<style scoped>
.page { padding: 24px; max-width: 980px; }
.page-title { font-size: 22px; font-weight: 700; margin-bottom: 6px; }
.beta { display: inline-block; margin-left: 10px; padding: 2px 9px; border-radius: 3px;
        background: #FFF3E0; color: #E65100; border: 1px solid #FFCC80;
        font-size: 12px; font-weight: 700; vertical-align: middle; }
.beta-note { background: #FFF8E1; border: 1px solid #FFE082; color: #8D6E00;
             border-radius: 8px; padding: 10px 14px; font-size: 13px; line-height: 1.8;
             margin: 0 0 18px; }
.lead { color: #555; font-size: 14px; margin-bottom: 20px; }
.msg { padding: 10px 14px; border-radius: 8px; font-size: 13px; margin-bottom: 14px; }
.msg.err { background: #FFEBEE; color: #B71C1C; border: 1px solid #FFCDD2; }
.msg.ok { background: #E8F5E9; color: #1B5E20; border: 1px solid #C8E6C9; }
.msg.busy { background: #FFF8E1; color: #8D6E00; border: 1px solid #FFE082; }
.card { background: #fff; border: 1px solid #e5e7eb; border-radius: 12px; padding: 20px 22px; margin-bottom: 16px; box-shadow: 0 1px 4px rgba(0,0,0,.05); }
.card.prep { border-color: #FFCC80; background: #FFF8E1; }
.step { display: flex; align-items: center; gap: 10px; margin-bottom: 8px; }
.step-no { display: inline-flex; align-items: center; justify-content: center; width: 24px; height: 24px; border-radius: 50%; background: #111; color: #fff; font-size: 13px; font-weight: 700; }
.card-title { font-size: 16px; font-weight: 700; margin: 0; }
.hint { color: #666; font-size: 13px; line-height: 1.8; margin: 0 0 14px; }
.hint.warn { color: #8D6E00; background: #FFF8E1; padding: 8px 12px; border-radius: 6px; }
.metrics { display: flex; gap: 26px; margin-bottom: 14px; }
.m-label { display: block; font-size: 11px; color: #888; }
.m-val { font-size: 22px; font-weight: 700; font-variant-numeric: tabular-nums; }
.m-unit { font-size: 12px; color: #888; margin-left: 2px; }
.btn { display: inline-block; background: #111; color: #fff; border: none; border-radius: 8px; padding: 10px 18px; font-size: 14px; font-weight: 600; cursor: pointer; }
.btn:disabled { opacity: .4; cursor: default; }
.btn-sm { background: #fff; border: 1px solid #cbd5e1; border-radius: 6px; padding: 4px 10px; font-size: 12px; cursor: pointer; }
.btn-sm:disabled { opacity: .4; cursor: default; }
.fname { margin-left: 12px; font-size: 13px; color: #555; }
.table-wrap { overflow-x: auto; margin-bottom: 14px; }
.table { width: 100%; border-collapse: collapse; font-size: 13px; }
.table th { text-align: left; font-size: 11px; color: #888; font-weight: 600; padding: 0 12px 6px 0; border-bottom: 1px solid #e5e7eb; }
.table td { padding: 7px 12px 7px 0; border-bottom: 1px solid #f1f3f5; }
.actions { display: flex; gap: 6px; flex-wrap: wrap; }
.table tfoot td { font-weight: 700; border-top: 2px solid #111; border-bottom: none; }
.num { text-align: right; font-variant-numeric: tabular-nums; }
.money { font-weight: 600; }
.tname { font-weight: 600; }
.locs { color: #666; font-size: 12px; }
.sheet { font-size: 12px; color: #2C4C6B; }
.sheet.none { color: #B71C1C; }
.result { margin-top: 12px; border-top: 1px dashed #e5e7eb; padding-top: 12px; }
.r-ok { font-size: 12.5px; color: #1B5E20; margin: 0 0 4px; }
.r-ng { font-size: 12.5px; color: #B71C1C; margin: 0 0 6px; line-height: 1.7; }
code { background: #f1f3f5; padding: 1px 5px; border-radius: 3px; font-size: 12px; }
.alias-form { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; margin-bottom: 8px; }
.alias-form .input { max-width: 280px; }
.alias-eq { color: #64748b; font-weight: 700; }
.muted { color: #94a3b8; font-size: 12px; white-space: nowrap; }
</style>
