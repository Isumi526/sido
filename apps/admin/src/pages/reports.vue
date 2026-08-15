<template>
  <div>
    <h1 class="page-title">日報一覧</h1>

    <div class="filters">
      <!-- 作業員フィルタ（複数選択可。2人以上で人ごとの列に分けた比較ビューに切り替わる） -->
      <div class="worker-filter">
        <button class="input worker-filter-btn" data-testid="worker-filter" @click.stop="workerMenuOpen = !workerMenuOpen">
          <span v-if="!selectedWorkers.length" class="worker-filter-placeholder">全作業員</span>
          <span v-else class="chips">
            <span v-for="w in selectedWorkers" :key="w" class="chip">
              {{ w }}
              <span class="material-symbols-rounded chip-remove" :title="`${w} を外す`" @click.stop="toggleWorker(w)">close</span>
            </span>
          </span>
          <span class="material-symbols-rounded caret">{{ workerMenuOpen ? 'expand_less' : 'expand_more' }}</span>
        </button>
        <div v-if="workerMenuOpen" class="worker-menu" data-testid="worker-menu" @click.stop>
          <label v-for="w in workerOptions" :key="w" class="worker-menu-item">
            <input type="checkbox" :checked="selectedWorkers.includes(w)" @change="toggleWorker(w)">
            <span>{{ w }}</span>
          </label>
          <div v-if="!workerOptions.length" class="worker-menu-empty">この月の日報がありません</div>
          <button v-if="selectedWorkers.length" class="worker-menu-clear" @click="clearWorkers">すべて解除</button>
        </div>
      </div>

      <!-- 月ナビ -->
      <div class="month-nav">
        <button class="month-btn" @click="prevMonth">‹</button>
        <span class="month-label">{{ navYear }}年{{ navMonth }}月</span>
        <button class="month-btn" @click="nextMonth">›</button>
      </div>
    </div>

    <div v-if="loading" class="empty">読み込み中...</div>
    <div v-else-if="reports.length === 0" class="empty">日報が見つかりません</div>

    <!-- 比較ビュー: 行=日付・列=選択した作業員。同じ日に誰が何をしていたかを横一列で突き合わせる -->
    <div v-else-if="compareMode" class="compare-wrap" data-testid="compare-view">
      <table class="compare-table">
        <thead>
          <tr>
            <th class="compare-date-col">日付</th>
            <th v-for="w in selectedWorkers" :key="w">{{ w }}</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="d in compareDates" :key="d">
            <td class="compare-date-col">{{ d.slice(5).replace('-', '/') }}</td>
            <td v-for="w in selectedWorkers" :key="w" class="compare-cell">
              <template v-if="reportsFor(d, w).length">
                <div v-for="r in reportsFor(d, w)" :key="r.id" class="compare-entry">
                  <div class="compare-entry-head" @click="selected = r">
                    <span class="badge" :class="r.leave_type === 'paid_leave' ? 'paid-leave' : r.is_working ? 'working' : 'off'">{{ r.leave_type === 'paid_leave' ? '有給' : r.is_working ? '稼働' : '休み' }}</span>
                    <span class="detail-hint">詳細 →</span>
                  </div>
                  <div v-if="r.is_working && r.sites?.length" class="compare-sites" @click="selected = r">
                    <div v-for="(site, i) in r.sites" :key="i" class="compare-site-row">
                      <span class="site-name">{{ resolveSiteName(site) }}</span>
                      <span v-if="site.workers?.[0]?.startTime && site.workers?.[0]?.endTime" class="work-time">
                        <span class="material-symbols-rounded" style="font-size:1em;vertical-align:middle;line-height:1">schedule</span> {{ site.workers[0].startTime }}〜{{ site.workers[0].endTime }}
                      </span>
                    </div>
                  </div>
                  <div class="compare-actions">
                    <button
                      v-if="r.users?.worker_id"
                      class="icon-btn"
                      :disabled="granting === r.id"
                      :title="grantedIds.has(r.id) ? '編集許可済み' : 'この日を申請なしで編集可にする'"
                      @click.stop="issueEditGrant(r)"
                    ><span class="material-symbols-rounded">{{ grantedIds.has(r.id) ? 'check' : 'edit' }}</span></button>
                    <button
                      v-if="!HIDE_LINE_SECTIONS && !r.line_notified_at"
                      class="icon-btn"
                      :disabled="notifying === r.id"
                      title="LINE通知を送る"
                      @click.stop="sendNotification(r)"
                    ><span class="material-symbols-rounded">send</span></button>
                  </div>
                </div>
              </template>
              <span v-else class="compare-none">日報なし</span>
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <div v-else class="report-list">
      <div v-for="r in reports" :key="r.id" class="report-card">
        <div class="report-header" @click="selected = r">
          <span class="report-date">{{ r.date }}</span>
          <span class="report-worker">{{ r.worker_name ?? '—' }}</span>
          <span class="badge" :class="r.leave_type === 'paid_leave' ? 'paid-leave' : r.is_working ? 'working' : 'off'">{{ r.leave_type === 'paid_leave' ? '有給' : r.is_working ? '稼働' : '休み' }}</span>
          <span class="detail-hint">詳細 →</span>
        </div>
        <div v-if="r.is_working && r.sites?.length" class="sites" @click="selected = r">
          <div v-for="(site, i) in r.sites" :key="i" class="site-row">
            <span class="site-name">{{ resolveSiteName(site) }}</span>
            <span v-if="resolveContractorName(site)" class="contractor-chip"><span class="material-symbols-rounded" style="font-size:1em;vertical-align:middle;line-height:1">apartment</span> {{ resolveContractorName(site) }}</span>
            <span v-if="site.workers?.[0]?.startTime && site.workers?.[0]?.endTime" class="work-time">
              <span class="material-symbols-rounded" style="font-size:1em;vertical-align:middle;line-height:1">schedule</span> {{ site.workers[0].startTime }}〜{{ site.workers[0].endTime }}
            </span>
            <span class="attendance">
              <template v-if="attendanceFor(r, site)?.checkin || attendanceFor(r, site)?.checkout"><span class="material-symbols-rounded" style="font-size:12px;vertical-align:middle;line-height:1;color:#16a34a">circle</span> 出勤 {{ attendanceFor(r, site)?.checkin ?? '—' }} / 退勤 {{ attendanceFor(r, site)?.checkout ?? '—' }}</template>
              <span v-else class="no-punch">打刻なし</span>
            </span>
            <!-- ★実打刻と作業時刻（＝人件費の根拠）のズレ。2026-08-10 の電話で
                 「実際打った時間と、管理者が決めた8時半・6時と…それが出てくればそれでいい」。
                 実打刻と作業時刻は既に上に出ているので、足りなかった『差』だけをここに出す。 -->
            <span v-for="d in punchDiffs(r, site)" :key="d.key" class="punch-diff"
              :class="{ big: d.big }" :data-testid="`punch-diff-${d.key}`">{{ d.label }}</span>
          </div>
        </div>
        <div class="card-actions">
          <button
            v-if="r.users?.worker_id"
            class="btn-grant-sm"
            :disabled="granting === r.id"
            :title="'この作業員のこの日を、申請なしで編集可にします'"
            @click.stop="issueEditGrant(r)"
          ><span v-if="grantedIds.has(r.id)"><span class="material-symbols-rounded" style="font-size:1em;vertical-align:middle;line-height:1">check</span> 編集許可済</span><span v-else-if="granting === r.id">発行中…</span><span v-else><span class="material-symbols-rounded" style="font-size:1em;vertical-align:middle;line-height:1">edit</span> 編集許可を発行</span></button>
          <button
            v-if="!HIDE_LINE_SECTIONS && !r.line_notified_at"
            class="btn-notify-sm"
            :disabled="notifying === r.id"
            @click.stop="sendNotification(r)"
          >{{ notifying === r.id ? '送信中...' : 'LINE通知' }}</button>
          <!-- 削除は誤操作防止のため一覧からは行わない。詳細（詳細→）を開いてから削除する -->
        </div>
      </div>
    </div>

    <!-- 詳細モーダル -->
    <div v-if="selected" class="modal-overlay" @click.self="selected = null">
      <div class="modal">
        <div class="modal-head">
          <div>
            <div class="modal-date">{{ selected.date }}</div>
            <div class="modal-worker">
              {{ selected.worker_name }}
              <span v-if="selected.sites?.[0]?.workers?.[0]?.workerRole" class="worker-role-inline">
                / {{ selected.sites[0].workers[0].workerRole === 'factory' ? '工場' : '現場' }}
              </span>
              <span v-if="canViewWages && selected.users?.workers?.daily_wage" class="unit-price-inline">
                ¥{{ selected.users.workers.daily_wage.toLocaleString() }}/日
              </span>
            </div>
          </div>
          <div class="modal-head-right">
            <span class="badge" :class="selected.leave_type === 'paid_leave' ? 'paid-leave' : selected.is_working ? 'working' : 'off'">
              {{ selected.leave_type === 'paid_leave' ? '有給' : selected.is_working ? '稼働' : '休み' }}
            </span>
            <button class="btn-delete" @click="deleteArmed = true">削除</button>
            <button class="btn-close" @click="selected = null">✕</button>
          </div>
        </div>

        <!-- 削除は2段階（誤操作防止）：元に戻せない旨を明示してから確定 -->
        <div v-if="deleteArmed" class="delete-confirm">
          <span class="delete-confirm-msg"><span class="material-symbols-rounded" style="font-size:1em;vertical-align:middle;line-height:1">warning</span> この日報を削除すると<b>元に戻せません</b>（工数・経費・添付も消えます）。本当に削除しますか？</span>
          <div class="delete-confirm-actions">
            <button class="btn-delete" :disabled="deleting" @click="doDeleteFromModal">{{ deleting ? '削除中…' : 'この日報を削除する' }}</button>
            <button class="btn-cancel-sm" @click="deleteArmed = false">キャンセル</button>
          </div>
        </div>

        <div v-if="selected.leave_type === 'paid_leave'" class="off-note">有給休暇（8h）</div>
        <div v-else-if="!selected.is_working" class="off-note">この日は休みです</div>

        <div v-else>
          <div v-for="(site, si) in selected.sites" :key="si" class="site-block">
            <div class="site-block-title">
              {{ resolveSiteName(site) }}
              <span v-if="resolveContractorName(site)" class="contractor-tag"><span class="material-symbols-rounded" style="font-size:1em;vertical-align:middle;line-height:1">apartment</span> {{ resolveContractorName(site) }}</span>
              <span class="attendance-tag">
                <span class="material-symbols-rounded" style="font-size:12px;vertical-align:middle;line-height:1;color:#16a34a">circle</span> 出勤 {{ attendanceFor(selected, site)?.checkin ?? '—' }} / 退勤 {{ attendanceFor(selected, site)?.checkout ?? '—' }}
              </span>
            </div>

            <!-- 作業員 -->
            <div v-if="site.workers?.length" class="section">
              <div class="section-label">稼働</div>
              <table class="inner-table">
                <thead>
                  <tr><th>開始</th><th>終了</th><th>休憩</th><th>通常</th><th>残業<span class="rate-note">(×1.25)</span></th><th>深夜<span class="rate-note">(×1.25)</span></th></tr>
                </thead>
                <tbody>
                  <template v-for="(w, wi) in site.workers" :key="wi">
                    <tr>
                      <td>{{ w.startTime }}</td>
                      <td>{{ w.endTime }}</td>
                      <template v-if="w.startTime && w.endTime">
                        <td>{{ effectiveBreakMinutes(w) / 60 }}</td>
                        <td>{{ calcHours(w).normal }}</td>
                        <td>{{ calcHours(w).ot }}</td>
                        <td>{{ calcHours(w).night }}</td>
                      </template>
                      <template v-else>
                        <td>—</td><td>—</td><td>—</td><td>—</td>
                      </template>
                    </tr>
                  </template>
                </tbody>
              </table>
              <div v-if="canViewWages && selected.users?.workers?.daily_wage" class="labor-cost">
                人件費
                <span class="labor-cost-amount">
                  ¥{{ site.workers.reduce((sum: number, w: any) => sum + (w.startTime && w.endTime ? calcLaborCost(w, selected.users.workers.daily_wage) : 0), 0).toLocaleString() }}
                </span>
              </div>
              <!-- 出張費（別費目・人件費とは別表示／主たる現場に1回） -->
              <div v-if="siteTripYen(site)" class="labor-cost">
                出張費
                <span class="labor-cost-amount">¥{{ siteTripYen(site).toLocaleString() }}</span>
              </div>
            </div>

            <!-- 下請け業者 -->
            <div v-if="site.subcontractors?.filter((s: any) => s.subcontractorName).length" class="section">
              <div class="section-label">協力業者</div>
              <div v-for="(s, si2) in site.subcontractors.filter((s: any) => s.subcontractorName)" :key="si2" class="sub-row">
                <span>{{ s.subcontractorName === '__other__' ? (s.customSubcontractorName || '新規業者') : s.subcontractorName }}</span>
                <span class="muted">{{ s.count }}名</span>
                <span v-if="subMaster[s.subcontractorName === '__other__' ? (s.customSubcontractorName || '') : s.subcontractorName]?.unit_price" class="sub-cost">
                  ¥{{ (subMaster[s.subcontractorName === '__other__' ? (s.customSubcontractorName || '') : s.subcontractorName].unit_price! * s.count).toLocaleString() }}
                </span>
              </div>
              <!-- 合計 -->
              <div class="labor-cost">
                協力業者費合計
                <span class="labor-cost-amount">
                  ¥{{ site.subcontractors.filter((s: any) => s.subcontractorName)
                    .reduce((sum: number, s: any) => {
                      const key = s.subcontractorName === '__other__' ? (s.customSubcontractorName || '') : s.subcontractorName
                      return sum + (subMaster[key]?.unit_price ?? 0) * (s.count ?? 0)
                    }, 0)
                    .toLocaleString() }}
                </span>
              </div>
            </div>

            <!-- 経費 -->
            <div v-if="hasExpenses(site.expenses)" class="section">
              <div class="section-label">経費</div>
              <div v-for="(veh, vi) in site.expenses?.vehicles?.filter((v: any) => v.vehicleName)" :key="'v'+vi" class="expense-row">
                <span class="exp-cat">車両</span>
                <span>{{ veh.vehicleName }}</span>
                <span v-if="veh.distanceKm" class="muted">ガソリン {{ veh.distanceKm }}km</span>
                <span v-if="veh.dieselKm" class="muted">軽油 {{ veh.dieselKm }}km</span>
                <span v-if="veh.parkingYen" class="muted">駐車 ¥{{ veh.parkingYen.toLocaleString() }}</span>
                <span v-if="veh.highwayYen" class="muted">高速 ¥{{ veh.highwayYen.toLocaleString() }}</span>
              </div>
              <div v-if="site.expenses?.vehicleUrls?.length" class="receipt-urls">
                <a v-for="(url, ui) in site.expenses.vehicleUrls" :key="ui" :href="url" target="_blank" rel="noopener" class="receipt-link"><span class="material-symbols-rounded" style="font-size:16px;vertical-align:middle;line-height:1">attach_file</span>車両領収書{{ site.expenses.vehicleUrls.length > 1 ? ui + 1 : '' }}</a>
              </div>
              <div v-for="(tr, ti) in site.expenses?.trains?.filter((t: any) => t.yen)" :key="'t'+ti" class="expense-row">
                <span class="exp-cat">電車</span>
                <span>{{ tr.label }}</span>
                <span class="muted">¥{{ tr.yen?.toLocaleString() }}</span>
              </div>
              <div v-if="site.expenses?.trainUrls?.length" class="receipt-urls">
                <a v-for="(url, ui) in site.expenses.trainUrls" :key="ui" :href="url" target="_blank" rel="noopener" class="receipt-link"><span class="material-symbols-rounded" style="font-size:16px;vertical-align:middle;line-height:1">attach_file</span>電車領収書{{ site.expenses.trainUrls.length > 1 ? ui + 1 : '' }}</a>
              </div>
              <!-- 宿泊費: 新形式 hotels[]（複数）。明細ごと領収書。 -->
              <template v-if="site.expenses?.hotels?.some((h: any) => h.yen)">
                <template v-for="(ho, hi) in site.expenses.hotels.filter((h: any) => h.yen)" :key="'h'+hi">
                  <div class="expense-row">
                    <span class="exp-cat">宿泊</span>
                    <span>{{ ho.label }}</span>
                    <span class="muted">¥{{ Number(ho.yen).toLocaleString() }}</span>
                  </div>
                  <div v-if="ho.fileUrls?.length" class="receipt-urls">
                    <a v-for="(url, ui) in ho.fileUrls" :key="ui" :href="url" target="_blank" rel="noopener" class="receipt-link"><span class="material-symbols-rounded" style="font-size:16px;vertical-align:middle;line-height:1">attach_file</span>宿泊領収書{{ ho.fileUrls.length > 1 ? ui + 1 : '' }}</a>
                  </div>
                </template>
              </template>
              <!-- 旧スカラー（後方互換） -->
              <template v-else>
                <div v-if="site.expenses?.hotelYen" class="expense-row">
                  <span class="exp-cat">宿泊</span>
                  <span>{{ site.expenses.hotelName }}</span>
                  <span class="muted">¥{{ site.expenses.hotelYen.toLocaleString() }}</span>
                </div>
                <div v-if="site.expenses?.hotelUrls?.length" class="receipt-urls">
                  <a v-for="(url, ui) in site.expenses.hotelUrls" :key="ui" :href="url" target="_blank" rel="noopener" class="receipt-link"><span class="material-symbols-rounded" style="font-size:16px;vertical-align:middle;line-height:1">attach_file</span>宿泊領収書{{ site.expenses.hotelUrls.length > 1 ? ui + 1 : '' }}</a>
                </div>
                <div v-if="site.expenses?.leopalaceYen" class="expense-row">
                  <span class="exp-cat">宿泊</span>
                  <span>{{ site.expenses.leopalaceName }}</span>
                  <span class="muted">¥{{ site.expenses.leopalaceYen.toLocaleString() }}</span>
                </div>
                <div v-if="site.expenses?.leopalaceUrls?.length" class="receipt-urls">
                  <a v-for="(url, ui) in site.expenses.leopalaceUrls" :key="ui" :href="url" target="_blank" rel="noopener" class="receipt-link"><span class="material-symbols-rounded" style="font-size:16px;vertical-align:middle;line-height:1">attach_file</span>レオパレス領収書{{ site.expenses.leopalaceUrls.length > 1 ? ui + 1 : '' }}</a>
                </div>
              </template>
              <div v-for="(ot, oi) in site.expenses?.others?.filter((o: any) => o.yen)" :key="'o'+oi">
                <div class="expense-row">
                  <span class="exp-cat">その他</span>
                  <span>{{ ot.label }}</span>
                  <span class="muted">¥{{ ot.yen?.toLocaleString() }}</span>
                </div>
                <div v-if="(ot as any).fileUrls?.length" class="receipt-urls">
                  <a v-for="(url, ui) in (ot as any).fileUrls" :key="ui" :href="url" target="_blank" rel="noopener" class="receipt-link"><span class="material-symbols-rounded" style="font-size:16px;vertical-align:middle;line-height:1">attach_file</span>{{ ot.label || 'その他' }}領収書{{ (ot as any).fileUrls.length > 1 ? ui + 1 : '' }}</a>
                </div>
              </div>
              <div v-if="site.expenses?.otherUrls?.length && !site.expenses?.others?.some((o: any) => o.fileUrls?.length)" class="receipt-urls">
                <a v-for="(url, ui) in site.expenses.otherUrls" :key="ui" :href="url" target="_blank" rel="noopener" class="receipt-link"><span class="material-symbols-rounded" style="font-size:16px;vertical-align:middle;line-height:1">attach_file</span>その他領収書{{ site.expenses.otherUrls.length > 1 ? ui + 1 : '' }}</a>
              </div>
              <div v-for="(ent, ei) in site.expenses?.entertainments?.filter((e: any) => e.yen)" :key="'e'+ei">
                <div class="expense-row">
                  <span class="exp-cat">雑経費</span>
                  <span>{{ ent.label }}</span>
                  <span class="muted">¥{{ ent.yen?.toLocaleString() }}</span>
                </div>
                <div v-if="(ent as any).fileUrls?.length" class="receipt-urls">
                  <a v-for="(url, ui) in (ent as any).fileUrls" :key="ui" :href="url" target="_blank" rel="noopener" class="receipt-link"><span class="material-symbols-rounded" style="font-size:16px;vertical-align:middle;line-height:1">attach_file</span>{{ ent.label || '雑経費' }}領収書{{ (ent as any).fileUrls.length > 1 ? ui + 1 : '' }}</a>
                </div>
              </div>
              <template v-if="site.expenses?.entertainmentYen && !site.expenses?.entertainments?.some((e: any) => e.yen)">
                <div class="expense-row">
                  <span class="exp-cat">雑経費</span>
                  <span>{{ site.expenses.entertainmentLabel }}</span>
                  <span class="muted">¥{{ site.expenses.entertainmentYen.toLocaleString() }}</span>
                </div>
                <div v-if="site.expenses?.entertainmentUrls?.length" class="receipt-urls">
                  <a v-for="(url, ui) in site.expenses.entertainmentUrls" :key="ui" :href="url" target="_blank" rel="noopener" class="receipt-link"><span class="material-symbols-rounded" style="font-size:16px;vertical-align:middle;line-height:1">attach_file</span>雑経費領収書{{ site.expenses.entertainmentUrls.length > 1 ? ui + 1 : '' }}</a>
                </div>
              </template>
              <div v-if="site.expenses?.garbagePhotoUrls?.length" class="receipt-urls">
                <a v-for="(url, ui) in site.expenses.garbagePhotoUrls" :key="ui" :href="url" target="_blank" rel="noopener" class="receipt-link"><span class="material-symbols-rounded" style="font-size:16px;vertical-align:middle;line-height:1">attach_file</span>ゴミ写真{{ site.expenses.garbagePhotoUrls.length > 1 ? ui + 1 : '' }}</a>
              </div>
            </div>

            <!-- 現場備考 -->
            <div v-if="site.siteNote" class="section note-section">
              <div class="section-label">現場備考</div>
              <div class="note-text">{{ site.siteNote }}</div>
            </div>
          </div>

          <!-- 備考 -->
          <div v-if="selected.note" class="section note-section">
            <div class="section-label">備考</div>
            <div class="note-text">{{ selected.note }}</div>
          </div>
        </div>

        <!-- 編集理由の履歴（稼働/休みに関わらず出す）。1編集=1行で追記される -->
        <div v-if="editLogs.length" class="section edit-log-section" data-testid="edit-log-section">
          <div class="section-label">編集理由</div>
          <div v-for="lg in editLogs" :key="lg.id" class="edit-log" data-testid="edit-log-row">
            <div class="edit-log-head">
              <span class="edit-log-when">{{ formatEditedAt(lg.created_at) }}</span>
              <span v-if="lg.edited_by_name" class="edit-log-who">{{ lg.edited_by_name }}</span>
            </div>
            <div class="edit-log-reason">{{ lg.reason }}</div>
            <!-- 理由だけでは妥当性を判断できないので、何を変えたかも一緒に出す
                 （liff の computeDiff が返す差分テキストをそのまま保存している） -->
            <div v-if="lg.diffs?.length" class="edit-log-diffs">
              <span v-for="(d, di) in lg.diffs" :key="di" class="edit-log-diff">{{ d }}</span>
            </div>
          </div>
        </div>

        <!-- ★この日報の承認履歴（誰がいつ承認/差戻ししたか）への導線。
             編集理由は「何を直したか」、承認履歴は「それが通ったか」で別物なので分けて出す。 -->
        <div v-if="reviewHistoryCount" class="section" data-testid="review-history-link-section">
          <div class="section-label">承認履歴</div>
          <RouterLink
            class="review-history-link"
            data-testid="review-history-link"
            :to="{ path: '/report-edit-review', query: { reportId: selected.id } }"
          >この日報の承認履歴を見る（{{ reviewHistoryCount }}件） →</RouterLink>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted, watch } from 'vue'
