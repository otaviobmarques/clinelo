create function clinelo_private.inbox_subject_key(p_value text)
returns text
language sql immutable strict set search_path = ''
as $$
  select translate(lower(normalize(p_value, NFC)),
    'áàâãäéèêëíìîïóòôõöúùûüç', 'aaaaaeeeeiiiiooooouuuuc')
$$;

revoke all on function clinelo_private.inbox_subject_key(text) from public, anon, authenticated;
grant execute on function clinelo_private.inbox_subject_key(text) to authenticated;

-- As políticas de inbox_threads continuam aplicadas ao usuário que faz a busca.
create function public.inbox_search(p_clinic uuid, p_query text)
returns setof public.inbox_threads
language sql stable security invoker set search_path = ''
as $$
  select t.*
  from public.inbox_threads t
  where t.clinic_id = p_clinic
    and char_length(btrim(p_query)) between 1 and 120
    and strpos(clinelo_private.inbox_subject_key(t.subject),
      clinelo_private.inbox_subject_key(btrim(p_query))) > 0
$$;

revoke all on function public.inbox_search(uuid, text) from public, anon, authenticated;
grant execute on function public.inbox_search(uuid, text) to authenticated;
