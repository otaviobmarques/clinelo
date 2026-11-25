"use server";

import { createClient } from "@supabase/supabase-js";
import { redirect } from "next/navigation";
import { validId } from "../../lib/agenda";
import { inboxAssignment, inboxChannel, inboxSearch, inboxUrl } from "../../lib/inbox";
import { supabase } from "../../lib/supabase";
import { whatsappPhones } from "../../lib/whatsapp";
import { openRecipient, replySettings, sendWhatsappText, type ReplyResult } from "../../lib/whatsapp-reply";

export async function replyOnWhatsapp(nonce: string, form: FormData) {
  const clinic = String(form.get("clinic") ?? "");
  const thread = String(form.get("thread") ?? "");
  const body = String(form.get("reply") ?? "").trim();
  const location = {
    clinic: validId(clinic) ? clinic : undefined, thread: validId(thread) ? thread : undefined,
    status: "open" as const, channel: inboxChannel(form.get("channel")),
    assignment: inboxAssignment(form.get("assignment")), query: inboxSearch(form.get("q")),
  };
  if (!location.clinic || !location.thread || !validId(nonce) || !body || body.includes("\0") || Array.from(body).length > 4096) {
    redirect(inboxUrl({ ...location, notice: "invalid" }));
  }
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const settings = replySettings(process.env);
  const phones = whatsappPhones(clinic);
  if (!url || !key || !settings || !phones.length) redirect(inboxUrl({ ...location, notice: "replyUnavailable" }));

  const session = await supabase();
  const { data: { user } } = await session.auth.getUser();
  if (!user) redirect("/");
  const client = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data, error } = await client.rpc("whatsapp_reserve_reply", {
    p_actor: user.id, p_clinic: clinic, p_thread: thread, p_nonce: nonce, p_body: body, p_phones: phones,
  }).maybeSingle<{ phone: string; contact: string; cipher: string }>();
  if (error) redirect(inboxUrl({ ...location, notice: error.code === "42501" ? "access" : "replyUnknown" }));
  if (!data) redirect(inboxUrl({ ...location, notice: "replyUnavailable" }));

  let result: ReplyResult;
  try {
    const recipient = openRecipient(data.cipher, { clinic, phone: data.phone, contact: data.contact }, settings.secret);
    result = await sendWhatsappText(settings, data.phone, recipient, body);
  } catch {
    result = "rejected";
  }
  const finished = await client.rpc("whatsapp_finish_reply", { p_clinic: clinic, p_nonce: nonce, p_status: result });
  const notices = { accepted: "replyAccepted", rejected: "replyRejected", unknown: "replyUnknown" };
  redirect(inboxUrl({ ...location, notice: finished.error ? "replyUnknown" : notices[result] }));
}
