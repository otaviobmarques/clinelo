alter table public.inbox_threads
  add column assignee_id uuid,
  add column assignee_label text,
  add foreign key (clinic_id, assignee_id) references public.clinic_members (clinic_id, user_id)
    on delete set null (assignee_id);

create function clinelo_private.reset_inbox_assignment()
returns trigger language plpgsql set search_path = '' as $$
begin
  if new.status = 'closed' then
    new.assignee_id := null;
  end if;
  if new.assignee_id is null then
    new.assignee_label := null;
  end if;
  return new;
end;
$$;

create trigger reset_inbox_assignment before update of status, assignee_id on public.inbox_threads
for each row execute function clinelo_private.reset_inbox_assignment();

create function public.inbox_assign_self(p_clinic uuid, p_thread uuid, p_release boolean)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  actor uuid := auth.uid();
  label text;
begin
  select coalesce(nullif(btrim(u.raw_user_meta_data->>'full_name'), ''), 'Atendente ' || left(actor::text, 8))
    into label from public.clinic_members m join auth.users u on u.id = m.user_id
    where m.clinic_id = p_clinic and m.user_id = actor for key share of m;
  if not found then
    raise exception 'Sem acesso à clínica.' using errcode = '42501';
  end if;
  update public.inbox_threads
    set assignee_id = case when p_release then null else actor end,
        assignee_label = case when p_release then null else left(label, 160) end
    where clinic_id = p_clinic and id = p_thread and status = 'open'
      and ((not p_release and (assignee_id is null or assignee_id = actor))
        or (p_release and assignee_id = actor));
  if not found then
    raise exception 'Responsável ou estado alterado.' using errcode = 'P0001';
  end if;
  return p_thread;
end;
$$;
revoke all on function public.inbox_assign_self(uuid,uuid,boolean) from public, anon;
grant execute on function public.inbox_assign_self(uuid,uuid,boolean) to authenticated;
