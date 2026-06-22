<template>
  <div>
    <div class="page-header">
      <h1 class="page-title">見積もり</h1>
      <RouterLink to="/estimates-list" class="back-link" data-testid="back-to-list">← 見積一覧へ</RouterLink>
    </div>

    <!-- 案件は一覧(/estimates-list)から開く前提。ここでは現在の案件名を表示し、新規作成のみ行う。 -->
    <div class="bar">
      <label>案件</label>
      <span v-if="projectId" class="current-project" data-testid="project-select">{{ currentProjectName }}</span>
      <span v-else class="muted" data-testid="project-select">一覧から案件を選ぶか、新規作成してください</span>
      <button v-if="!addingProject" class="btn-add" data-testid="new-project-toggle" @click="addingProject = true">＋ 新規案件</button>
      <template v-else>
        <input v-model="newProjectName" class="input" placeholder="新規案件名" data-testid="new-project-name" @keyup.enter="addProject" />
        <button class="btn-add" :disabled="!newProjectName.trim()" data-testid="add-project" @click="addProject">追加</button>
        <button class="btn-del" title="キャンセル" @click="addingProject = false; newProjectName = ''">×</button>
      </template>
      <span v-if="projectErr" class="err" data-testid="project-err">{{ projectErr }}</span>

      <!-- 案件に元請けを紐付け（見積書PDFの送信先になる。正式受注後に現場へ昇華する前段） -->
      <template v-if="projectId">
        <label>元請け</label>
        <select :value="currentContractorId || ''" class="input sel" :disabled="projectSaving" data-testid="project-contractor"
                @change="setProjectContractor(($event.target as HTMLSelectElement).value || null)">
          <option value="">（未設定）</option>
          <option v-for="c in contractors" :key="c.id" :value="c.id">{{ c.name }}</option>
        </select>
        <RouterLink to="/contractors" class="muted-link">元請け担当者を管理</RouterLink>
      </template>
    </div>

    <!-- E5 マスタ蓄積: 入力済み材料を予測変換候補に（案件選択前から常時ロード） -->
    <datalist id="est-materials">
      <option v-for="m in materials" :key="m.id" :value="m.name" />
    </datalist>

    <!-- 承認待ちの価格差分があれば、案件未選択でも気づけるよう上部に出す -->
    <div v-if="revisions.length" class="rev-alert" data-testid="rev-alert">
      🔔 価格表の承認待ち差分が {{ revisions.length }} 件あります（下の「⚙️ マスタ・取込設定」で承認）
    </div>

    <template v-if="projectId">
      <div class="grid">
        <!-- 明細入力 -->
        <section class="panel">
          <div class="panel-head">
            <h2>明細入力</h2>
            <button class="btn-add" data-testid="add-row" @click="addRow">＋ 行追加</button>
          </div>
          <table class="table">
            <thead>
              <tr><th>場所</th><th>工種</th><th>品名</th><th>単位</th><th class="num">数量</th><th>商社</th><th class="num">単価</th><th class="num">金額</th><th></th></tr>
            </thead>
            <tbody>
              <tr v-for="(r, i) in rows" :key="r.id ?? 'new' + i">
                <td><input v-model="r.location" class="input sm" :data-testid="`item-loc-${i}`" /></td>
                <td>
                  <select v-model="r.trade_id" class="input sm" :data-testid="`item-trade-${i}`">
                    <option :value="null">—</option>
                    <option v-for="t in trades" :key="t.id" :value="t.id">{{ t.name }}</option>
                  </select>
                </td>
                <td><input v-model="r.item_name" class="input" :data-testid="`item-name-${i}`" list="est-materials" autocomplete="off" @change="resolveMaterial(r)" @blur="resolveMaterial(r)" /></td>
                <td><input v-model="r.unit" class="input sm" :data-testid="`item-unit-${i}`" placeholder="m²/個 等" /></td>
                <td class="num"><input v-model.number="r.quantity" type="number" step="0.01" class="input sm num" :data-testid="`item-qty-${i}`" /></td>
                <td>
                  <select v-model="r.supplier_id" class="input sm" :data-testid="`item-supplier-${i}`" @change="onSupplierPick(r)">
                    <option :value="null">—</option>
                    <option v-for="p in pricesForMaterial(r.material_id)" :key="p.supplier_id" :value="p.supplier_id">{{ p.supplierName }} ¥{{ p.unit_price.toLocaleString('ja-JP') }}</option>
                  </select>
                </td>
                <td class="num"><input v-model.number="r.unit_price" type="number" class="input sm num" :data-testid="`item-price-${i}`" /></td>
                <td class="num amount" :data-testid="`item-amount-${i}`">{{ yen(lineAmount(r)) }}</td>
                <td><button class="btn-del" @click="removeRow(i)">×</button></td>
              </tr>
              <tr v-if="rows.length === 0"><td colspan="9" class="empty">「＋ 行追加」で明細を入力</td></tr>
            </tbody>
          </table>
          <div class="actions-row">
            <button class="btn-primary" :disabled="saving" data-testid="save-items" @click="save">{{ saving ? '保存中…' : '保存' }}</button>
            <span v-if="saveError" class="err">{{ saveError }}</span>
            <span v-if="savedMsg" class="ok">{{ savedMsg }}</span>
          </div>
        </section>

        <!-- 工種別 自動集計（転記操作なし） -->
        <section class="panel">
          <div class="panel-head"><h2>工種別 内訳（自動）</h2></div>
          <table class="table">
            <thead><tr><th>工種</th><th class="num">金額</th></tr></thead>
            <tbody>
              <tr v-for="g in byTrade" :key="g.tradeId ?? 'none'">
                <td :data-testid="`trade-name-${g.key}`">{{ g.tradeName }}</td>
                <td class="num" :data-testid="`trade-total-${g.key}`">{{ yen(g.total) }}</td>
              </tr>
              <tr v-if="byTrade.length === 0"><td colspan="2" class="empty">明細なし</td></tr>
            </tbody>
            <tfoot>
              <tr class="grand"><td>合計</td><td class="num" data-testid="grand-total">{{ yen(grandTotal) }}</td></tr>
            </tfoot>
          </table>
        </section>
      </div>

      <!-- E2 帳票PDF: 見積書（表紙＋内訳書）。サンプル様式に準拠 -->
      <section class="panel pdf-panel" v-if="rows.length">
        <div class="panel-head">
          <h2>見積書PDF</h2>
          <div class="pager" data-testid="pdf-pager">
            <button class="pg-btn" :disabled="currentPage === 0" data-testid="pdf-prev" @click="prevPage">‹</button>
            <span class="pg-ind" data-testid="pdf-page-ind">{{ currentPage + 1 }} / {{ totalPages }} ページ</span>
            <button class="pg-btn" :disabled="currentPage >= totalPages - 1" data-testid="pdf-next" @click="nextPage">›</button>
          </div>
          <button class="btn-primary" :disabled="pdfBusy" data-testid="export-pdf" @click="exportPdf">{{ pdfBusy ? '生成中…' : 'PDF出力' }}</button>
        </div>
        <p v-if="!company.company_name" class="muted">自社情報が未登録です。<RouterLink to="/company-profile">自社情報</RouterLink>で会社名・住所・印影等を登録すると見積書に反映されます。</p>
        <!-- 見積書に出す案件情報（「保存」で明細と一緒に保存） -->
        <div class="doc-form">
          <div class="doc-field"><label>工事場所</label><input v-model="doc.construction_location" class="input" data-testid="doc-location" /></div>
          <div class="doc-field"><label>予定工期</label><input v-model="doc.period_text" class="input" placeholder="例: 着工〜2026/3" /></div>
          <div class="doc-field"><label>見積有効期限</label><input v-model="doc.valid_until" class="input" :placeholder="company.estimate_valid_until || '次回変更まで、もしくは3ヶ月'" /></div>
          <div class="doc-field"><label>端数調整（±円）</label><input v-model.number="doc.adjustment" type="number" class="input num" data-testid="doc-adjustment" /></div>
          <div class="doc-field wide"><label>MEMO</label><input v-model="doc.memo" class="input" /></div>
        </div>

        <div class="pdf-preview est-doc" ref="previewEl" data-testid="pdf-preview">
          <!-- ── 表紙（1ページ目: 全体の内容） ── -->
          <div class="est-cover" data-pdf-page v-show="exporting || currentPage === 0">
          <h1 class="est-title">御　見　積　書</h1>
          <div class="est-date">{{ todayWareki }}</div>
          <div class="est-client">{{ currentClient }}　様</div>
          <div class="est-head">
            <div class="est-amounts">
              <div class="welfare">法定福利費　{{ yen(welfare) }}</div>
              <div class="band"><span class="lbl">見積金額：</span><span class="big" data-testid="pdf-grandtotal">{{ yen(totalExclTax) }}</span><span class="rgt">消費税別</span></div>
              <div class="band sub"><span class="lbl">{{ yen(tax) }} <small>消費税{{ taxRate }}%</small></span><span class="big sm">{{ yen(totalInclTax) }}</span><span class="rgt">税込金額</span></div>
            </div>
            <div class="est-issuer">
              <div class="cname">{{ company.company_name || '（自社情報未登録）' }}</div>
              <div v-if="company.company_rep">{{ company.company_rep }}</div>
              <div v-if="company.company_address">住所： {{ company.company_address }}</div>
              <div v-if="company.company_tel">ＴＥＬ： {{ company.company_tel }}</div>
              <div v-if="company.company_fax">ＦＡＸ： {{ company.company_fax }}</div>
            </div>
            <table class="est-seal">
              <tr><th>会社</th><th>責任者</th><th>担当</th></tr>
              <tr><td><img v-if="sealUrl" :src="sealUrl" alt="印" /></td><td></td><td></td></tr>
            </table>
          </div>
          <div class="est-applied">上記の通り御見積申し上げます</div>
          <div class="est-cols">
            <div class="est-l">
              <div class="kv"><span>工事件名</span><b>{{ currentProjectName }}</b></div>
              <div class="kv"><span>工事場所</span><b>{{ doc.construction_location }}</b></div>
              <div class="kv"><span>予定工期</span><b>{{ doc.period_text }}</b></div>
              <div class="kv"><span>見積有効期限</span><b>{{ docValidUntil }}</b></div>
              <div class="sepn"><b>◆別途工事◆</b><br>{{ company.estimate_separate_note || '※見積書に記載なき工事は別途' }}</div>
            </div>
            <div class="est-r">
              <div class="rh">MEMO</div><div class="rb">{{ doc.memo }}</div>
              <div class="rh">◆支払条件◆</div><div class="rb pre">{{ company.estimate_payment_terms }}</div>
            </div>
          </div>
          </div><!-- /est-cover -->
          <!-- ── 内訳書（2ページ目〜: 工種ごとの集計・行単位で改ページ） ── -->
          <div v-for="(pg, pi) in breakdownPages" :key="'bd' + pi" class="est-bd" data-pdf-page v-show="exporting || currentPage === 1 + pi">
            <div class="bd-head"><span>内訳書<span v-if="breakdownPages.length > 1">（{{ pi + 1 }}/{{ breakdownPages.length }}）</span></span><span class="bd-date">{{ todayWareki }}</span></div>
            <table class="bd-table">
              <thead><tr><th>名　称</th><th>形状・寸法</th><th class="num">数量</th><th>単位</th><th class="num">単価</th><th class="num">金　額</th></tr></thead>
              <tbody>
                <tr v-for="g in pg" :key="g.key"><td>{{ g.tradeName }}</td><td></td><td></td><td></td><td></td><td class="num">{{ yen(g.total) }}</td></tr>
              </tbody>
              <tfoot v-if="pi === breakdownPages.length - 1">
                <tr><td colspan="5" class="r">小計</td><td class="num">{{ yen(subtotal) }}</td></tr>
                <tr><td>法定福利費</td><td>請負金額 × {{ welfareA }}％ × {{ welfareB }}％</td><td colspan="3"></td><td class="num">{{ yen(welfare) }}</td></tr>
                <tr v-if="adjustment"><td>端数調整</td><td colspan="4"></td><td class="num" :class="{ neg: adjustment < 0 }">{{ yen(adjustment) }}</td></tr>
                <tr class="bd-grand"><td colspan="5" class="r">合計</td><td class="num">{{ yen(totalExclTax) }}</td></tr>
              </tfoot>
            </table>
          </div>
          <!-- ── 工種別 明細（3ページ目以降: 各工種ごと・行単位で改ページ） ── -->
          <div v-for="(pg, pi) in detailPages" :key="'d' + pi" class="est-detail" data-pdf-page v-show="exporting || currentPage === detailBase + pi">
            <div class="dh">{{ pg.tradeName }}<span v-if="pg.parts > 1">（{{ pg.part }}/{{ pg.parts }}）</span>　<span class="dsub">小計 {{ yen(pg.total) }}</span></div>
            <table class="bd-table">
              <thead><tr><th>場所</th><th>明細</th><th class="num">数量</th><th>単位</th><th class="num">単価</th><th class="num">金額</th></tr></thead>
              <tbody>
                <tr v-for="(it, idx) in pg.items" :key="idx">
                  <td>{{ it.location }}</td><td>{{ it.item_name }}</td><td class="num">{{ it.quantity }}</td><td>{{ it.unit }}</td>
                  <td class="num">{{ yen(it.unit_price) }}</td><td class="num">{{ yen(lineAmount(it)) }}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>

        <!-- ③ 見積書PDFを元請けの担当者宛にメール送信＋履歴 -->
        <div class="send-block">
          <div class="sub-h">元請けへメール送信</div>
          <p v-if="!currentContractorId" class="muted">送信するには、上の「元請け」で案件の元請けを選んでください（担当者は<RouterLink to="/contractors">元請け業者マスタ</RouterLink>で登録）。</p>
          <template v-else>
            <div class="send-row">
              <span class="send-to">{{ currentContractorName }} 御中</span>
              <select v-model="sendContactId" class="input sm" data-testid="send-contact">
                <option :value="null" disabled>担当者を選択…</option>
                <option v-for="c in sendContacts" :key="c.id" :value="c.id">{{ c.name || '(担当者)' }}{{ c.email ? `（${c.email}）` : '（メール未登録）' }}</option>
              </select>
              <button class="btn-primary" :disabled="!canSend || sending" data-testid="send-estimate" @click="sendPdf">{{ sending ? '送信中…' : 'PDFを送信' }}</button>
            </div>
            <span v-if="!sendContacts.length" class="muted">この元請けには担当者が未登録です（<RouterLink to="/contractors">元請け業者マスタ</RouterLink>で登録してください）。</span>
            <span v-else-if="sendContactId && !sendEmail" class="err">この担当者はメール未登録です。送信できません。</span>
          </template>
          <span v-if="sendMsg" class="ok" data-testid="send-msg">{{ sendMsg }}</span>
          <span v-if="sendErr" class="err" data-testid="send-err">{{ sendErr }}</span>

          <div v-if="sends.length" class="send-history">
            <div class="sub-h">送信履歴</div>
            <table class="table">
              <thead><tr><th>日時</th><th>宛先</th><th>件名</th></tr></thead>
              <tbody>
                <tr v-for="s in sends" :key="s.id" :data-testid="`send-row-${s.id}`">
                  <td>{{ s.sent_at ? new Date(s.sent_at).toLocaleString('ja-JP') : `（記録のみ ${new Date(s.created_at).toLocaleString('ja-JP')}）` }}</td>
                  <td>{{ s.email_to || '—' }}</td>
                  <td>{{ s.subject || '—' }}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      </section>

      <!-- F2 商社へ発注（見積明細を商社ごとに分割→各商社の担当者へ発注書を送信） -->
      <section class="panel po-split" v-if="bySupplier.length">
        <div class="panel-head"><h2>商社へ発注（商社ごとに分割）</h2></div>
        <p class="muted">明細を商社ごとにまとめ、各商社の担当者へ発注書（PDF）をメール送信します。<span v-if="rowsWithoutSupplier">（商社未設定の明細 {{ rowsWithoutSupplier }} 件は対象外）</span></p>
        <p v-if="poMsg" class="ok" data-testid="po-msg">{{ poMsg }}</p>
        <p v-if="poErr" class="err" data-testid="po-err">{{ poErr }}</p>
        <div class="po-cards">
          <div v-for="g in bySupplier" :key="g.supplierId" class="po-card" :data-testid="`po-card-${g.supplierId}`">
            <div class="po-card-head">
              <span class="po-sup">{{ g.supplierName }}</span>
              <span class="po-tot">{{ g.items.length }}明細 ／ {{ yen(g.total) }}</span>
            </div>
            <select class="input sm" :value="poContactId(g.supplierId) || ''" :data-testid="`po-contact-${g.supplierId}`"
                    @change="poContactSel[g.supplierId] = ($event.target as HTMLSelectElement).value || null">
              <option value="">担当者を選択…</option>
              <option v-for="c in contactsFor(g.supplierId)" :key="c.id" :value="c.id">{{ c.name || '(担当者)' }}{{ c.email ? `（${c.email}）` : '（メール未登録）' }}</option>
            </select>
            <div class="po-status" v-if="poFor(g.supplierId)">
              <span v-if="poFor(g.supplierId)?.email_sent_at" class="badge-ok" :data-testid="`po-sent-${g.supplierId}`">送信済み {{ poFor(g.supplierId)?.order_number }}・{{ fmtDateTime(poFor(g.supplierId)?.email_sent_at) }}</span>
              <span v-else class="muted">発行済み {{ poFor(g.supplierId)?.order_number }}（未送信）</span>
              <a v-if="poFor(g.supplierId)?.pdf_path" :href="poPdfUrl(poFor(g.supplierId)!.pdf_path)" target="_blank" rel="noopener" class="pdf-link" :data-testid="`po-pdf-${g.supplierId}`">📄 PDFを表示/DL</a>
            </div>
            <div class="po-card-foot">
              <span v-if="!contactsFor(g.supplierId).length" class="muted">担当者未登録（<RouterLink to="/subcontractors">下請け業者マスタ</RouterLink>）</span>
              <button class="btn-primary sm" :disabled="!canSendPO(g) || poBusy === g.supplierId" :data-testid="`po-send-${g.supplierId}`" @click="sendPO(g)">
                {{ poBusy === g.supplierId ? '送信中…' : (poFor(g.supplierId)?.email_sent_at ? '再送' : '発注書を送信') }}
              </button>
            </div>
          </div>
        </div>
        <!-- 発注書PDF生成用（商社1社分・オフスクリーン） -->
        <div v-if="poTarget" ref="poPreviewEl" class="po-print">
          <h1 class="pdf-title">発 注 書</h1>
          <div class="pdf-meta">
            <div class="pdf-client">{{ poTarget.supplierName }} 御中</div>
            <div v-if="poTarget.contactName">ご担当：{{ poTarget.contactName }} 様</div>
            <div>案件：{{ currentProjectName }}</div>
            <div>発行日：{{ today }}</div>
          </div>
          <div class="pdf-total">御発注金額　{{ yen(poTarget.total) }}（税抜）</div>
          <table class="pdf-table">
            <thead><tr><th>品名</th><th class="num">数量</th><th>単位</th><th class="num">単価</th><th class="num">金額</th></tr></thead>
            <tbody>
              <tr v-for="(it, idx) in poTarget.items" :key="idx">
                <td>{{ it.item_name }}</td><td class="num">{{ it.quantity }}</td><td>{{ it.unit }}</td>
                <td class="num">{{ yen(it.unit_price) }}</td><td class="num">{{ yen(lineAmount(it)) }}</td>
              </tr>
            </tbody>
          </table>
          <div class="pdf-grand">合計　{{ yen(poTarget.total) }}（税抜）</div>
        </div>
      </section>
    </template>
    <p v-else class="hint">案件を選択または追加すると、明細入力と工種別内訳が表示されます。</p>

    <!-- ⚙️ マスタ・取込設定（たまに使う設定系をまとめて折りたたみ） -->
    <section class="panel settings-panel">
      <div class="settings-head">
        ⚙️ マスタ・取込設定
        <span v-if="revisions.length" class="badge-new">承認待ち {{ revisions.length }}</span>
      </div>

      <div class="settings-body">
        <div class="subtabs">
          <button class="subtab" :class="{ active: settingsTab === 'price' }" data-testid="subtab-price" @click="settingsTab = 'price'">商社別単価</button>
          <button class="subtab" :class="{ active: settingsTab === 'material' }" data-testid="subtab-material" @click="settingsTab = 'material'">材料マスタ</button>
          <button class="subtab" :class="{ active: settingsTab === 'trade' }" data-testid="subtab-trade" @click="settingsTab = 'trade'">工種</button>
        </div>
        <p v-if="masterErr" class="err">{{ masterErr }}</p>
        <!-- 工種マスタ クイック追加 -->
        <div class="setting-block" v-show="settingsTab === 'trade'">
          <h3>工種</h3>
          <div class="trade-add">
            <input v-model="newTradeName" class="input" placeholder="工種名（例: 軽鉄工事）" data-testid="new-trade-name" />
            <button class="btn-add" :disabled="!newTradeName.trim()" data-testid="add-trade" @click="addTrade">工種を追加</button>
          </div>
          <table v-if="trades.length" class="table" data-testid="trade-list">
            <thead><tr><th>工種</th><th></th></tr></thead>
            <tbody>
              <tr v-for="t in trades" :key="t.id" :data-testid="`trade-row-${t.id}`">
                <td>{{ t.name }}</td>
                <td><button class="btn-del" :data-testid="`trade-del-${t.id}`" @click="deleteTrade(t.id)">削除</button></td>
              </tr>
            </tbody>
          </table>
          <p v-else class="muted">工種はまだありません。</p>
        </div>

        <!-- 材料マスタ（品番・品名を別管理） -->
        <div class="setting-block" v-show="settingsTab === 'material'">
          <h3>材料マスタ（品番・品名）</h3>
          <p class="muted">品番と品名は別管理です。明細入力での品名捕捉（予測変換）でも自動で増えます。</p>
          <div class="trade-add">
            <input v-model="materialForm.code" class="input sm" placeholder="品番（任意）" data-testid="mat-code" />
            <input v-model="materialForm.name" class="input" placeholder="品名" data-testid="mat-name" />
            <input v-model="materialForm.unit" class="input sm" placeholder="単位" data-testid="mat-unit" />
            <button class="btn-add" :disabled="!materialForm.name.trim()" data-testid="mat-add" @click="addMaterial">材料を追加</button>
          </div>
          <table v-if="materials.length" class="table" data-testid="material-list">
            <thead><tr><th>品番</th><th>品名</th><th>単位</th><th></th></tr></thead>
            <tbody>
              <tr v-for="m in materials" :key="m.id" :data-testid="`mat-row-${m.id}`">
                <td>{{ m.code || '—' }}</td>
                <td>{{ m.name }}</td>
                <td>{{ m.unit || '—' }}</td>
                <td><button class="btn-del" :data-testid="`mat-del-${m.id}`" @click="deleteMaterial(m.id)">削除</button></td>
              </tr>
            </tbody>
          </table>
          <p v-else class="muted">材料はまだありません。</p>
        </div>

        <!-- 商社別単価（手入力 と 価格表OCR取込 を1ブロックに統合・商社タブが対象） -->
        <div class="setting-block" v-show="settingsTab === 'price'">
          <h3>商社別単価</h3>
          <p class="muted">商社は「下請け業者」マスタの<b>区分=商社</b>（<RouterLink to="/subcontractors">下請け業者</RouterLink>で登録）。<b>商社タブを選ぶ</b>と、その商社の単価の追加・一覧・取込が対象になります。</p>
          <!-- 商社タブ（対象商社の選択）＋このページから商社追加（横断不要） -->
          <div class="price-tabs">
            <button v-for="s in suppliers" :key="s.id" class="ptab" :class="{ active: activeSupplier === s.id }" :data-testid="`ptab-${s.id}`" @click="activeSupplier = s.id">{{ s.name }}</button>
            <button v-if="!addingSupplier" class="ptab ptab-add" data-testid="add-supplier-toggle" @click="addingSupplier = true">＋ 商社を追加</button>
            <template v-else>
              <input v-model="newSupplierName" class="input sm" placeholder="商社名" data-testid="new-supplier-name" @keyup.enter="addSupplier" />
              <button class="btn-add" :disabled="!newSupplierName.trim()" data-testid="add-supplier" @click="addSupplier">追加</button>
              <button class="btn-del" title="キャンセル" @click="addingSupplier = false; newSupplierName = ''">×</button>
            </template>
          </div>
          <p v-if="!suppliers.length && !addingSupplier" class="muted">まだ商社がありません。「＋ 商社を追加」で登録できます（下請け業者 区分=商社として保存）。</p>

          <template v-if="activeSupplier">
            <!-- 価格の追加（2方法を並べる） -->
            <div class="add-methods">
              <div class="method">
                <div class="method-label">手入力で1件ずつ</div>
                <div class="trade-add">
                  <select v-model="priceForm.material_id" class="input sm" data-testid="price-material">
                    <option :value="null" disabled>材料</option>
                    <option v-for="m in materials" :key="m.id" :value="m.id">{{ m.name }}</option>
                  </select>
                  <input v-model.number="priceForm.unit_price" type="number" class="input sm num" placeholder="単価" data-testid="price-value" />
                  <button class="btn-add" :disabled="!priceForm.material_id || !(priceForm.unit_price > 0)" data-testid="add-price" @click="addPrice">登録</button>
                </div>
              </div>
              <div class="method">
                <div class="method-label">価格表から取込（OCR）</div>
                <label class="btn-add" :class="{ disabled: ocrBusy }">
                  {{ ocrBusy ? '取込中…' : '単価表を取込（PDF/写真）' }}
                  <input type="file" accept="image/*,.pdf" hidden data-testid="ocr-file" :disabled="ocrBusy" @change="onOcrFile" />
                </label>
                <!-- 取込中の進捗（不安解消用：経過秒＋残り目安＋バー） -->
                <div v-if="ocrBusy" class="ocr-progress" data-testid="ocr-progress">
                  <div class="ocr-bar"><div class="ocr-bar-fill" :style="{ width: ocrPct + '%' }"></div></div>
                  <div class="ocr-status">
                    <span class="spin"></span>
                    <span>AIが読み取り中… <b>ページ {{ Math.min(ocrDone + 1, ocrTotal || 1) }}/{{ ocrTotal || 1 }}</b> ・ 経過{{ ocrElapsed }}秒 ／ {{ ocrEtaText }}</span>
                  </div>
                  <div class="muted">PDFはページごとに解析します。1ページ目の実測から残り時間を見積もります。</div>
                </div>
                <span class="muted">読み取った差分は下に出ます。<b>承認した分だけ</b>反映（自動反映なし）。</span>
                <span v-if="ocrError" class="err">{{ ocrError }}</span>
              </div>
            </div>

            <!-- 取込の承認待ち差分（この商社の分） -->
            <div v-if="revisionsFiltered.length" class="rev-section">
              <div class="sub-h">取込の承認待ち（{{ revisionsFiltered.length }}件）</div>
              <p class="muted">承認前に各項目を手修正できます。<b>紐付け先</b>で既存材料を選ぶと、商社ごとの品番/品名の揺れを吸収して同じ材料にまとめられます（次回の取込から自動一致）。</p>
              <table class="table">
                <thead><tr><th>品番</th><th>品名</th><th>紐付け先</th><th class="num">現行</th><th class="num">新単価</th><th>有効日</th><th></th></tr></thead>
                <tbody>
                  <tr v-for="r in revisionsFiltered" :key="r.id" :data-testid="`rev-${r.id}`">
                    <td><input v-model="r.code" class="input sm" :data-testid="`rev-code-${r.id}`" placeholder="品番" /></td>
                    <td><input v-model="r.name" class="input" :data-testid="`rev-name-${r.id}`" placeholder="品名" /></td>
                    <td>
                      <select v-model="r.material_id" class="input sm" :data-testid="`rev-material-${r.id}`">
                        <option :value="null">＋ 新規材料として作成</option>
                        <option v-for="m in materials" :key="m.id" :value="m.id">{{ m.name }}{{ m.code ? `（${m.code}）` : '' }}</option>
                      </select>
                    </td>
                    <td class="num">{{ r.old_price == null ? '—' : yen(r.old_price) }}</td>
                    <td class="num"><input v-model.number="r.new_price" type="number" class="input sm num" :data-testid="`rev-price-${r.id}`" /></td>
                    <td><input v-model="r.effective_date" type="date" class="input sm" :data-testid="`rev-date-${r.id}`" /></td>
                    <td class="actions">
                      <button class="btn-primary sm" :disabled="revBusy" :data-testid="`approve-${r.id}`" @click="approveRevision(r)">承認</button>
                      <button class="btn-del" :data-testid="`reject-${r.id}`" @click="rejectRevision(r)">却下</button>
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>

            <!-- 現行単価 一覧 -->
            <div class="sub-h">現行単価</div>
            <table v-if="priceListFiltered.length" class="table price-list" data-testid="price-list">
              <thead><tr><th>品番</th><th>品名</th><th class="num">単価</th><th>有効日</th><th></th></tr></thead>
              <tbody>
                <tr v-for="p in priceListFiltered" :key="p.id" :data-testid="`price-row-${p.id}`">
                  <td class="code">{{ p.materialCode || '—' }}</td>
                  <td>{{ p.materialName }}</td>
                  <td class="num"><input v-model.number="p.unit_price" type="number" class="input sm num" :data-testid="`price-val-${p.id}`" @change="savePrice(p)" /></td>
                  <td><input v-model="p.effective_date" type="date" class="input sm" :data-testid="`price-date-${p.id}`" @change="savePrice(p)" /></td>
                  <td><button class="btn-del" :data-testid="`price-del-${p.id}`" @click="deletePrice(p.id)">削除</button></td>
                </tr>
              </tbody>
            </table>
            <p v-else class="muted">「{{ activeSupplierName }}」の単価はまだありません。手入力か価格表取込で追加してください。</p>
          </template>
        </div>
      </div>
    </section>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch, onMounted, onUnmounted, nextTick } from 'vue'
