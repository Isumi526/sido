---
title: External/anon access must verify token
severity: critical
paths:
  - apps/liff/pages/**
  - apps/admin/src/pages/**
  - supabase/functions/**
  - supabase/migrations/**
---
未認証アクセス可能なルート／ページ／RLS ポリシー（注文書の承諾画面など外部受注者導線を含む）は、
推測困難なトークン（UUID／署名／ハッシュ）を要求し、行レベルで照合すること。
obscurity 依存（URL を知っていれば見える）・token 照合なしの anon 可読を critical として指摘する。
