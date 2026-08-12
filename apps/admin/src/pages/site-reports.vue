<template>
  <div>
    <div class="page-header">
      <h1 class="page-title">現場別集計
        <HelpButton title="現場別集計の使い方" :items="[
          '現場ごとに日報の稼働（人工）と経費を集計して表示します。',
          '上部の月ナビで対象月を切り替えられます。「期間で見る」で複数月をまたいだ合計も出せます。',
          '行を開くと、日報単位の内訳（作業員・経費）を確認できます。',
        ]" />
      </h1>
      <!-- ★既定は従来の単月ナビ。複数月にまたがる工事を通しで見たい時だけ期間指定に切り替える -->
      <div class="month-nav">
        <template v-if="!isRange">
          <button class="btn-nav" @click="shiftMonth(-1)">‹</button>
          <span class="month-label">{{ yearMonth }}</span>
          <button class="btn-nav" @click="shiftMonth(1)">›</button>
          <button class="btn-range" data-testid="range-open" @click="openRange">期間で見る</button>
        </template>
        <template v-else>
          <input type="month" v-model="rangeFromYM" class="range-ym" data-testid="range-from" />
          <span>〜</span>
          <input type="month" v-model="rangeToYM" class="range-ym" data-testid="range-to" />
          <button class="btn-range" data-testid="range-close" @click="closeRange">単月に戻す</button>
        </template>
      </div>
    </div>

    <div v-if="loading" class="empty">読み込み中...</div>
    <div v-else-if="siteNamesAll.length === 0" class="empty">{{ isRange ? 'この期間の日報がありません' : 'この月の日報がありません' }}</div>

    <template v-else>
      <!-- 絞り込み。現場が300件を超えるとタブから目的の1件を目視で探せない（2026-08-10 運用者要望）。
           ★表示を絞るだけ。各現場の集計値・出力対象には触れない。 -->
      <div class="site-filter">
        <label class="sf-field">
          <span class="material-symbols-rounded sf-icon">search</span>
          <input v-model="filterText" type="search" class="sf-input" placeholder="現場名で絞り込み"
            data-testid="site-filter-text" />
        </label>
        <select v-model="filterContractor" class="sf-select" data-testid="site-filter-contractor">
          <option value="">元請け（すべて）</option>
          <option v-for="c in contractorOptions" :key="c" :value="c">{{ c }}</option>
        </select>
        <template v-if="isFiltering">
          <span class="sf-count" data-testid="site-filter-count">{{ siteNames.length }} / {{ siteNamesAll.length }} 件</span>
          <button class="sf-clear" data-testid="site-filter-clear" @click="clearFilter">クリア</button>
        </template>
      </div>

      <div v-if="siteNames.length === 0" class="empty" data-testid="site-filter-empty">
        絞り込みに一致する現場がありません（{{ siteNamesAll.length }}件中0件）
      </div>

      <!-- 現場タブ（五十音順） -->
      <div v-if="siteNames.length" class="tabs-wrap">
        <div class="tabs">
          <button v-for="name in siteNames" :key="name" class="tab"
            :class="{ active: displaySite === name }" @click="activeSite = name">
            {{ name }}
          </button>
        </div>
      </div>

      <!-- 出力（※表の表示月は上の ‹ 年月 › ナビで切替。出力ボタンを押すと出力期間を選ぶ） -->
      <div v-if="displaySite" class="export-bar">
        <div class="export-pop-wrap">
          <button class="btn-export" data-testid="export-site" @click="exportPanelOpen = !exportPanelOpen"><span class="material-symbols-rounded" style="font-size:1em;vertical-align:middle;line-height:1">download</span> {{ canViewEstimates ? 'CSV＋見積書PDFを出力' : 'CSVを出力' }}</button>
          <div v-if="exportPanelOpen" class="export-pop" data-testid="export-panel">
            <div class="export-pop-title">出力する期間を選んでください</div>
            <label class="export-range-lbl">出力範囲
              <select v-model="exportRange" class="export-range" data-testid="export-range">
                <option value="month">表示中の期間（{{ periodLabel }}）</option>
                <option value="range">年月範囲を指定</option>
                <option value="all">全期間</option>
              </select>
            </label>
            <div v-if="exportRange === 'range'" class="export-range-inputs">
              <input type="month" v-model="exportFromYM" class="export-ym" data-testid="export-from" />
              <span>〜</span>
              <input type="month" v-model="exportToYM" class="export-ym" data-testid="export-to" />
            </div>
            <div class="export-pop-actions">
              <button class="btn-cancel-sm" @click="exportPanelOpen = false">キャンセル</button>
              <button class="btn-export-go" :disabled="exporting" data-testid="export-go" @click="exportSite">{{ exporting ? '出力中…' : 'この期間で出力' }}</button>
            </div>
          </div>
        </div>
      </div>

      <!-- 一覧テーブル -->
      <div v-if="displaySite" class="table-wrap">
        <table class="table">
          <thead>
            <tr>
              <th>日付</th>
              <th>作業員</th>
              <th class="num">商社</th>
              <th class="num">業者</th>
              <th v-if="canViewWages" class="num">
                社員
                <button
                  v-if="canViewHourlyWage"
                  type="button"
                  class="wage-toggle-btn"
                  :class="{ on: wageMode === 'real' }"
                  :title="wageMode === 'real' ? '日当ベースに戻す' : '実質賃金(時給×稼働)で集計に切替'"
                  @click.stop="toggleWageMode"
                >{{ wageMode === 'real' ? '日当に切替' : '実質賃金に切替' }}</button>
              </th>
              <th class="num">駐車場</th>
              <th class="num">燃料</th>
              <th class="num">高速</th>
              <th class="num">宿泊</th>
              <th class="num">接待交際費</th>
              <th class="num">ゴミ</th>
              <th class="num">交通費</th>
              <th class="num">ホーム</th>
              <th class="num">出張費</th>
              <th class="num">合計</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="row in siteMap[displaySite]" :key="row._key" class="data-row" :class="{ 'invoice-row': row._isInvoice }" @click="!row._isInvoice && (selected = row)">
              <td class="date-cell">
                {{ row.date.slice(5).replace('-', '/') }}
                <span v-if="row._isSunday" class="sun">日</span>
              </td>
              <td class="worker-cell">
                <span v-if="row.workerSummary">{{ row.workerSummary }}</span>
                <span v-else class="muted">—</span>
              </td>
              <td class="num">{{ row.shoshaCost ? yen(row.shoshaCost) : '—' }}</td>
              <td class="num">{{ row.gyoshaCost ? yen(row.gyoshaCost) : '—' }}</td>
              <td v-if="canViewWages" class="num">{{ row.laborCost     ? yen(row.laborCost)     : '—' }}</td>
              <td class="num">{{ row.parkingYen    ? yen(row.parkingYen)    : '—' }}</td>
              <td class="num">{{ row.fuelCost      ? yen(row.fuelCost)      : '—' }}</td>
              <td class="num">{{ row.highwayCost   ? yen(row.highwayCost)   : '—' }}</td>
              <td class="num">{{ row.hotelCost     ? yen(row.hotelCost)     : '—' }}</td>
              <td class="num">{{ row.entertainCost ? yen(row.entertainCost) : '—' }}</td>
              <td class="num">{{ row.garbageCost ? yen(row.garbageCost) : '—' }}</td>
              <td class="num">{{ row.trainCost     ? yen(row.trainCost)     : '—' }}</td>
              <td class="num">{{ row.homeCost      ? yen(row.homeCost)      : '—' }}</td>
              <td class="num">{{ row.tripCost      ? yen(row.tripCost)      : '—' }}</td>
              <td class="num total-col">{{ yen(row.total) }}</td>
              <td class="hint">{{ row._isInvoice ? '請求' : '詳細 →' }}</td>
            </tr>
          </tbody>
          <tfoot>
            <tr class="total-row">
              <td colspan="2" data-testid="period-total-label">{{ isRange ? '期間計' : '月計' }}</td>
              <td class="num">{{ yen(sumF(siteMap[displaySite], 'shoshaCost'))    }}</td>
              <td class="num">{{ yen(sumF(siteMap[displaySite], 'gyoshaCost'))    }}</td>
              <td v-if="canViewWages" class="num">{{ yen(sumF(siteMap[displaySite], 'laborCost'))     }}</td>
              <td class="num">{{ yen(sumF(siteMap[displaySite], 'parkingYen'))    }}</td>
              <td class="num">{{ yen(sumF(siteMap[displaySite], 'fuelCost'))      }}</td>
              <td class="num">{{ yen(sumF(siteMap[displaySite], 'highwayCost'))   }}</td>
              <td class="num">{{ yen(sumF(siteMap[displaySite], 'hotelCost'))     }}</td>
              <td class="num">{{ yen(sumF(siteMap[displaySite], 'entertainCost')) }}</td>
              <td class="num">{{ yen(sumF(siteMap[displaySite], 'garbageCost')) }}</td>
              <td class="num">{{ yen(sumF(siteMap[displaySite], 'trainCost'))     }}</td>
              <td class="num">{{ yen(sumF(siteMap[displaySite], 'homeCost'))      }}</td>
              <td class="num">{{ yen(sumF(siteMap[displaySite], 'tripCost'))     }}</td>
              <td class="num total-col">{{ yen(sumF(siteMap[displaySite], 'total')) }}</td>
              <td></td>
            </tr>
          </tfoot>
        </table>
      </div>

      <!-- ★業者別内訳。合計だけだと検算できず、どこかの業者が漏れていても気づけない。
           内訳は月計と同じ行から作っているので、合計が必ず一致する。 -->
      <section v-if="displaySite" class="vendor-breakdown" data-testid="vendor-breakdown">
        <div class="vb-head">
          <h3 class="vb-title">業者別内訳</h3>
          <span class="vb-check" data-testid="vendor-check">
            内訳合計 <b>{{ yen(vendorBreakdown.countedTotal) }}</b> ／ {{ isRange ? '期間計' : '月計' }}（商社+業者） <b>{{ yen(vendorGrandTotal) }}</b>
            <span v-if="vendorBreakdown.countedTotal === vendorGrandTotal" class="vb-ok" data-testid="vendor-check-ok">一致</span>
            <span v-else class="vb-ng" data-testid="vendor-check-ng">不一致</span>
          </span>
        </div>

        <div v-if="!vendorBreakdown.counted.length && !vendorBreakdown.uncategorized.length" class="vb-empty">
          この現場に業者の原価はありません。
        </div>

        <table v-else class="table vb-table">
          <thead>
            <tr><th>業者名</th><th>区分</th><th class="num">商社</th><th class="num">業者</th><th class="num">合計</th><th></th></tr>
          </thead>
          <tbody>
            <tr v-for="v in vendorBreakdown.counted" :key="v.name" data-testid="vendor-row">
              <td class="vb-name">{{ v.name }}</td>
              <td>{{ v.category ?? '—' }}</td>
              <td class="num">{{ v.shosha ? yen(v.shosha) : '—' }}</td>
              <td class="num">{{ v.gyosha ? yen(v.gyosha) : '—' }}</td>
              <td class="num vb-total">{{ yen(v.total) }}</td>
              <td>
                <!-- AC3: 特定業者だけの明細（「とらやだけのリストほしい」） -->
                <button class="vb-detail-btn" :data-testid="`vendor-detail-${v.name}`"
                        @click="vendorFilter = vendorFilter === v.name ? '' : v.name">
                  {{ vendorFilter === v.name ? '閉じる' : '明細' }}
                </button>
              </td>
            </tr>
            <tr v-if="vendorFilter" class="vb-detail-row" data-testid="vendor-detail-panel">
              <td colspan="6">
                <div class="vb-detail-title">{{ vendorFilter }} の明細</div>
                <table class="vb-detail-table">
                  <thead><tr><th>日付</th><th>内容</th><th class="num">金額</th></tr></thead>
                  <tbody>
                    <tr v-for="(it, i) in (vendorBreakdown.counted.find(v => v.name === vendorFilter)?.items
                                        ?? vendorBreakdown.uncategorized.find(v => v.name === vendorFilter)?.items ?? [])" :key="i">
                      <td>{{ it.date }}</td>
                      <td>{{ it.note }}</td>
                      <td class="num">{{ yen(it.amount) }}</td>
                    </tr>
                  </tbody>
                </table>
              </td>
            </tr>
          </tbody>
          <tfoot>
            <tr class="total-row">
              <td colspan="4">内訳合計</td>
              <td class="num total-col" data-testid="vendor-breakdown-total">{{ yen(vendorBreakdown.countedTotal) }}</td>
              <td></td>
            </tr>
          </tfoot>
        </table>

        <!-- ★区分(商社/業者)が未設定の協力業者は、月計の商社にも業者にも計上されていない。
             これこそ「漏れていても分からない」状態なので、原価未計上として明示する。 -->
        <div v-if="vendorBreakdown.uncategorized.length" class="vb-warn" data-testid="vendor-uncategorized">
          <span class="material-symbols-rounded vb-warn-icon">error</span>
          <div>
            <strong>区分（商社/業者）が未設定のため、原価に計上されていない協力業者があります。</strong>
            <ul class="vb-warn-list">
              <li v-for="v in vendorBreakdown.uncategorized" :key="v.name">
                {{ v.name }} … <b>{{ yen(v.unpriced) }}</b>（未計上）
              </li>
            </ul>
            合計 <b>{{ yen(vendorBreakdown.uncategorizedTotal) }}</b> が上の月計に含まれていません。
            協力業者マスタで区分を設定すると計上されます。
          </div>
        </div>
      </section>
    </template>

    <!-- 詳細モーダル -->
    <div v-if="selected" class="modal-overlay" @click.self="selected = null">
      <div class="modal">
        <div class="modal-head">
          <div>
            <div class="modal-title">{{ selected.siteName }}</div>
            <div class="modal-date">{{ selected.date }}</div>
          </div>
          <button class="btn-close" @click="selected = null">✕</button>
        </div>

        <!-- 出張費（別費目・主たる現場に計上／社員には含めない） -->
        <div class="modal-section" v-if="selected.tripCost" data-testid="trip-cost-section">
          <div class="section-label">出張費（{{ yen(selected.tripCost) }}）</div>
          <p class="muted" style="font-size:12px;margin:2px 0 0">出張日の手当 ¥3,000/人。主たる現場（最長稼働）に1回計上。社員（人件費）には含みません。</p>
        </div>

        <!-- 稼働 -->
        <div class="modal-section" v-if="selected.workers.length">
          <div class="section-label">稼働<template v-if="canViewWages">（社員 {{ yen(selected.laborCost) }}）</template></div>
          <table class="inner-table">
            <thead>
              <tr>
                <th>作業員</th><th>区分</th>
                <th class="num">通常</th><th class="num">残業</th><th class="num">深夜</th>
                <th v-if="canViewWages" class="num">単価</th><th v-if="canViewWages" class="num">人件費</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="(w, i) in selected.workers" :key="i">
                <td>{{ w.workerName }}</td>
                <td><span class="role-badge" :class="w.role">{{ w.role === 'factory' ? '工場' : '現場' }}</span></td>
                <td class="num">{{ fmt(w.hoursNormal) }}</td>
                <td class="num">{{ fmt(w.hoursOT) }}</td>
                <td class="num">{{ fmt(w.hoursNight) }}</td>
                <td v-if="canViewWages" class="num">{{ !w.unitPrice ? '—' : yen(w.unitPrice) + (w._wageMode === 'real' ? '/h' : '/日') }}</td>
                <td v-if="canViewWages" class="num">{{ w.laborCost ? yen(w.laborCost) : '—' }}</td>
              </tr>
            </tbody>
          </table>
        </div>

        <!-- 商社 -->
        <div class="modal-section" v-if="selected.subs.filter((s: any) => s.category === '商社').length">
          <div class="section-label">商社（{{ yen(selected.shoshaCost) }}）</div>
          <table class="inner-table">
            <thead><tr><th>業者名</th><th class="num">人数</th><th class="num">単価</th><th class="num">金額</th></tr></thead>
            <tbody>
              <tr v-for="(s, i) in selected.subs.filter((s: any) => s.category === '商社')" :key="i">
                <td>{{ s.name }}</td>
                <td class="num">{{ s.count }}名</td>
                <td class="num">{{ s.unitPrice ? yen(s.unitPrice) : '—' }}</td>
                <td class="num">{{ s.unitPrice ? yen(s.count * s.unitPrice) : '—' }}</td>
              </tr>
            </tbody>
          </table>
        </div>

        <!-- 業者 -->
        <div class="modal-section" v-if="selected.subs.filter((s: any) => s.category === '業者').length">
          <div class="section-label">業者（{{ yen(selected.gyoshaCost) }}）</div>
          <table class="inner-table">
            <thead><tr><th>業者名</th><th class="num">人数</th><th class="num">単価</th><th class="num">金額</th></tr></thead>
            <tbody>
              <tr v-for="(s, i) in selected.subs.filter((s: any) => s.category === '業者')" :key="i">
                <td>{{ s.name }}</td>
                <td class="num">{{ s.count }}名</td>
                <td class="num">{{ s.unitPrice ? yen(s.unitPrice) : '—' }}</td>
                <td class="num">{{ s.unitPrice ? yen(s.count * s.unitPrice) : '—' }}</td>
              </tr>
            </tbody>
          </table>
        </div>

        <!-- カテゴリ未設定の下請け -->
        <div class="modal-section" v-if="selected.subs.filter((s: any) => !s.category).length">
          <div class="section-label">協力業者（区分未設定）</div>
          <table class="inner-table">
            <thead><tr><th>業者名</th><th class="num">人数</th></tr></thead>
            <tbody>
              <tr v-for="(s, i) in selected.subs.filter((s: any) => !s.category)" :key="i">
                <td>{{ s.name }}</td><td class="num">{{ s.count }}名</td>
              </tr>
            </tbody>
          </table>
        </div>

        <!-- 車両経費 -->
        <div class="modal-section" v-if="selected.vehicleItems.length">
          <div class="section-label">車両経費</div>
          <table class="inner-table">
            <thead><tr><th>車両</th><th class="num">ガソリン</th><th class="num">軽油</th><th class="num">駐車場</th><th class="num">高速</th></tr></thead>
            <tbody>
              <tr v-for="(v, i) in selected.vehicleItems" :key="i">
                <td>{{ v.vehicleName }}</td>
                <td class="num">{{ v.distanceKm ? v.distanceKm + 'km' : '—' }}</td>
                <td class="num">{{ v.dieselKm   ? v.dieselKm   + 'km' : '—' }}</td>
                <td class="num">{{ v.parkingYen ? yen(v.parkingYen) : '—' }}</td>
                <td class="num">{{ v.highwayYen ? yen(v.highwayYen) : '—' }}</td>
              </tr>
            </tbody>
          </table>
        </div>

        <!-- 宿泊 -->
        <div class="modal-section" v-if="selected.hotelCost">
          <div class="section-label">宿泊（{{ yen(selected.hotelCost) }}）</div>
          <table class="inner-table">
            <thead><tr><th>種別</th><th>名称</th><th class="num">金額</th></tr></thead>
            <tbody>
              <!-- 新形式 hotels[]（複数） -->
              <template v-if="(selected._exp?.hotels || []).some((h: any) => h.yen)">
                <tr v-for="(h, hi) in (selected._exp.hotels || []).filter((x: any) => x.yen)" :key="hi">
                  <td>宿泊</td>
                  <td>{{ h.label || '—' }}</td>
                  <td class="num">{{ yen(h.yen) }}</td>
                </tr>
              </template>
              <!-- 旧スカラー（後方互換） -->
              <template v-else>
                <tr v-if="selected._exp?.hotelYen">
                  <td>ホテル</td>
                  <td>{{ selected._exp.hotelName || '—' }}</td>
                  <td class="num">{{ yen(selected._exp.hotelYen) }}</td>
                </tr>
                <tr v-if="selected._exp?.leopalaceYen">
                  <td>レオパレス</td>
                  <td>{{ selected._exp.leopalaceName || '—' }}</td>
                  <td class="num">{{ yen(selected._exp.leopalaceYen) }}</td>
                </tr>
              </template>
            </tbody>
          </table>
        </div>

        <!-- 接待交際費 -->
        <div class="modal-section" v-if="selected.entertainCost">
          <div class="section-label">接待交際費</div>
          <div class="simple-row">
            <span>{{ selected._exp?.entertainmentLabel || '接待交際費' }}</span>
            <span class="num-text">{{ yen(selected.entertainCost) }}</span>
          </div>
        </div>

        <!-- ゴミ -->
        <div class="modal-section" v-if="selected.garbageCost">
          <div class="section-label">ゴミ処分（{{ yen(selected.garbageCost) }}）</div>
          <table class="inner-table">
            <thead><tr><th>区分</th><th class="num">m³</th><th class="num">単価</th><th class="num">金額</th></tr></thead>
            <tbody>
              <tr v-if="selected.garbageFactoryM3">
                <td>工場ゴミ</td>
                <td class="num">{{ selected.garbageFactoryM3 }}m³</td>
                <td class="num">¥{{ GF_YEN.toLocaleString() }}/m³</td>
                <td class="num">{{ yen(Math.round(selected.garbageFactoryM3 * GF_YEN)) }}</td>
              </tr>
              <tr v-if="selected.garbageSiteM3">
                <td>現場ゴミ</td>
                <td class="num">{{ selected.garbageSiteM3 }}m³</td>
                <td class="num">¥{{ GS_YEN.toLocaleString() }}/m³</td>
                <td class="num">{{ yen(Math.round(selected.garbageSiteM3 * GS_YEN)) }}</td>
              </tr>
            </tbody>
          </table>
        </div>

        <!-- 交通費（電車） -->
        <div class="modal-section" v-if="selected.trainCost">
          <div class="section-label">交通費（電車） {{ yen(selected.trainCost) }}</div>
          <table class="inner-table">
            <thead><tr><th>区間</th><th class="num">金額</th></tr></thead>
            <tbody>
              <tr v-for="(t, i) in selected._trainItems" :key="i">
                <td>{{ t.label || '—' }}</td>
                <td class="num">{{ yen(t.yen) }}</td>
              </tr>
            </tbody>
          </table>
        </div>

        <!-- ホーム（その他） -->
        <div class="modal-section" v-if="selected.homeCost">
          <div class="section-label">ホームセンター等 {{ yen(selected.homeCost) }}</div>
          <table class="inner-table">
            <thead><tr><th>内容</th><th class="num">金額</th></tr></thead>
            <tbody>
              <tr v-for="(o, i) in selected._otherItems" :key="i">
                <td>{{ o.label || '—' }}</td>
                <td class="num">{{ yen(o.yen) }}</td>
              </tr>
            </tbody>
          </table>
        </div>

        <!-- 合計 -->
        <div class="modal-total">
          <span>合計</span>
          <span>{{ yen(selected.total) }}</span>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, watch } from 'vue'
