<template>
  <!-- 位置情報の行（道具②）。出退勤と同じ4状態。取れなくても記録はできる（確認事項2=A）ので、ここは案内だけ -->
  <div class="geo" :class="state" data-testid="tool-geo">
    <span class="material-symbols-rounded geo-icon">{{ state === 'granted' ? 'location_on' : state === 'blocked' ? 'location_off' : 'my_location' }}</span>
    <span class="geo-text" data-testid="tool-geo-state">{{ label }}</span>
    <button v-if="state === 'idle' || state === 'retryable'" type="button" class="geo-btn" data-testid="tool-geo-get" @click="onFetch">{{ state === 'idle' ? $t('tools.geoGet') : $t('tools.geoRetry') }}</button>
  </div>
</template>

<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import type { GeoState } from '~/composables/useGeolocation'
const props = defineProps<{ state: GeoState; onFetch: () => Promise<unknown> }>()
const { t } = useI18n()
const label = computed(() =>
  props.state === 'granted' ? t('tools.geoGranted')
    : props.state === 'pending' ? t('tools.geoPending')
    : props.state === 'blocked' ? t('tools.geoBlocked')
    : props.state === 'retryable' ? t('tools.geoRetryable')
    : t('tools.geoIdle'))
</script>

<style scoped>
.geo { display: flex; align-items: center; gap: 8px; margin-top: 12px; padding: 8px 10px; border-radius: 8px; background: #f8fafc; font-size: 12px; color: #475569; }
.geo.granted { background: #ecfdf5; color: #047857; }
.geo.blocked, .geo.retryable { background: #fffbeb; color: #92400e; }
.geo-icon { font-size: 18px; }
.geo-text { flex: 1; line-height: 1.5; }
.geo-btn { font-size: 12px; padding: 5px 10px; border: 1px solid #cbd5e1; border-radius: 999px; background: #fff; color: #334155; white-space: nowrap; }
</style>
