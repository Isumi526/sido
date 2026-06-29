<template>
  <div class="page">
    <AppNav :subtitle="$t('nav.rulebook')" :user-name="proxy.proxyTarget.value?.name ?? profile?.displayName" />
    <main class="wrap">
      <h1 class="ttl">{{ $t('nav.rulebook') }}</h1>
      <p class="lead">日々の運用ルールをまとめています。提出・申請の期限を守って、正確な記録にご協力ください。</p>

      <section class="card">
        <h2 class="sec"><span class="num">1</span>日報・経費の提出と編集</h2>
        <ul class="rules">
          <li><strong>提出・編集ができるのは「当日を含む過去3日以内」</strong>です（本日／前日／前々日まで）。</li>
          <li>それより前の日付は<strong>ロックされ、提出・編集できません</strong>。日報・経費のどちらも対象です。</li>
          <li>やむを得ず期限を過ぎた分を直したいときは、<strong>管理者へ許可を依頼</strong>してください。許可されると、その日に限り再度入力できます。</li>
          <li>提出忘れを防ぐため、未提出のリマインドが届きます。早めの提出をお願いします。</li>
        </ul>
      </section>

      <section class="card">
        <h2 class="sec"><span class="num">2</span>残業の申請</h2>
        <ul class="rules">
          <li>残業が発生する日は、<strong>当日の15:00までに残業申請</strong>を行ってください。</li>
          <li>未申請の日は、<strong>定時（終了時刻）以降の入力ができません</strong>。</li>
        </ul>
      </section>

      <section class="card">
        <h2 class="sec"><span class="num">3</span>勤務時間の基準</h2>
        <ul class="rules">
          <li>勤務時間は、<strong>現場ごとに担当者が設定した開始／終了時刻が基準</strong>になります。</li>
          <li>早朝搬入など例外的に時間がずれる場合は、残業申請で対応してください。</li>
        </ul>
      </section>

      <section class="card">
        <h2 class="sec"><span class="num">4</span>出退勤の打刻</h2>
        <ul class="rules">
          <li>現場への<strong>到着時と退出時の打刻は必須</strong>です。忘れずに行ってください。</li>
        </ul>
      </section>

      <p class="note">※ 本ルールは運用に合わせて更新されることがあります。最新の内容はこのページでご確認ください。</p>
    </main>
  </div>
</template>

<script setup lang="ts">
import { useI18n } from 'vue-i18n'

useI18n()
const proxy = useProxyMode()
const { profile } = useLiff()
</script>

<style scoped>
.page { min-height: 100dvh; background: #f6f7f9; }
.wrap { max-width: 680px; margin: 0 auto; padding: 16px 16px 48px; }
.ttl { font-size: 20px; font-weight: 700; margin: 8px 0 4px; color: #111827; }
.lead { font-size: 13px; color: #4b5563; line-height: 1.7; margin: 0 0 16px; }
.card {
  background: #fff; border: 1px solid #e5e7eb; border-radius: 12px;
  padding: 14px 16px; margin-bottom: 12px;
}
.sec { display: flex; align-items: center; gap: 8px; font-size: 15px; font-weight: 700; color: #0f172a; margin: 0 0 10px; }
.num {
  display: inline-flex; align-items: center; justify-content: center;
  width: 22px; height: 22px; border-radius: 6px;
  background: #0d9488; color: #fff; font-size: 13px; font-weight: 700;
}
.rules { margin: 0; padding-left: 18px; }
.rules li { font-size: 13px; color: #374151; line-height: 1.8; margin-bottom: 6px; }
.rules strong { color: #0f172a; }
.note { font-size: 12px; color: #6b7280; line-height: 1.6; margin-top: 16px; }
</style>