import { onBeforeRouteLeave, useRoute } from 'vue-router'
import { jsPDF } from 'jspdf'
import html2canvas from 'html2canvas'
import { supabase } from '../lib/supabase'
import { getAccountId, getAccountSlug } from '../lib/account'

const BUCKET = 'expense-receipts'
const IS_DEV = import.meta.env.DEV
const route  = useRoute()   // 一覧から ?project=<id> で開いた案件を初期選択する

type Project  = { id: string; name: string; client_name: string | null; contractor_id: string | null }
type Contractor = { id: string; name: string }
type Trade    = { id: string; name: string }
type Material = { id: string; name: string; unit: string | null; code: string | null }
type Supplier = { id: string; name: string }
type MatPrice = { id: string; material_id: string; supplier_id: string; unit_price: number; effective_date: string | null }
type Contact  = { id: string; contractor_id: string; name: string | null; email: string | null }
type EstimateSend = { id: string; email_to: string | null; subject: string | null; sent_at: string | null; created_at: string }
type Row = {
  id: string | null
  location: string
  trade_id: string | null
  material_id: string | null
  supplier_id: string | null
  item_name: string
  unit: string
  quantity: number
  unit_price: number
}

const projects       = ref<Project[]>([])
const trades         = ref<Trade[]>([])
const materials      = ref<Material[]>([])
const suppliers      = ref<Supplier[]>([])
const matPrices      = ref<MatPrice[]>([])
const priceForm      = ref<{ material_id: string | null; unit_price: number | null }>({ material_id: null, unit_price: null })
const addingSupplier = ref(false)
const newSupplierName = ref('')
const masterErr      = ref('')
const materialForm   = ref<{ code: string; name: string; unit: string }>({ code: '', name: '', unit: '' })
// E4 価格表OCR取込＋差分承認
type Revision = { id: string; material_id: string | null; supplier_id: string | null; code: string | null; name: string | null; unit: string | null; old_price: number | null; new_price: number | null; effective_date: string | null; status: string }
const revisions   = ref<Revision[]>([])
const revBusy     = ref(false)
const settingsTab = ref<'price' | 'material' | 'trade'>('price')
const ocrBusy     = ref(false)
const ocrError    = ref('')
const ocrElapsed  = ref(0)        // 取込の経過秒
let   ocrTimer: ReturnType<typeof setInterval> | undefined
const ocrTotal    = ref(0)        // 総ページ数
const ocrDone     = ref(0)        // 処理済みページ数
const ocrPageStart = ref(0)       // 現ページ開始時の経過秒
const ocrAvgPageSec = ref(0)      // 済みページの平均所要秒（実測）
// 進捗バー: 済みページ＋現ページの推定進捗。1ページ目は実績無いので暫定15秒、以降は実測平均で正確化。
const ocrPct = computed(() => {
  if (!ocrTotal.value) return 0
  const avg = ocrDone.value > 0 ? ocrAvgPageSec.value : 15
  const cur = Math.max(0, ocrElapsed.value - ocrPageStart.value)
  const frac = Math.min(0.95, avg > 0 ? cur / avg : 0)
  return Math.min(98, Math.round(((ocrDone.value + frac) / ocrTotal.value) * 100))
})
const ocrEtaText = computed(() => {
  if (!ocrTotal.value) return '解析中…'
  const avg = ocrDone.value > 0 ? ocrAvgPageSec.value : 15
  const cur = Math.max(0, ocrElapsed.value - ocrPageStart.value)
  const remain = Math.max(0, Math.round(avg * (ocrTotal.value - ocrDone.value) - cur))
  return ocrDone.value > 0 ? `残り約${remain}秒` : '1ページ目を解析中…'
})
const projectId      = ref<string | null>(null)
const rows           = ref<Row[]>([])
const removedIds     = ref<string[]>([])
const newProjectName = ref('')
const addingProject  = ref(false)
const projectErr     = ref('')
const newTradeName   = ref('')
const saving         = ref(false)
const saveError      = ref('')
const savedMsg       = ref('')
let accountId = ''
// ③ 見積書PDFのメール送信（元請けの担当者宛）＋送信履歴
const contractors       = ref<Contractor[]>([])
const contractorContacts = ref<Contact[]>([])
const sends             = ref<EstimateSend[]>([])
const sendContactId     = ref<string | null>(null)
const sending           = ref(false)
const sendMsg           = ref('')
const sendErr           = ref('')
const projectSaving     = ref(false)   // 案件の元請け紐付け保存中
// F2 商社への発注（見積明細を商社ごとに分割して発注書を作成→各商社の担当者へ送信）
type SubContact = { id: string; subcontractor_id: string; name: string | null; email: string | null }
const subContacts   = ref<SubContact[]>([])
const projectPOs    = ref<any[]>([])                       // この案件の purchase_orders（estimate_project_id 一致）
const poContactSel  = ref<Record<string, string | null>>({}) // 商社ごとの送信先担当者の上書き選択
const poBusy        = ref<string | null>(null)             // 送信中の商社id
const poMsg         = ref('')
const poErr         = ref('')
const poPreviewEl   = ref<HTMLElement | null>(null)
const poTarget      = ref<null | { supplierName: string; contactName: string; items: Row[]; total: number }>(null)
// ④ 見積書フォーマット: 自社情報(settings) と 案件側の見積書項目
const COMPANY_KEYS = ['company_name', 'company_rep', 'company_address', 'company_tel', 'company_fax', 'company_seal_path', 'welfare_rate_a', 'welfare_rate_b', 'tax_rate', 'estimate_valid_until', 'estimate_payment_terms', 'estimate_separate_note']
const company = ref<Record<string, string>>({})
const doc     = ref<{ construction_location: string; period_text: string; valid_until: string; memo: string; adjustment: number }>(
  { construction_location: '', period_text: '', valid_until: '', memo: '', adjustment: 0 })