import { supabase } from '../lib/supabase'
import { getAccountId } from '../lib/account'
import { useQueryParam, useYearMonthParam } from '../composables/useQueryParam'
import { resolveDocUrl } from '../lib/docUrl'
import HelpButton from '../components/HelpButton.vue'
import { laborBreakdownForReport, laborCostForBreakdown, ZERO_BREAKDOWN, buildWageTimelines, wageForDate, businessTripMainEntries, BUSINESS_TRIP_ALLOWANCE } from '../lib/workerHours'
import type { WageMode } from '../lib/workerHours'
import { canViewWages, canViewHourlyWage, canViewManagementPages } from '../lib/auth'
import { canViewEstimates } from '../lib/features'
import { resolveSiteRef, type SiteResolveCtx } from '../lib/siteKey'
import { normalizeSiteName } from '../lib/siteSimilarity'
import { netAmountOf, normalizeTaxMode } from '../lib/invoiceTax'
import JSZip from 'jszip'

const exporting = ref(false)
// エクスポート期間の選択（当月／年月範囲／全期間）
const _nowYM = (() => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}` })()
const exportRange  = ref<'month' | 'range' | 'all'>('month')
const exportPanelOpen = ref(false)   // 出力ボタンで開く期間選択パネル
const exportFromYM = ref(_nowYM)   // 'YYYY-MM'
const exportToYM   = ref(_nowYM)
function ymToFrom(ym: string) { return `${ym}-01` }
function ymToTo(ym: string) {
  const [y, m] = ym.split('-').map(Number)
  const last = new Date(y, m, 0).getDate()   // 当月末日（m は1-12のまま=翌月0日）
  return `${y}-${String(m).padStart(2, '0')}-${String(last).padStart(2, '0')}`
}
// 選択中の期間を {from, to, label} に解決（label はファイル名に使う）
function exportPeriod(): { from: string; to: string; label: string } {
  if (exportRange.value === 'all') return { from: '2000-01-01', to: '2999-12-31', label: '全期間' }
  if (exportRange.value === 'range' && exportFromYM.value && exportToYM.value) {
    const [a, b] = exportFromYM.value <= exportToYM.value
      ? [exportFromYM.value, exportToYM.value] : [exportToYM.value, exportFromYM.value]
    return { from: ymToFrom(a), to: ymToTo(b), label: `${a}〜${b}` }
  }
  return { from: dateFrom.value, to: dateTo.value, label: yearMonth.value }
}
// 現場別集計（当該現場の表・選択期間）＋ 紐づく見積書PDF を zip でエクスポート（見積書フォルダ内包）
async function exportSite() {
  const site = displaySite.value
  if (!site) return
  exporting.value = true
  try {
    const { from, to, label } = exportPeriod()
    // 表示中の当月ならロード済みの siteMap を流用、それ以外は選択期間で再集計
    const map = (exportRange.value === 'month') ? siteMap.value : await computeSiteMap(from, to)
    const rows = (map[site] ?? []).filter((r: any) => !r._isInvoice)
    const head = ['日付','作業員','商社','業者','社員','駐車場','燃料','高速','宿泊','接待交際費','ゴミ','交通費','ホーム','出張費','合計']
    const csv = [head.join(',')].concat(rows.map((r: any) => [
      r.date, '"' + String(r.workerSummary ?? '').replace(/"/g, '""') + '"',
      r.shoshaCost||0, r.gyoshaCost||0, r.laborCost||0, r.parkingYen||0, r.fuelCost||0, r.highwayCost||0,
      r.hotelCost||0, r.entertainCost||0, r.garbageCost||0, r.trainCost||0, r.homeCost||0, r.tripCost||0, r.total||0,
    ].join(','))).join('\r\n')
    const zip = new JSZip()
    zip.file(`現場別集計_${site}_${label}.csv`, '﻿' + csv) // BOM付き=Excelで文字化けしない
    // 紐づく見積書PDF（estimates.site_id）を「見積書」フォルダに内包（期間に依らず当該現場の全見積）
    //  ★現場管理者には同梱しない（2026-07-31 レビュー指摘）: 見積系の画面を非表示にしたのに
    //   この出力から見積金額入りPDFを取得できてしまう抜け道になっていた。CSV（現場の原価集計）は
    //   現場管理者にも見せる方針なのでそのまま出す。
    const accountId = await getAccountId()
    const { data: siteRow } = canViewEstimates.value
      ? await supabase.from('sites').select('id').eq('account_id', accountId).eq('name', site).maybeSingle()
      : { data: null }
    if (siteRow?.id) {
      const { data: ests } = await supabase.from('estimates')
        .select('estimate_number, pdf_path, pdf_bucket').eq('site_id', siteRow.id).eq('is_deleted', false)
      const folder = zip.folder('見積書')
      for (const e of (ests ?? []) as any[]) {
        if (!e.pdf_path) continue
        try {
          // pdf_bucket で出し分け（admin-docs=署名URL / expense-receipts=公開URL）
          const url = await resolveDocUrl(e.pdf_path, e.pdf_bucket); if (!url) continue
          const resp = await fetch(url); if (!resp.ok) continue
          folder?.file(`${e.estimate_number || 'estimate'}.pdf`, await resp.blob())
        } catch { /* 1件失敗しても続行 */ }
      }
    }
    const blob = await zip.generateAsync({ type: 'blob' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob); a.download = `現場別集計_${site}_${label}.zip`
    a.click(); URL.revokeObjectURL(a.href)
    exportPanelOpen.value = false   // 出力できたらパネルを閉じる
  } finally { exporting.value = false }
}

const baseDate  = useYearMonthParam()   // 対象月を ?ym=YYYY-MM でURL同期
const yearMonth = computed(() => `${baseDate.value.getFullYear()}年${baseDate.value.getMonth() + 1}月`)
const selected  = ref<any | null>(null)

function shiftMonth(delta: number) {
  const d = new Date(baseDate.value)
  d.setDate(1); d.setMonth(d.getMonth() + delta); baseDate.value = d
}
// ★表示期間。既定は従来どおり単月（開いた時の見え方を変えない＝AC3）。
//   複数月にまたがる工事の原価を通しで見るために、期間指定に切り替えられる。
//   URLに載せるのは「期間で見ている状態」を共有・再読込しても保てるようにするため。
const rangeMode   = useQueryParam('range', '')       // '' = 単月 / 'ym' = 年月範囲
const rangeFromYM = useQueryParam('from', '')        // 'YYYY-MM'
const rangeToYM   = useQueryParam('to', '')
const isRange = computed(() => rangeMode.value === 'ym' && !!rangeFromYM.value && !!rangeToYM.value)

/** 期間指定は開始・終了を逆に入れても成立させる（入れ違いで0件になると壊れて見える） */
const rangeYMs = computed(() => {
  const a = rangeFromYM.value, b = rangeToYM.value
  return a <= b ? [a, b] : [b, a]
})

const dateFrom = computed(() => {
  if (isRange.value) return ymToFrom(rangeYMs.value[0])
  const d = baseDate.value
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`
})
const dateTo = computed(() => {
  if (isRange.value) return ymToTo(rangeYMs.value[1])
  const d = new Date(baseDate.value); d.setMonth(d.getMonth() + 1); d.setDate(0)
  return d.toISOString().split('T')[0]
})