import { supabase } from '../lib/supabase'
import { getAccountId, getAccountSlug } from '../lib/account'
import { useQueryParam } from '../composables/useQueryParam'
import { HIDE_LINE_SECTIONS } from '../lib/featureFlags'
import { effectiveBreakMinutes, laborBreakdownForReport, laborCostForBreakdown, ZERO_BREAKDOWN, businessTripMainEntries, BUSINESS_TRIP_ALLOWANCE, type RateBreakdown } from '../lib/workerHours'
import { canViewWages, currentUser } from '../lib/auth'
import { punchDiffLabel, isPunchDiffBig, isPunchDiffWorthShowing } from '../lib/attendance-punch.gen'

const EDGE_URL  = import.meta.env.VITE_SUPABASE_EDGE_URL as string
const ANON_KEY  = import.meta.env.VITE_SUPABASE_ANON_KEY as string

// 下請けマスタ（name → {unit_price, category}）
const subMaster = ref<Record<string, { unit_price: number | null; category: string | null }>>({})

// 作業員フィルター（複数選択）。URL ?worker=A,B に同期（リロード/共有で復元・単一指定の旧リンクもそのまま動く）
const workerParam    = useQueryParam('worker', '')
const workerOptions  = ref<string[]>([])
const workerMenuOpen = ref(false)

