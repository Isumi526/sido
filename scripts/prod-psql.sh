#!/usr/bin/env bash
# ============================================================
#  scripts/prod-psql.sh — 本番 Supabase への psql 実行（.env の SUPABASE_PROD_DB_URL 経由）
#
#  なぜ要るか（2026-09-22）: CC が本番SQLを回す時、毎回 `set -a && . ./.env && psql "$SUPABASE_PROD_DB_URL" …`
#  と書いていた。(1) 接続URLがコマンド行に見える形になりやすい (2) 許可ルールが書けない（先頭が cd/set）
#  (3) 読み取りのつもりで書き込みできてしまう。この1枚に寄せて、許可は `Bash(bash scripts/prod-psql.sh:*)` だけにする。
#
#  使い方:
#    bash scripts/prod-psql.sh --ro -c "select count(*) from sites;"      # 読み取り専用セッション（推奨・既定）
#    bash scripts/prod-psql.sh --rw -c "update … ;"                        # 書き込み（人の承認済みの時だけ）
#    bash scripts/prod-psql.sh --ro -f /path/to/query.sql
#    bash scripts/prod-psql.sh --rw -f /path/to/migration.sql
#  それ以外の引数はそのまま psql に渡す（-At など）。
#
#  安全:
#   - 既定は --ro（`set default_transaction_read_only = on`）。--rw を明示しない限り書けない。
#   - URL は環境変数のまま psql に渡す（argv に出さない）。出力にも印字しない。
#   - `db push` / `db reset` はここでは扱わない（.claude/settings.json で deny のまま）。
# ============================================================
set -uo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
MODE=ro
case "${1:-}" in
  --ro) MODE=ro; shift;;
  --rw) MODE=rw; shift;;
esac
[ $# -eq 0 ] && { echo "usage: prod-psql.sh [--ro|--rw] <psql args…>  (既定 --ro)" >&2; exit 2; }

# .env から SUPABASE_PROD_DB_URL だけを取り出す（他の秘密は環境に載せない）
URL="$(grep -E '^SUPABASE_PROD_DB_URL=' "$ROOT/.env" 2>/dev/null | head -1 | cut -d= -f2- | sed -E 's/^["'"'"']|["'"'"']$//g')"
[ -z "$URL" ] && { echo "SUPABASE_PROD_DB_URL が .env に無い" >&2; exit 1; }
case "$URL" in postgres*://*) : ;; *) echo "SUPABASE_PROD_DB_URL の形式が不正" >&2; exit 1;; esac

# URL は環境変数（PGSERVICEFILE 等と違い psql が直接読む形）で渡し、argv には出さない
export PGURL="$URL"
if [ "$MODE" = ro ]; then
  PGOPTIONS='-c default_transaction_read_only=on' psql "$PGURL" -v ON_ERROR_STOP=1 "$@"
else
  echo "[prod-psql] 書き込みモード（--rw）で実行します" >&2
  psql "$PGURL" -v ON_ERROR_STOP=1 "$@"
fi
