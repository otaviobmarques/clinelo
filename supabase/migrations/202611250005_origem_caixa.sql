alter table public.inbox_threads
  add column channel text not null default 'manual' check (channel in ('manual', 'whatsapp'));

-- A origem permanece registrada mesmo que o atendimento receba notas internas.
update public.inbox_threads t
  set channel = 'whatsapp'
  where exists (
    select 1 from clinelo_private.whatsapp_contacts c
    where c.clinic_id = t.clinic_id and c.thread_id = t.id
  );

create index inbox_threads_channel_queue_idx
  on public.inbox_threads (clinic_id, status, channel, updated_at desc, id);

create function clinelo_private.mark_whatsapp_thread()
returns trigger language plpgsql set search_path = ''
as $$
begin
  update public.inbox_threads
    set channel = 'whatsapp'
    where clinic_id = new.clinic_id and id = new.thread_id and channel = 'manual';
  return new;
end;
$$;

revoke all on function clinelo_private.mark_whatsapp_thread() from public, anon, authenticated;

create trigger mark_whatsapp_thread after insert on public.inbox_notes
  for each row when (new.source = 'whatsapp')
  execute function clinelo_private.mark_whatsapp_thread();