const selectedWorkers = computed<string[]>(() =>
  workerParam.value ? workerParam.value.split(',').map(s => s.trim()).filter(Boolean) : [])

/** 2人以上選んだら「行=日付・列=作業員」の比較ビューに切り替える（0/1人は従来のカード一覧） */
const compareMode = computed(() => selectedWorkers.value.length >= 2)

function toggleWorker(name: string) {
  const next = new Set(selectedWorkers.value)
  if (next.has(name)) next.delete(name); else next.add(name)
  // 列の並びをプルダウンの並び（五十音順）に揃える＝選んだ順で列が入れ替わらない
  workerParam.value = workerOptions.value.filter(w => next.has(w)).join(',')
}
function clearWorkers() {
  workerParam.value = ''
  workerMenuOpen.value = false
}

// 月ナビ
const now      = new Date()
const navYear  = ref(now.getFullYear())
const navMonth = ref(now.getMonth() + 1)

const dateFrom = computed(() => `${navYear.value}-${String(navMonth.value).padStart(2, '0')}-01`)
const dateTo   = computed(() => {
  const last = new Date(navYear.value, navMonth.value, 0)
  return `${navYear.value}-${String(navMonth.value).padStart(2, '0')}-${String(last.getDate()).padStart(2, '0')}`
})