/** 画面に出す期間の見出し。単月は従来表記のまま */
const periodLabel = computed(() => isRange.value ? `${rangeYMs.value[0]} 〜 ${rangeYMs.value[1]}` : yearMonth.value)

/** 期間指定に切り替える。初期値は今見ている月（いきなり別の期間に飛ばさない） */
function openRange() {
  const d = baseDate.value
  const ym = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
  if (!rangeFromYM.value) rangeFromYM.value = ym
  if (!rangeToYM.value)   rangeToYM.value = ym
  rangeMode.value = 'ym'
}
function closeRange() { rangeMode.value = '' }

const loading    = ref(false)
const siteMap    = ref<Record<string, any[]>>({})
const activeSite = useQueryParam('site', '')   // URL ?site= に同期（ユーザーが選んだ現場そのもの・月を跨いでも書き換えない）
// 賃金モード（office以上のみ切替可）。既定=日当/8×稼働（現場管理者も閲覧OK）／real=実質賃金(時給×稼働)
const wageMode = ref<WageMode>('daily')
function toggleWageMode() {
  if (!canViewHourlyWage.value) return
  wageMode.value = wageMode.value === 'daily' ? 'real' : 'daily'
}
const siteNamesAll = computed(() => Object.keys(siteMap.value).sort((a, b) => a.localeCompare(b, 'ja')))

