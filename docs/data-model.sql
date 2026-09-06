-- REF-A Operations Hub relational model blueprint
-- PostgreSQL / Supabase target. Apply through versioned migrations in implementation.

create table if not exists organizations (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists departments (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id),
  code text not null,
  name text not null,
  is_active boolean not null default true,
  unique(organization_id, code)
);

create table if not exists lines (
  id uuid primary key default gen_random_uuid(),
  department_id uuid not null references departments(id),
  code text not null,
  name text not null,
  is_active boolean not null default true,
  unique(department_id, code)
);

create table if not exists areas (
  id uuid primary key default gen_random_uuid(),
  line_id uuid not null references lines(id),
  code text not null,
  name text not null,
  is_active boolean not null default true,
  unique(line_id, code)
);

create table if not exists stations (
  id uuid primary key default gen_random_uuid(),
  area_id uuid not null references areas(id),
  code text not null,
  name text not null,
  is_active boolean not null default true,
  unique(area_id, code)
);

create table if not exists processes (
  id uuid primary key default gen_random_uuid(),
  department_id uuid not null references departments(id),
  code text not null,
  name text not null,
  sequence_no integer,
  is_critical boolean not null default false,
  is_active boolean not null default true,
  unique(department_id, code)
);

create table if not exists models (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null,
  family text,
  is_active boolean not null default true
);

create table if not exists shifts (
  id uuid primary key default gen_random_uuid(),
  department_id uuid not null references departments(id),
  code text not null,
  name text not null,
  start_time time not null,
  end_time time not null,
  is_overnight boolean not null default false,
  is_active boolean not null default true,
  unique(department_id, code)
);

create table if not exists employees (
  id uuid primary key default gen_random_uuid(),
  department_id uuid not null references departments(id),
  employee_code text not null,
  display_name text not null,
  job_title text,
  team text,
  is_active boolean not null default true,
  unique(department_id, employee_code)
);

create table if not exists production_plans (
  id uuid primary key default gen_random_uuid(),
  production_date date not null,
  shift_id uuid not null references shifts(id),
  line_id uuid not null references lines(id),
  model_id uuid not null references models(id),
  planned_qty integer not null check(planned_qty >= 0),
  created_at timestamptz not null default now()
);

create table if not exists production_hourly (
  id uuid primary key default gen_random_uuid(),
  production_date date not null,
  shift_id uuid not null references shifts(id),
  line_id uuid not null references lines(id),
  model_id uuid not null references models(id),
  process_id uuid references processes(id),
  station_id uuid references stations(id),
  hour_start time not null,
  planned_qty integer,
  good_qty integer not null default 0 check(good_qty >= 0),
  ng_qty integer not null default 0 check(ng_qty >= 0),
  rework_qty integer not null default 0 check(rework_qty >= 0),
  scrap_qty integer not null default 0 check(scrap_qty >= 0),
  notes text,
  created_by uuid,
  created_at timestamptz not null default now()
);

create table if not exists defect_events (
  id uuid primary key default gen_random_uuid(),
  event_ts timestamptz not null default now(),
  production_date date not null,
  shift_id uuid references shifts(id),
  line_id uuid references lines(id),
  model_id uuid references models(id),
  process_id uuid references processes(id),
  station_id uuid references stations(id),
  defect_code text not null,
  category text,
  severity text,
  quantity integer not null check(quantity > 0),
  disposition text,
  description text,
  source_production_id uuid references production_hourly(id),
  created_by uuid
);

create table if not exists downtime_events (
  id uuid primary key default gen_random_uuid(),
  start_ts timestamptz not null,
  end_ts timestamptz,
  production_date date not null,
  shift_id uuid references shifts(id),
  line_id uuid references lines(id),
  area_id uuid references areas(id),
  station_id uuid references stations(id),
  reason_code text not null,
  planned boolean not null default false,
  description text,
  impact_qty integer,
  created_by uuid
);