function prevMonth() {
  if (navMonth.value === 1) { navYear.value--; navMonth.value = 12 }
  else navMonth.value--
  load()
}
function nextMonth() {
  if (navMonth.value === 12) { navYear.value++; navMonth.value = 1 }
  else navMonth.value++
  load()
}
const loading  = ref(false)
const deleting = ref(false)
const notifying = ref<string | null>(null)
// 取得した当月の全日報。作業員の絞り込みはここからクライアント側で行う（切り替えで再フェッチしない）
const allReports = ref<any[]>([])
const reports = computed<any[]>(() => selectedWorkers.value.length
  ? allReports.value.filter((r: any) => selectedWorkers.value.includes(r.worker_name))
  : allReports.value)
const selected = ref<any | null>(null)

// ── 編集理由の履歴（daily_report_edit_logs）──
//  liff で日報を編集した時に 1編集=1行 で追記される。日報を開いた時だけ読む
//  （一覧で全件JOINすると大半の日報にログが無く無駄が大きいため）。
const editLogs = ref<any[]>([])
// この日報に承認/差戻しの履歴が何件あるか。0件なら導線を出さない
// （出すと「履歴はまだありません」に飛ばすだけの空リンクになる）。
const reviewHistoryCount = ref(0)
watch(selected, async (r) => {
  editLogs.value = []
  reviewHistoryCount.value = 0
  if (!r?.id) return
  const accountId = await getAccountId()
  const [{ data, error }, { count }] = await Promise.all([
    supabase
      .from('daily_report_edit_logs')
      .select('id, reason, diffs, edited_by_name, created_at')
      .eq('account_id', accountId)
      .eq('report_id', r.id)
      .order('created_at', { ascending: false }),
    supabase
      .from('daily_report_pending_edits')
      .select('id', { count: 'exact', head: true })
      .eq('account_id', accountId)
      .eq('report_id', r.id)
      .in('status', ['approved', 'rejected']),
  ])
  if (error) { console.error('[reports] 編集理由の取得に失敗:', error); return }
  // 開き直しの競合で古い日報のログが残らないように、取得後に対象が変わっていないか確認する
  if (selected.value?.id === r.id) {
    editLogs.value = data ?? []
    reviewHistoryCount.value = count ?? 0
  }
})

