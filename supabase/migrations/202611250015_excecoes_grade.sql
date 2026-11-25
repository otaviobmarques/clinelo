create table public.professional_date_hours (
  like public.professional_hours including defaults including constraints
);

alter table public.professional_date_hours
  drop column weekday,
  add column day date not null check (day between date '0001-01-01' and date '9999-12-31'),
  add primary key (clinic_id, professional_id, day),
  add foreign key (clinic_id, professional_id) references public.professionals (clinic_id, id) on delete cascade;

alter table public.professional_date_hours enable row level security;
create policy read_member_professional_date_hours on public.professional_date_hours for select to authenticated
  using (clinic_id in (select clinic_id from public.clinic_members where user_id = (select auth.uid())));
revoke all on public.professional_date_hours from public, anon, authenticated;
grant select on public.professional_date_hours to authenticated;
grant select, insert, update, delete on public.professional_date_hours to service_role;

create function clinelo_private.lock_professional_date_hours()
returns trigger language plpgsql set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' and (old.clinic_id, old.professional_id, old.day)
    is distinct from (new.clinic_id, new.professional_id, new.day) then
    raise exception 'Para alterar a data ou o profissional, remova e recrie a exceção.' using errcode = '22023';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(coalesce(new.professional_id, old.professional_id)::text, 731));
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;

revoke all on function clinelo_private.lock_professional_date_hours() from public;
create trigger professional_date_hours_lock before insert or update or delete on public.professional_date_hours
  for each row execute function clinelo_private.lock_professional_date_hours();
create trigger revise_professional_date_hours before update on public.professional_date_hours
  for each row execute function clinelo_private.revise_professional_hours();

create or replace function clinelo_private.professional_slots(p_clinic uuid, p_professional uuid, p_day date, p_timezone text)
returns table (starts_at timestamptz, ends_at timestamptz)
language sql stable set search_path = ''
as $$
  with override as (
    select opens_at, closes_at, break_from, break_until
    from (
      select h.opens_at, h.closes_at, h.break_from, h.break_until, 1 as priority
      from public.professional_date_hours h
      where h.clinic_id = p_clinic and h.professional_id = p_professional and h.day = p_day
      union all
      select h.opens_at, h.closes_at, h.break_from, h.break_until, 2 as priority
      from public.professional_hours h
      where h.clinic_id = p_clinic and h.professional_id = p_professional
        and h.weekday = extract(isodow from p_day)
    ) rules
    order by priority limit 1
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

create function public.agenda_manage_date_hours(
  p_clinic uuid, p_professional uuid, p_day date, p_action text, p_revision uuid default null,
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

  if p_day is null or p_day not between date '0001-01-01' and date '9999-12-31' or p_action is null
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
    delete from public.professional_date_hours
      where clinic_id = p_clinic and professional_id = p_professional and day = p_day and revision = p_revision;
  elsif p_revision is null then
    insert into public.professional_date_hours (clinic_id, professional_id, day, opens_at, closes_at, break_from, break_until)
      values (p_clinic, p_professional, p_day, p_opens, p_closes, p_break_from, p_break_until)
      on conflict do nothing;
  else
    update public.professional_date_hours
      set opens_at = p_opens, closes_at = p_closes, break_from = p_break_from, break_until = p_break_until
      where clinic_id = p_clinic and professional_id = p_professional and day = p_day and revision = p_revision;
  end if;

  if not found then
    raise exception 'A grade mudou. Confira os horários e tente novamente.' using errcode = 'P0001';
  end if;
end;
$$;

revoke all on function public.agenda_manage_date_hours(uuid, uuid, date, text, uuid, time, time, time, time) from public, anon, authenticated;
grant execute on function public.agenda_manage_date_hours(uuid, uuid, date, text, uuid, time, time, time, time) to authenticated;
