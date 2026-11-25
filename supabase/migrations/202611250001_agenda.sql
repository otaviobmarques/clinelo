-- Agenda própria do Clinelo. Horários persistidos como instantes com fuso.
create extension if not exists btree_gist;

create table public.clinics (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(trim(name)) > 0),
  timezone text not null default 'America/Sao_Paulo'
);

create table public.clinic_members (
  clinic_id uuid not null references public.clinics,
  user_id uuid not null references auth.users,
  primary key (clinic_id, user_id)
);

create table public.professionals (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinics,
  name text not null,
  unique (clinic_id, id)
);

create table public.appointments (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinics,
  professional_id uuid not null,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  status text not null default 'scheduled' check (status in ('scheduled','confirmed','cancelled','attended','absent')),
  check (ends_at > starts_at),
  foreign key (clinic_id, professional_id) references public.professionals (clinic_id, id),
  exclude using gist (professional_id with =, tstzrange(starts_at, ends_at, '[)') with &&)
    where (status <> 'cancelled')
);

alter table public.clinics enable row level security;
alter table public.clinic_members enable row level security;
alter table public.professionals enable row level security;
alter table public.appointments enable row level security;

create policy read_own_membership on public.clinic_members for select to authenticated
using (user_id = (select auth.uid()));

create policy read_member_clinics on public.clinics for select to authenticated
using (id in (select clinic_id from public.clinic_members where user_id = (select auth.uid())));

create policy read_clinic_professionals on public.professionals for select to authenticated
using (clinic_id in (select clinic_id from public.clinic_members where user_id = (select auth.uid())));

create policy read_clinic_appointments on public.appointments for select to authenticated
using (clinic_id in (select clinic_id from public.clinic_members where user_id = (select auth.uid())));

-- A escrita será liberada pelo serviço de agenda após validação de perfil e unidade.
revoke all on public.clinics, public.clinic_members, public.professionals, public.appointments from anon, authenticated;
grant select on public.clinics, public.clinic_members, public.professionals, public.appointments to authenticated;
