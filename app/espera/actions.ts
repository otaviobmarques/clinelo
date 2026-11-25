"use server";

import { redirect } from "next/navigation";
import { validDay, validId } from "../../lib/agenda";
import { supabase } from "../../lib/supabase";
import { waitingUrl } from "../../lib/waiting";

export async function changeWaiting(form: FormData) {
  const get = (key: string) => String(form.get(key) ?? "");
  const clinic = get("clinic");
  const patient = get("patient");
  const request = get("request");
  const operation = get("operation");
  const professional = get("professional");
  const day = get("day");
  const from = get("from");
  const until = get("until");
  const start = get("start");
  const scope = {
    clinic: validId(clinic) ? clinic : undefined,
    patient: validId(patient) ? patient : undefined,
    request: validId(request) ? request : undefined,
    day: validDay(day) ? day : undefined,
  };
  if (!scope.clinic || !["create", "book", "withdraw"].includes(operation)
    || (operation === "create" && (!scope.patient || !validId(professional) || !validDay(from) || !validDay(until)))
    || (operation !== "create" && !scope.request)
    || (operation === "book" && !Number.isFinite(Date.parse(start)))) {
    redirect(waitingUrl({ ...scope, notice: "invalid" }));
  }

  const client = await supabase();
  const { data, error } = await client.rpc("waiting_request_change", {
    p_clinic: clinic, p_action: operation, p_request: scope.request ?? null,
    p_patient: operation === "create" ? patient : null,
    p_professional: operation === "create" ? professional : null,
    p_from: operation === "create" ? from : null, p_until: operation === "create" ? until : null,
    p_start: operation === "book" ? new Date(start).toISOString() : null,
  });
  if (error) {
    const notices: Record<string, string> = {
      "42501": "forbidden", "23505": "duplicate", "22023": "invalid",
      "23P01": "conflict", "40P01": "conflict", P0001: "changed",
    };
    redirect(waitingUrl({ ...scope, notice: notices[error.code] ?? "error" }));
  }
  redirect(waitingUrl({ clinic, request: data, notice: operation, history: operation === "create" ? undefined : "1" }));
}
