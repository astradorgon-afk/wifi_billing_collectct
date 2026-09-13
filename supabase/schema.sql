-- ============================================================================
-- WiFi Billing & Collections — Supabase schema
-- ----------------------------------------------------------------------------
-- Mirrors the app's offline SQLite tables so each device can sync.
-- Sync model: last-write-wins on `updated_at`, soft-delete via `deleted_at`.
--
--   push:  UPSERT rows where local updated_at > last_pull (per device), or
--          send changes from a local outbox; server keeps the newest updated_at.
--   pull:  SELECT * FROM t WHERE updated_at > $last_pull AND device_id != $me
--          (plus any tombstones) then upsert locally, and copy deleted_at rows
--          into the local "deleted/pending" state.
--
-- Device identity: every row records the device_id that created it. The app
-- keeps PIN hashes LOCAL-only — they are never synced (see users table).
-- ============================================================================

-- ---------------------------------------------------------------------------
-- Auto-update `updated_at` on any table that carries it
-- ---------------------------------------------------------------------------
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- plans
-- ---------------------------------------------------------------------------
create table if not exists public.plans (
  id            text primary key,
  name          text not null,
  monthly_price numeric(12,2) not null default 0,
  speed_mbps    integer not null default 0,
  active        boolean not null default true,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  deleted_at    timestamptz
);

-- ---------------------------------------------------------------------------
-- customers
-- ---------------------------------------------------------------------------
create table if not exists public.customers (
  id          text primary key,
  full_name   text not null,
  phone       text,
  address     text,
  plan_id     text references public.plans(id),
  status      text not null default 'active',
  archived    boolean not null default false,
  archived_at timestamptz,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  deleted_at  timestamptz
);

create index if not exists idx_customers_plan on public.customers(plan_id);
create index if not exists idx_customers_updated on public.customers(updated_at);

-- ---------------------------------------------------------------------------
-- users — synced metadata only. pin_hash never leaves the device.
-- ---------------------------------------------------------------------------
create table if not exists public.users (
  id             text primary key,
  username       text not null unique,
  name           text not null,
  role           text not null default 'collector' check (role in ('owner','collector')),
  active         boolean not null default true,
  must_change_pin boolean not null default false,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  deleted_at     timestamptz
);

-- ---------------------------------------------------------------------------
-- installations
-- ---------------------------------------------------------------------------
create table if not exists public.installations (
  id               text primary key,
  customer_id      text references public.customers(id),
  scheduled_date   text,
  started_at       text,
  completed_date   text,
  installer        text,
  status           text not null default 'scheduled',
  installation_fee numeric(12,2) not null default 0,
  notes            text,
  archived         boolean not null default false,
  archived_at      timestamptz,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  deleted_at       timestamptz
);

create index if not exists idx_installations_customer on public.installations(customer_id);
create index if not exists idx_installations_updated on public.installations(updated_at);

-- ---------------------------------------------------------------------------
-- invoices
-- ---------------------------------------------------------------------------
create table if not exists public.invoices (
  id           text primary key,
  customer_id  text references public.customers(id),
  period_start text,
  period_end   text,
  amount       numeric(12,2) not null default 0,
  type         text not null default 'monthly' check (type in ('monthly','installation')),
  status       text not null default 'unpaid',
  due_date     text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  deleted_at   timestamptz,
  -- mirrors the app's UNIQUE(customer_id, period_start, type) protection
  constraint uq_invoices_monthly unique (customer_id, period_start, type)
);

create index if not exists idx_invoices_customer on public.invoices(customer_id);
create index if not exists idx_invoices_period on public.invoices(period_start);
create index if not exists idx_invoices_updated on public.invoices(updated_at);

-- ---------------------------------------------------------------------------
-- payments
-- ---------------------------------------------------------------------------
create table if not exists public.payments (
  id            text primary key,
  invoice_id    text references public.invoices(id),
  amount        numeric(12,2) not null default 0,
  method        text not null default 'cash',
  paid_at       text,
  reference     text,
  notes         text,
  recorded_by   text references public.users(id),
  device_id     text,
  cancelled     boolean not null default false,
  cancelled_at  timestamptz,
  cancel_reason text,
  cancelled_by  text references public.users(id),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  deleted_at    timestamptz
);