const yen = (n: number) => '¥' + Math.round(n || 0).toLocaleString('ja-JP')
const lineAmount = (r: Row) => (Number(r.quantity) || 0) * (Number(r.unit_price) || 0)

// 工種別の自動集計（明細を入れるだけで集計＝手コピペ撲滅）
const byTrade = computed(() => {
  const m = new Map<string, { tradeId: string | null; tradeName: string; total: number; key: string }>()
  for (const r of rows.value) {
    const tid = r.trade_id ?? null
    const name = tid ? (trades.value.find(t => t.id === tid)?.name ?? '(不明)') : '(工種未設定)'
    const key = tid ?? 'none'
    const cur = m.get(key) ?? { tradeId: tid, tradeName: name, total: 0, key }
    cur.total += lineAmount(r)
    m.set(key, cur)
  }
  return [...m.values()].sort((a, b) => a.tradeName.localeCompare(b.tradeName, 'ja'))
})
const grandTotal = computed(() => rows.value.reduce((s, r) => s + lineAmount(r), 0))

// E2 帳票PDF: 工種別に明細をまとめた印刷プレビュー用データ
const groupedDetailed = computed(() => {
  const m = new Map<string, { key: string; tradeName: string; total: number; items: Row[] }>()
  for (const r of rows.value) {
    const tid = r.trade_id ?? null
    const name = tid ? (trades.value.find(t => t.id === tid)?.name ?? '(不明)') : '(工種未設定)'
    const key = tid ?? 'none'
    const cur = m.get(key) ?? { key, tradeName: name, total: 0, items: [] as Row[] }
    cur.items.push(r); cur.total += lineAmount(r); m.set(key, cur)
  }
  return [...m.values()].sort((a, b) => a.tradeName.localeCompare(b.tradeName, 'ja'))
})
const previewEl = ref<HTMLElement | null>(null)
const pdfBusy = ref(false)
const today = new Date().toISOString().slice(0, 10)
// 見積書: 和暦の発行日（例: 令和8年6月15日）。サンプル様式に合わせる。
const todayWareki = computed(() => { const d = new Date(); return `令和${d.getFullYear() - 2018}年${d.getMonth() + 1}月${d.getDate()}日` })
// 自社情報・金額計算（小計→法定福利費→端数調整→合計税抜→消費税→税込）
const sealUrl  = computed(() => company.value.company_seal_path ? supabase.storage.from(BUCKET).getPublicUrl(company.value.company_seal_path).data.publicUrl : '')
const welfareA = computed(() => Number(company.value.welfare_rate_a) || 23)
const welfareB = computed(() => Number(company.value.welfare_rate_b) || 15)
const taxRate  = computed(() => Number(company.value.tax_rate) || 10)
const subtotal     = computed(() => grandTotal.value)                                          // 小計＝明細合計
const welfare      = computed(() => Math.round(subtotal.value * welfareA.value / 100 * welfareB.value / 100)) // 法定福利費
const adjustment   = computed(() => Number(doc.value.adjustment) || 0)                          // 端数調整(±)
const totalExclTax = computed(() => subtotal.value + welfare.value + adjustment.value)          // 合計(税抜)
const tax          = computed(() => Math.round(totalExclTax.value * taxRate.value / 100))       // 消費税
const totalInclTax = computed(() => totalExclTax.value + tax.value)                             // 税込
const docValidUntil = computed(() => doc.value.valid_until || company.value.estimate_valid_until || '')
// ページネーション: 行が途中で切れないよう行単位でページ分割（ヘッダーは各ページで繰り返す）
const BD_ROWS_PER_PAGE = 18      // 内訳書（工種別集計）の1ページ行数
const DETAIL_ROWS_PER_PAGE = 16  // 工種明細の1ページ行数
function chunk<T>(arr: T[], n: number): T[][] {
  const out: T[][] = []
  for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n))
  return out.length ? out : [[]]
}
// 内訳書ページ（工種集計を分割・合計欄は最終ページのみ）
const breakdownPages = computed(() => chunk(groupedDetailed.value, BD_ROWS_PER_PAGE))
// 工種明細ページ（各工種ごとに改ページ＋明細が多ければ続きページ）
const detailPages = computed(() => {
  const pages: { key: string; tradeName: string; total: number; items: Row[]; part: number; parts: number }[] = []
  for (const g of groupedDetailed.value) {
    const cs = chunk(g.items, DETAIL_ROWS_PER_PAGE)
    cs.forEach((items, i) => pages.push({ key: g.key, tradeName: g.tradeName, total: g.total, items, part: i + 1, parts: cs.length }))
  }
  return pages
})
// プレビューのページャ: 窓は1ページ分だけ表示し ‹ › で切替（PDF出力は全ページ）。
// ページ並び順: 0=表紙 / 1〜=内訳書 / その後=工種明細。
const currentPage  = ref(0)
const exporting    = ref(false)   // PDF生成中だけ全ページをDOM表示（html2canvas用）
const detailBase   = computed(() => 1 + breakdownPages.value.length)
const totalPages   = computed(() => 1 + breakdownPages.value.length + detailPages.value.length)
function prevPage() { if (currentPage.value > 0) currentPage.value-- }
function nextPage() { if (currentPage.value < totalPages.value - 1) currentPage.value++ }
// 明細が減ってページ数が縮んだら範囲内に丸める
watch(totalPages, (n) => { if (currentPage.value > n - 1) currentPage.value = Math.max(0, n - 1) })
const currentProjectName = computed(() => projects.value.find(p => p.id === projectId.value)?.name ?? '')
const currentProject   = computed(() => projects.value.find(p => p.id === projectId.value) ?? null)
const currentContractorId = computed(() => currentProject.value?.contractor_id ?? null)
const currentContractorName = computed(() => contractors.value.find(c => c.id === currentContractorId.value)?.name ?? '')
// PDFの宛名（御中）は元請けを優先、無ければ従来の client_name
const currentClient = computed(() => currentContractorName.value || (currentProject.value?.client_name ?? ''))