create table if not exists materials (
  id uuid primary key default gen_random_uuid(),
  material_code text not null unique,
  name text not null,
  unit text not null,
  is_active boolean not null default true
);

create table if not exists material_standards (
  id uuid primary key default gen_random_uuid(),
  model_id uuid not null references models(id),
  material_id uuid not null references materials(id),
  standard_qty numeric(18,6) not null check(standard_qty >= 0),
  effective_from date not null,
  effective_to date,
  unique(model_id, material_id, effective_from)
);

create table if not exists material_transactions (
  id uuid primary key default gen_random_uuid(),
  transaction_ts timestamptz not null default now(),
  transaction_type text not null,
  material_id uuid not null references materials(id),
  model_id uuid references models(id),
  shift_id uuid references shifts(id),
  batch_lot text,
  qty numeric(18,6) not null,
  unit text not null,
  reference_type text,
  reference_id uuid,
  reason_code text,
  created_by uuid
);

create table if not exists critical_control_points (
  id uuid primary key default gen_random_uuid(),
  process_id uuid not null references processes(id),
  station_id uuid references stations(id),
  code text not null unique,
  characteristic text not null,
  unit text,
  target numeric(18,6),
  lsl numeric(18,6),
  usl numeric(18,6),
  min_value numeric(18,6),
  max_value numeric(18,6),
  frequency text,
  measurement_method text,
  reaction_plan text,
  is_active boolean not null default true
);

create table if not exists critical_checks (
  id uuid primary key default gen_random_uuid(),
  ccp_id uuid not null references critical_control_points(id),
  check_ts timestamptz not null default now(),
  shift_id uuid references shifts(id),
  model_id uuid references models(id),
  measured_value numeric(18,6),
  result text not null,
  notes text,
  created_by uuid
);

create table if not exists checklist_templates (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null,
  version text not null,
  frequency text,
  process_id uuid references processes(id),
  is_active boolean not null default true
);

create table if not exists checklist_items (
  id uuid primary key default gen_random_uuid(),
  template_id uuid not null references checklist_templates(id) on delete cascade,
  sequence_no integer not null,
  prompt text not null,
  item_type text not null,
  mandatory boolean not null default true,
  target_value text,
  acceptance_rule text
);

create table if not exists checklist_runs (
  id uuid primary key default gen_random_uuid(),
  template_id uuid not null references checklist_templates(id),
  run_ts timestamptz not null default now(),
  shift_id uuid references shifts(id),
  model_id uuid references models(id),
  station_id uuid references stations(id),
  status text not null default 'OPEN',
  score numeric(8,3),
  created_by uuid
);

create table if not exists checklist_responses (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references checklist_runs(id) on delete cascade,
  item_id uuid not null references checklist_items(id),
  response_text text,
  numeric_value numeric(18,6),
  pass boolean,
  evidence_url text,
  UNIQUE(run_id, item_id)
);

create table if not exists capa_actions (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  source_type text,
  source_id uuid,
  owner_employee_id uuid references employees(id),
  priority text,
  status text not null default 'OPEN',
  root_cause text,
  action_text text,
  due_date date,
  closed_at timestamptz,
  verification_result text,
  created_at timestamptz not null default now()
);

create table if not exists audit_log (
  id bigserial primary key,
  actor_user_id uuid,
  table_name text not null,
  record_id uuid,
  action text not null,
  old_data jsonb,
  new_data jsonb,
  created_at timestamptz not null default now()
);

create index if not exists idx_production_hourly_date_shift on production_hourly(production_date, shift_id);
create index if not exists idx_defect_events_date_shift on defect_events(production_date, shift_id);
create index if not exists idx_downtime_events_date_shift on downtime_events(production_date, shift_id);
create index if not exists idx_material_tx_ts on material_transactions(transaction_ts);
create index if not exists idx_critical_checks_ts on critical_checks(check_ts);
create index if not exists idx_audit_log_created on audit_log(created_at);
