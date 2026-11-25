alter table public.clinic_members add column can_manage_hours boolean not null default false;
alter table public.professional_hours add column revision uuid not null default gen_random_uuid();

create function clinelo_private.revise_professional_hours()
returns trigger language plpgsql set search_path = ''
as $$
begin
  new.revision := gen_random_uuid();
  return new;
end;
$$;

revoke all on function clinelo_private.revise_professional_hours() from public;
create trigger revise_professional_hours before update on public.professional_hours
  for each row execute function clinelo_private.revise_professional_hours();

create function public.agenda_manage_hours(
  p_clinic uuid, p_professional uuid, p_weekday smallint, p_action text, p_revision uuid default null,
  p_opens time default null, p_closes time default null, p_break_from time default null, p_break_until time default null
)
returns void
language plpgsql security definer set search_path = ''
as $$
begin
  -- FOR SHARE impede revogar a permissão enquanto uma alteração já autorizada está em curso.
  perform 1 from public.clinic_members
    where clinic_id = p_clinic and user_id = (select auth.uid()) and can_manage_hours
    for share;
  if not found then
    raise exception 'Sem permissão para administrar a grade desta clínica.' using errcode = '42501';
  end if;

  if p_weekday is null or p_weekday not between 1 and 7 or p_action is null
    or p_action not in ('set', 'closed', 'default')
    or (p_action = 'set' and (p_opens is null or p_closes is null))
    or not exists (select 1 from public.professionals where clinic_id = p_clinic and id = p_professional) then
    raise exception 'Dados da grade inválidos.' using errcode = '22023';
  end if;

  if p_action <> 'set' then
    p_opens := null;
    p_closes := null;
    p_break_from := null;
    p_break_until := null;
  end if;

  if p_action = 'default' then
    delete from public.professional_hours
      where clinic_id = p_clinic and professional_id = p_professional and weekday = p_weekday and revision = p_revision;
  elsif p_revision is null then
    insert into public.professional_hours (clinic_id, professional_id, weekday, opens_at, closes_at, break_from, break_until)
      values (p_clinic, p_professional, p_weekday, p_opens, p_closes, p_break_from, p_break_until)
      on conflict do nothing;
  else
    update public.professional_hours
      set opens_at = p_opens, closes_at = p_closes, break_from = p_break_from, break_until = p_break_until
      where clinic_id = p_clinic and professional_id = p_professional and weekday = p_weekday and revision = p_revision;
  end if;

  if not found then
    raise exception 'A grade mudou. Confira os horários e tente novamente.' using errcode = 'P0001';
  end if;
end;
$$;

revoke all on function public.agenda_manage_hours(uuid, uuid, smallint, text, uuid, time, time, time, time) from public, anon, authenticated;
grant execute on function public.agenda_manage_hours(uuid, uuid, smallint, text, uuid, time, time, time, time) to authenticated;
