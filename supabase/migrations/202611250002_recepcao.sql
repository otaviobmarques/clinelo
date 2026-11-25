alter table public.appointments
  add column patient_name text not null default 'Paciente não identificado'
    check (char_length(btrim(patient_name)) between 1 and 120),
  add column revision integer not null default 0;

alter table public.appointments alter column patient_name drop default;
create index appointments_clinic_starts_idx on public.appointments (clinic_id, starts_at);
create index clinic_members_user_idx on public.clinic_members (user_id, clinic_id);

-- Intervalos fixos de 30 minutos, das 08h às 18h em dias úteis.
create schema if not exists clinelo_private;

create function clinelo_private.work_slots(p_day date, p_timezone text)
returns table (starts_at timestamptz, ends_at timestamptz)
language sql stable set search_path = ''
as $$
  select local_start at time zone p_timezone,
         (local_start + interval '30 minutes') at time zone p_timezone
  from generate_series(p_day + time '08:00', p_day + time '17:30', interval '30 minutes') as slot(local_start)
  where extract(isodow from p_day) between 1 and 5
$$;

create function public.agenda_day(p_clinic uuid, p_day date)
returns setof public.appointments
language sql stable set search_path = ''
as $$
  select a.*
  from public.appointments a
  join public.clinics c on c.id = a.clinic_id
  where c.id = p_clinic
    and a.starts_at < ((p_day + 1)::timestamp at time zone c.timezone)
    and a.ends_at > (p_day::timestamp at time zone c.timezone)
  order by a.starts_at, a.id
$$;

create function public.agenda_slots(p_clinic uuid, p_professional uuid, p_day date)
returns table (starts_at timestamptz, ends_at timestamptz)
language sql stable set search_path = ''
as $$
  select slot.starts_at, slot.ends_at
  from public.clinics c
  join public.professionals p on p.clinic_id = c.id and p.id = p_professional
  cross join lateral clinelo_private.work_slots(p_day, c.timezone) slot
  where c.id = p_clinic
    and slot.starts_at > statement_timestamp()
    and not exists (
      select 1 from public.appointments a
      where a.clinic_id = c.id and a.professional_id = p.id and a.status <> 'cancelled'
        and tstzrange(a.starts_at, a.ends_at, '[)') && tstzrange(slot.starts_at, slot.ends_at, '[)')
    )
  order by slot.starts_at
$$;

create function public.agenda_change(
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

  select s.ends_at into slot_end
    from clinelo_private.work_slots((p_start at time zone clinic_timezone)::date, clinic_timezone) s
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

revoke all on schema clinelo_private from public;
grant usage on schema clinelo_private to authenticated;
revoke all on function clinelo_private.work_slots(date, text) from public;
grant execute on function clinelo_private.work_slots(date, text) to authenticated;
revoke all on function public.agenda_day(uuid, date), public.agenda_slots(uuid, uuid, date),
  public.agenda_change(uuid, text, uuid, timestamptz, text, uuid, integer) from public, anon, authenticated;
grant execute on function public.agenda_day(uuid, date), public.agenda_slots(uuid, uuid, date),
  public.agenda_change(uuid, text, uuid, timestamptz, text, uuid, integer) to authenticated;
