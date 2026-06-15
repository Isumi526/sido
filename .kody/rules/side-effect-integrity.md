---
title: Side-effects must not pre-commit status
severity: high
paths:
  - supabase/functions/**
---
メール送信等の外部副作用は、送信成功を確認するまでレコードを「発行済／送信済」にしないこと。
成功前に status を進める・送信失敗を握り潰す（エラーを無視して成功扱いにする）実装を high として指摘する。
