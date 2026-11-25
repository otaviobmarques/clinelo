create function public.reception_dashboard(p_clinic uuid, p_day date)
returns jsonb
language sql stable security invoker set search_path = ''
as $$
  with clinic as (
    select id from public.clinics where id = p_clinic
  ), visits as materialized (
    select a.id, a.professional_id, a.patient_name, a.starts_at, a.status
    from clinic c cross join lateral public.agenda_day(c.id, p_day) a
    where not a.is_block
  ), next_visits as (
    select v.*, p.name as professional_name
    from visits v join public.professionals p on p.id = v.professional_id and p.clinic_id = p_clinic
    where v.status in ('scheduled', 'confirmed') and v.starts_at >= statement_timestamp()
    order by v.starts_at, v.id limit 5
  ), waiting as (
    select t.id, t.subject, t.channel, t.queued_at, t.updated_at
    from public.inbox_threads t join clinic c on c.id = t.clinic_id
    where t.status = 'open' and t.assignee_id is null
    order by t.queued_at asc nulls last, t.updated_at desc, t.id limit 5
  )
  select jsonb_build_object(
    'appointments', (
      select jsonb_build_object(
        'scheduled', count(*) filter (where status = 'scheduled'),
        'confirmed', count(*) filter (where status = 'confirmed'),
        'attended', count(*) filter (where status = 'attended'),
        'absent', count(*) filter (where status = 'absent'),
        'cancelled', count(*) filter (where status = 'cancelled')
      ) from visits
    ),
    'queue', (
      select jsonb_build_object(
        'open', count(*),
        'unassigned', count(*) filter (where t.assignee_id is null),
        'mine', count(*) filter (where t.assignee_id = (select auth.uid()))
      )
      from public.inbox_threads t where t.clinic_id = c.id and t.status = 'open'
    ),
    'next', coalesce((select jsonb_agg(to_jsonb(v) order by v.starts_at, v.id) from next_visits v), '[]'::jsonb),
    'waiting', coalesce((select jsonb_agg(to_jsonb(w) order by w.queued_at asc nulls last, w.updated_at desc, w.id) from waiting w), '[]'::jsonb)
  )
  from clinic c
$$;

revoke all on function public.reception_dashboard(uuid, date) from public, anon, authenticated;
grant execute on function public.reception_dashboard(uuid, date) to authenticated;