// ── 絞り込み（現場名 部分一致 × 元請け）──
//  現場が300件を超えるとタブから目的の1件を目視で探せない、という運用者要望（2026-08-10）。
//  ★これは「表示するタブを減らす」だけの機能。siteMap（=集計の中身）も出力対象も触らない。
//  現場名の照合は normalizeSiteName（NFKC＝全角/半角・カナ/かな・記号除去・小文字化）を通す。
//   日報の現場名は手入力なので「ﾙﾙﾚﾓﾝ」「ルルレモン」「lululemon」の揺れが実在する。
const filterText       = ref('')
const filterContractor = ref('')
// 現場名 → 元請け名。現場マスタに載っていない現場（手入力の表記ゆれ等）はここに現れないので、
// 元請けで絞ると出てこない＝「元請けが分からない現場」を混ぜない（絞った結果が信用できる方を採る）。
const contractorBySite = ref<Record<string, string>>({})

const contractorOptions = computed(() => {
  const present = new Set<string>()
  for (const name of siteNamesAll.value) {
    const c = contractorBySite.value[name]
    if (c) present.add(c)
  }
  return [...present].sort((a, b) => a.localeCompare(b, 'ja'))
})

const isFiltering = computed(() => !!filterText.value.trim() || !!filterContractor.value)
function clearFilter() { filterText.value = ''; filterContractor.value = '' }

