alter table public.appointments add unique (clinic_id, id);

create table public.waiting_requests (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinics,
  patient_id uuid not null,
  professional_id uuid not null,
  date_from date not null,
  date_until date not null,
  status text not null default 'waiting' check (status in ('waiting', 'booked', 'withdrawn')),
  appointment_id uuid,
  created_at timestamptz not null default clock_timestamp(),
  check (date_from between date '0001-01-01' and date '9999-12-31'
    and date_until between date '0001-01-01' and date '9999-12-31'
    and date_until - date_from between 0 and 29),
  check (status = 'booked' or appointment_id is null),
  foreign key (clinic_id, patient_id) references public.patients (clinic_id, id) on delete cascade,
  foreign key (clinic_id, professional_id) references public.professionals (clinic_id, id),
  foreign key (clinic_id, appointment_id) references public.appointments (clinic_id, id) on delete set null (appointment_id)
);

create index waiting_requests_queue_idx on public.waiting_requests (clinic_id, status, created_at, id);
create unique index waiting_requests_active_idx on public.waiting_requests
  (clinic_id, patient_id, professional_id, date_from, date_until) where status = 'waiting';
alter table public.waiting_requests enable row level security;
create policy read_clinic_waiting_requests on public.waiting_requests for select to authenticated
  using (clinic_id in (select clinic_id from public.clinic_members where user_id = (select auth.uid())));
revoke all on public.waiting_requests from public, anon, authenticated;
grant select on public.waiting_requests to authenticated;
grant select, insert, update, delete on public.waiting_requests to service_role;

create function public.waiting_request_change(
  p_clinic uuid, p_action text, p_request uuid default null, p_patient uuid default null,
  p_professional uuid default null, p_from date default null, p_until date default null,
  p_start timestamptz default null
)
returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  clinic_zone text;
  request public.waiting_requests;
  booking uuid;
  begins date;
begin
  select c.timezone into clinic_zone from public.clinics c
  join public.clinic_members m on m.clinic_id = c.id
  where c.id = p_clinic and m.user_id = (select auth.uid()) for key share of m;
  if not found then raise exception 'Clínica indisponível.' using errcode = '42501'; end if;

  if p_action = 'create' then
    perform 1 from public.patients where clinic_id = p_clinic and id = p_patient and not archived for share;
    if not found then raise exception 'Paciente indisponível.' using errcode = 'P0001'; end if;
    if p_from is null or p_until is null or not isfinite(p_from) or not isfinite(p_until)
      or p_from < (statement_timestamp() at time zone clinic_zone)::date
      or p_until - p_from not between 0 and 29
      or not exists (select 1 from public.professionals where clinic_id = p_clinic and id = p_professional) then
      raise exception 'Preferência inválida.' using errcode = '22023';
    end if;
    insert into public.waiting_requests (clinic_id, patient_id, professional_id, date_from, date_until)
      values (p_clinic, p_patient, p_professional, p_from, p_until) returning * into request;
    return request.id;
  end if;

  if p_action is null or p_action not in ('book', 'withdraw') then
    raise exception 'Operação inválida.' using errcode = '22023';
  end if;
  select * into request from public.waiting_requests
    where clinic_id = p_clinic and id = p_request and status = 'waiting' for update;
  if not found then raise exception 'Solicitação indisponível.' using errcode = 'P0001'; end if;

  if p_action = 'withdraw' then
    update public.waiting_requests set status = 'withdrawn' where id = request.id;
  else
    begins := (p_start at time zone clinic_zone)::date;
    if begins is null or begins not between request.date_from and request.date_until then
      raise exception 'Horário fora da preferência.' using errcode = '22023';
    end if;
    booking := public.agenda_book_for_patient(p_clinic, request.patient_id, request.professional_id, p_start);
    update public.waiting_requests set status = 'booked', appointment_id = booking where id = request.id;
  end if;
  return request.id;
end;
$$;

revoke all on function public.waiting_request_change(uuid, text, uuid, uuid, uuid, date, date, timestamptz) from public, anon, authenticated;
grant execute on function public.waiting_request_change(uuid, text, uuid, uuid, uuid, date, date, timestamptz) to authenticated;
