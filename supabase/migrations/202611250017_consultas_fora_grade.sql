create function public.agenda_outside_hours(p_clinic uuid, p_from date, p_through date, p_professional uuid default null)
returns table (id uuid, professional_id uuid, patient_name text, starts_at timestamptz)
language sql stable security invoker set search_path = ''
as $$
  select a.id, a.professional_id, a.patient_name, a.starts_at
  from public.appointments a
  join public.clinics c on c.id = a.clinic_id
  where c.id = p_clinic
    and p_from between date '0001-01-01' and date '9999-12-31'
    and p_through between date '0001-01-01' and date '9999-12-31'
    and p_through - p_from between 0 and 89
    and (p_professional is null or a.professional_id = p_professional)
    and not a.is_block and a.status in ('scheduled', 'confirmed')
    and a.starts_at >= statement_timestamp()
    and a.starts_at >= (p_from::timestamp at time zone c.timezone)
    and a.starts_at < ((p_through + 1)::timestamp at time zone c.timezone)
    and not exists (
      select 1 from clinelo_private.professional_slots(
        c.id, a.professional_id, (a.starts_at at time zone c.timezone)::date, c.timezone
      ) slot
      where slot.starts_at = a.starts_at and slot.ends_at = a.ends_at
    )
  order by a.starts_at, a.id
$$;

revoke all on function public.agenda_outside_hours(uuid, date, date, uuid) from public, anon, authenticated;
grant execute on function public.agenda_outside_hours(uuid, date, date, uuid) to authenticated;
