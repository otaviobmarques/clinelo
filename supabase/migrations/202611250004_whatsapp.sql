alter table public.inbox_notes
  add column source text not null default 'internal' check (source in ('internal', 'whatsapp'));
alter table public.inbox_notes drop constraint inbox_notes_body_check;
alter table public.inbox_notes add constraint inbox_notes_body_check
  check (char_length(btrim(body)) between 1 and case source when 'whatsapp' then 4096 else 2000 end);

create table clinelo_private.whatsapp_contacts (
  clinic_id uuid not null,
  phone_id text not null,
  contact_key text not null,
  thread_id uuid not null,
  primary key (clinic_id, phone_id, contact_key),
  foreign key (clinic_id, thread_id) references public.inbox_threads (clinic_id, id) on delete cascade
);

create table clinelo_private.whatsapp_receipts (
  clinic_id uuid not null references public.clinics,
  phone_id text not null,
  message_id text not null,
  primary key (clinic_id, phone_id, message_id)
);

create function public.whatsapp_receive(
  p_clinic uuid, p_phone text, p_contact text, p_message text, p_body text
)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  target uuid;
begin
  if p_phone is null or p_phone !~ '^[0-9]{1,32}$'
    or p_contact is null or p_contact !~ '^[a-f0-9]{64}$'
    or p_message is null or char_length(btrim(p_message)) not between 1 and 512 then
    raise exception 'Identificadores inválidos.' using errcode = '22023';
  end if;

  insert into clinelo_private.whatsapp_receipts (clinic_id, phone_id, message_id)
    values (p_clinic, p_phone, p_message) on conflict do nothing;
  if not found then return; end if;

  perform pg_advisory_xact_lock(hashtextextended(p_clinic::text || '/' || p_phone || '/' || p_contact, 0));
  select thread_id into target from clinelo_private.whatsapp_contacts
    where clinic_id = p_clinic and phone_id = p_phone and contact_key = p_contact;

  if target is null then
    insert into public.inbox_threads (clinic_id, subject)
      values (p_clinic, 'WhatsApp · Contato ' || left(p_contact, 8))
      returning id into target;
    insert into clinelo_private.whatsapp_contacts (clinic_id, phone_id, contact_key, thread_id)
      values (p_clinic, p_phone, p_contact, target);
  else
    update public.inbox_threads set status = 'open', updated_at = clock_timestamp()
      where clinic_id = p_clinic and id = target;
  end if;

  insert into public.inbox_notes (clinic_id, thread_id, body, source, created_at)
    values (p_clinic, target, btrim(p_body), 'whatsapp', clock_timestamp());
end;
$$;

revoke all on function public.whatsapp_receive(uuid, text, text, text, text) from public, anon, authenticated;
grant execute on function public.whatsapp_receive(uuid, text, text, text, text) to service_role;