// ③ 送信先＝案件に紐づく元請けの担当者。元請けの担当者だけに絞り、メール未登録は送信不可。
const sendContacts = computed(() => contractorContacts.value.filter(c => c.contractor_id === currentContractorId.value))
const sendEmail    = computed(() => sendContacts.value.find(c => c.id === sendContactId.value)?.email || '')
const canSend      = computed(() => rows.value.length > 0 && !!currentContractorId.value && !!sendContactId.value && !!sendEmail.value)
// 案件に元請けを紐付け（estimate_projects.contractor_id を保存）
async function setProjectContractor(contractorId: string | null) {
  if (!projectId.value) return
  projectSaving.value = true
  try {
    await supabase.from('estimate_projects').update({ contractor_id: contractorId }).eq('id', projectId.value)
    const p = projects.value.find(x => x.id === projectId.value)
    if (p) p.contractor_id = contractorId
    // 元請けが変わったら送信先担当者を初期化（先頭）
    sendContactId.value = contractorContacts.value.find(c => c.contractor_id === contractorId)?.id ?? null
  } finally { projectSaving.value = false }
}

// F2 明細を商社(supplier_id)ごとにまとめる（商社ごとに1発注書）
const bySupplier = computed(() => {
  const m = new Map<string, { supplierId: string; supplierName: string; items: Row[]; total: number }>()
  for (const r of rows.value) {
    if (!r.supplier_id) continue
    const name = suppliers.value.find(s => s.id === r.supplier_id)?.name ?? '(商社)'
    const cur = m.get(r.supplier_id) ?? { supplierId: r.supplier_id, supplierName: name, items: [] as Row[], total: 0 }
    cur.items.push(r); cur.total += lineAmount(r); m.set(r.supplier_id, cur)
  }
  return [...m.values()].sort((a, b) => a.supplierName.localeCompare(b.supplierName, 'ja'))
})
const rowsWithoutSupplier = computed(() => rows.value.filter(r => !r.supplier_id).length)
function poFor(supplierId: string) { return projectPOs.value.find(p => p.subcontractor_id === supplierId) }
function contactsFor(supplierId: string) { return subContacts.value.filter(c => c.subcontractor_id === supplierId) }
// 送信先担当者: 上書き選択 → 既存発注の担当者 → 先頭、の順
function poContactId(supplierId: string): string | null {
  if (supplierId in poContactSel.value) return poContactSel.value[supplierId]
  return poFor(supplierId)?.subcontractor_contact_id ?? contactsFor(supplierId)[0]?.id ?? null
}
function poEmail(supplierId: string) { return contactsFor(supplierId).find(c => c.id === poContactId(supplierId))?.email || '' }
function canSendPO(g: { supplierId: string; items: Row[] }) { return g.items.length > 0 && !!poContactId(g.supplierId) && !!poEmail(g.supplierId) }
// 発注書PDFのURL（プレビュー/ダウンロード）と送信日時表示
function poPdfUrl(path: string) { return supabase.storage.from(BUCKET).getPublicUrl(path).data.publicUrl }
function fmtDateTime(iso: string | null) { if (!iso) return ''; try { return new Date(iso).toLocaleString('ja-JP', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }) } catch { return '' } }

