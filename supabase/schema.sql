-- ============================================================================
-- WiFi Billing & Collections — Supabase schema
-- ----------------------------------------------------------------------------
-- Mirrors the app's offline SQLite tables so devices can sync.
--
-- Sync model: last-write-wins on `updated_at`. The writer's own timestamp is
-- authoritative (NOT overwritten by the server), so out-of-order pushes from
-- an offline device can never clobber a newer change — `maintain_updated_at`
-- discards any UPDATE whose `updated_at` is older than the stored row
-- (a stale push is silently ignored). Soft-deletes travel via `deleted_at`.
--
-- Device identity: `device_metadata.last_seen` records when each device last
-- synced. User accounts, PIN hashes and the audit trail are LOCAL-ONLY and
-- deliberately do NOT exist here.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- LWW maintenance: stamp missing updated_at, reject stale UPDATEs.
-- (Runs before update on every synced table.)
-- ---------------------------------------------------------------------------
create or replace function public.maintain_updated_at()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'UPDATE' and new.updated_at < old.updated_at then
    return old;              -- incoming change is older: ignore it
  end if;
  new.updated_at = coalesce(new.updated_at, now());
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- plans
-- ---------------------------------------------------------------------------
create table if not exists public.plans (
  id            text primary key,
  name          text not null,
  monthly_price double precision not null default 0,
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

-- NOTE: NO users table. User accounts and PIN hashes are device-local only —
-- exposing them to the anon role (public access) would leak credentials.

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
  installation_fee double precision not null default 0,
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
  amount       double precision not null default 0,
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
  amount        double precision not null default 0,
  method        text not null default 'cash',
  paid_at       text,
  reference     text,
  notes         text,
  recorded_by   text,
  device_id     text,
  cancelled     boolean not null default false,
  cancelled_at  timestamptz,
  cancel_reason text,
  cancelled_by  text,
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
  requested_by  text,
  decided_by    text,
  requested_at  timestamptz not null default now(),
  decided_at    timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  deleted_at    timestamptz
);

create index if not exists idx_requests_status on public.requests(status);

-- ---------------------------------------------------------------------------
-- device_metadata — which devices have synced and when
create table if not exists public.device_metadata (
  device_id    text primary key,
  display_name text,
  last_seen    timestamptz not null default now(),
  last_pull    timestamptz default now()
);

create index if not exists idx_device_seen on public.device_metadata(last_seen);

-- ---------------------------------------------------------------------------
-- LWW triggers on the six synced tables (drop-then-create is re-runnable)
-- ---------------------------------------------------------------------------
drop trigger if exists trg_plans_updated           on public.plans;
drop trigger if exists trg_customers_updated       on public.customers;
drop trigger if exists trg_installations_updated   on public.installations;
drop trigger if exists trg_invoices_updated        on public.invoices;
drop trigger if exists trg_payments_updated        on public.payments;
drop trigger if exists trg_requests_updated        on public.requests;

create trigger trg_plans_updated         before update on public.plans         for each row execute function public.maintain_updated_at();
create trigger trg_customers_updated     before update on public.customers     for each row execute function public.maintain_updated_at();
create trigger trg_installations_updated before update on public.installations for each row execute function public.maintain_updated_at();
create trigger trg_invoices_updated      before update on public.invoices      for each row execute function public.maintain_updated_at();
create trigger trg_payments_updated      before update on public.payments      for each row execute function public.maintain_updated_at();
create trigger trg_requests_updated      before update on public.requests      for each row execute function public.maintain_updated_at();

-- ---------------------------------------------------------------------------
-- Row Level Security
-- The app connects with the ANON (publishable) key and NO login, so the
-- `anon` role gets full CRUD on every row. This keeps phone <-> PC sync
-- password-free in a single-owner household app at the cost of exposing all
-- billing data to anyone holding the anon key (which ships in the app code).
-- If you change the app to use Supabase Auth (email/password), swap the two
-- policy lines below to `to authenticated`.
-- ---------------------------------------------------------------------------
alter table public.plans          enable row level security;
alter table public.customers      enable row level security;
alter table public.installations  enable row level security;
alter table public.invoices       enable row level security;
alter table public.payments       enable row level security;
alter table public.requests       enable row level security;
alter table public.device_metadata enable row level security;

create policy "public anon access on plans"          on public.plans          for all to anon using (true) with check (true);
create policy "public anon access on customers"      on public.customers      for all to anon using (true) with check (true);
create policy "public anon access on installations"  on public.installations  for all to anon using (true) with check (true);
create policy "public anon access on invoices"       on public.invoices       for all to anon using (true) with check (true);
create policy "public anon access on payments"       on public.payments       for all to anon using (true) with check (true);
create policy "public anon access on requests"       on public.requests       for all to anon using (true) with check (true);
create policy "public anon access on device_metadata" on public.device_metadata for all to anon using (true) with check (true);

-- ---------------------------------------------------------------------------
-- Cleanup for anyone who ran an earlier draft of this schema: the app keeps
-- users + audit_log local-only, so drop any stale copies (and old triggers).
-- ---------------------------------------------------------------------------
drop trigger if exists trg_users_updated on public.users;
drop policy if exists "public anon access on users" on public.users;
drop table if exists public.users cascade;
drop table if exists public.audit_log cascade;

-- ---------------------------------------------------------------------------
-- Keep-alive ping (prevents Free Tier auto-pause after 7 days of inactivity)
-- ---------------------------------------------------------------------------
-- `public.ping()` executes `SELECT 1` server-side. SECURITY DEFINER + an empty
-- search_path so the function ignores RLS and touches no tables. The keep-alive
-- cron (`scripts/keepalive/`) calls this via `supabase.rpc("ping")`.
create or replace function public.ping()
returns integer
language sql
security definer
set search_path = ''
as $$
  select 1
$$;

revoke all on function public.ping() from public;
grant execute on function public.ping() to anon;