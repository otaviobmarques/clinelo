create table public.patients (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinics,
  name text not null check (char_length(btrim(name)) between 1 and 120),
  phone text check (phone is null or phone ~ '^[+]?[0-9]{7,15}$'),
  email text check (email is null or (char_length(email) <= 254 and email ~ '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$')),
  archived boolean not null default false,
  revision uuid not null default gen_random_uuid(),
  unique (clinic_id, id)
);

create index patients_clinic_name_idx on public.patients (clinic_id, archived, name, id);
alter table public.patients enable row level security;
create policy read_clinic_patients on public.patients for select to authenticated
  using (clinic_id in (select clinic_id from public.clinic_members where user_id = (select auth.uid())));
revoke all on public.patients from public, anon, authenticated;
grant select on public.patients to authenticated;
grant select, insert, update, delete on public.patients to service_role;

alter table public.appointments
  add column patient_id uuid,
  add foreign key (clinic_id, patient_id) references public.patients (clinic_id, id)
    on delete set null (patient_id),
  add check (not is_block or patient_id is null);
create index appointments_patient_idx on public.appointments (clinic_id, patient_id, starts_at desc, id)
  where patient_id is not null;

create function public.patient_search(p_clinic uuid, p_query text)
returns setof public.patients
language sql stable security invoker set search_path = ''
as $$
  select p.* from public.patients p
  where p.clinic_id = p_clinic and char_length(btrim(p_query)) between 1 and 120
    and strpos(clinelo_private.inbox_subject_key(p.name), clinelo_private.inbox_subject_key(btrim(p_query))) > 0
$$;

create function public.patient_change(
  p_clinic uuid, p_action text, p_id uuid default null, p_revision uuid default null,
  p_name text default null, p_phone text default null, p_email text default null
)
returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  changed uuid;
begin
  perform 1 from public.clinic_members
    where clinic_id = p_clinic and user_id = (select auth.uid()) for key share;
  if not found then
    raise exception 'Clínica indisponível para este usuário.' using errcode = '42501';
  end if;

  if p_action is null or p_action not in ('create', 'update', 'archive', 'restore')
    or (p_action in ('create', 'update') and (p_name is null or char_length(btrim(p_name)) not between 1 and 120)) then
    raise exception 'Dados do paciente inválidos.' using errcode = '22023';
  end if;

  if p_action = 'create' then
    insert into public.patients (clinic_id, name, phone, email)
      values (p_clinic, btrim(p_name), nullif(btrim(p_phone), ''), nullif(btrim(p_email), ''))
      returning id into changed;
  elsif p_action = 'update' then
    update public.patients set name = btrim(p_name), phone = nullif(btrim(p_phone), ''),
      email = nullif(btrim(p_email), ''), revision = gen_random_uuid()
      where clinic_id = p_clinic and id = p_id and revision = p_revision and not archived
      returning id into changed;
  else
    update public.patients set archived = (p_action = 'archive'), revision = gen_random_uuid()
      where clinic_id = p_clinic and id = p_id and revision = p_revision
        and archived is distinct from (p_action = 'archive')
      returning id into changed;
  end if;

  if changed is null then
    raise exception 'O cadastro foi alterado ou está indisponível.' using errcode = 'P0001';
  end if;
  return changed;
end;
$$;

create function public.agenda_book_for_patient(
  p_clinic uuid, p_patient uuid, p_professional uuid, p_start timestamptz, p_thread uuid default null
)
returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  patient_name text;
  booked uuid;
begin
  perform 1 from public.clinic_members
    where clinic_id = p_clinic and user_id = (select auth.uid()) for key share;
  if not found then
    raise exception 'Clínica indisponível para este usuário.' using errcode = '42501';
  end if;

  select p.name into patient_name from public.patients p
    where p.clinic_id = p_clinic and p.id = p_patient and not p.archived for share;
  if not found then
    raise exception 'Paciente indisponível para agendamento.' using errcode = 'P0001';
  end if;

  if p_thread is null then
    booked := public.agenda_change(p_clinic, 'book', p_professional, p_start, patient_name);
  else
    booked := public.agenda_book_from_inbox(p_clinic, p_thread, p_professional, p_start, patient_name);
  end if;
  update public.appointments set patient_id = p_patient where clinic_id = p_clinic and id = booked;
  return booked;
end;
$$;

revoke all on function public.patient_search(uuid, text), public.patient_change(uuid, text, uuid, uuid, text, text, text),
  public.agenda_book_for_patient(uuid, uuid, uuid, timestamptz, uuid) from public, anon, authenticated;
grant execute on function public.patient_search(uuid, text), public.patient_change(uuid, text, uuid, uuid, text, text, text),
  public.agenda_book_for_patient(uuid, uuid, uuid, timestamptz, uuid) to authenticated;
