alter table public.inbox_threads
  add column patient_id uuid,
  add column patient_link_revision uuid not null default gen_random_uuid(),
  add foreign key (clinic_id, patient_id) references public.patients (clinic_id, id)
    on delete set null (patient_id);

create index inbox_threads_patient_idx on public.inbox_threads (clinic_id, patient_id, updated_at desc, id)
  where patient_id is not null;

create function public.inbox_link_patient(p_clinic uuid, p_thread uuid, p_patient uuid, p_revision uuid, p_unlink boolean default false)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  actor uuid := auth.uid();
begin
  perform 1 from public.clinic_members where clinic_id = p_clinic and user_id = actor for key share;
  if not found then
    raise exception 'Clínica indisponível para este usuário.' using errcode = '42501';
  end if;
  if p_unlink is null then
    raise exception 'Operação inválida.' using errcode = '22023';
  end if;
  perform 1 from public.patients where clinic_id = p_clinic and id = p_patient and (p_unlink or not archived)
    for share;
  if not found then
    raise exception 'Paciente indisponível.' using errcode = 'P0001';
  end if;

  update public.inbox_threads
    set patient_id = case when p_unlink then null else p_patient end,
      patient_link_revision = gen_random_uuid(), updated_at = clock_timestamp()
    where clinic_id = p_clinic and id = p_thread and patient_link_revision = p_revision
      and ((p_unlink and patient_id = p_patient) or (not p_unlink and patient_id is null));
  if not found then
    raise exception 'Atendimento ou vínculo indisponível.' using errcode = 'P0001';
  end if;

  insert into public.inbox_notes (clinic_id, thread_id, body, author_id)
    values (p_clinic, p_thread,
      case when p_unlink then 'Vínculo com a ficha do paciente removido.' else 'Atendimento vinculado à ficha do paciente.' end,
      actor);
end;
$$;

revoke all on function public.inbox_link_patient(uuid, uuid, uuid, uuid, boolean) from public, anon, authenticated;
grant execute on function public.inbox_link_patient(uuid, uuid, uuid, uuid, boolean) to authenticated;
