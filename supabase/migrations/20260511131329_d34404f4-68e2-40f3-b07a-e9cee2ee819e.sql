
-- Roles enum
create type public.app_role as enum ('admin', 'manager', 'user');

-- Profiles
create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text,
  full_name text,
  created_at timestamptz not null default now()
);
alter table public.profiles enable row level security;

-- User roles
create table public.user_roles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  role public.app_role not null,
  created_at timestamptz not null default now(),
  unique(user_id, role)
);
alter table public.user_roles enable row level security;

-- Has role function
create or replace function public.has_role(_user_id uuid, _role public.app_role)
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (select 1 from public.user_roles where user_id = _user_id and role = _role)
$$;

-- Settings
create table public.app_settings (
  key text primary key,
  value jsonb,
  updated_at timestamptz not null default now()
);
alter table public.app_settings enable row level security;

-- Activity logs
create table public.activity_logs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete set null,
  user_email text,
  action text not null,
  entity text,
  details jsonb,
  created_at timestamptz not null default now()
);
alter table public.activity_logs enable row level security;

-- Auto-create profile trigger
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public
as $$
begin
  insert into public.profiles (id, email, full_name)
  values (new.id, new.email, coalesce(new.raw_user_meta_data->>'full_name', new.email));
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- RLS policies
create policy "profiles self read" on public.profiles for select to authenticated using (auth.uid() = id or public.has_role(auth.uid(), 'admin'));
create policy "profiles self update" on public.profiles for update to authenticated using (auth.uid() = id or public.has_role(auth.uid(), 'admin'));
create policy "profiles admin insert" on public.profiles for insert to authenticated with check (public.has_role(auth.uid(), 'admin') or auth.uid() = id);

create policy "user_roles read auth" on public.user_roles for select to authenticated using (auth.uid() = user_id or public.has_role(auth.uid(), 'admin'));
create policy "user_roles admin manage" on public.user_roles for all to authenticated using (public.has_role(auth.uid(), 'admin')) with check (public.has_role(auth.uid(), 'admin'));

create policy "settings read auth" on public.app_settings for select to authenticated using (true);
create policy "settings admin write" on public.app_settings for all to authenticated using (public.has_role(auth.uid(), 'admin')) with check (public.has_role(auth.uid(), 'admin'));

create policy "activity read admin" on public.activity_logs for select to authenticated using (public.has_role(auth.uid(), 'admin'));
create policy "activity insert auth" on public.activity_logs for insert to authenticated with check (true);
