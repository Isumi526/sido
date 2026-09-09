<template>
  <div class="na-wrap">
    <div class="na-card" data-testid="no-account">
      <span class="material-symbols-outlined na-icon">person_off</span>
      <h1 class="na-title">作業員情報が見つかりません</h1>
      <p class="na-body">
        ログインはできていますが、このアカウントに紐づく作業員が登録されていません。
        日報・打刻・経費の入力には作業員の登録が必要です。
      </p>
      <p class="na-body na-note">
        お手数ですが、管理者（事務所）に連絡して<br>作業員の登録とログイン情報の発行を依頼してください。
      </p>
      <NuxtLink to="/login" class="na-btn" data-testid="no-account-login">別のIDでログインする</NuxtLink>
    </div>
  </div>
</template>

<script setup lang="ts">
// ============================================================
//  /no-account — 「身元が解決できなかった」時の行き止まり画面。
//
//  ★ここは旧 /register（作業員が自分で自分を登録する画面）の置き換え。
//   新規ユーザーは管理画面でメール/パスワードを発行して作る運用になったため、
//   作業員が自分で workers 行を作る経路は 2026-09-09 に廃止した。
//   （自己登録は「作業員が任意の名前で自分を作れる」＝権限の入口でもあった）
//
//  ★なぜ /login に飛ばさないか
//   ここに来る人は **ログイン自体は成立している**（users 行や worker_id が無いだけ）。
//   /login へ送るとセッションが有るまま入口に戻され、また同じ画面へ弾かれる
//   ＝無限ループに見える。行き止まりであることと、次に取るべき行動を明示する。
// ============================================================
</script>

<style scoped>
.na-wrap { min-height: 100vh; display: flex; align-items: center; justify-content: center; background: #f5f5f5; padding: 24px; }
.na-card { background: #fff; border-radius: 16px; padding: 32px 24px; width: 100%; max-width: 360px; box-shadow: 0 2px 12px rgba(0,0,0,.08); text-align: center; }
.na-icon { font-size: 44px; color: #bdbdbd; }
.na-title { font-size: 17px; font-weight: 700; margin-top: 12px; }
.na-body { font-size: 13px; color: #666; line-height: 1.8; margin-top: 14px; text-align: left; }
.na-note { color: #333; font-weight: 600; }
.na-btn { display: block; margin-top: 24px; background: #06C755; color: #fff; border-radius: 8px; padding: 13px; font-size: 14px; font-weight: 700; text-decoration: none; }
</style>