/** 編集日時。日付をまたいだ編集が分かるよう日付ごと出す */
function formatEditedAt(iso: string | null): string {
  if (!iso) return '—'
  const d = new Date(iso)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
}

// 比較ビュー: 行=日付（降順・一覧の並びと同じ）／セル=その作業員のその日の日報（重複ユーザー行があれば複数）
const compareDates = computed<string[]>(() =>
  [...new Set(reports.value.map((r: any) => r.date))].sort((a, b) => b.localeCompare(a)))
function reportsFor(date: string, worker: string): any[] {
  return reports.value.filter((r: any) => r.date === date && r.worker_name === worker)
}

// 管理者から編集許可を発行：この日報の worker×date に approved grant を作成し、申請なしで編集可にする。
//  （日報の間違いを見ながらその場で許可を出せる。作業員側は既存の realtime/ポーリングで自動反映）
const granting   = ref<string | null>(null)
const grantedIds = ref<Set<string>>(new Set())
async function issueEditGrant(r: any) {
  const workerId = r.users?.worker_id
  if (!workerId || !r.date) return
  if (!confirm(`${r.worker_name ?? 'この作業員'} の ${r.date} の日報に編集許可を発行します。よろしいですか？\n（この作業員は申請なしでこの日を再編集できるようになります）`)) return
  granting.value = r.id
  try {
    const accountId = await getAccountId()
    const email = currentUser.value?.email ?? null
    const now = new Date().toISOString()
    // 同 worker×date の既存grantがあれば approved へ更新、無ければ approved で新規（DB一意制約なし）
    const { data: existing } = await supabase.from('report_edit_grants')
      .select('id').eq('account_id', accountId).eq('worker_id', workerId).eq('date', r.date).limit(1)
    let grantId: string | null = null
    if (existing && existing.length) {
      grantId = (existing[0] as any).id
      await supabase.from('report_edit_grants')
        .update({ status: 'approved', approved_by: email, decided_at: now }).eq('id', grantId)
    } else {
      const { data } = await supabase.from('report_edit_grants')
        .insert({ account_id: accountId, worker_id: workerId, date: r.date, status: 'approved', approved_by: email, decided_at: now, requested_at: now })
        .select('id').single()
      grantId = (data as any)?.id ?? null
    }
    grantedIds.value = new Set(grantedIds.value).add(r.id)
    // 通知メール送信（作業員がnotify_emailを登録していれば送信・失敗しても発行自体は成立済みなので握りつぶす）
    if (grantId) {
      supabase.functions.invoke('notify-edit-grant', { body: { grant_id: grantId } })
        .catch((e) => console.error('[notify-edit-grant]', e))
    }
  } catch (e) {
    alert('編集許可の発行に失敗しました')
  } finally {
    granting.value = null
  }
}

// 出退勤マップ: `${worker_id}|${date}|${現場名}` → { checkin, checkout }（HH:MM, JST）
const attendanceMap = ref<Record<string, { checkin?: string; checkout?: string }>>({})

// 削除は詳細モーダル内の2段階のみ（一覧からは不可・誤操作防止）
const deleteArmed = ref(false)
watch(selected, () => { deleteArmed.value = false })   // 別日報を開いた/閉じたら武装解除
async function doDeleteFromModal() {
  if (!selected.value) return
  await deleteReport(selected.value)   // 成功時に selected=null でモーダルを閉じる
  deleteArmed.value = false
}

const URL_KEYS = ['vehicleUrls', 'trainUrls', 'hotelUrls', 'leopalaceUrls', 'otherUrls', 'entertainmentUrls', 'garbagePhotoUrls'] as const

function extractStoragePaths(r: any): string[] {
  const paths: string[] = []
  const MARKER = '/expense-receipts/'
  for (const site of (r.sites ?? [])) {
    const exp = site.expenses ?? {}
    for (const key of URL_KEYS) {
      for (const url of (exp[key] ?? [])) {
        const idx = url.indexOf(MARKER)
        if (idx !== -1) paths.push(decodeURIComponent(url.slice(idx + MARKER.length)))
      }
    }
  }
  return paths
}

