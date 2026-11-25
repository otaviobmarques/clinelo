create or replace function public.patient_search(p_clinic uuid, p_query text)
returns setof public.patients
language sql stable security invoker set search_path = ''
as $$
  with query as (
    select btrim(p_query) as term, regexp_replace(p_query, '[^0-9]', '', 'g') as digits
  )
  select p.* from public.patients p cross join query q
  where p.clinic_id = p_clinic and char_length(q.term) between 1 and 120
    and (
      strpos(clinelo_private.inbox_subject_key(p.name), clinelo_private.inbox_subject_key(q.term)) > 0
      or strpos(lower(p.email), lower(q.term)) > 0
      or (q.term ~ '^[0-9+().[:space:]-]+$' and char_length(q.digits) >= 4 and strpos(p.phone, q.digits) > 0)
    )
$$;

alter table public.appointment_events
  add column previous_patient_id uuid,
  add column patient_id uuid;

create or replace function clinelo_private.record_appointment_event()
returns trigger language plpgsql security definer set search_path = ''
as $$
begin
  if tg_op = 'UPDATE'
    and row(old.status, old.starts_at, old.ends_at, old.professional_id, old.patient_id)
      is not distinct from row(new.status, new.starts_at, new.ends_at, new.professional_id, new.patient_id) then
    return new;
  end if;

  insert into public.appointment_events (
    appointment_id, revision, clinic_id, actor_id, previous_status, status,
    previous_start, starts_at, previous_professional, professional_id, previous_patient_id, patient_id
  ) values (
    new.id, new.revision, new.clinic_id, auth.uid(), old.status, new.status,
    old.starts_at, new.starts_at, old.professional_id, new.professional_id, old.patient_id, new.patient_id
  );
  return new;
end;
$$;

create function public.patient_link_visit(
  p_clinic uuid, p_patient uuid, p_appointment uuid, p_revision integer, p_unlink boolean default false
)
returns void
language plpgsql security definer set search_path = ''
as $$
begin
  perform 1 from public.clinic_members
    where clinic_id = p_clinic and user_id = (select auth.uid()) for key share;
  if not found then
    raise exception 'Clínica indisponível para este usuário.' using errcode = '42501';
  end if;

  if p_unlink is null then
    raise exception 'Operação inválida.' using errcode = '22023';
  end if;

  perform 1 from public.patients
    where id = p_patient and clinic_id = p_clinic and (p_unlink or not archived)
    for share;
  if not found then
    raise exception 'Cadastro indisponível.' using errcode = 'P0001';
  end if;

  update public.appointments set patient_id = case when p_unlink then null else p_patient end,
    revision = revision + 1
    where clinic_id = p_clinic and id = p_appointment and not is_block and revision = p_revision
      and ((p_unlink and patient_id = p_patient) or (not p_unlink and patient_id is null));
  if not found then
    raise exception 'A consulta ou o vínculo foi alterado.' using errcode = 'P0001';
  end if;
end;
$$;

revoke all on function public.patient_link_visit(uuid, uuid, uuid, integer, boolean) from public, anon, authenticated;
grant execute on function public.patient_link_visit(uuid, uuid, uuid, integer, boolean) to authenticated;

create or replace function public.agenda_undo_attendance(p_clinic uuid, p_appointment uuid, p_revision integer)
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
        and previous_status is distinct from status
      order by id desc limit 1
    ) e
    where a.id = p_appointment and a.clinic_id = p_clinic and a.revision = p_revision
      and not a.is_block and a.status in ('attended', 'absent')
      and e.clinic_id = a.clinic_id and e.appointment_id = a.id
      and e.status = a.status and e.previous_status in ('scheduled', 'confirmed')
    returning a.id into changed;
  if not found then
    raise exception 'Registro indisponível para correção.' using errcode = 'P0001';
  end if;
  return changed;
end;
$$;
