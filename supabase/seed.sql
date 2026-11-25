insert into public.clinics (id, name) values
  ('10000000-0000-4000-8000-000000000001', 'Clínica Horizonte · Demo'),
  ('10000000-0000-4000-8000-000000000002', 'Clínica Sorriso · Demo');

insert into public.professionals (id, clinic_id, name) values
  ('20000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', 'Dra. Marina Exemplo'),
  ('20000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000001', 'Dr. Lucas Exemplo'),
  ('20000000-0000-4000-8000-000000000003', '10000000-0000-4000-8000-000000000002', 'Dra. Sofia Exemplo');

-- O próximo dia útil garante que o cenário continue utilizável em qualquer data.
with next_day as (
  select ((now() at time zone 'America/Sao_Paulo')::date + i) as day
  from generate_series(1, 7) as offset_day(i)
  where extract(isodow from (now() at time zone 'America/Sao_Paulo')::date + i) between 1 and 5
  order by i limit 1
)
insert into public.appointments (clinic_id, professional_id, starts_at, ends_at, patient_name)
select p.clinic_id, p.id, s.starts_at, s.ends_at, 'Paciente Fictício ' || right(p.id::text, 1)
from public.professionals p cross join next_day d
cross join lateral clinelo_private.work_slots(d.day, 'America/Sao_Paulo') s
where (s.starts_at at time zone 'America/Sao_Paulo')::time = time '09:00';
