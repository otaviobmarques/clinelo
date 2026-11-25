create table public.professional_hours (
  clinic_id uuid not null,
  professional_id uuid not null,
  weekday smallint not null check (weekday between 1 and 7),
  opens_at time,
  closes_at time,
  break_from time,
  break_until time,
  primary key (clinic_id, professional_id, weekday),
  foreign key (clinic_id, professional_id) references public.professionals (clinic_id, id) on delete cascade,
  check (
    (opens_at is null and closes_at is null and break_from is null and break_until is null)
    or (
      opens_at is not null and closes_at is not null and opens_at < closes_at
      and (extract(epoch from opens_at) % 1800 = 0) and (extract(epoch from closes_at) % 1800 = 0)
      and ((break_from is null and break_until is null) or (
        break_from is not null and break_until is not null
        and opens_at <= break_from and break_from < break_until and break_until <= closes_at
        and (extract(epoch from break_from) % 1800 = 0) and (extract(epoch from break_until) % 1800 = 0)
      ))
    )
  )
);

alter table public.professional_hours enable row level security;
create policy read_member_professional_hours on public.professional_hours for select to authenticated
  using (clinic_id in (select clinic_id from public.clinic_members where user_id = (select auth.uid())));
revoke all on public.professional_hours from public, anon, authenticated;
grant select on public.professional_hours to authenticated;
grant select, insert, update, delete on public.professional_hours to service_role;

-- A grade pode mudar durante o uso da agenda. As gravações de reservas e de grade
-- se coordenam por profissional, mantendo o GiST como árbitro de reservas concorrentes.
create function clinelo_private.lock_professional_hours()
returns trigger language plpgsql set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' and (old.clinic_id, old.professional_id, old.weekday)
    is distinct from (new.clinic_id, new.professional_id, new.weekday) then
    raise exception 'Para alterar a chave da grade, remova e recrie o registro.' using errcode = '22023';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(coalesce(new.professional_id, old.professional_id)::text, 731));
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;

revoke all on function clinelo_private.lock_professional_hours() from public;
create trigger professional_hours_lock before insert or update or delete on public.professional_hours
  for each row execute function clinelo_private.lock_professional_hours();

create function clinelo_private.professional_slots(p_clinic uuid, p_professional uuid, p_day date, p_timezone text)
returns table (starts_at timestamptz, ends_at timestamptz)
language sql stable set search_path = ''
as $$
  with override as (
    select h.opens_at, h.closes_at, h.break_from, h.break_until
    from public.professional_hours h
    where h.clinic_id = p_clinic and h.professional_id = p_professional
      and h.weekday = extract(isodow from p_day)
  ), custom_slots as (
    select start_at at time zone p_timezone as starts_at,
      (start_at + interval '30 minutes') at time zone p_timezone as ends_at
    from override o
    cross join lateral generate_series(p_day + o.opens_at, p_day + o.closes_at - interval '30 minutes', interval '30 minutes') s(start_at)
    where o.break_from is null or start_at + interval '30 minutes' <= p_day + o.break_from
      or start_at >= p_day + o.break_until
  )
  select s.starts_at, s.ends_at from custom_slots s where s.ends_at > s.starts_at
  union
  select s.starts_at, s.ends_at from clinelo_private.work_slots(p_day, p_timezone) s
    where not exists (select 1 from override) and s.ends_at > s.starts_at
$$;

revoke all on function clinelo_private.professional_slots(uuid, uuid, date, text) from public;
grant execute on function clinelo_private.professional_slots(uuid, uuid, date, text) to authenticated;

create or replace function public.agenda_slots(p_clinic uuid, p_professional uuid, p_day date)
returns table (starts_at timestamptz, ends_at timestamptz)
language sql stable set search_path = ''
as $$
  select slot.starts_at, slot.ends_at
  from public.clinics c
  join public.professionals p on p.clinic_id = c.id and p.id = p_professional
  cross join lateral clinelo_private.professional_slots(c.id, p.id, p_day, c.timezone) slot
  where c.id = p_clinic
    and slot.starts_at > statement_timestamp()
    and not exists (
      select 1 from public.appointments a
      where a.clinic_id = c.id and a.professional_id = p.id and a.status <> 'cancelled'
        and tstzrange(a.starts_at, a.ends_at, '[)') && tstzrange(slot.starts_at, slot.ends_at, '[)')
    )
  order by slot.starts_at
$$;

create or replace function public.agenda_change(
  p_clinic uuid, p_action text, p_professional uuid default null,
  p_start timestamptz default null, p_patient text default null,
  p_appointment uuid default null, p_revision integer default null
)
returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  clinic_timezone text;
  slot_end timestamptz;
  booking public.appointments;
begin
  -- O acesso é validado com o JWT do usuário, inclusive quando a RPC é chamada diretamente.
  select c.timezone into clinic_timezone
    from public.clinics c
    join public.clinic_members m on m.clinic_id = c.id
    where c.id = p_clinic and m.user_id = (select auth.uid())
    for key share of m;
  if not found then
    raise exception 'Clínica indisponível para este usuário.' using errcode = '42501';
  end if;

  if p_action is null or p_action not in ('book', 'move', 'cancel') then
    raise exception 'Operação inválida.' using errcode = '22023';
  end if;

  if p_action <> 'book' then
    select * into booking from public.appointments
      where id = p_appointment and clinic_id = p_clinic for update;
    if not found or booking.revision is distinct from p_revision
      or booking.status not in ('scheduled', 'confirmed') then
      raise exception 'O agendamento foi alterado ou está indisponível.' using errcode = 'P0001';
    end if;
  end if;

  if p_action = 'cancel' then
    update public.appointments set status = 'cancelled', revision = revision + 1
      where id = booking.id;
    return booking.id;
  end if;

  if not exists (select 1 from public.professionals where clinic_id = p_clinic and id = p_professional) then
    raise exception 'Profissional indisponível nesta clínica.' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock_shared(hashtextextended(p_professional::text, 731));
  select s.ends_at into slot_end
    from clinelo_private.professional_slots(
      p_clinic, p_professional, (p_start at time zone clinic_timezone)::date, clinic_timezone
    ) s
    where s.starts_at = p_start and s.starts_at > clock_timestamp() and s.ends_at > s.starts_at;
  if not found then
    raise exception 'Horário fora da grade de atendimento.' using errcode = '22023';
  end if;

  if p_action = 'move' then
    update public.appointments
      set professional_id = p_professional, starts_at = p_start, ends_at = slot_end, revision = revision + 1
      where id = booking.id;
  else
    if p_patient is null or char_length(btrim(p_patient)) not between 1 and 120 then
      raise exception 'Informe o nome do paciente.' using errcode = '22023';
    end if;
    insert into public.appointments (clinic_id, professional_id, starts_at, ends_at, patient_name)
      values (p_clinic, p_professional, p_start, slot_end, btrim(p_patient))
      returning * into booking;
  end if;

  -- A restrição de exclusão da migração original arbitra gravações concorrentes.
  return booking.id;
end;
$$;