const siteNames = computed(() => {
  if (!isFiltering.value) return siteNamesAll.value
  const q = normalizeSiteName(filterText.value.trim())
  return siteNamesAll.value.filter((name) => {
    if (q && !normalizeSiteName(name).includes(q)) return false
    if (filterContractor.value && contractorBySite.value[name] !== filterContractor.value) return false
    return true
  })
})

// 月を変えて対象現場が入れ替わったとき、絞り込みが残っていると「0件」に見えて事故る…
// ということはない（0件は明示表示する＝AC4）ので絞り込みは保持する。ユーザーが打った条件を
// 勝手に消す方が驚く。
// 表示用に選択現場を解決：今月に存在すればそれを使い、無ければ先頭にフォールバック（activeSite自体は書き換えない＝月を戻せば復元される）
const displaySite = computed(() => siteNames.value.includes(activeSite.value) ? activeSite.value : (siteNames.value[0] ?? ''))

// 単価（settings テーブルから上書き）
let G_YEN = 23
let D_YEN = 20
let GF_YEN = 8000   // ゴミ工場 yen/m³
let GS_YEN = 14000  // ゴミ現場 yen/m³

function yen(v: number) { return '¥' + Math.round(v).toLocaleString() }
function fmt(v: any) {
  const n = Number(v); return !v || isNaN(n) || n === 0 ? '—' : n.toFixed(2).replace(/\.?0+$/, '')
}
function sumF(rows: any[], field: string) {
  return rows?.reduce((s, r) => s + (Number(r[field]) || 0), 0) ?? 0
}

// ── 業者別内訳 ──
//  合計だけ出ていて内訳が見えないと「金額が合っているか検算できず、どこかの業者が
//  漏れていても気づけない」（2026-08-03 ユーザー指摘）。
//  ★内訳は必ず「月計と同じ行(siteMap[displaySite])」から作る。別クエリで作り直すと
//   合計と内訳がズレる（下請け請求の税区分で一覧とモーダルが食い違った前例がある）。
type VendorItem = { date: string; amount: number; note: string; isInvoice: boolean }
type VendorAgg = { name: string; category: string | null; shosha: number; gyosha: number; unpriced: number; total: number; items: VendorItem[] }

const vendorBreakdown = computed<{ counted: VendorAgg[]; uncategorized: VendorAgg[]; countedTotal: number; uncategorizedTotal: number }>(() => {
  const rows = siteMap.value[displaySite.value] ?? []
  const byVendor = new Map<string, VendorAgg>()
  const get = (name: string, category: string | null): VendorAgg => {
    let v = byVendor.get(name)
    if (!v) { v = { name, category, shosha: 0, gyosha: 0, unpriced: 0, total: 0, items: [] }; byVendor.set(name, v) }
    if (v.category == null && category != null) v.category = category
    return v
  }

  for (const r of rows) {
    if (r._isInvoice) {
      // 請求行: 行に載っている金額をそのまま業者へ寄せる（区分未設定は業者列に入る既存仕様）
      const v = get(r._vendor || '（業者名なし）', r._vendorCategory ?? null)
      v.shosha += Number(r.shoshaCost) || 0
      v.gyosha += Number(r.gyoshaCost) || 0
      const amt = (Number(r.shoshaCost) || 0) + (Number(r.gyoshaCost) || 0)
      v.items.push({ date: r.date, amount: amt, note: '請求', isInvoice: true })
      continue
    }
    // 日報行: subs(協力業者)を業者ごとに分解。金額の出し方は月計と同じ count × 単価
    for (const s of (r.subs ?? [])) {
      const amt = (Number(s.count) || 0) * (Number(s.unitPrice) || 0)
      const v = get(s.name || '（業者名なし）', s.category ?? null)
      // ★区分(商社/業者)が未設定の協力業者は、既存の月計では商社にも業者にも計上されない。
      //   ＝原価に乗っていない。まさに「どこかの業者が漏れていても分からない」状態なので
      //   合計には混ぜず、別枠で「原価未計上」として見せる。
      if (s.category === '商社') v.shosha += amt
      else if (s.category === '業者') v.gyosha += amt
      else v.unpriced += amt
      v.items.push({ date: r.date, amount: amt, note: `${s.count}人 × ${yen(s.unitPrice || 0)}`, isInvoice: false })
    }
  }

  const all = [...byVendor.values()]
  for (const v of all) v.total = v.shosha + v.gyosha
  const counted = all.filter((v) => v.total > 0).sort((a, b) => b.total - a.total)
  const uncategorized = all.filter((v) => v.unpriced > 0).sort((a, b) => b.unpriced - a.unpriced)
  return {
    counted,
    uncategorized,
    countedTotal: counted.reduce((s, v) => s + v.total, 0),
    uncategorizedTotal: uncategorized.reduce((s, v) => s + v.unpriced, 0),
  }
})

/** 月計の商社+業者。内訳の合計とこれが一致することが検算の要（AC2） */
const vendorGrandTotal = computed(() => {
  const rows = siteMap.value[displaySite.value] ?? []
  return sumF(rows, 'shoshaCost') + sumF(rows, 'gyoshaCost')
})
const vendorFilter = ref<string>('')   // 特定業者だけの明細を見る（AC3）
// スプレッドシートの列に対応した経費列を抽出
function extractExpenseCols(exp: any) {
  let parkingYen = 0, fuelCost = 0, highwayCost = 0

  for (const v of (exp?.vehicles ?? []).filter((v: any) => v.vehicleName)) {
    parkingYen  += v.parkingYen || 0
    fuelCost    += Math.round((v.distanceKm || 0) * G_YEN) + Math.round((v.dieselKm || 0) * D_YEN)
    highwayCost += v.highwayYen || 0
  }
  // 新形式: 現場ごとの駐車場代/高速代（複数・明細ごと）も集計に含める（旧の車両埋め込みだけだと漏れる）
  parkingYen  += (exp?.parkings  ?? []).reduce((s: number, p: any) => s + (Number(p.yen) || 0), 0)
  highwayCost += (exp?.highways  ?? []).reduce((s: number, h: any) => s + (Number(h.yen) || 0), 0)

  // 宿泊費: 新形式 hotels[] があればその合計、無ければ旧スカラー(hotel/leopalace)＝二重計上を防ぐ後方互換
  const hotelsSum      = (exp?.hotels || []).reduce((s: number, h: any) => s + (Number(h.yen) || 0), 0)
  const hotelCost      = hotelsSum > 0 ? hotelsSum : (exp?.hotelYen || 0) + (exp?.leopalaceYen || 0)
  const entertainCost  = (exp?.entertainments ?? []).reduce((s: number, e: any) => s + (e.yen || 0), 0) || (exp?.entertainmentYen || 0)
  const garbageFactoryM3 = exp?.garbageFactoryM3 || 0
  const garbageSiteM3    = exp?.garbageSiteM3    || 0
  const garbageCost    = Math.round(garbageFactoryM3 * GF_YEN + garbageSiteM3 * GS_YEN)
  const trainCost      = (exp?.trains ?? []).filter((t: any) => t.yen).reduce((s: number, t: any) => s + t.yen, 0)
  const homeCost       = (exp?.others ?? []).filter((o: any) => o.yen).reduce((s: number, o: any) => s + o.yen, 0)

  return { parkingYen, fuelCost, highwayCost, hotelCost, entertainCost, garbageFactoryM3, garbageSiteM3, garbageCost, trainCost, homeCost }
}

