"use server";

import { redirect } from "next/navigation";
import { validId } from "../../lib/agenda";
import { inboxAssignment, inboxChannel, inboxSearch, inboxUrl } from "../../lib/inbox";
import { supabase } from "../../lib/supabase";

export async function changeInbox(form: FormData) {
  const clinic = String(form.get("clinic") ?? "");
  const thread = String(form.get("thread") ?? "");
  const operation = String(form.get("operation") ?? "");
  const text = String(form.get("text") ?? "").trim();
  const status = form.get("status") === "closed" ? "closed" : "open";
  const assignment = inboxAssignment(form.get("assignment"));
  const channel = inboxChannel(form.get("channel"));
  const location = { clinic: validId(clinic) ? clinic : undefined, status, channel, assignment, query: inboxSearch(form.get("q")) } as const;
  if (!location.clinic) redirect(inboxUrl({ ...location, notice: "invalid" }));
  const selected = validId(thread) ? thread : undefined;
  if (!["create", "note", "close", "reopen", "claim", "release"].includes(operation)
    || (operation !== "create" && !selected)
    || (["create", "note"].includes(operation) && (!text || Array.from(text).length > (operation === "create" ? 120 : 2000)))) {
    redirect(inboxUrl({ ...location, thread: selected, notice: "invalid" }));
  }

  const client = await supabase();
  const { data, error } = operation === "claim" || operation === "release"
    ? await client.rpc("inbox_assign_self", { p_clinic: clinic, p_thread: selected, p_release: operation === "release" })
    : await client.rpc("inbox_change", {
      p_clinic: clinic, p_action: operation, p_thread: selected ?? null, p_text: text || null,
    });

  if (error) {
    const code = error.code === "42501" ? "access" : error.code === "P0001" ? "changed" : "error";
    redirect(inboxUrl({ ...location, thread: selected, notice: code }));
  }

  const nextStatus = operation === "close" ? "closed" : operation === "note" ? status : "open";
  const nextChannel = operation === "create" && channel === "whatsapp" ? "manual" : channel;
  let nextAssignment = assignment;
  if (operation === "claim" && assignment === "unassigned") nextAssignment = "mine";
  if (assignment === "mine" && ["release", "create"].includes(operation)) nextAssignment = "unassigned";
  redirect(inboxUrl({ ...location, status: nextStatus, thread: data, notice: operation, channel: nextChannel, assignment: nextAssignment, query: operation === "create" ? undefined : location.query }));
}
