alter table public.appointments
  add column inbox_thread_id uuid,
  add foreign key (clinic_id, inbox_thread_id) references public.inbox_threads (clinic_id, id)
    on delete set null (inbox_thread_id);

create index appointments_inbox_thread_idx
  on public.appointments (clinic_id, inbox_thread_id, starts_at desc)
  where inbox_thread_id is not null;

create function public.agenda_book_from_inbox(
  p_clinic uuid, p_thread uuid, p_professional uuid, p_start timestamptz, p_patient text
)
returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  booked uuid;
begin
  -- O agendamento existente autentica o membro e arbitra a vaga.
  booked := public.agenda_change(p_clinic, 'book', p_professional, p_start, p_patient);
  perform 1 from public.inbox_threads
    where clinic_id = p_clinic and id = p_thread and status = 'open'
    for share;
  if not found then
    -- O erro reverte também a reserva recém-criada.
    raise exception 'Atendimento indisponível para agendamento.' using errcode = 'P0001';
  end if;

  update public.appointments set inbox_thread_id = p_thread
    where clinic_id = p_clinic and id = booked;
  return booked;
end;
$$;

revoke all on function public.agenda_book_from_inbox(uuid, uuid, uuid, timestamptz, text) from public, anon, authenticated;
grant execute on function public.agenda_book_from_inbox(uuid, uuid, uuid, timestamptz, text) to authenticated;