create index if not exists idx_payments_invoice on public.payments(invoice_id);
create index if not exists idx_payments_updated on public.payments(updated_at);

-- ---------------------------------------------------------------------------
-- requests — approval workflow (e.g. collector requests a reversal)
-- ---------------------------------------------------------------------------
create table if not exists public.requests (
  id            text primary key,
  type          text not null default 'reversal',
  status        text not null default 'pending' check (status in ('pending','approved','rejected','cancelled')),
  payload       jsonb,
  requested_by  text references public.users(id),
  decided_by    text references public.users(id),
  requested_at  timestamptz not null default now(),
  decided_at    timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  deleted_at    timestamptz
);

create index if not exists idx_requests_status on public.requests(status);

-- ---------------------------------------------------------------------------
-- audit_log — append-only trail
-- ---------------------------------------------------------------------------
create table if not exists public.audit_log (
  id          text primary key,
  ts          text not null,
  user_id     text references public.users(id),
  action      text not null,
  entity      text,
  entity_id   text,
  before_json jsonb,
  after_json  jsonb,
  device_id   text,
  created_at  timestamptz not null default now()
);

create index if not exists idx_audit_action on public.audit_log(action);
create index if not exists idx_audit_ts on public.audit_log(ts);

-- ---------------------------------------------------------------------------
-- device_metadata — which devices have synced and when (for last_pull)
-- ---------------------------------------------------------------------------
create table if not exists public.device_metadata (
  device_id    text primary key,
  display_name text,
  last_seen    timestamptz not null default now(),
  last_pull    timestamptz default now()
);

create index if not exists idx_device_seen on public.device_metadata(last_seen);

-- ---------------------------------------------------------------------------
-- updated_at triggers on mutable tables
-- ---------------------------------------------------------------------------
create trigger trg_plans_updated    before update on public.plans        for each row execute function public.set_updated_at();
create trigger trg_customers_updated before update on public.customers   for each row execute function public.set_updated_at();
create trigger trg_users_updated    before update on public.users        for each row execute function public.set_updated_at();
create trigger trg_installations_updated before update on public.installations for each row execute function public.set_updated_at();
create trigger trg_invoices_updated before update on public.invoices     for each row execute function public.set_updated_at();
create trigger trg_payments_updated before update on public.payments     for each row execute function public.set_updated_at();
create trigger trg_requests_updated before update on public.requests     for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- Row Level Security
-- This is a single-owner household business app: the authenticated Supabase
-- user (the owner) has full CRUD on all rows from any of their devices.
-- Collector accounts gate UI access inside the app, not via Supabase auth.
-- ---------------------------------------------------------------------------
alter table public.plans        enable row level security;
alter table public.customers    enable row level security;
alter table public.users        enable row level security;
alter table public.installations enable row level security;
alter table public.invoices     enable row level security;
alter table public.payments     enable row level security;
alter table public.requests     enable row level security;
alter table public.audit_log    enable row level security;
alter table public.device_metadata enable row level security;

create policy "owner full access on plans"        on public.plans         for all to authenticated using (true) with check (true);
create policy "owner full access on customers"    on public.customers     for all to authenticated using (true) with check (true);
create policy "owner full access on users"        on public.users         for all to authenticated using (true) with check (true);
create policy "owner full access on installations" on public.installations for all to authenticated using (true) with check (true);
create policy "owner full access on invoices"     on public.invoices      for all to authenticated using (true) with check (true);
create policy "owner full access on payments"     on public.payments      for all to authenticated using (true) with check (true);
create policy "owner full access on requests"     on public.requests      for all to authenticated using (true) with check (true);
create policy "owner full access on audit_log"    on public.audit_log     for all to authenticated using (true) with check (true);
create policy "owner full access on device_metadata" on public.device_metadata for all to authenticated using (true) with check (true);