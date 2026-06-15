---
title: Multi-tenant RLS isolation
severity: critical
paths:
  - supabase/migrations/**
  - supabase/functions/**
---
クライアントに露出する全 Supabase テーブルは、認証テナント／会社ID（account_id 等）で
行レベルにスコープされた RLS を持つこと。テナント跨ぎで他社の行を read/write しうる
新テーブル・ポリシー・クエリ（service_role の不用意な使用・RLS 未設定・account_id/tenant_id
条件の欠落を含む）を critical として指摘する。
