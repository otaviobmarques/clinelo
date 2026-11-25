alter table clinelo_private.whatsapp_contacts
  add column reply_cipher text,
  add column last_inbound_at timestamptz;

create table public.whatsapp_replies (
  id uuid primary key,
  clinic_id uuid not null,
  thread_id uuid not null,
  body text not null check (char_length(btrim(body)) between 1 and 4096),
  status text not null default 'sending' check (status in ('sending', 'accepted', 'rejected', 'unknown')),
  created_at timestamptz not null default now(),
  foreign key (clinic_id, thread_id) references public.inbox_threads (clinic_id, id) on delete cascade
);

create index whatsapp_replies_thread_history on public.whatsapp_replies (clinic_id, thread_id, created_at desc, id desc);
alter table public.whatsapp_replies enable row level security;
revoke all on public.whatsapp_replies from public, anon, authenticated;
grant select on public.whatsapp_replies to authenticated;
create policy whatsapp_replies_read on public.whatsapp_replies for select to authenticated
  using (clinic_id in (select clinic_id from public.clinic_members where user_id = (select auth.uid())));

create function public.whatsapp_receive_reply_context(
  p_clinic uuid, p_phone text, p_contact text, p_message text, p_body text,
  p_cipher text, p_inbound_at timestamptz
) returns void
language plpgsql security definer set search_path = ''
as $$
begin
  perform public.whatsapp_receive(p_clinic, p_phone, p_contact, p_message, p_body);
  if p_cipher is not null and p_inbound_at <= now() then
    update clinelo_private.whatsapp_contacts
       set reply_cipher = p_cipher, last_inbound_at = p_inbound_at
     where clinic_id = p_clinic and phone_id = p_phone and contact_key = p_contact
       and (last_inbound_at is null or last_inbound_at < p_inbound_at);
  end if;
end;
$$;

create function public.whatsapp_reply_available(p_clinic uuid, p_thread uuid, p_phones text[])
returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.clinic_members m
    join public.inbox_threads t on t.clinic_id = m.clinic_id
    join clinelo_private.whatsapp_contacts c on c.clinic_id = t.clinic_id and c.thread_id = t.id
    where m.clinic_id = p_clinic and m.user_id = auth.uid() and t.id = p_thread and t.status = 'open'
      and c.phone_id = any(p_phones) and c.reply_cipher is not null
      and c.last_inbound_at > now() - interval '24 hours'
  );
$$;

create function public.whatsapp_reserve_reply(
  p_actor uuid, p_clinic uuid, p_thread uuid, p_nonce uuid, p_body text, p_phones text[]
) returns table(phone text, contact text, cipher text)
language plpgsql security definer set search_path = ''
as $$
declare
  target clinelo_private.whatsapp_contacts%rowtype;
begin
  perform 1 from public.clinic_members where clinic_id = p_clinic and user_id = p_actor for key share;
  if not found then raise exception 'Acesso indisponível.' using errcode = '42501'; end if;
  perform 1 from public.inbox_threads where clinic_id = p_clinic and id = p_thread and status = 'open' for update;
  if not found then return; end if;
  select c.* into target from clinelo_private.whatsapp_contacts c
    where c.clinic_id = p_clinic and c.thread_id = p_thread
      and c.phone_id = any(p_phones) and c.reply_cipher is not null
      and c.last_inbound_at > clock_timestamp() - interval '24 hours'
    order by c.last_inbound_at desc, c.phone_id, c.contact_key limit 1;
  if not found then return; end if;
  insert into public.whatsapp_replies(id, clinic_id, thread_id, body)
    values (p_nonce, p_clinic, p_thread, p_body) on conflict (id) do nothing;
  if found then return query select target.phone_id, target.contact_key, target.reply_cipher; end if;
end;
$$;

create function public.whatsapp_finish_reply(p_clinic uuid, p_nonce uuid, p_status text)
returns void
language sql security definer set search_path = ''
as $$
  update public.whatsapp_replies set status = p_status
    where clinic_id = p_clinic and id = p_nonce and status = 'sending'
      and p_status in ('accepted', 'rejected', 'unknown');
$$;

revoke all on function public.whatsapp_receive_reply_context(uuid, text, text, text, text, text, timestamptz),
  public.whatsapp_reserve_reply(uuid, uuid, uuid, uuid, text, text[]),
  public.whatsapp_finish_reply(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.whatsapp_receive_reply_context(uuid, text, text, text, text, text, timestamptz),
  public.whatsapp_reserve_reply(uuid, uuid, uuid, uuid, text, text[]),
  public.whatsapp_finish_reply(uuid, uuid, text) to service_role;
revoke all on function public.whatsapp_reply_available(uuid, uuid, text[]) from public, anon;
grant execute on function public.whatsapp_reply_available(uuid, uuid, text[]) to authenticated;
