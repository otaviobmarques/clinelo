-- O histórico anterior não registra quando um atendimento voltou à fila.
alter table public.inbox_threads add column queued_at timestamptz;

create function clinelo_private.track_queue_wait()
returns trigger language plpgsql set search_path = '' as $$
begin
  if new.status <> 'open' or new.assignee_id is not null then
    new.queued_at := null;
  elsif tg_op = 'INSERT' then
    new.queued_at := clock_timestamp();
  elsif old.status <> 'open' or old.assignee_id is not null then
    new.queued_at := clock_timestamp();
  end if;
  return new;
end;
$$;

-- Executar depois de reset_inbox_assignment, que libera o responsável ao encerrar.
create trigger track_queue_wait before insert or update of status, assignee_id
  on public.inbox_threads for each row execute function clinelo_private.track_queue_wait();

create index inbox_unassigned_wait_idx on public.inbox_threads
  (clinic_id, queued_at, updated_at desc, id) where status = 'open' and assignee_id is null;
