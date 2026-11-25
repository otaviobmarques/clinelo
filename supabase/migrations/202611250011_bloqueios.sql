alter table public.appointments add column is_block boolean not null default false;

alter table public.appointments add constraint appointments_block_state
  check (not is_block or (status in ('scheduled', 'cancelled') and inbox_thread_id is null));

create function public.agenda_block(p_clinic uuid, p_professional uuid, p_start timestamptz, p_reason text default null)
returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  blocked uuid;
begin
  -- Reutiliza a validação da clínica, da grade e da exclusão de intervalos.
  blocked := public.agenda_change(p_clinic, 'book', p_professional, p_start,
    coalesce(nullif(btrim(p_reason), ''), 'Bloqueio de horário'));
  update public.appointments set is_block = true where clinic_id = p_clinic and id = blocked;
  return blocked;
end;
$$;

revoke all on function public.agenda_block(uuid, uuid, timestamptz, text) from public, anon, authenticated;
grant execute on function public.agenda_block(uuid, uuid, timestamptz, text) to authenticated;