// E4 差分承認: pending の価格改定を読む
async function loadRevisions() {
  const { data } = await supabase.from('estimate_price_revisions')
    .select('id, material_id, supplier_id, code, name, unit, old_price, new_price, effective_date, status')
    .eq('account_id', accountId).eq('status', 'pending').order('created_at')
  revisions.value = (data ?? []) as Revision[]
}
function revMaterialName(r: Revision) {
  return r.material_id ? (materials.value.find(m => m.id === r.material_id)?.name ?? r.name ?? '(材料)') : (r.name ?? '(新規材料)')
}
function revSupplierName(r: Revision) {
  return suppliers.value.find(s => s.id === r.supplier_id)?.name ?? '(商社)'
}
// ② 揺れ対策: 承認時の(商社×品番/品名)→自社材料 の紐付けをエイリアスとして学習。
//   同一商社の同じ品番/品名は最新の紐付けに更新（古い対応を消してから1件入れる＝後勝ち）。
async function recordAlias(materialId: string, supplierId: string, code: string | null, name: string | null) {
  const c = (code || '').trim(), n = (name || '').trim()
  if (!c && !n) return
  if (c) await supabase.from('estimate_material_aliases')
    .delete().eq('account_id', accountId).eq('supplier_id', supplierId).ilike('supplier_code', c)
  if (n) await supabase.from('estimate_material_aliases')
    .delete().eq('account_id', accountId).eq('supplier_id', supplierId).ilike('supplier_name', n)
  await supabase.from('estimate_material_aliases')
    .insert({ account_id: accountId, material_id: materialId, supplier_id: supplierId, supplier_code: c || null, supplier_name: n || null })
}
// 承認＝material_prices へ反映（現行を履歴化→新単価をcurrent・材料が無ければ作成）＋revision applied＋エイリアス学習。
// ①編集: r.code/r.name/r.new_price/r.effective_date と紐付け先(r.material_id)は承認画面で手修正された値をそのまま使う。
async function approveRevision(r: Revision) {
  if (!r.supplier_id) { saveError.value = '商社が未解決です'; return }
  if (!(Number(r.new_price) > 0)) { saveError.value = '新単価は1円以上にしてください'; return }
  revBusy.value = true; saveError.value = ''
  try {
    let materialId = r.material_id   // 紐付け先セレクトで既存材料を選んでいればそれを使う
    if (!materialId) {
      const nm = (r.name || '').trim()
      const ex = materials.value.find(m => m.name.trim().toLowerCase() === nm.toLowerCase())
      if (ex) materialId = ex.id
      else {
        const { data } = await supabase.from('estimate_materials')
          .insert({ account_id: accountId, name: nm || '(新規材料)', code: r.code || null, unit: r.unit || null, source: 'ocr' }).select('id').single()
        materialId = (data as any)?.id ?? null
      }
    }
    if (!materialId) { saveError.value = '材料が未解決です'; return }
    await supabase.from('estimate_material_prices').update({ is_current: false })
      .eq('account_id', accountId).eq('material_id', materialId).eq('supplier_id', r.supplier_id).eq('is_current', true)
    await supabase.from('estimate_material_prices')
      .insert({ account_id: accountId, material_id: materialId, supplier_id: r.supplier_id, unit_price: Number(r.new_price), effective_date: r.effective_date, is_current: true })
    await supabase.from('estimate_price_revisions')
      .update({ status: 'applied', applied_at: new Date().toISOString(), material_id: materialId }).eq('id', r.id)
    await recordAlias(materialId, r.supplier_id, r.code, r.name)
    await Promise.all([loadMaterials(), loadMaterialPrices(), loadRevisions()])
  } finally { revBusy.value = false }
}
async function rejectRevision(r: Revision) {
  await supabase.from('estimate_price_revisions').update({ status: 'rejected' }).eq('id', r.id)
  await loadRevisions()
}
// OCR取込: 単価表画像を vision-LLM(Edge Function) に送り、pending revisions を作る
function bytesToB64(bytes: Uint8Array): string {
  let bin = ''
  const chunk = 0x8000
  for (let i = 0; i < bytes.length; i += chunk) bin += String.fromCharCode.apply(null, Array.from(bytes.subarray(i, i + chunk)))
  return btoa(bin)
}
function fileToB64(file: File): Promise<string> {
  return new Promise((res, rej) => {
    const fr = new FileReader(); fr.onload = () => res(String(fr.result).split(',')[1] || ''); fr.onerror = rej; fr.readAsDataURL(file)
  })
}
// 1ページ分を OCR EF に投げ、作成された差分件数を返す
async function callOcr(b64: string, mime: string): Promise<number> {
  const { data: sess } = await supabase.auth.getSession()
  const resp = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/estimate-price-ocr`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${sess?.session?.access_token ?? ''}`, apikey: import.meta.env.VITE_SUPABASE_ANON_KEY },
    body: JSON.stringify({ account_slug: getAccountSlug(), supplier_id: activeSupplier.value, image_base64: b64, mime }),
  })
  const json = await resp.json()
  if (!resp.ok || json?.error) throw new Error(json?.error || `取込エラー(${resp.status})`)
  return json?.created ?? 0
}
// PDFはページ分割して1ページずつ処理＝「X/Nページ」の実進捗＋実測平均で残り時間を出す
async function onOcrFile(e: Event) {
  const file = (e.target as HTMLInputElement).files?.[0]
  if (!file) return
  if (!activeSupplier.value) { ocrError.value = '先に対象の商社タブを選んでください'; return }
  ocrBusy.value = true; ocrError.value = ''
  ocrElapsed.value = 0; ocrTotal.value = 0; ocrDone.value = 0; ocrPageStart.value = 0; ocrAvgPageSec.value = 0
  ocrTimer = setInterval(() => { ocrElapsed.value++ }, 1000)
  try {
    let pages: { b64: string; mime: string }[]
    const isPdf = file.type === 'application/pdf' || /\.pdf$/i.test(file.name)
    if (isPdf) {
      const buf = await file.arrayBuffer()
      const { PDFDocument } = await import('pdf-lib')
      const src = await PDFDocument.load(buf)
      const n = src.getPageCount()
      pages = []
      for (let i = 0; i < n; i++) {
        const doc = await PDFDocument.create()
        const [pg] = await doc.copyPages(src, [i])
        doc.addPage(pg)
        pages.push({ b64: bytesToB64(await doc.save()), mime: 'application/pdf' })
      }
    } else {
      pages = [{ b64: await fileToB64(file), mime: file.type || 'image/png' }]
    }
    ocrTotal.value = pages.length
    for (const pg of pages) {
      ocrPageStart.value = ocrElapsed.value
      await callOcr(pg.b64, pg.mime)
      ocrDone.value++
      ocrAvgPageSec.value = ocrElapsed.value / ocrDone.value   // 実測平均（以降の残り時間が正確に）
    }
    await loadRevisions()
  } catch (err: any) {
    ocrError.value = err?.message ?? '取込に失敗しました'
  } finally {
    ocrBusy.value = false
    if (ocrTimer) clearInterval(ocrTimer)
    ;(e.target as HTMLInputElement).value = ''
  }
}
// E2 PDF出力（表紙＋工種別内訳＋合計・A4複数ページ対応）
// 見積書PDFを生成: A4横向き・ページブロック単位（[data-pdf-page]）で改ページ。
//  1ページ目=表紙(全体)／2ページ目=内訳書(工種別集計)／3ページ目以降=工種ごとの明細。
//  サンプルPDFと同じ構成。ブロックが1ページに収まらなければそのブロック内で複数ページに分割。
async function buildEstimatePdf(): Promise<import('jspdf').jsPDF> {
  exporting.value = true      // 全ページをDOM表示してから取り込む（ページャで隠れている分も）
  await nextTick()
  try {
    return await renderEstimatePdf()
  } finally {
    exporting.value = false
  }
}
async function renderEstimatePdf(): Promise<import('jspdf').jsPDF> {
  const pdf = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' })
  const pageW = 297, pageH = 210
  const blocks = Array.from(previewEl.value!.querySelectorAll<HTMLElement>('[data-pdf-page]'))
  for (let b = 0; b < blocks.length; b++) {
    const canvas = await html2canvas(blocks[b], { scale: 2, backgroundColor: '#ffffff' })
    const png = canvas.toDataURL('image/png')
    const imgW = pageW
    const imgH = (canvas.height / canvas.width) * imgW
    let heightLeft = imgH, position = 0
    if (b > 0) pdf.addPage()
    pdf.addImage(png, 'PNG', 0, position, imgW, imgH)
    heightLeft -= pageH
    while (heightLeft > 0) { position = heightLeft - imgH; pdf.addPage(); pdf.addImage(png, 'PNG', 0, position, imgW, imgH); heightLeft -= pageH }
  }
  // ページ番号（全ページ右下に "現在 / 総数"。数字のみ＝既定フォントで可）
  const total = pdf.getNumberOfPages()
  for (let i = 1; i <= total; i++) {
    pdf.setPage(i)
    pdf.setFontSize(9)
    pdf.setTextColor(120)
    pdf.text(`${i} / ${total}`, pageW - 8, pageH - 5, { align: 'right' })
  }
  return pdf
}
async function exportPdf() {
  if (!previewEl.value) return
  pdfBusy.value = true
  try {
    const pdf = await buildEstimatePdf()
    pdf.save(`見積_${currentProjectName.value || 'estimate'}.pdf`)
  } finally {
    pdfBusy.value = false
  }
}
// ③ 見積書PDFを生成→Storageへ保存→商社の担当者宛にメール送信（履歴は EF が estimate_sends に記録）
async function sendPdf() {
  if (!canSend.value || !previewEl.value || !projectId.value) return
  const to = sendContacts.value.find(c => c.id === sendContactId.value)
  if (!window.confirm(`${currentContractorName.value} 御中（${to?.name ?? ''} / ${sendEmail.value}）に見積書PDFをメール送信します。よろしいですか？`)) return
  sending.value = true; sendErr.value = ''; sendMsg.value = ''
  try {
    // PDF生成（A4横向き・ページブロック単位＝exportPdf と同方式）
    const pdf = await buildEstimatePdf()
    // Storageへ保存（EFが添付用にダウンロードする・履歴に紐付く）
    const path = `estimates/${accountId}/${projectId.value}-${Date.now()}.pdf`
    const { error: upErr } = await supabase.storage.from(BUCKET).upload(path, pdf.output('blob'), { upsert: true, contentType: 'application/pdf' })
    if (upErr) throw upErr
    // 送信EF（devはテスト入口＝実メールは送らず履歴のみ記録）。EFが呼び出し元JWTで越境を拒否。
    const fnName = IS_DEV ? 'test-send-estimate' : 'send-estimate'
    const { data: { session } } = await supabase.auth.getSession()
    const res = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/${fnName}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', apikey: import.meta.env.VITE_SUPABASE_ANON_KEY, Authorization: `Bearer ${session?.access_token ?? ''}` },
      body: JSON.stringify({
        project_id: projectId.value, contractor_id: currentContractorId.value, contractor_contact_id: sendContactId.value,
        pdf_path: path, total_amount: Math.round(grandTotal.value), project_name: currentProjectName.value,
      }),
    })
    const r = await res.json().catch(() => ({}))
    if (!res.ok || r?.error) throw new Error(r?.error ?? `送信失敗(${res.status})`)
    sendMsg.value = r.test ? '送信履歴を記録しました（dev: 実メールは送信しません）' : `${r.sent_to ?? ''} へ送信しました`
    await loadSends()
  } catch (e: any) {
    sendErr.value = e?.message ?? '送信に失敗しました'
  } finally {
    sending.value = false
  }
}

