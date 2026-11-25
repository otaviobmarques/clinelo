create table public.appointment_events (
  id bigint generated always as identity primary key,
  appointment_id uuid not null references public.appointments on delete cascade,
  revision integer not null,
  clinic_id uuid not null references public.clinics,
  actor_id uuid,
  occurred_at timestamptz not null default clock_timestamp(),
  previous_status text,
  status text not null,
  previous_start timestamptz,
  starts_at timestamptz not null,
  previous_professional uuid,
  professional_id uuid not null
);

create index appointment_events_timeline_idx on public.appointment_events (clinic_id, appointment_id, id desc);

alter table public.appointment_events enable row level security;
create policy read_clinic_appointment_events on public.appointment_events for select to authenticated
  using (clinic_id in (select clinic_id from public.clinic_members where user_id = (select auth.uid())));
revoke all on public.appointment_events from public, anon, authenticated;
grant select on public.appointment_events to authenticated;

create function clinelo_private.record_appointment_event()
returns trigger language plpgsql security definer set search_path = ''
as $$
begin
  if tg_op = 'UPDATE'
    and row(old.status, old.starts_at, old.ends_at, old.professional_id)
      is not distinct from row(new.status, new.starts_at, new.ends_at, new.professional_id) then
    return new;
  end if;
  insert into public.appointment_events (
    appointment_id, revision, clinic_id, actor_id, previous_status, status,
    previous_start, starts_at, previous_professional, professional_id
  ) values (
    new.id, new.revision, new.clinic_id, auth.uid(), old.status, new.status,
    old.starts_at, new.starts_at, old.professional_id, new.professional_id
  );
  return new;
end;
$$;

revoke all on function clinelo_private.record_appointment_event() from public, anon, authenticated;
create trigger record_appointment_event after insert or update on public.appointments
  for each row execute function clinelo_private.record_appointment_event();

create function public.agenda_undo_attendance(p_clinic uuid, p_appointment uuid, p_revision integer)
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

  update public.appointments a
    set status = e.previous_status, revision = a.revision + 1
    from (
      select * from public.appointment_events
      where clinic_id = p_clinic and appointment_id = p_appointment
      order by id desc limit 1
    ) e
    where a.id = p_appointment and a.clinic_id = p_clinic and a.revision = p_revision
      and not a.is_block and a.status in ('attended', 'absent')
      and e.clinic_id = a.clinic_id and e.appointment_id = a.id and e.revision = a.revision
      and e.status = a.status and e.previous_status in ('scheduled', 'confirmed')
    returning a.id into changed;
  if not found then
    raise exception 'Registro indisponível para correção.' using errcode = 'P0001';
  end if;
  return changed;
end;
$$;

revoke all on function public.agenda_undo_attendance(uuid, uuid, integer) from public, anon, authenticated;
grant execute on function public.agenda_undo_attendance(uuid, uuid, integer) to authenticated;
