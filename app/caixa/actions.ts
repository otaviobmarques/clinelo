"use server";

import { redirect } from "next/navigation";
import { validId } from "../../lib/agenda";
import { inboxUrl } from "../../lib/inbox";
import { supabase } from "../../lib/supabase";

export async function changeInbox(form: FormData) {
  const clinic = String(form.get("clinic") ?? "");
  const thread = String(form.get("thread") ?? "");
  const operation = String(form.get("operation") ?? "");
  const text = String(form.get("text") ?? "").trim();
  const status = form.get("status") === "closed" ? "closed" : "open";
  if (!validId(clinic)) redirect(inboxUrl(undefined, status, undefined, "invalid"));
  const selected = validId(thread) ? thread : undefined;
  if (!["create", "note", "close", "reopen"].includes(operation)
    || (operation !== "create" && !selected)
    || (["create", "note"].includes(operation) && (!text || Array.from(text).length > (operation === "create" ? 120 : 2000)))) {
    redirect(inboxUrl(clinic, status, selected, "invalid"));
  }

  const client = await supabase();
  const { data, error } = await client.rpc("inbox_change", {
    p_clinic: clinic, p_action: operation, p_thread: selected ?? null, p_text: text || null,
  });

  if (error) {
    const code = error.code === "42501" ? "access" : error.code === "P0001" ? "changed" : "error";
    redirect(inboxUrl(clinic, status, selected, code));
  }

  const nextStatus = operation === "close" ? "closed" : operation === "note" ? status : "open";
  redirect(inboxUrl(clinic, nextStatus, data, operation));
}