// F2 発注書番号採番（PO-<年>-<4桁・account×年ごと連番。purchase-orders ページと同方式）
async function nextOrderNumber(): Promise<string> {
  const year = new Date().getFullYear(); const prefix = `PO-${year}-`
  const { data } = await supabase.from('purchase_orders').select('order_number')
    .eq('account_id', accountId).like('order_number', `${prefix}%`).order('order_number', { ascending: false }).limit(1)
  const last = data?.[0]?.order_number as string | undefined
  const seq = last ? parseInt(last.slice(prefix.length), 10) || 0 : 0
  return `${prefix}${String(seq + 1).padStart(4, '0')}`
}
// F2 商社1社分の発注書PDFを生成→Storage保存→purchase_orders 作成/更新→send-purchase-order EF で送信
async function sendPO(g: { supplierId: string; supplierName: string; items: Row[]; total: number }) {
  const contactId = poContactId(g.supplierId)
  if (!contactId || !poEmail(g.supplierId)) { poErr.value = `${g.supplierName}: 担当者のメールが未登録です`; return }
  const resend = poFor(g.supplierId)?.email_sent_at ? '再送' : '送信'
  if (!window.confirm(`${g.supplierName}（${poEmail(g.supplierId)}）へ発注書PDFをメール${resend}します。よろしいですか？`)) return
  poBusy.value = g.supplierId; poErr.value = ''; poMsg.value = ''
  try {
    const contactName = contactsFor(g.supplierId).find(c => c.id === contactId)?.name ?? ''
    // 発注書プレビュー（商社1社分）を描画してからPDF化
    poTarget.value = { supplierName: g.supplierName, contactName, items: g.items.slice(), total: g.total }
    await nextTick()
    const canvas = await html2canvas(poPreviewEl.value!, { scale: 2, backgroundColor: '#ffffff' })
    const png = canvas.toDataURL('image/png')
    const pdf = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' })
    const pageW = 210, pageH = 297, imgW = pageW
    const imgH = (canvas.height / canvas.width) * imgW
    let heightLeft = imgH, position = 0
    pdf.addImage(png, 'PNG', 0, position, imgW, imgH); heightLeft -= pageH
    while (heightLeft > 0) { position = heightLeft - imgH; pdf.addPage(); pdf.addImage(png, 'PNG', 0, position, imgW, imgH); heightLeft -= pageH }
    const blob = pdf.output('blob')
    // 同案件×商社の発注が既にあれば更新（再送＝重複発行しない）、無ければ採番して作成
    const existing = poFor(g.supplierId)
    let orderId = existing?.id as string | undefined
    const orderNumber = existing?.order_number ?? await nextOrderNumber()
    const payload: any = {
      account_id: accountId, estimate_project_id: projectId.value, subcontractor_id: g.supplierId,
      subcontractor_contact_id: contactId, order_number: orderNumber, order_date: today,
      total_amount: Math.round(g.total), site_name: currentProjectName.value,
      vendor_name: g.supplierName, vendor_contact_name: contactName,
      status: 'issued', issued_at: new Date().toISOString(),
    }
    if (orderId) await supabase.from('purchase_orders').update(payload).eq('id', orderId)
    else { const { data, error } = await supabase.from('purchase_orders').insert(payload).select('id').single(); if (error) throw error; orderId = (data as any)?.id }
    if (!orderId) throw new Error('発注書の作成に失敗しました')
    const path = `purchase-orders/${accountId}/${orderId}.pdf`
    const { error: upErr } = await supabase.storage.from(BUCKET).upload(path, blob, { upsert: true, contentType: 'application/pdf' })
    if (upErr) throw upErr
    await supabase.from('purchase_orders').update({ pdf_path: path }).eq('id', orderId)
    // 送信（発注書の承諾依頼。既存 send-purchase-order EF を再利用。devはtest入口で実送信なし）
    const fn = IS_DEV ? 'test-send-purchase-order' : 'send-purchase-order'
    const { data: { session } } = await supabase.auth.getSession()
    const res = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/${fn}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', apikey: import.meta.env.VITE_SUPABASE_ANON_KEY, Authorization: `Bearer ${session?.access_token ?? ''}` },
      body: JSON.stringify({ order_id: orderId }),
    })
    const r = await res.json().catch(() => ({}))
    if (!res.ok || r?.error) throw new Error(r?.error ?? `送信失敗(${res.status})`)
    poMsg.value = r.test ? `${g.supplierName}: 発注書 ${orderNumber} を作成（dev: 実メール送信なし）` : `${g.supplierName}: ${r.sent_to ?? ''} へ送信しました`
    await loadProjectPOs()
  } catch (e: any) {
    poErr.value = e?.message ?? '発注に失敗しました'
  } finally {
    poBusy.value = null; poTarget.value = null
  }
}

async function loadProjects() {
  const { data } = await supabase.from('estimate_projects')
    .select('id, name, client_name, contractor_id').eq('account_id', accountId).order('created_at', { ascending: false })
  projects.value = (data ?? []) as Project[]
}
async function loadTrades() {
  const { data } = await supabase.from('estimate_trades')
    .select('id, name').eq('account_id', accountId).order('sort_order').order('name')
  trades.value = (data ?? []) as Trade[]
}
async function loadMaterials() {
  const { data } = await supabase.from('estimate_materials')
    .select('id, name, unit, code').eq('account_id', accountId).order('name')
  materials.value = (data ?? []) as Material[]
}
// 商社＝下請け業者マスタ(区分=商社)。新設せず既存 subcontractors を流用（subcontractors はRLS無効のため account_id で絞る）
async function loadSuppliers() {
  const { data } = await supabase.from('subcontractors')
    .select('id, name').eq('account_id', accountId).eq('category', '商社').order('name')
  suppliers.value = (data ?? []) as Supplier[]
}
async function loadMaterialPrices() {
  const { data } = await supabase.from('estimate_material_prices')
    .select('id, material_id, supplier_id, unit_price, effective_date').eq('account_id', accountId).eq('is_current', true)
  matPrices.value = (data ?? []) as MatPrice[]
}
// ③ 元請けと担当者（見積書の送信先候補）。元請けマスタ(contractors)＋ contractor_contacts。
async function loadContractors() {
  const [{ data: cs }, { data: ccs }] = await Promise.all([
    supabase.from('contractors').select('id, name').eq('account_id', accountId).eq('active', true).order('name'),
    supabase.from('contractor_contacts').select('id, contractor_id, name, email').eq('account_id', accountId).eq('is_deleted', false).order('sort_order'),
  ])
  contractors.value = (cs ?? []) as Contractor[]
  contractorContacts.value = (ccs ?? []) as Contact[]
}
// ④ 自社情報（settings）を読む
async function loadCompany() {
  const { data } = await supabase.from('settings').select('key, value').eq('account_id', accountId).in('key', COMPANY_KEYS)
  company.value = Object.fromEntries((data ?? []).map((s: any) => [s.key, s.value]))
}
// F2 商社（下請け業者）の担当者＝発注書の送信先候補
async function loadSubContacts() {
  const { data } = await supabase.from('subcontractor_contacts')
    .select('id, subcontractor_id, name, email').eq('account_id', accountId).eq('is_deleted', false).order('sort_order')
  subContacts.value = (data ?? []) as SubContact[]
}
// F2 この案件で既に発行済みの発注書（商社ごと・送信状態の表示と再送に使う）
async function loadProjectPOs() {
  projectPOs.value = []
  poContactSel.value = {}
  if (!projectId.value) return
  const { data } = await supabase.from('purchase_orders')
    .select('id, subcontractor_id, subcontractor_contact_id, order_number, total_amount, email_sent_at, pdf_path, status')
    .eq('estimate_project_id', projectId.value).eq('is_deleted', false)
  projectPOs.value = (data ?? []) as any[]
}
// ③ この案件の送信履歴
async function loadSends() {
  sends.value = []
  if (!projectId.value) return
  const { data } = await supabase.from('estimate_sends')
    .select('id, email_to, subject, sent_at, created_at').eq('project_id', projectId.value).order('created_at', { ascending: false })
  sends.value = (data ?? []) as EstimateSend[]
}
// 商社別単価の現行一覧（材料名・商社名つき・材料→商社順）
const priceList = computed(() =>
  matPrices.value
    .map(p => ({
      id: p.id, supplierId: p.supplier_id, unit_price: Number(p.unit_price), effective_date: p.effective_date,
      materialName: materials.value.find(m => m.id === p.material_id)?.name ?? '(材料)',
      materialCode: materials.value.find(m => m.id === p.material_id)?.code ?? null,
      supplierName: suppliers.value.find(s => s.id === p.supplier_id)?.name ?? '(商社)',
    }))
    .sort((a, b) => a.materialName.localeCompare(b.materialName, 'ja') || a.supplierName.localeCompare(b.supplierName, 'ja'))
)
// 商社タブ＝対象商社の選択（単価登録・一覧・OCR取込の対象を兼ねる）
const activeSupplier = ref<string | null>(null)
const activeSupplierName = computed(() => suppliers.value.find(s => s.id === activeSupplier.value)?.name ?? '')
const priceListFiltered = computed(() =>
  activeSupplier.value ? priceList.value.filter(p => p.supplierId === activeSupplier.value) : []
)
// 取込の承認待ち差分も選択商社で絞る
const revisionsFiltered = computed(() =>
  activeSupplier.value ? revisions.value.filter(r => r.supplier_id === activeSupplier.value) : []
)
async function deletePrice(id: string) {
  await supabase.from('estimate_material_prices').delete().eq('id', id)
  await loadMaterialPrices()
}
// ①編集: 現行単価の単価・有効日を手修正（行の値を直接更新＝その場保存）
async function savePrice(p: { id: string; unit_price: number; effective_date: string | null }) {
  await supabase.from('estimate_material_prices')
    .update({ unit_price: Number(p.unit_price) || 0, effective_date: p.effective_date || null }).eq('id', p.id)
  await loadMaterialPrices()
}
// E7 商社別単価: 行の材料に対する商社別単価リスト（単価差の表示元）
function pricesForMaterial(materialId: string | null) {
  if (!materialId) return [] as Array<{ supplier_id: string; supplierName: string; unit_price: number }>
  return matPrices.value
    .filter(p => p.material_id === materialId)
    .map(p => ({ supplier_id: p.supplier_id, supplierName: suppliers.value.find(s => s.id === p.supplier_id)?.name ?? '(商社)', unit_price: Number(p.unit_price) }))
    .sort((a, b) => a.unit_price - b.unit_price)
}
// 商社を選ぶと、その商社×材料の単価を明細単価に反映（金額は生成列/computedで追従）
function onSupplierPick(r: Row) {
  if (!r.material_id || !r.supplier_id) return
  const p = matPrices.value.find(x => x.material_id === r.material_id && x.supplier_id === r.supplier_id)
  if (p) r.unit_price = Number(p.unit_price)
}
// このページから商社（＝下請け業者 区分=商社）を追加（横断不要）
async function addSupplier() {
  const name = newSupplierName.value.trim()
  if (!name) return
  newSupplierName.value = ''
  const { data, error } = await supabase.from('subcontractors')
    .insert({ account_id: accountId, name, category: '商社', active: true }).select('id, name').single()
  if (error) { saveError.value = error.message; newSupplierName.value = name; return }
  addingSupplier.value = false
  await loadSuppliers()
  activeSupplier.value = (data as any).id
}
async function addPrice() {
  const f = priceForm.value
  const supplierId = activeSupplier.value
  if (!f.material_id || !supplierId || !(Number(f.unit_price) > 0)) return
  // 同一(材料×商社)の現行価格は履歴化（is_current=false）してから新価格を current で追加
  await supabase.from('estimate_material_prices')
    .update({ is_current: false }).eq('account_id', accountId)
    .eq('material_id', f.material_id).eq('supplier_id', supplierId).eq('is_current', true)
  const { error } = await supabase.from('estimate_material_prices')
    .insert({ account_id: accountId, material_id: f.material_id, supplier_id: supplierId, unit_price: Number(f.unit_price), is_current: true })
  if (error) { saveError.value = error.message; return }
  priceForm.value = { material_id: null, unit_price: null }
  await loadMaterialPrices()
}
// E6 品番予測変換: 明細名が既存材料に一致したら material_id を紐付け、単位を補完
function resolveMaterial(r: Row) {
  const nm = (r.item_name || '').trim().toLowerCase()
  if (!nm) { r.material_id = null; return }
  const m = materials.value.find(x => x.name.trim().toLowerCase() === nm)
  if (m) {
    r.material_id = m.id
    if (!r.unit && m.unit) r.unit = m.unit
  } else {
    r.material_id = null
  }
  // 材料に単価の無い商社選択はクリア
  if (r.supplier_id && !matPrices.value.some(p => p.material_id === r.material_id && p.supplier_id === r.supplier_id)) {
    r.supplier_id = null
  }
}
async function loadItems() {
  rows.value = []
  removedIds.value = []
  doc.value = { construction_location: '', period_text: '', valid_until: '', memo: '', adjustment: 0 }
  lastLoadedProjectId = projectId.value
  if (!projectId.value) { markSaved(); return }
  const [{ data }, { data: pj }] = await Promise.all([
    supabase.from('estimate_items')
      .select('id, category_id, trade_id, material_id, supplier_id, item_name, unit, quantity, unit_price, note')
      .eq('project_id', projectId.value).order('sort_order'),
    supabase.from('estimate_projects')
      .select('construction_location, period_text, valid_until, memo, adjustment').eq('id', projectId.value).single(),
  ])
  rows.value = (data ?? []).map((d: any) => ({
    id: d.id, location: d.note ?? '', trade_id: d.trade_id, material_id: d.material_id ?? null,
    supplier_id: d.supplier_id ?? null, item_name: d.item_name, unit: d.unit ?? '',
    quantity: Number(d.quantity) || 0, unit_price: Number(d.unit_price) || 0,
  }))
  doc.value = {
    construction_location: pj?.construction_location ?? '', period_text: pj?.period_text ?? '',
    valid_until: pj?.valid_until ?? '', memo: pj?.memo ?? '', adjustment: Number(pj?.adjustment) || 0,
  }
  currentPage.value = 0   // 案件を開いたら先頭ページへ
  markSaved()
  await Promise.all([loadSends(), loadProjectPOs()])
  // 送信先担当者を案件の元請けの先頭で初期化
  sendContactId.value = contractorContacts.value.find(c => c.contractor_id === currentContractorId.value)?.id ?? null
}