async function computeSiteMap(fromDate: string, toDate: string): Promise<Record<string, any[]>> {
  const accountId = await getAccountId()
  const [{ data: wm }, { data: sm }, { data: cfg }, { data: wh }, { data: siteRows }] = await Promise.all([
    supabase.from('workers').select('id, name, daily_wage, hourly_wage').eq('account_id', accountId),
    supabase.from('subcontractors').select('name, category, unit_price').eq('account_id', accountId),
    supabase.from('settings').select('key, value').eq('account_id', accountId),
    supabase.from('worker_wage_history').select('worker_id, effective_date, changed_at, old_unit_price, new_unit_price, wage_type, old_wage_type, old_daily_wage, new_daily_wage, old_hourly_wage, new_hourly_wage').eq('account_id', accountId),
    supabase.from('sites').select('id, name, active, created_at, contractors(name)').eq('account_id', accountId).order('created_at', { ascending: true }),
  ])
  // 絞り込み用の 現場名→元請け名。集計には使わない（表示するタブを減らすためだけ）。
  contractorBySite.value = Object.fromEntries(
    (siteRows ?? [])
      .map((s: any) => [s.name, s.contractors?.name ?? ''])
      .filter(([, c]: any[]) => !!c),
  )
  // 現場参照の解決コンテキスト: site_id 優先＋active名一致で表記ゆれ/マージ孤児を1バケットへ統合（根本対策）
  const siteCtx: SiteResolveCtx = {
    activeSites: (siteRows ?? []).filter((s: any) => s.active).map((s: any) => ({ id: s.id, name: s.name })),
    siteNameById: Object.fromEntries((siteRows ?? []).map((s: any) => [s.id, s.name])),
  }
  const wageTimelines = buildWageTimelines((wh ?? []) as any[])  // 作業員ごとの昇給timeline（日付別単価解決用）
  // 設定値を上書き
  for (const row of (cfg ?? [])) {
    if (row.key === 'gasoline_rate_per_km')        G_YEN  = Number(row.value)
    if (row.key === 'diesel_rate_per_km')           D_YEN  = Number(row.value)
    if (row.key === 'garbage_factory_rate_per_m3')  GF_YEN = Number(row.value)
    if (row.key === 'garbage_site_rate_per_m3')     GS_YEN = Number(row.value)
  }
  // 下請け請求（当月）を日表の請求行として構築（商社/業者列に金額を載せ、月計に反映）
  const invoiceSites = new Set<string>()
  const invoiceRowsBySite: Record<string, any[]> = {}
  {
    const { data: sii } = await supabase
      .from('subcontractor_invoice_items')
      .select('site_name, item_date, amount, tax_rate, description, subcontractor_invoices(vendor_name, tax_mode, subcontractors(category))')
      .eq('account_id', accountId)
      .gte('item_date', fromDate)
      .lte('item_date', toDate)
    for (const r of (sii ?? []) as any[]) {
      if (!r.site_name) continue
      // 請求の現場名も同じ解決を通し、日報側と同じ正式名バケットに合流させる（表記ゆれ吸収）
      const name = resolveSiteRef({ siteName: r.site_name }, siteCtx).name || r.site_name
      invoiceSites.add(name)
      // ★原価は税抜で揃える。内税の請求書は amount が税込なので割り戻す
      //   （揃えないと内税の請求だけ約10%多く原価に乗る）
      const amt = Math.round(netAmountOf(r, normalizeTaxMode(r.subcontractor_invoices?.tax_mode)))
      const cat = r.subcontractor_invoices?.subcontractors?.category ?? null
      const vendor = r.subcontractor_invoices?.vendor_name ?? ''
      const rows = (invoiceRowsBySite[name] ??= [])
      rows.push({
        _key: `inv-${name}-${r.item_date}-${rows.length}`, _isInvoice: true, siteName: name,
        date: r.item_date || dateFrom.value, _isSunday: false,
        // 業者別内訳を出すために業者名を行に持たせる（workerSummary の文字列から
        // 業者名を切り出すのは表記が変わると壊れるため、構造化して持つ）
        _vendor: vendor || '（業者名なし）', _vendorCategory: cat,
        workerSummary: `【請求】${vendor}${r.description ? '・' + r.description : ''}`,
        workers: [], subs: [],
        // 区分=商社 のみ商社列、それ以外（業者/未区分）は業者列（index.vue 月次集計と統一）
        shoshaCost: cat === '商社' ? amt : 0, gyoshaCost: cat === '商社' ? 0 : amt,
        laborCost: 0, parkingYen: 0, fuelCost: 0, highwayCost: 0, hotelCost: 0,
        entertainCost: 0, garbageCost: 0, trainCost: 0, homeCost: 0, total: amt,
      })
    }
  }

  const dailyById    = Object.fromEntries((wm ?? []).map((w: any) => [w.id,   w.daily_wage  ?? 0]))
  const dailyByName  = Object.fromEntries((wm ?? []).map((w: any) => [w.name, w.daily_wage  ?? 0]))
  const hourlyById   = Object.fromEntries((wm ?? []).map((w: any) => [w.id,   w.hourly_wage ?? 0]))
  const hourlyByName = Object.fromEntries((wm ?? []).map((w: any) => [w.name, w.hourly_wage ?? 0]))
  const idByName    = Object.fromEntries((wm ?? []).map((w: any) => [w.name, w.id]))  // 日報がworkerId空でも昇給timelineを引けるように
  const subMaster   = Object.fromEntries((sm ?? []).map((s: any) => [s.name, { category: s.category, unitPrice: s.unit_price ?? 0 }]))

  const { data } = await supabase
    .from('daily_reports')
    .select('id, date, is_working, is_business_trip, sites')
    .eq('account_id', accountId)
    .eq('is_working', true)
    .gte('date', fromDate)
    .lte('date', toDate)
    .order('date', { ascending: true })
    .limit(5000) // 1ヶ月×全作業員で500件超→一部の日が溢れて欠落するため余裕を持たせる

  // 現場×日でグループ化
  const grouped: Record<string, any> = {}

  for (const report of data ?? []) {
    const isSunday = new Date((report as any).date + 'T00:00:00').getDay() === 0
    // 実勤務時間ベースで料率別時間を再計算（保存値の hoursNormal に依存しない＝通常×8h固定バグの修正）。
    // 同一作業員が複数現場に跨る場合は現場跨ぎで残業を累積する。
    const laborMap = laborBreakdownForReport((report as any).sites ?? [], isSunday)
    // 出張日：作業員ごとの主たる現場（最長稼働）にだけ +¥3,000 を計上（二重計上回避）
    const tripSet = (report as any).is_business_trip ? businessTripMainEntries((report as any).sites ?? []) : null

    for (const site of ((report as any).sites ?? [])) {
      const rawName  = site.siteName ?? ''
      // site_id（保存済み or active名一致で解決）→ 正式名でグループ化。表記ゆれ/マージ孤児が1バケットに統合される。
      const siteName = resolveSiteRef(site, siteCtx).name?.trim()
        || (rawName === '__other__' ? '新規現場' : '(不明)')
      const date  = (report as any).date
      const gKey  = `${siteName}__${date}`

      if (!grouped[gKey]) {
        grouped[gKey] = {
          _key: gKey, siteName, date, _isSunday: isSunday,
          workers: [], subs: [],
          vehicleItems: [],
          _trainItems: [], _otherItems: [],
          _exp: null,
          parkingYen: 0, fuelCost: 0, highwayCost: 0,
          hotelCost: 0, entertainCost: 0,
          garbageFactoryM3: 0, garbageSiteM3: 0, garbageCost: 0,
          trainCost: 0, homeCost: 0, tripCost: 0,
        }
      }
      const g = grouped[gKey]

      // 作業員
      for (const w of (site.workers ?? []).filter((w: any) => w.workerName)) {
        const curDaily  = dailyById[w.workerId]  ?? dailyByName[w.workerName]  ?? 0
        const curHourly = hourlyById[w.workerId] ?? hourlyByName[w.workerName] ?? 0
        const wid = w.workerId || idByName[w.workerName]
        // 日報の日付に有効だった日当・時給で計算（昇給で過去の人件費が動かないように）
        const { daily, hourly } = wageForDate(date, wid ? wageTimelines.get(wid) : undefined, curDaily, curHourly)
        const breakdown = laborMap.get(w) ?? ZERO_BREAKDOWN
        // 単価セルは選択中モードの単価を表示（既定=日当／実質賃金ONは時給）
        const unitPrice = wageMode.value === 'real' ? hourly : daily
        g.workers.push({ ...w, ...breakdown, role: w.workerRole ?? 'site', unitPrice, _wageMode: wageMode.value, laborCost: laborCostForBreakdown(breakdown, daily, hourly, wageMode.value) })
        // 出張費は人件費(社員)に混ぜず、主たる現場の別費目として計上（原価視点・複数現場でも主現場に1回）
        if (tripSet?.has(w)) g.tripCost += BUSINESS_TRIP_ALLOWANCE
      }

      // 下請け（商社/業者区分・単価を master から付与）
      for (const s of (site.subcontractors ?? []).filter((s: any) => s.subcontractorName)) {
        const m = subMaster[s.subcontractorName] ?? { category: null, unitPrice: 0 }
        g.subs.push({ name: s.subcontractorName, count: s.count, category: m.category, unitPrice: m.unitPrice })
      }

      // 経費列の抽出（複数日報を加算）
      const cols = extractExpenseCols(site.expenses)
      g.parkingYen      += cols.parkingYen
      g.fuelCost        += cols.fuelCost
      g.highwayCost     += cols.highwayCost
      g.hotelCost       += cols.hotelCost
      g.entertainCost   += cols.entertainCost
      g.garbageFactoryM3 += cols.garbageFactoryM3
      g.garbageSiteM3   += cols.garbageSiteM3
      g.garbageCost     += cols.garbageCost
      g.trainCost       += cols.trainCost
      g.homeCost        += cols.homeCost

      // モーダル用詳細
      for (const v of (site.expenses?.vehicles ?? []).filter((v: any) => v.vehicleName))
        g.vehicleItems.push(v)
      for (const t of (site.expenses?.trains ?? []).filter((t: any) => t.yen))
        g._trainItems.push(t)
      for (const o of (site.expenses?.others ?? []).filter((o: any) => o.yen))
        g._otherItems.push(o)
      // 最後のexpensesをモーダル用に保持（ホテル・接待交際費）
      if (site.expenses) g._exp = site.expenses
    }
  }

  // 集計して siteMap に格納
  const map: Record<string, any[]> = {}
  for (const g of Object.values(grouped)) {
    if (!map[g.siteName]) map[g.siteName] = []

    const laborCost  = g.workers.reduce((s: number, w: any) => s + (w.laborCost || 0), 0)
    const shoshaCost = g.subs.filter((s: any) => s.category === '商社')
      .reduce((s: number, sub: any) => s + sub.count * (sub.unitPrice || 0), 0)
    const gyoshaCost = g.subs.filter((s: any) => s.category === '業者')
      .reduce((s: number, sub: any) => s + sub.count * (sub.unitPrice || 0), 0)
    const total = shoshaCost + gyoshaCost + laborCost
      + g.parkingYen + g.fuelCost + g.highwayCost
      + g.hotelCost + g.entertainCost + g.garbageCost + g.trainCost + g.homeCost + g.tripCost

    const workerNames   = [...new Set(g.workers.map((w: any) => w.workerName))] as string[]
    const workerSummary = workerNames.join('・')

    map[g.siteName].push({
      ...g,
      laborCost, shoshaCost, gyoshaCost, total,
      workerSummary,
    })
  }

  // 下請け請求の行を各現場に追加（日報の無い現場もタブに出す）
  for (const [name, rows] of Object.entries(invoiceRowsBySite)) {
    ;(map[name] ??= []).push(...rows)
  }

  // 日付順ソート
  for (const rows of Object.values(map)) rows.sort((a, b) => a.date.localeCompare(b.date))

  return map
}

