create function public.agenda_set_status(p_clinic uuid, p_appointment uuid, p_revision integer, p_status text)
returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  changed uuid;
begin
  perform 1 from public.clinic_members
    where clinic_id = p_clinic and user_id = (select auth.uid())
    for key share;
  if not found then
    raise exception 'Clínica indisponível para este usuário.' using errcode = '42501';
  end if;

  if p_status is null or p_status not in ('confirmed', 'attended', 'absent') then
    raise exception 'Situação inválida.' using errcode = '22023';
  end if;

  update public.appointments
    set status = p_status, revision = revision + 1
    where clinic_id = p_clinic and id = p_appointment and revision = p_revision
      and status in ('scheduled', 'confirmed')
      and (
        (p_status = 'confirmed' and status = 'scheduled' and ends_at > statement_timestamp())
        or (p_status = 'attended' and starts_at <= statement_timestamp())
        or (p_status = 'absent' and ends_at <= statement_timestamp())
      )
    returning id into changed;
  if not found then
    raise exception 'O agendamento foi alterado ou está indisponível.' using errcode = 'P0001';
  end if;
  return changed;
end;
$$;

revoke all on function public.agenda_set_status(uuid, uuid, integer, text) from public, anon, authenticated;
grant execute on function public.agenda_set_status(uuid, uuid, integer, text) to authenticated;