async function addProject() {
  const name = newProjectName.value.trim()
  if (!name) return
  projectErr.value = ''
  // 同名の案件は作らせない（大小文字無視）
  if (projects.value.some(p => p.name.trim().toLowerCase() === name.toLowerCase())) {
    projectErr.value = `案件「${name}」は既にあります`
    return
  }
  newProjectName.value = ''   // 同期クリア（連続入力のレース回避）
  const { data, error } = await supabase.from('estimate_projects')
    .insert({ account_id: accountId, name }).select('id, name, client_name').single()
  if (error) { projectErr.value = /duplicate|unique/i.test(error.message) ? `案件「${name}」は既にあります` : error.message; newProjectName.value = name; return }
  await loadProjects()
  projectId.value = (data as Project).id
  addingProject.value = false
  await loadItems()
}
async function addTrade() {
  const name = newTradeName.value.trim()
  if (!name) return
  newTradeName.value = ''     // 同期クリア（連続入力のレース回避）
  const { error } = await supabase.from('estimate_trades').insert({ account_id: accountId, name })
  if (error) { saveError.value = error.message; newTradeName.value = name; return }
  await loadTrades()
}
async function deleteTrade(id: string) {
  masterErr.value = ''
  const { error } = await supabase.from('estimate_trades').delete().eq('id', id)
  if (error) { masterErr.value = '使用中の工種は削除できません（明細で使われています）'; return }
  await loadTrades()
}
// 材料マスタ（品番=code・品名=name・単位）を別管理
async function addMaterial() {
  const f = materialForm.value
  if (!f.name.trim()) return
  masterErr.value = ''
  const { error } = await supabase.from('estimate_materials')
    .insert({ account_id: accountId, code: f.code.trim() || null, name: f.name.trim(), unit: f.unit.trim() || null, source: 'manual' })
  if (error) { masterErr.value = error.message; return }
  materialForm.value = { code: '', name: '', unit: '' }
  await loadMaterials()
}
async function deleteMaterial(id: string) {
  masterErr.value = ''
  const { error } = await supabase.from('estimate_materials').delete().eq('id', id)  // 価格は cascade
  if (error) { masterErr.value = '使用中の材料は削除できません（明細で使われています）'; return }
  await Promise.all([loadMaterials(), loadMaterialPrices()])
}

function addRow() {
  rows.value.push({ id: null, location: '', trade_id: null, material_id: null, supplier_id: null, item_name: '', unit: '', quantity: 0, unit_price: 0 })
}
function removeRow(i: number) {
  const r = rows.value[i]
  if (r.id) removedIds.value.push(r.id)
  rows.value.splice(i, 1)
}

async function save() {
  if (!projectId.value) return
  saving.value = true; saveError.value = ''; savedMsg.value = ''
  try {
    // 削除
    if (removedIds.value.length) {
      await supabase.from('estimate_items').delete().in('id', removedIds.value)
      removedIds.value = []
    }
    // E5 マスタ蓄積（明細保存より前）: 初回入力の材料名を estimate_materials に捕捉し、
    // 新規材料の material_id を行に紐付けてから保存する（E6: 単位も一緒に捕捉）。
    const known = new Map(materials.value.map(m => [m.name.trim().toLowerCase(), m.id]))
    const created = new Map<string, string>()
    for (const r of rows.value) {
      const nm = (r.item_name || '').trim()
      if (!nm || nm === '(無題)') continue
      const key = nm.toLowerCase()
      if (!r.material_id && known.has(key)) r.material_id = known.get(key)!
      if (!r.material_id && created.has(key)) r.material_id = created.get(key)!
      if (!r.material_id) {
        const { data } = await supabase.from('estimate_materials')
          .insert({ account_id: accountId, name: nm, unit: r.unit || null, trade_id: r.trade_id, source: 'manual' })
          .select('id').single()
        if (data) { r.material_id = (data as any).id; created.set(key, r.material_id!) }
      }
    }
    // upsert（amount は生成列なので送らない）
    let order = 0
    for (const r of rows.value) {
      const payload: any = {
        account_id: accountId, project_id: projectId.value,
        trade_id: r.trade_id, material_id: r.material_id, supplier_id: r.supplier_id, item_name: r.item_name || '(無題)',
        unit: r.unit || null, quantity: Number(r.quantity) || 0, unit_price: Number(r.unit_price) || 0,
        note: r.location || null, sort_order: order++,
      }
      if (r.id) await supabase.from('estimate_items').update(payload).eq('id', r.id)
      else {
        const { data } = await supabase.from('estimate_items').insert(payload).select('id').single()
        if (data) r.id = (data as any).id
      }
    }
    if (created.size) await loadMaterials()
    // 見積書フィールド（工事場所/工期/有効期限/MEMO/端数調整）も保存
    await supabase.from('estimate_projects').update({
      construction_location: doc.value.construction_location || null, period_text: doc.value.period_text || null,
      valid_until: doc.value.valid_until || null, memo: doc.value.memo || null, adjustment: Number(doc.value.adjustment) || 0,
    }).eq('id', projectId.value)
    markSaved()   // 保存完了＝離脱ガードの基準を更新（以降は未保存扱いしない）
    savedMsg.value = '保存しました'
    setTimeout(() => (savedMsg.value = ''), 2500)
  } catch (e: any) {
    saveError.value = e?.message ?? '保存に失敗しました'
  } finally {
    saving.value = false
  }
}

// #3 編集中の離脱ガード: 未保存の明細がある状態で 遷移/タブ閉じ/案件切替 時に確認する
function rowsSig(): string {
  return JSON.stringify([rows.value.map(r => [r.location, r.trade_id, r.material_id, r.supplier_id, r.item_name, r.unit, r.quantity, r.unit_price]), doc.value])
}
const savedSig = ref('[]')
function markSaved() { savedSig.value = rowsSig() }   // 「今の明細＝保存済み」とみなす基準を更新
const isDirty = computed(() => !!projectId.value && (rowsSig() !== savedSig.value || removedIds.value.length > 0))
const DIRTY_MSG = '保存していない明細があります。保存せずに移動しますか？'
let lastLoadedProjectId: string | null = null
// ルート遷移（一覧へ戻る・サイドメニュー等）のガード。案件切替は一覧経由＝遷移なのでこれで覆える。
onBeforeRouteLeave(() => (isDirty.value ? window.confirm(DIRTY_MSG) : true))
// タブ閉じ/リロードのガード（ブラウザのネイティブ確認）
function beforeUnload(e: BeforeUnloadEvent) { if (isDirty.value) { e.preventDefault(); e.returnValue = '' } }
onMounted(() => window.addEventListener('beforeunload', beforeUnload))
onUnmounted(() => window.removeEventListener('beforeunload', beforeUnload))

onMounted(async () => {
  accountId = await getAccountId()
  await Promise.all([loadProjects(), loadTrades(), loadMaterials(), loadSuppliers(), loadMaterialPrices(), loadRevisions(), loadContractors(), loadSubContacts(), loadCompany()])
  if (!activeSupplier.value && suppliers.value[0]) activeSupplier.value = suppliers.value[0].id  // 既定タブ
  // 一覧から開いた案件（?project=<id>）を初期選択
  const qp = route.query.project
  const pid = Array.isArray(qp) ? qp[0] : qp
  if (pid && projects.value.some(p => p.id === pid)) { projectId.value = pid as string; await loadItems() }
})
</script>