async function sendNotification(r: any) {
  if (!confirm(`${r.date} ${r.worker_name ?? ''} の日報をLINE通知しますか？`)) return
  notifying.value = r.id
  try {
    const res = await fetch(`${EDGE_URL}/resend-notifications`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${ANON_KEY}`,
      },
      body: JSON.stringify({ report_id: r.id, account_slug: getAccountSlug(), dry_run: false }),
    })
    const data = await res.json()
    if (data.count > 0) {
      r.line_notified_at = new Date().toISOString()
    } else {
      alert('送信に失敗しました: ' + JSON.stringify(data))
    }
  } catch (e) {
    alert('エラー: ' + String(e))
  } finally {
    notifying.value = null
  }
}

async function deleteReport(r: any) {
  deleting.value = true

  // Storage ファイルを先に削除
  const paths = extractStoragePaths(r)
  if (paths.length > 0) {
    const { error: storageError } = await supabase.storage.from('expense-receipts').remove(paths)
    if (storageError) console.error('[Storage削除]', storageError.message)
  }

  const { error } = await supabase.from('daily_reports').delete().eq('id', r.id)
  deleting.value = false
  if (error) { alert('削除に失敗しました: ' + error.message); return }
  allReports.value = allReports.value.filter(rep => rep.id !== r.id)
  if (selected.value?.id === r.id) selected.value = null
}

// 選択中の日報(=1人1日・全現場)の料率別時間。残業は「1日8時間超」で判定するため、
//  現場ごとに独立計算せず現場跨ぎで累積する（出面勤怠・現場別集計と同じルール）。
//  worker オブジェクトの参照で引く Map が返る。
const selectedBreakdown = computed<Map<any, RateBreakdown>>(() => {
  const r = selected.value
  if (!r) return new Map()
  const isSunday = new Date(r.date + 'T00:00:00').getDay() === 0
  return laborBreakdownForReport(r.sites ?? [], isSunday)
})

function calcHours(w: any) {
  const h = selectedBreakdown.value.get(w) ?? ZERO_BREAKDOWN
  return {
    normal: h.hoursNormal + h.hoursSunday,
    ot:     h.hoursOT + h.hoursOTNight + h.hoursSundayOT + h.hoursSundayOTNight,
    night:  h.hoursNight + h.hoursOTNight + h.hoursSundayNight + h.hoursSundayOTNight,
  }
}

// 出張費（別費目）: その日が出張で、この現場が作業員の主たる現場(最長稼働)なら ¥3,000/該当人。
function siteTripYen(site: any): number {
  if (!selected.value?.is_business_trip) return 0
  const mains = businessTripMainEntries(selected.value.sites ?? [])
  let n = 0
  for (const w of (site.workers ?? [])) if (mains.has(w)) n++
  return n * BUSINESS_TRIP_ALLOWANCE
}
// 日報詳細は既定の日当ベース（日当/8h × 稼働時間）で人件費を表示（現場管理者も閲覧OK）
function calcLaborCost(w: any, dailyWage: number): number {
  return laborCostForBreakdown(selectedBreakdown.value.get(w) ?? ZERO_BREAKDOWN, dailyWage, 0, 'daily')
}

/**
 * その現場行に出す「ズレ」チップ。出勤/退勤それぞれ、実打刻と作業時刻の両方が揃った時だけ出す。
 * ★片方しか無い時に 0 や — を出さない（無いものを在るように見せない）。
 */
function punchDiffs(r: any, site: any): { key: string; label: string; big: boolean }[] {
  const att = attendanceFor(r, site)
  const w = site?.workers?.[0]
  if (!att || !w) return []
  const out: { key: string; label: string; big: boolean }[] = []
  for (const [key, actual, planned, jp] of [
    ['in', att.checkin, w.startTime, '出勤'],
    ['out', att.checkout, w.endTime, '退勤'],
  ] as const) {
    // ★15分未満は出さない。実運用では全員が数分ズレるので、出すと大きなズレが埋もれる。
    if (!isPunchDiffWorthShowing(actual, planned)) continue
    const label = punchDiffLabel(actual, planned)
    if (!label) continue
    out.push({ key, label: `${jp} ${label}`, big: isPunchDiffBig(actual, planned) })
  }
  return out
}

function resolveSiteName(site: any): string {
  const n = site.siteName ?? ''
  return n === '__other__' ? (site.customSiteName?.trim() || '新規現場') : (n || '(現場名なし)')
}

// ── 出退勤（実打刻）表示ヘルパー ──────────────────────────
const TZ = 'Asia/Tokyo'
function jstDate(iso: string): string {
  // YYYY-MM-DD（JST）。daily_reports.date と突き合わせる。
  return new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(new Date(iso))
}
function jstTime(iso: string): string {
  return new Intl.DateTimeFormat('en-GB', { timeZone: TZ, hour: '2-digit', minute: '2-digit' }).format(new Date(iso))
}
function attendanceFor(r: any, site: any): { checkin?: string; checkout?: string } | null {
  const wid = r.users?.worker_id
  if (!wid) return null
  return attendanceMap.value[`${wid}|${r.date}|${resolveSiteName(site)}`] ?? null
}

function resolveContractorName(site: any): string {
  const n = site.contractorName ?? ''
  return n === '__other__' ? (site.customContractorName?.trim() || '新規元請け') : n
}

function hasExpenses(exp: any): boolean {
  if (!exp) return false
  return !!(
    exp.vehicles?.some((v: any) => v.vehicleName) ||
    exp.trains?.some((t: any) => t.yen) ||
    exp.hotels?.some((h: any) => h.yen) ||
    exp.hotelYen ||
    exp.leopalaceYen ||
    exp.others?.some((o: any) => o.yen) ||
    exp.entertainmentYen ||
    exp.garbagePhotoUrls?.length
  )
}

async function load() {
  loading.value = true
  const accountId = await getAccountId()

  // 下請けマスタ取得
  const { data: subs } = await supabase
    .from('subcontractors')
    .select('name, unit_price, category')
    .eq('account_id', accountId)
  subMaster.value = Object.fromEntries(
    (subs ?? []).map((s: any) => [s.name, { unit_price: s.unit_price, category: s.category }])
  )

  const { data } = await supabase
    .from('daily_reports')
    .select('id, date, is_working, is_business_trip, leave_type, line_notified_at, sites, note, user_id, users(real_name, worker_id, workers(name, daily_wage, hourly_wage))')
    .eq('account_id', accountId)
    .gte('date', dateFrom.value)
    .lte('date', dateTo.value)
    .order('date', { ascending: false })
    .limit(5000) // 1ヶ月×全作業員（数十人）で200件超→古い日付が溢れて消えるため余裕を持たせる

  const mapped = (data ?? []).map((r: any) => ({
    ...r,
    worker_name: r.users?.workers?.name ?? r.users?.real_name ?? '—',
  }))

  // 出退勤（実打刻）を取得して現場ごとにマップ化
  // attendance_logs には account_id が無いため worker_id 集合で隔離する。
  const workerIds = [...new Set(mapped.map((r: any) => r.users?.worker_id).filter(Boolean))]
  const map: Record<string, { checkin?: string; checkout?: string }> = {}
  if (workerIds.length > 0) {
    // JST の月初〜月末を UTC(Z) に変換して渡す（フィルタ値に '+' を含めると
    // URL 上でスペース解釈され timestamp パースエラーになるため toISOString を使う）
    const loUtc = new Date(`${dateFrom.value}T00:00:00+09:00`).toISOString()
    const hiUtc = new Date(`${dateTo.value}T23:59:59+09:00`).toISOString()
    const { data: logs } = await supabase
      .from('attendance_logs')
      .select('worker_id, type, checked_at, sites(name)')
      .in('worker_id', workerIds)
      .gte('checked_at', loUtc)
      .lte('checked_at', hiUtc)
      .order('checked_at', { ascending: true })
      .limit(5000) // 1ヶ月×全作業員(出退勤で1日2件以上)で上限(既定1000)超による欠落防止（daily_reportsクエリと同じ余裕）
    for (const log of (logs ?? []) as any[]) {
      const siteName = log.sites?.name
      if (!siteName) continue
      const key = `${log.worker_id}|${jstDate(log.checked_at)}|${siteName}`
      const entry = map[key] ?? (map[key] = {})
      // order asc のため checkin は最早を保持（上書きしない）、checkout は最遅を保持（上書き）
      if (log.type === 'checkin') { if (!entry.checkin) entry.checkin = jstTime(log.checked_at) }
      else if (log.type === 'checkout') { entry.checkout = jstTime(log.checked_at) }
    }
  }
  attendanceMap.value = map

  // 作業員プルダウン選択肢を更新（五十音順）
  const names = [...new Set(mapped.map((r: any) => r.worker_name).filter((n: string) => n && n !== '—'))]
  workerOptions.value = names.sort((a: string, b: string) => a.localeCompare(b, 'ja'))

  allReports.value = mapped
  loading.value = false
}

onMounted(load)

// 作業員メニューは外側クリックで閉じる（ボタン/メニュー内は @click.stop で伝播を止めている）
function closeWorkerMenu() { workerMenuOpen.value = false }
onMounted(() => document.addEventListener('click', closeWorkerMenu))
onUnmounted(() => document.removeEventListener('click', closeWorkerMenu))
</script>

<style scoped>
.page-title { font-size: 22px; font-weight: 700; margin-bottom: 24px; }
.filters { display: flex; gap: 16px; align-items: center; margin-bottom: 24px; flex-wrap: wrap; }
.input { background: #fff; border: 1px solid #e0e0e0; border-radius: 8px; padding: 9px 14px; font-size: 14px; }
/* 作業員フィルタ（複数選択） */
.worker-filter { position: relative; }
.worker-filter-btn { min-width: 200px; max-width: 620px; cursor: pointer; display: flex; align-items: center; gap: 8px; text-align: left; }
.worker-filter-placeholder { color: #888; }
.chips { display: flex; flex-wrap: wrap; gap: 6px; flex: 1; min-width: 0; }
.chip { display: inline-flex; align-items: center; gap: 4px; background: #e8f9ef; color: #067a3a; border-radius: 999px; padding: 2px 6px 2px 10px; font-size: 13px; }
.chip-remove { font-size: 15px; cursor: pointer; color: #4b9c72; }
.chip-remove:hover { color: #b91c1c; }
.caret { margin-left: auto; color: #888; font-size: 20px; }
.worker-menu { position: absolute; z-index: 30; top: calc(100% + 6px); left: 0; min-width: 240px; max-height: 320px; overflow-y: auto; background: #fff; border: 1px solid #e0e0e0; border-radius: 10px; box-shadow: 0 6px 24px rgba(0,0,0,.12); padding: 6px; }
.worker-menu-item { display: flex; align-items: center; gap: 8px; padding: 8px 10px; border-radius: 6px; font-size: 14px; cursor: pointer; }
.worker-menu-item:hover { background: #f5f5f5; }
.worker-menu-empty { padding: 12px 10px; color: #888; font-size: 13px; }
.worker-menu-clear { width: 100%; margin-top: 4px; background: none; border: none; border-top: 1px solid #eee; color: #888; font-size: 13px; padding: 8px; cursor: pointer; }
.worker-menu-clear:hover { color: #b91c1c; }

/* 比較ビュー（行=日付・列=作業員） */
.compare-wrap { overflow-x: auto; background: #fff; border-radius: 12px; box-shadow: 0 1px 4px rgba(0,0,0,.06); }
.compare-table { border-collapse: collapse; width: 100%; }
.compare-table th, .compare-table td { border-bottom: 1px solid #eee; border-right: 1px solid #eee; padding: 10px 14px; vertical-align: top; text-align: left; }
.compare-table th { background: #fafafa; font-size: 13px; font-weight: 700; position: sticky; top: 0; z-index: 1; }
.compare-table th:last-child, .compare-table td:last-child { border-right: none; }
.compare-date-col { width: 72px; white-space: nowrap; font-size: 13px; font-weight: 700; color: #555; background: #fafafa; }
.compare-cell { min-width: 220px; }
.compare-entry + .compare-entry { margin-top: 10px; padding-top: 10px; border-top: 1px dashed #e0e0e0; }
.compare-entry-head { display: flex; align-items: center; gap: 8px; cursor: pointer; }
.compare-sites { margin-top: 6px; cursor: pointer; }
.compare-site-row { display: flex; flex-wrap: wrap; gap: 8px; align-items: baseline; padding: 2px 0; font-size: 13px; }
.compare-actions { display: flex; gap: 4px; margin-top: 6px; }
.compare-none { color: #bbb; font-size: 13px; }
.icon-btn { background: none; border: 1px solid #e0e0e0; border-radius: 6px; width: 26px; height: 26px; display: inline-flex; align-items: center; justify-content: center; cursor: pointer; color: #666; }
.icon-btn:hover:not(:disabled) { background: #f5f5f5; border-color: #06C755; color: #06C755; }
.icon-btn:disabled { opacity: .5; cursor: default; }
.icon-btn .material-symbols-rounded { font-size: 16px; }
.month-nav { display: flex; align-items: center; gap: 12px; background: #f5f5f5; border-radius: 10px; padding: 6px 12px; }
.month-btn { background: #fff; border: 1px solid #e0e0e0; border-radius: 8px; width: 32px; height: 32px; font-size: 18px; cursor: pointer; display: flex; align-items: center; justify-content: center; color: #333; transition: background .15s; }
.month-btn:hover { background: #e8f9ef; border-color: #06C755; }
.month-label { font-size: 16px; font-weight: 700; min-width: 100px; text-align: center; }
.empty { color: #888; padding: 40px; text-align: center; }
.report-list { display: flex; flex-direction: column; gap: 12px; }
.report-card { background: #fff; border-radius: 12px; padding: 16px 20px; box-shadow: 0 1px 4px rgba(0,0,0,.06); transition: box-shadow .15s; }
.report-card:hover { box-shadow: 0 4px 16px rgba(0,0,0,.1); }
.report-header { cursor: pointer; }
.card-actions { display: flex; justify-content: flex-end; margin-top: 10px; }
.btn-grant-sm { background: none; border: 1px solid #f0b429; color: #b45309; border-radius: 6px; padding: 4px 12px; font-size: 12px; cursor: pointer; }
.btn-grant-sm:hover:not(:disabled) { background: #fffbeb; }
.btn-grant-sm:disabled { opacity: .6; cursor: default; }
.btn-notify-sm { background: none; border: 1px solid #6db8e8; color: #1a7abf; border-radius: 6px; padding: 4px 12px; font-size: 12px; cursor: pointer; }
.btn-notify-sm:hover:not(:disabled) { background: #e8f4fd; }
.btn-notify-sm:disabled { opacity: .5; cursor: not-allowed; }
.btn-delete-sm { background: none; border: 1px solid #fca5a5; color: #dc2626; border-radius: 6px; padding: 4px 12px; font-size: 12px; cursor: pointer; }
.btn-delete-sm:hover { background: #fef2f2; }
.delete-confirm { background: #fef2f2; border: 1px solid #fca5a5; border-radius: 8px; padding: 12px 14px; margin: 0 0 12px; display: flex; flex-direction: column; gap: 10px; }
.delete-confirm-msg { font-size: 13px; color: #991b1b; line-height: 1.6; }
.delete-confirm-actions { display: flex; gap: 10px; }
.btn-cancel-sm { background: #fff; border: 1px solid #d1d5db; color: #374151; border-radius: 8px; padding: 6px 14px; font-size: 13px; cursor: pointer; }
.btn-delete { background: #dc2626; color: #fff; border: none; border-radius: 8px; padding: 6px 14px; font-size: 13px; font-weight: 700; cursor: pointer; }
.btn-delete:disabled { opacity: .6; }
.btn-delete:hover { background: #b91c1c; }
.report-header { display: flex; align-items: center; gap: 12px; }
.report-date { font-weight: 700; font-size: 15px; min-width: 100px; }
.report-worker { font-size: 14px; color: #555; flex: 1; }
.detail-hint { font-size: 12px; color: #aaa; }
.badge { font-size: 11px; padding: 3px 8px; border-radius: 4px; font-weight: 700; }
.badge.working      { background: #e8fff0; color: #0a8a3a; }
.badge.off          { background: #f5f5f5; color: #aaa; }
.badge.paid-leave   { background: #fff3e0; color: #e67e22; }
.badge.notified     { background: #e8f4fd; color: #1a7abf; }
.badge.not-notified { background: #fff0f0; color: #cc3333; }
.sites { margin-top: 12px; display: flex; flex-direction: column; gap: 6px; padding-left: 8px; border-left: 2px solid #06C755; }
.site-row { display: flex; gap: 16px; font-size: 13px; }
.site-name { font-weight: 600; }
.contractor-chip { font-size: 11px; color: #6b4eff; background: #eee9ff; border-radius: 4px; padding: 2px 8px; }
.contractor-tag { font-size: 12px; font-weight: 600; color: #6b4eff; margin-left: 8px; }
.attendance-tag { font-size: 12px; font-weight: 600; color: #0a8a3a; margin-left: 8px; font-variant-numeric: tabular-nums; }
.work-time { color: #1a7abf; font-weight: 600; font-variant-numeric: tabular-nums; }
.attendance { color: #0a8a3a; font-weight: 600; font-variant-numeric: tabular-nums; }
/* 実打刻と作業時刻のズレ。30分以上は色を変えて気づけるようにする */
.punch-diff { margin-left: 6px; font-size: 11px; font-weight: 700; color: #475569; background: #f1f5f9; border: 1px solid #e2e8f0; border-radius: 999px; padding: 1px 8px; white-space: nowrap; font-variant-numeric: tabular-nums; }
.punch-diff.big { color: #b45309; background: #fef3c7; border-color: #fde68a; }
.no-punch { color: #94a3b8; font-weight: 500; }
.worker-count { color: #888; }

/* モーダル */
.modal-overlay { position: fixed; inset: 0; background: rgba(0,0,0,.5); display: flex; align-items: flex-start; justify-content: center; z-index: 100; padding: 40px 16px; overflow-y: auto; }
.modal { background: #fff; border-radius: 16px; width: 100%; max-width: 720px; padding: 32px; display: flex; flex-direction: column; gap: 20px; }
.modal-head { display: flex; justify-content: space-between; align-items: flex-start; }
.modal-date { font-size: 20px; font-weight: 900; }
.modal-worker { font-size: 15px; color: #555; margin-top: 4px; }
.modal-head-right { display: flex; align-items: center; gap: 12px; }
.btn-close { background: #f0f0f0; border: none; border-radius: 8px; padding: 6px 12px; font-size: 14px; cursor: pointer; }
.off-note { color: #888; font-size: 14px; text-align: center; padding: 24px 0; }
.site-block { border: 1px solid #eee; border-radius: 12px; overflow: hidden; margin-bottom: 16px; }
.site-block-title { background: #f9f9f9; padding: 10px 16px; font-weight: 700; font-size: 14px; border-bottom: 1px solid #eee; }
.section { padding: 12px 16px; border-top: 1px solid #f0f0f0; }
.section:first-child { border-top: none; }
.section-label { font-size: 11px; font-weight: 700; color: #06C755; text-transform: uppercase; letter-spacing: 1px; margin-bottom: 8px; }
.worker-name-row { font-weight: 700; font-size: 13px; padding-bottom: 2px !important; border-bottom: none !important; }
.worker-role-inline { margin-left: 6px; font-size: 11px; color: #888; font-weight: 400; }
.unit-price-inline { margin-left: 10px; font-size: 11px; color: #888; font-weight: 400; }
.labor-cost { display: flex; justify-content: flex-end; align-items: center; gap: 8px; margin-top: 8px; font-size: 12px; color: #888; font-weight: 600; }
.labor-cost-amount { font-size: 15px; font-weight: 700; color: #111; }
.rate-note { font-size: 10px; font-weight: 400; color: #aaa; margin-left: 2px; }
.inner-table { width: 100%; border-collapse: collapse; font-size: 13px; }
.inner-table th { background: #f9f9f9; padding: 6px 10px; text-align: left; font-size: 11px; color: #888; font-weight: 700; }
.inner-table td { padding: 8px 10px; border-top: 1px solid #f5f5f5; }
.sub-row { display: flex; gap: 12px; font-size: 13px; padding: 4px 0; align-items: center; }
.sub-unit-price { color: #aaa; font-size: 11px; margin-left: auto; }
.sub-cost { font-weight: 700; font-size: 13px; min-width: 80px; text-align: right; }
.expense-row { display: flex; gap: 10px; align-items: center; font-size: 13px; padding: 4px 0; border-top: 1px solid #f5f5f5; }
.expense-row:first-child { border-top: none; }
.exp-cat { font-size: 10px; background: #f0f0f0; color: #666; padding: 2px 6px; border-radius: 4px; font-weight: 700; flex-shrink: 0; }
.muted { color: #888; font-size: 12px; }
.note-section { background: #fafafa; }
.note-text { font-size: 14px; color: #333; white-space: pre-wrap; }

/* 編集理由の履歴 */
.edit-log-section { background: #fffbeb; border: 1px solid #fde68a; border-radius: 10px; padding: 12px 14px; }
.edit-log { padding: 8px 0; border-top: 1px solid #fde68a; }
.edit-log:first-of-type { border-top: none; padding-top: 0; }
.edit-log-head { display: flex; gap: 10px; align-items: baseline; font-size: 12px; color: #92400e; }
.edit-log-who { font-weight: 700; }
.edit-log-reason { font-size: 14px; color: #333; white-space: pre-wrap; margin-top: 2px; }
.edit-log-diffs { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 6px; }
.edit-log-diff { font-size: 12px; color: #555; background: #fff; border: 1px solid #e5e7eb; border-radius: 999px; padding: 2px 8px; }
.review-history-link { font-size: 13px; color: #2563eb; text-decoration: none; font-weight: 700; }
.review-history-link:hover { text-decoration: underline; }
.receipt-urls { display: flex; flex-wrap: wrap; gap: 6px; padding: 4px 0 8px; }
.receipt-link { font-size: 11px; color: #06C755; text-decoration: none; background: #e8fff0; padding: 2px 8px; border-radius: 4px; }
.receipt-link:hover { text-decoration: underline; }
</style>
