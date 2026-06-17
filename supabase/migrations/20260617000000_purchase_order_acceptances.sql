-- ============================================================
--  20260617000000_purchase_order_acceptances.sql
--  注文書の「業者承諾」証跡（同意履歴）— 見積→注文→請求エピックの「承諾画面」
--   - 業者がトークンURL(/p/<token>)から注文書を確認し、署名＋同意ボタンで承諾。
--   - 承諾の証跡として 同意日時 / IP / UA / 署名者名 / 署名画像パス / 対象PDFハッシュ を保存。
--   - 書込は subcontractor-portal Edge(service_role)のみ（業者はJWTを持たない）。
--     admin は自 account 分を read して承諾状況・証跡を確認する。
--   - purchase_orders に accepted_at を追加（一覧で「承諾済」を即表示するため）。
--  ★standalone-safe: 生成時点で account スコープの RLS を有効化（purchase_orders と同方針）。
--   anon は一切触らない（承諾書込は service_role 経由）ため anon は全拒否。
--  追加のみDDL（CREATE TABLE / INDEX / POLICY / enable RLS / revoke / ADD COLUMN）。破壊的変更なし。
--  ※ current_account_id() は 20260613000000_create_purchase_orders.sql で定義済み。
-- ============================================================

-- 注文書に「承諾日時」を追加（status='accepted' と併せて一覧の即時表示に使う）
alter table purchase_orders add column if not exists accepted_at timestamptz;

create table if not exists purchase_order_acceptances (
  id                uuid primary key default gen_random_uuid(),
  account_id        uuid references accounts(id) not null,
  purchase_order_id uuid references purchase_orders(id) not null,
  subcontractor_id  uuid references subcontractors(id),
  token_id          uuid references document_access_tokens(id),
  accepted_at       timestamptz not null default now(),  -- 同意日時（証跡）
  accepted_ip       text,                                -- 同意者IP（x-forwarded-for 先頭・証跡）
  user_agent        text,                                -- 同意者UA（証跡）
  signer_name       text,                                -- 署名者が入力した氏名（任意）
  signature_path    text,                                -- 署名画像PNGのStorageパス（expense-receipts）
  pdf_hash          text,                                -- 承諾時点の対象注文書PDFのSHA-256（null=PDF未生成）
  created_at        timestamptz default now()
);

create index if not exists poa_account_idx           on purchase_order_acceptances (account_id);
create index if not exists poa_order_idx             on purchase_order_acceptances (purchase_order_id);
create index if not exists poa_subcontractor_idx     on purchase_order_acceptances (subcontractor_id);

-- 1注文書につき承諾は1回（重複承諾を弾く＝冪等の土台）。
create unique index if not exists poa_order_unique
  on purchase_order_acceptances (purchase_order_id);

-- ★生成時点で RLS 有効化（一時的にもRLS-offにしない＝standalone-safe）
alter table purchase_order_acceptances enable row level security;

-- authenticated（admin）は自 account の証跡を read のみ（書込は service_role）。
create policy poa_sel on purchase_order_acceptances for select to authenticated
  using (account_id = (select public.current_account_id()));

-- anon は承諾証跡を一切使わない → ポリシー無し＝RLSで全拒否。多層防御で直接権限も剥奪。
revoke all on purchase_order_acceptances from anon;