<style scoped>
.page-header { display: flex; align-items: baseline; gap: 16px; }
.page-title { font-size: 22px; font-weight: 700; }
.back-link { font-size: 13px; color: #06864a; text-decoration: none; }
.back-link:hover { text-decoration: underline; }
.bar { display: flex; gap: 10px; align-items: center; flex-wrap: wrap; margin-bottom: 16px; }
.bar label { font-weight: 600; color: #444; }
.current-project { font-size: 16px; font-weight: 700; color: #222; }
.sel { min-width: 220px; }
.grid { display: grid; grid-template-columns: 2fr 1fr; gap: 16px; align-items: start; }
@media (max-width: 900px) { .grid { grid-template-columns: 1fr; } }
.panel { background: #fff; border: 1px solid #e5e5e5; border-radius: 10px; padding: 14px; }
.panel-head { display: flex; justify-content: space-between; align-items: center; margin-bottom: 10px; }
.panel-head h2 { font-size: 15px; margin: 0; }
.table { width: 100%; border-collapse: collapse; }
.table th, .table td { border-bottom: 1px solid #eee; padding: 6px 8px; font-size: 13px; text-align: left; }
.table th.num, .table td.num { text-align: right; }
.input { padding: 6px 8px; border: 1px solid #ccc; border-radius: 6px; font-size: 13px; width: 100%; box-sizing: border-box; }
.input.sm { width: 90px; }
.input.num { text-align: right; }
.amount { font-variant-numeric: tabular-nums; }
.actions-row { display: flex; gap: 12px; align-items: center; margin-top: 12px; }
.btn-primary { background: #06C755; color: #fff; border: none; border-radius: 6px; padding: 8px 18px; font-weight: 600; cursor: pointer; }
.btn-primary:disabled { opacity: .6; cursor: default; }
.btn-add { background: #eef7f0; color: #06864a; border: 1px solid #bfe3cd; border-radius: 6px; padding: 6px 12px; cursor: pointer; }
.btn-add:disabled { opacity: .4; cursor: not-allowed; background: #f3f4f6; color: #9ca3af; border-color: #e5e7eb; }
.btn-del { background: none; border: none; color: #c00; font-size: 16px; cursor: pointer; }
.trade-add { display: flex; gap: 8px; align-items: center; margin-top: 14px; padding-top: 12px; border-top: 1px dashed #ddd; }
.grand td { font-weight: 700; border-top: 2px solid #333; }
.empty { color: #999; text-align: center; padding: 14px; }
.hint { color: #777; }
.err { color: #c00; font-size: 13px; }
.ok { color: #06864a; font-size: 13px; }
.pdf-panel { margin-top: 16px; }
.pdf-preview { background: #fff; color: #111; padding: 24px; border: 1px solid #ddd; max-width: 760px; }
/* 見積書情報の入力フォーム */
.doc-form { display: flex; flex-wrap: wrap; gap: 12px; margin: 8px 0 16px; }
.doc-field { display: flex; flex-direction: column; gap: 4px; }
.doc-field label { font-size: 11px; font-weight: 700; color: #888; }
.doc-field .input { width: 200px; }
.doc-field.wide .input { width: 420px; }
/* ── 見積書(サンプル様式・A4横向き) ── */
/* プレビューはページブロック[data-pdf-page]単位。各ブロックを横A4比率(約297:210)で表示し、
   PDFはブロックごとに改ページ（1=表紙/2=内訳書/3〜=工種明細）。 */
.pdf-panel { overflow-x: auto; }
.panel-head .pager { display: flex; align-items: center; gap: 8px; margin-left: auto; margin-right: 12px; }
.pg-btn { width: 30px; height: 30px; border: 1px solid #cbd5e1; background: #fff; border-radius: 6px; font-size: 16px; line-height: 1; cursor: pointer; color: #334155; }
.pg-btn:hover:not(:disabled) { background: #f1f5f9; }
.pg-btn:disabled { opacity: .4; cursor: default; }
.pg-ind { font-size: 13px; color: #555; font-variant-numeric: tabular-nums; min-width: 76px; text-align: center; }
.pdf-preview.est-doc { max-width: none; width: 1056px; padding: 0; border: none; background: transparent; }
.est-doc { font-size: 12px; color: #111; }
.est-doc [data-pdf-page] { width: 1056px; min-height: 740px; box-sizing: border-box; background: #fff; border: 1px solid #ddd; padding: 28px 32px; }
.est-doc [data-pdf-page] + [data-pdf-page] { margin-top: 14px; }
.est-title { text-align: center; font-size: 26px; letter-spacing: 8px; margin: 0 0 4px; font-weight: 700; }
.est-date { text-align: right; font-size: 12px; }
.est-client { font-size: 18px; border-bottom: 2px solid #333; padding: 6px 4px; margin: 6px 0 14px; }
.est-head { display: grid; grid-template-columns: 1.3fr 1.4fr auto; gap: 14px; align-items: start; }
.est-amounts { display: flex; flex-direction: column; gap: 4px; }
.est-amounts .welfare { text-align: right; font-size: 11px; }
.est-amounts .band { display: grid; grid-template-columns: auto 1fr auto; align-items: center; gap: 8px; background: #ddd; padding: 6px 8px; }
.est-amounts .band.sub { background: #eee; }
.est-amounts .band .big { text-align: center; font-size: 20px; font-weight: 700; }
.est-amounts .band .big.sm { font-size: 14px; }
.est-amounts .band .rgt { font-size: 11px; }
.est-issuer .cname { font-size: 20px; font-weight: 700; margin-bottom: 4px; }
.est-issuer div { line-height: 1.5; }
.est-seal { border-collapse: collapse; }
.est-seal th, .est-seal td { border: 1px solid #333; width: 42px; height: 22px; font-size: 10px; text-align: center; }
.est-seal td { height: 44px; }
.est-seal img { max-width: 40px; max-height: 40px; }
.est-applied { font-weight: 700; margin: 14px 0; }
.est-cols { display: grid; grid-template-columns: 1.2fr 1fr; gap: 24px; }
.est-l .kv { display: grid; grid-template-columns: 90px 1fr; border-bottom: 1px solid #333; padding: 8px 2px; }
.est-l .kv span { font-weight: 700; }
.est-l .sepn { margin-top: 16px; font-weight: 700; }
.est-r .rh { font-weight: 700; margin: 4px 0; }
.est-r .rb { border-bottom: 1px solid #ccc; min-height: 22px; padding: 2px; white-space: pre-wrap; }
.est-bd { margin-top: 22px; }
.bd-head { display: flex; justify-content: space-between; font-size: 12px; margin-bottom: 4px; }
.bd-table { width: 100%; border-collapse: collapse; }
.bd-table th, .bd-table td { border: 1px solid #bbb; padding: 5px 6px; font-size: 11px; text-align: left; }
.bd-table th { background: #ddd; text-align: center; }
.bd-table .num { text-align: right; font-variant-numeric: tabular-nums; }
.bd-table .r { text-align: right; font-weight: 700; }
.bd-table .neg { color: #c00; }
.bd-table tfoot .bd-grand td { font-weight: 700; border-top: 2px solid #333; }
.est-detail { margin-top: 16px; }
.est-detail .dh { font-weight: 700; background: #f0f4f1; padding: 4px 8px; border-left: 4px solid #06C755; }
.est-detail .dsub { font-weight: 600; color: #444; font-size: 11px; }
.pdf-title { text-align: center; font-size: 22px; letter-spacing: 4px; margin: 0 0 16px; }
.pdf-meta { font-size: 13px; line-height: 1.7; margin-bottom: 10px; }
.pdf-client { font-size: 15px; font-weight: 700; }
.pdf-total { font-size: 16px; font-weight: 700; border: 2px solid #333; display: inline-block; padding: 6px 14px; margin: 8px 0 16px; }
.pdf-group { margin-bottom: 14px; }
.pdf-group-head { font-weight: 700; background: #f0f4f1; padding: 5px 8px; border-left: 4px solid #06C755; }
.pdf-sub { font-weight: 600; color: #444; font-size: 13px; }
.pdf-table { width: 100%; border-collapse: collapse; margin-top: 4px; }
.pdf-table th, .pdf-table td { border: 1px solid #ccc; padding: 4px 6px; font-size: 12px; text-align: left; }
.pdf-table th.num, .pdf-table td.num { text-align: right; }
.pdf-grand { text-align: right; font-size: 16px; font-weight: 700; border-top: 2px solid #333; padding-top: 8px; margin-top: 8px; }
.ocr-panel { margin-bottom: 16px; }
.ocr-row { display: flex; gap: 10px; align-items: center; flex-wrap: wrap; margin-bottom: 10px; }
.ocr-row label.btn-add { cursor: pointer; }
.ocr-row label.btn-add.disabled { opacity: .6; pointer-events: none; }
.muted { color: #888; font-size: 12px; }
.btn-primary.sm { padding: 4px 12px; font-size: 13px; }
.badge-new { display: inline-block; margin-left: 6px; font-size: 11px; background: #fde68a; color: #92400e; border-radius: 4px; padding: 1px 6px; }
.diff { color: #06864a; font-weight: 700; }
.actions { white-space: nowrap; }
.rev-alert { background: #fff7ed; border: 1px solid #fdba74; color: #9a3412; border-radius: 8px; padding: 10px 14px; margin-bottom: 14px; font-size: 13px; }
.settings-panel { margin-top: 20px; }
.settings-head { font-size: 16px; font-weight: 700; color: #333; display: flex; align-items: center; gap: 10px; margin: 4px 0 12px; padding-bottom: 8px; border-bottom: 2px solid #eee; }
.settings-toggle { width: 100%; text-align: left; background: #f7f7f7; border: 1px solid #e5e5e5; border-radius: 8px; padding: 12px 16px; font-size: 14px; font-weight: 600; color: #444; cursor: pointer; display: flex; align-items: center; gap: 10px; }
.settings-toggle:hover { background: #f0f0f0; }
.settings-toggle .chev { margin-left: auto; color: #888; }
.settings-body { padding: 14px 4px 4px; }
.subtabs { display: inline-flex; gap: 2px; background: #eef0ee; border-radius: 8px; padding: 3px; margin-bottom: 8px; }
.subtab { border: none; background: transparent; color: #555; border-radius: 6px; padding: 6px 16px; font-size: 13px; font-weight: 600; cursor: pointer; }
.subtab:hover { color: #222; }
.subtab.active { background: #fff; color: #06864a; box-shadow: 0 1px 2px rgba(0,0,0,.08); }
.setting-block { padding: 12px 0; border-bottom: 1px dashed #e5e5e5; }
.setting-block:last-child { border-bottom: none; }
.setting-block h3 { font-size: 14px; margin: 0 0 8px; }
/* 明細テーブル: 列を詰めすぎず、はみ出したら横スクロール。プルダウンは読める幅に */
.grid > .panel:first-child { overflow-x: auto; }
.table th, .table td { white-space: nowrap; }
.table select.input { min-width: 120px; }
.table input.input { min-width: 90px; }
.table input.input.num { min-width: 64px; }
/* 設定欄の入力はゆとりある幅（プレースホルダー見切れ防止） */
.setting-block .input { width: auto; min-width: 160px; }
.setting-block .input.num { min-width: 100px; }
.ocr-row { align-items: center; }
.price-tabs { display: flex; gap: 6px; flex-wrap: wrap; margin: 10px 0 8px; }
.ptab { border: 1px solid #d1d5db; background: #fff; color: #555; border-radius: 999px; padding: 4px 14px; font-size: 13px; cursor: pointer; }
.ptab:hover { background: #f3f4f6; }
.ptab.active { background: #06C755; color: #fff; border-color: #06C755; }
.ptab-add { border-style: dashed; color: #06864a; }
.add-methods { display: flex; gap: 24px; flex-wrap: wrap; margin: 12px 0 4px; }
.method { display: flex; flex-direction: column; gap: 6px; }
.method-label { font-size: 12px; font-weight: 600; color: #555; }
.sub-h { font-size: 13px; font-weight: 700; color: #444; margin: 16px 0 6px; }
.rev-section { background: #fffbeb; border: 1px solid #fde68a; border-radius: 8px; padding: 8px 12px; margin-top: 12px; }
.ocr-progress { margin-top: 8px; max-width: 460px; }
.ocr-bar { height: 8px; background: #e5e7eb; border-radius: 999px; overflow: hidden; }
.ocr-bar-fill { height: 100%; background: linear-gradient(90deg, #06C755, #34d399); border-radius: 999px; transition: width .8s ease; }
.ocr-status { display: flex; align-items: center; gap: 8px; font-size: 13px; color: #444; margin-top: 6px; }
.spin { width: 14px; height: 14px; border: 2px solid #cbd5e1; border-top-color: #06C755; border-radius: 50%; display: inline-block; animation: spin 0.8s linear infinite; }
@keyframes spin { to { transform: rotate(360deg); } }
.code { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; color: #555; white-space: nowrap; }
.send-block { margin-top: 16px; padding-top: 12px; border-top: 1px dashed #ddd; }
.send-row { display: flex; gap: 10px; align-items: center; flex-wrap: wrap; margin-bottom: 6px; }
.send-row .input.sm { min-width: 200px; width: auto; }
.send-to { font-weight: 700; color: #333; }
.muted-link { font-size: 12px; color: #06864a; }
.send-history { margin-top: 12px; }
.po-split { margin-top: 16px; }
.po-cards { display: grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); gap: 12px; margin-top: 10px; }
.po-card { border: 1px solid #e5e5e5; border-radius: 10px; padding: 12px; display: flex; flex-direction: column; gap: 8px; }
.po-card-head { display: flex; justify-content: space-between; align-items: baseline; }
.po-sup { font-weight: 700; }
.po-tot { font-size: 12px; color: #666; }
.po-card .input.sm { width: 100%; min-width: 0; }
.po-card-foot { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.po-card-foot .btn-primary.sm { margin-left: auto; }
.badge-ok { font-size: 11px; background: #e8fff0; color: #0a8a3a; border-radius: 4px; padding: 2px 8px; font-weight: 700; }
.po-status { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; font-size: 12px; }
.pdf-link { color: #1a6fc4; text-decoration: none; font-size: 12px; }
.pdf-link:hover { text-decoration: underline; }
/* 発注書PDF生成用プレビュー: 画面外に置いて html2canvas で取り込む */
.po-print { position: absolute; left: -10000px; top: 0; width: 760px; background: #fff; color: #111; padding: 24px; }
</style>