async function load() {
  loading.value = true
  const map = await computeSiteMap(dateFrom.value, dateTo.value)
  siteMap.value = map
  loading.value = false
}

onMounted(load)
// 期間指定では終了月だけを変えることもあるので dateTo も見る（見ないと再集計されない）
watch([dateFrom, dateTo], load)
watch(wageMode, load)   // 日当-実質賃金の切替で社員人件費を再集計
</script>

<style scoped>
.page-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px; flex-wrap: wrap; gap: 12px; }
.page-title { font-size: 22px; font-weight: 700; }
.month-nav { display: flex; align-items: center; gap: 12px; }
.month-label { font-size: 16px; font-weight: 700; min-width: 100px; text-align: center; }
.btn-range { background: #fff; color: #374151; border: 1px solid #d1d5db; border-radius: 6px; padding: 4px 10px; font-size: 12px; font-weight: 700; cursor: pointer; }
.range-ym { border: 1px solid #ccc; border-radius: 6px; padding: 4px 8px; font-size: 13px; }
.btn-nav { background: #f0f0f0; border: none; border-radius: 8px; padding: 6px 14px; font-size: 18px; cursor: pointer; }
.empty { color: #888; padding: 60px; text-align: center; }
.wage-toggle-btn { display: inline-block; margin-left: 6px; font-size: 10px; font-weight: 700; border: 1px solid #c7d2fe; background: #eef2ff; color: #4338ca; border-radius: 999px; padding: 1px 8px; cursor: pointer; white-space: nowrap; }
.wage-toggle-btn.on { background: #4338ca; color: #fff; border-color: #4338ca; }

/* 現場の絞り込みバー（現場名 × 元請け） */
.site-filter { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; margin-bottom: 10px; }
.sf-field { display: flex; align-items: center; gap: 6px; border: 1px solid #d0d0d0; border-radius: 6px; padding: 0 10px; background: #fff; }
.sf-field:focus-within { border-color: #06C755; }
.sf-icon { font-size: 18px; color: #888; }
.sf-input { border: none; outline: none; padding: 7px 0; font-size: 13px; width: 200px; background: transparent; }
.sf-select { border: 1px solid #d0d0d0; border-radius: 6px; padding: 7px 10px; font-size: 13px; background: #fff; max-width: 220px; }
.sf-count { font-size: 12px; color: #888; font-variant-numeric: tabular-nums; }
.sf-clear { border: 1px solid #d0d0d0; background: #fff; border-radius: 6px; padding: 6px 12px; font-size: 12px; color: #555; cursor: pointer; }
.sf-clear:hover { background: #f5f5f5; }

.tabs-wrap { overflow-x: auto; margin-bottom: 16px; }
.export-bar { display: flex; justify-content: flex-end; align-items: center; gap: 8px; margin: 10px 0 0; flex-wrap: wrap; }
.export-pop-wrap { position: relative; }
.export-pop { position: absolute; right: 0; top: calc(100% + 6px); z-index: 20; background: #fff; border: 1px solid #e0e0e0; border-radius: 10px; box-shadow: 0 6px 24px rgba(0,0,0,.12); padding: 16px; width: 300px; display: flex; flex-direction: column; gap: 12px; }
.export-pop-title { font-size: 13px; font-weight: 700; color: #333; }
.export-range-inputs { display: flex; align-items: center; gap: 6px; }
.export-range-lbl { font-size: 12px; color: #555; display: flex; align-items: center; gap: 4px; }
.export-range, .export-ym { border: 1px solid #ccc; border-radius: 6px; padding: 5px 8px; font-size: 13px; }
.export-pop-actions { display: flex; gap: 8px; justify-content: flex-end; margin-top: 4px; }
.btn-cancel-sm { background: #f0f0f0; border: none; border-radius: 8px; padding: 8px 14px; font-size: 13px; cursor: pointer; color: #666; }
.btn-export-go { background: #06C755; color: #fff; border: none; border-radius: 8px; padding: 8px 16px; font-size: 13px; font-weight: 700; cursor: pointer; }
.btn-export-go:disabled { opacity: .5; }
.btn-export { background: #06C755; color: #fff; border: none; border-radius: 8px; padding: 8px 14px; font-size: 13px; font-weight: 700; cursor: pointer; }
.btn-export:disabled { opacity: .5; cursor: default; }
.tabs { display: flex; gap: 4px; border-bottom: 2px solid #e0e0e0; min-width: max-content; }
.tab { background: none; border: none; border-bottom: 3px solid transparent; margin-bottom: -2px; padding: 10px 16px; font-size: 13px; font-weight: 600; color: #888; cursor: pointer; white-space: nowrap; transition: color .15s, border-color .15s; }
.tab:hover { color: #333; }
.tab.active { color: #06C755; border-bottom-color: #06C755; }

.table-wrap { background: #fff; border-radius: 12px; box-shadow: 0 1px 4px rgba(0,0,0,.06);  max-height: 70vh; overflow: auto; }
.table { width: 100%; border-collapse: collapse; font-size: 13px; }
.table th { background: #f9f9f9; padding: 9px 10px; text-align: left; font-size: 11px; color: #888; font-weight: 700; white-space: nowrap; position: sticky; top: 0; z-index: 2;}
.table td { padding: 9px 10px; border-top: 1px solid #f0f0f0; vertical-align: middle; }
.table tfoot td { background: #f5f5f5; font-weight: 700; border-top: 2px solid #e0e0e0; font-size: 13px; }
.data-row { cursor: pointer; transition: background .1s; }
.data-row:hover { background: #f9fff9; }
.invoice-row { background: #eef4ff; cursor: default; }
.invoice-row:hover { background: #e6efff; }
.invoice-row .hint { color: #1a3a7a; }
.num { text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap; }
.date-cell { font-weight: 700; white-space: nowrap; }
.sun { color: #E53935; font-size: 10px; font-weight: 700; margin-left: 4px; }
.worker-cell { font-size: 12px; max-width: 180px; }
.sub-cell { font-size: 12px; color: #555; white-space: nowrap; }
.total-col { color: #06C755; font-weight: 700; }

/* 業者別内訳 */
.vendor-breakdown { margin-top: 24px; }
.vb-head { display: flex; align-items: baseline; justify-content: space-between; gap: 12px; flex-wrap: wrap; margin-bottom: 8px; }
.vb-title { font-size: 15px; font-weight: 800; }
.vb-check { font-size: 12px; color: #555; }
.vb-ok { margin-left: 8px; font-weight: 700; color: #0a8a3a; background: #e8fff0; border-radius: 999px; padding: 2px 8px; }
.vb-ng { margin-left: 8px; font-weight: 700; color: #b91c1c; background: #fee2e2; border-radius: 999px; padding: 2px 8px; }
.vb-empty { font-size: 13px; color: #888; padding: 12px 0; }
.vb-table { width: 100%; }
.vb-name { font-weight: 700; }
.vb-total { font-weight: 700; }
.vb-detail-btn { background: #fff; border: 1px solid #d1d5db; border-radius: 6px; padding: 3px 10px; font-size: 12px; cursor: pointer; color: #374151; }
.vb-detail-row > td { background: #f9fafb; }
.vb-detail-title { font-size: 12px; font-weight: 700; margin-bottom: 6px; }
.vb-detail-table { width: 100%; border-collapse: collapse; font-size: 12px; }
.vb-detail-table th, .vb-detail-table td { border-bottom: 1px solid #eef0f3; padding: 4px 8px; text-align: left; }
.vb-detail-table th { color: #666; font-weight: 700; }
.vb-warn { margin-top: 12px; display: flex; gap: 8px; align-items: flex-start; font-size: 12px; line-height: 1.7;
  color: #9A3412; background: #FFF7ED; border: 1px solid #FDBA74; border-radius: 6px; padding: 10px 12px; }
.vb-warn-icon { font-size: 1.1em; line-height: 1.4; }
.vb-warn-list { margin: 4px 0; padding-left: 16px; }
.hint { font-size: 11px; color: #bbb; white-space: nowrap; }
.muted { color: #bbb; }

/* モーダル */
.modal-overlay { position: fixed; inset: 0; background: rgba(0,0,0,.5); display: flex; align-items: flex-start; justify-content: center; z-index: 100; padding: 32px 16px; overflow-y: auto; }
.modal { background: #fff; border-radius: 16px; width: 100%; max-width: 720px; padding: 28px; display: flex; flex-direction: column; gap: 20px; }
.modal-head { display: flex; justify-content: space-between; align-items: flex-start; }
.modal-title { font-size: 18px; font-weight: 900; }
.modal-date { font-size: 13px; color: #888; margin-top: 4px; }
.btn-close { background: #f0f0f0; border: none; border-radius: 8px; padding: 6px 12px; font-size: 14px; cursor: pointer; }
.modal-section { display: flex; flex-direction: column; gap: 8px; }
.section-label { font-size: 11px; font-weight: 700; color: #06C755; letter-spacing: 1px; }
.inner-table { width: 100%; border-collapse: collapse; font-size: 13px; }
.inner-table th { background: #f9f9f9; padding: 7px 10px; text-align: left; font-size: 11px; color: #888; font-weight: 700; }
.inner-table td { padding: 8px 10px; border-top: 1px solid #f5f5f5; }
.trip-badge { display: inline-block; margin-left: 6px; font-size: 10px; padding: 2px 6px; border-radius: 4px; font-weight: 700; background: #eef2ff; color: #4338ca; white-space: nowrap; }
.role-badge { font-size: 10px; padding: 2px 6px; border-radius: 4px; font-weight: 700; }
.role-badge.factory { background: #e8f4ff; color: #1a6fc4; }
.role-badge.site { background: #e8fff0; color: #0a8a3a; }
.simple-row { display: flex; justify-content: space-between; align-items: center; font-size: 13px; padding: 4px 0; }
.num-text { font-variant-numeric: tabular-nums; }
.flex-rows { display: flex; flex-direction: column; gap: 4px; }
.modal-total { display: flex; justify-content: space-between; align-items: center; border-top: 2px solid #e0e0e0; padding-top: 16px; font-size: 16px; font-weight: 700; }
.modal-total span:last-child { font-size: 20px; color: #06C755; }
</style>
