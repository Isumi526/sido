<template>
  <button
    v-if="guide" type="button" class="guide-btn" :aria-label="$t('guide.open')" data-testid="nav-guide"
    @click="open = true"
  >
    <span class="material-symbols-rounded">help</span>
    <span class="guide-btn-text">{{ $t('guide.label') }}</span>
  </button>
  <Teleport to="body">
    <div v-if="open && guide" class="guide-overlay" data-testid="guide-sheet" @click.self="open = false">
      <div class="guide-sheet" role="dialog" :aria-label="guide.title[lang]">
        <div class="guide-head">
          <span class="guide-title">{{ $t('guide.titleOf', { name: guide.title[lang] }) }}</span>
          <button type="button" class="guide-close" :aria-label="$t('guide.close')" data-testid="guide-close" @click="open = false">
            <span class="material-symbols-rounded">close</span>
          </button>
        </div>
        <div class="guide-body">
          <p class="guide-summary">{{ guide.summary[lang] }}</p>
          <section v-for="(sec, i) in guide.sections" :key="i" class="guide-sec">
            <h3 class="guide-sec-head">{{ sec.heading[lang] }}</h3>
            <ol class="guide-steps">
              <li v-for="(st, j) in sec.steps[lang]" :key="j">{{ st }}</li>
            </ol>
          </section>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
// ============================================================
//  GuideButton — 画面ごとの「使い方」（2026-10-02 設計「見やすさと分かりやすさ」II-4）
//  見出し（AppNav）の横に置く。文面は shared/worker-guides.ts（utils/worker-guides.gen.ts）が正本。
//  ★ここに文面を書かない。AI チャット（II-5）も同じ定義を根拠にするので、二重管理になる。
// ============================================================
import { useI18n } from 'vue-i18n'
import { guideOf } from '~/utils/worker-guides.gen'

const props = defineProps<{ guideKey: string }>()
const { locale } = useI18n({ useScope: 'global' })
const lang = computed(() => (locale.value === 'en' ? 'en' : 'ja') as 'ja' | 'en')
const guide = computed(() => guideOf(props.guideKey))
const open = ref(false)
</script>

<style scoped>
.guide-btn {
  display: flex; flex-direction: column; align-items: center; justify-content: center;
  flex-shrink: 0; min-width: 40px; height: 36px; padding: 0 2px;
  background: none; border: none; color: inherit; cursor: pointer;
}
.guide-btn .material-symbols-rounded { font-size: 20px; line-height: 1; }
.guide-btn-text { font-size: 9px; font-weight: 700; line-height: 1.1; margin-top: 1px; white-space: nowrap; }

.guide-overlay {
  position: fixed; inset: 0; z-index: 2000;
  background: rgba(15, 23, 42, .45);
  display: flex; align-items: flex-end; justify-content: center;
}
.guide-sheet {
  width: 100%; max-width: 560px; max-height: 85vh;
  background: #fff; border-radius: 16px 16px 0 0;
  display: flex; flex-direction: column;
  box-shadow: 0 -4px 24px rgba(0, 0, 0, .18);
}
.guide-head {
  display: flex; align-items: center; justify-content: space-between; gap: 8px;
  padding: 14px 16px 10px; border-bottom: 1px solid #eef2f5;
}
.guide-title { font-size: 16px; font-weight: 800; color: #1f2937; }
.guide-close {
  display: flex; align-items: center; justify-content: center;
  width: 36px; height: 36px; border: none; background: none; color: #64748b; cursor: pointer;
}
.guide-body { overflow-y: auto; padding: 12px 16px 24px; }
.guide-summary { margin: 0 0 12px; font-size: 14px; line-height: 1.6; color: #374151; }
.guide-sec + .guide-sec { margin-top: 14px; }
.guide-sec-head { margin: 0 0 6px; font-size: 14px; font-weight: 800; color: #06a050; }
.guide-steps { margin: 0; padding-left: 20px; display: flex; flex-direction: column; gap: 6px; }
.guide-steps li { font-size: 14px; line-height: 1.6; color: #374151; }
</style>
