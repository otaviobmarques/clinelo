create table public.inbox_threads (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinics,
  subject text not null check (char_length(btrim(subject)) between 1 and 120),
  status text not null default 'open' check (status in ('open', 'closed')),
  created_by uuid references auth.users on delete set null,
  updated_at timestamptz not null default now(),
  unique (clinic_id, id)
);

create table public.inbox_notes (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null,
  thread_id uuid not null,
  body text not null check (char_length(btrim(body)) between 1 and 2000),
  author_id uuid references auth.users on delete set null,
  created_at timestamptz not null default now(),
  foreign key (clinic_id, thread_id) references public.inbox_threads (clinic_id, id) on delete cascade
);

create index inbox_threads_queue_idx on public.inbox_threads (clinic_id, status, updated_at desc, id);
create index inbox_notes_timeline_idx on public.inbox_notes (clinic_id, thread_id, created_at desc, id);
alter table public.inbox_threads enable row level security;
alter table public.inbox_notes enable row level security;

create policy read_clinic_inbox on public.inbox_threads for select to authenticated
  using (clinic_id in (select clinic_id from public.clinic_members where user_id = (select auth.uid())));
create policy read_clinic_notes on public.inbox_notes for select to authenticated
  using (clinic_id in (select clinic_id from public.clinic_members where user_id = (select auth.uid())));

revoke all on public.inbox_threads, public.inbox_notes from anon, authenticated;
grant select on public.inbox_threads, public.inbox_notes to authenticated;

create function public.inbox_change(
  p_clinic uuid, p_action text, p_thread uuid default null, p_text text default null
)
returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  actor uuid := auth.uid();
  item public.inbox_threads;
begin
  perform 1 from public.clinic_members where clinic_id = p_clinic and user_id = actor for key share;
  if not found then
    raise exception 'Clínica indisponível para este usuário.' using errcode = '42501';
  end if;

  if p_action = 'create' then
    insert into public.inbox_threads (clinic_id, subject, created_by)
      values (p_clinic, btrim(p_text), actor) returning * into item;
    return item.id;
  end if;

  if p_action is null or p_action not in ('note', 'close', 'reopen') then
    raise exception 'Operação inválida.' using errcode = '22023';
  end if;

  select * into item from public.inbox_threads where clinic_id = p_clinic and id = p_thread for update;
  if not found then
    raise exception 'Atendimento indisponível.' using errcode = 'P0001';
  end if;

  if p_action = 'note' then
    if item.status <> 'open' then
      raise exception 'Reabra o atendimento para adicionar notas.' using errcode = 'P0001';
    end if;
    insert into public.inbox_notes (clinic_id, thread_id, body, author_id)
      values (p_clinic, item.id, btrim(p_text), actor);
    update public.inbox_threads set updated_at = clock_timestamp() where id = item.id;
  elsif p_action = 'close' and item.status = 'open' then
    update public.inbox_threads set status = 'closed', updated_at = clock_timestamp() where id = item.id;
  elsif p_action = 'reopen' and item.status = 'closed' then
    update public.inbox_threads set status = 'open', updated_at = clock_timestamp() where id = item.id;
  end if;

  return item.id;
end;
$$;

revoke all on function public.inbox_change(uuid, text, uuid, text) from public, anon, authenticated;
grant execute on function public.inbox_change(uuid, text, uuid, text) to authenticated;
