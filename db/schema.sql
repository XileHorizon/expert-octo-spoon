-- Ship Print eSell — portable PostgreSQL schema.
-- Works on any PostgreSQL 14+ instance. No vendor-specific extensions or services.
-- Apply with:  psql "$DATABASE_URL" -f db/schema.sql

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------- owners/auth
create table if not exists owners (
  id uuid primary key default gen_random_uuid(),
  email text not null,
  password_hash text not null,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Case-insensitive unique email without requiring the citext extension.
create unique index if not exists owners_email_lower_idx on owners (lower(email));

create table if not exists owner_sessions (
  token_hash text primary key,
  owner_id uuid not null references owners(id) on delete cascade,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);
create index if not exists owner_sessions_owner_idx on owner_sessions(owner_id);
create index if not exists owner_sessions_expiry_idx on owner_sessions(expires_at);

create table if not exists owner_password_resets (
  token_hash text primary key,
  owner_id uuid not null references owners(id) on delete cascade,
  expires_at timestamptz not null,
  used_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists owner_resets_owner_idx on owner_password_resets(owner_id);

-- ------------------------------------------------------------------- catalog
create table if not exists products (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  description text,
  minimum_quantity integer not null default 1 check (minimum_quantity > 0),
  active boolean not null default false,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists sizes (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references products(id) on delete cascade,
  name text not null,
  active boolean not null default false,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists materials (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references products(id) on delete cascade,
  name text not null,
  unit_price numeric(14,4) check (unit_price is null or unit_price >= 0),
  active boolean not null default false,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists material_sizes (
  material_id uuid not null references materials(id) on delete cascade,
  size_id uuid not null references sizes(id) on delete cascade,
  primary key (material_id, size_id)
);

create table if not exists bulk_tiers (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references products(id) on delete cascade,
  min_quantity integer not null check (min_quantity > 0),
  unit_price numeric(14,4) check (unit_price is null or unit_price >= 0),
  sort_order integer not null default 0,
  unique (product_id, min_quantity)
);

create table if not exists finishing_options (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  unit_price numeric(14,4) check (unit_price is null or unit_price >= 0),
  active boolean not null default false,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists fulfillment_options (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  flat_price numeric(14,4) check (flat_price is null or flat_price >= 0),
  active boolean not null default false,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ------------------------------------------------------------------ requests
create table if not exists quote_requests (
  id uuid primary key default gen_random_uuid(),
  idempotency_key uuid not null unique,
  customer_name text not null,
  customer_email text not null,
  organization text,
  phone text,
  fulfillment_id uuid references fulfillment_options(id),
  fulfillment_name text,
  pricing_status text not null check (pricing_status in ('priced','manual')),
  calculated_total numeric(14,2),
  status text not null check (status in ('received','intake_failed','reviewing','quoted','closed')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists quote_requests_created_idx on quote_requests(created_at desc);
create index if not exists quote_requests_status_idx on quote_requests(status);

create table if not exists quote_jobs (
  id uuid primary key default gen_random_uuid(),
  quote_request_id uuid not null references quote_requests(id) on delete cascade,
  client_id text not null,
  file_name text not null,
  file_size bigint not null check (file_size > 0),
  mime_type text not null,
  page_count integer check (page_count is null or page_count > 0),
  product_id text not null,
  size_id text not null,
  material_id text not null,
  product_name text,
  size_name text,
  material_name text,
  finishing_names jsonb not null default '[]'::jsonb,
  custom_width numeric(12,3),
  custom_height numeric(12,3),
  custom_units text check (custom_units is null or custom_units in ('in','cm','mm')),
  color_mode text not null default 'color' check (color_mode in ('color','black-white')),
  orientation text not null default 'portrait' check (orientation in ('portrait','landscape')),
  quantity integer not null check (quantity > 0),
  sides integer not null check (sides in (1,2)),
  finishing_ids jsonb not null default '[]'::jsonb,
  notes text,
  storage_path text unique,
  pricing_status text not null check (pricing_status in ('priced','manual')),
  calculated_subtotal numeric(14,2),
  pricing_reason text,
  created_at timestamptz not null default now()
);
create index if not exists quote_jobs_request_idx on quote_jobs(quote_request_id);

-- Upgrade existing installations without deleting historical metadata.
alter table quote_jobs add column if not exists custom_width numeric(12,3);
alter table quote_jobs add column if not exists custom_height numeric(12,3);
alter table quote_jobs add column if not exists custom_units text;
alter table quote_jobs add column if not exists color_mode text not null default 'color';
alter table quote_jobs add column if not exists orientation text not null default 'portrait';
alter table quote_jobs alter column storage_path drop not null;

-- ------------------------------------------ owner pricing model (additive)
-- Pricing belongs to the size + paper combination, never to a paper alone, so
-- two different papers may share a weight. Existing data is preserved.

alter table materials add column if not exists weight text;
alter table materials add column if not exists category text;

alter table sizes add column if not exists dimensions text;
alter table sizes add column if not exists base_price numeric(14,4) check (base_price is null or base_price >= 0);
alter table sizes add column if not exists billing_unit text not null default 'printed_page';
alter table sizes add column if not exists minimum_quantity integer not null default 1 check (minimum_quantity > 0);
alter table sizes add column if not exists manual_quote boolean not null default false;
alter table sizes add column if not exists included_note text;
do $$ begin
  alter table sizes add constraint sizes_billing_unit_check
    check (billing_unit in ('printed_page','piece','card','job'));
exception when duplicate_object then null; end $$;

-- Surcharge for one paper on one size. The standard paper is included in base.
create table if not exists size_papers (
  size_id uuid not null references sizes(id) on delete cascade,
  material_id uuid not null references materials(id) on delete cascade,
  surcharge numeric(14,4) check (surcharge is null or surcharge >= 0),
  is_standard boolean not null default false,
  active boolean not null default true,
  sort_order integer not null default 0,
  primary key (size_id, material_id)
);

-- Carry existing size/paper mappings forward exactly once.
insert into size_papers (size_id, material_id, surcharge, is_standard, active)
select ms.size_id, ms.material_id, 0, false, true
from material_sizes ms
on conflict (size_id, material_id) do nothing;

alter table finishing_options add column if not exists charge_basis text not null default 'per_piece';
do $$ begin
  alter table finishing_options add constraint finishing_charge_basis_check
    check (charge_basis in ('per_piece','per_printed_page','flat_per_job'));
exception when duplicate_object then null; end $$;

create table if not exists finishing_sizes (
  finishing_id uuid not null references finishing_options(id) on delete cascade,
  size_id uuid not null references sizes(id) on delete cascade,
  primary key (finishing_id, size_id)
);

-- Percentage bulk discounts replace per-tier unit overrides without data loss.
alter table bulk_tiers add column if not exists discount_percent numeric(5,2)
  check (discount_percent is null or (discount_percent >= 0 and discount_percent <= 100));
alter table bulk_tiers add column if not exists quantity_basis text not null default 'printed_pages';
alter table bulk_tiers add column if not exists active boolean not null default true;
alter table bulk_tiers alter column product_id drop not null;
do $$ begin
  alter table bulk_tiers add constraint bulk_tiers_quantity_basis_check
    check (quantity_basis in ('printed_pages','pieces'));
exception when duplicate_object then null; end $$;

create table if not exists bulk_tier_sizes (
  tier_id uuid not null references bulk_tiers(id) on delete cascade,
  size_id uuid not null references sizes(id) on delete cascade,
  primary key (tier_id, size_id)
);

create table if not exists email_deliveries (
  id uuid primary key default gen_random_uuid(),
  quote_request_id uuid not null references quote_requests(id) on delete cascade,
  status text not null check (status in ('not_configured','queued','provider_accepted','failed')),
  provider_message_id text,
  error_message text,
  created_at timestamptz not null default now()
);
create index if not exists email_deliveries_request_idx on email_deliveries(quote_request_id);

-- ------------------------------------------------------- settings and audit
create table if not exists business_settings (
  id boolean primary key default true check (id),
  contact_phone text not null default '',
  contact_email text not null default '',
  turnaround_intro text not null default '',
  standard_turnaround text not null default '',
  rush_turnaround text not null default '',
  support_copy text not null default 'Need help?',
  notification_target text,
  updated_at timestamptz not null default now(),
  updated_by uuid references owners(id)
);
insert into business_settings(id) values (true) on conflict (id) do nothing;

create table if not exists admin_activity_log (
  id bigint generated always as identity primary key,
  owner_id uuid references owners(id),
  action text not null,
  entity_type text not null,
  entity_id text,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

-- --------------------------------------- protect history from catalog edits
create or replace function prevent_referenced_catalog_delete() returns trigger
language plpgsql as $$
begin
  if tg_table_name = 'products' and exists (select 1 from quote_jobs where product_id = old.id::text) then
    raise exception using errcode='23503', message='This product appears in quote history; deactivate it instead.';
  elsif tg_table_name = 'sizes' and exists (select 1 from quote_jobs where size_id = old.id::text) then
    raise exception using errcode='23503', message='This size appears in quote history; deactivate it instead.';
  elsif tg_table_name = 'materials' and exists (select 1 from quote_jobs where material_id = old.id::text) then
    raise exception using errcode='23503', message='This material appears in quote history; deactivate it instead.';
  elsif tg_table_name = 'finishing_options' and exists (select 1 from quote_jobs where finishing_ids ? old.id::text) then
    raise exception using errcode='23503', message='This finishing option appears in quote history; deactivate it instead.';
  elsif tg_table_name = 'fulfillment_options' and exists (select 1 from quote_requests where fulfillment_id = old.id) then
    raise exception using errcode='23503', message='This fulfillment method appears in quote history; deactivate it instead.';
  end if;
  return old;
end;
$$;

drop trigger if exists protect_product_history on products;
create trigger protect_product_history before delete on products for each row execute function prevent_referenced_catalog_delete();
drop trigger if exists protect_size_history on sizes;
create trigger protect_size_history before delete on sizes for each row execute function prevent_referenced_catalog_delete();
drop trigger if exists protect_material_history on materials;
create trigger protect_material_history before delete on materials for each row execute function prevent_referenced_catalog_delete();
drop trigger if exists protect_finishing_history on finishing_options;
create trigger protect_finishing_history before delete on finishing_options for each row execute function prevent_referenced_catalog_delete();
drop trigger if exists protect_fulfillment_history on fulfillment_options;
create trigger protect_fulfillment_history before delete on fulfillment_options for each row execute function prevent_referenced_catalog_delete();

create or replace function set_updated_at() returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end;
$$;

drop trigger if exists requests_updated_at on quote_requests;
create trigger requests_updated_at before update on quote_requests for each row execute function set_updated_at();
drop trigger if exists settings_updated_at on business_settings;
create trigger settings_updated_at before update on business_settings for each row execute function set_updated_at();
drop trigger if exists owners_updated_at on owners;
create trigger owners_updated_at before update on owners for each row execute function set_updated_at();
