create function public.agenda_week(p_clinic uuid, p_professional uuid, p_from date)
returns table (day date, available integer, first_start timestamptz)
language sql stable security invoker set search_path = ''
as $$
  select p_from + days.offset_day, count(slot.starts_at)::integer, min(slot.starts_at)
  from public.professionals p
  cross join generate_series(0, 6) as days(offset_day)
  left join lateral public.agenda_slots(p_clinic, p_professional, p_from + days.offset_day) slot on true
  where p.id = p_professional and p.clinic_id = p_clinic
    and p_from between date '0001-01-01' and date '9999-12-25'
  group by days.offset_day
  order by days.offset_day
$$;

revoke all on function public.agenda_week(uuid, uuid, date) from public, anon, authenticated;
grant execute on function public.agenda_week(uuid, uuid, date) to authenticated;
