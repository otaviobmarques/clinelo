"use server";

import { redirect } from "next/navigation";
import { supabase } from "../lib/supabase";
import { agendaUrl, statusActions, validDay, validId } from "../lib/agenda";

function field(form: FormData, name: string) {
  const value = form.get(name);
  return typeof value === "string" ? value : "";
}

export async function login(form: FormData) {
  const client = await supabase();
  const { error } = await client.auth.signInWithPassword({
    email: field(form, "email").trim(), password: field(form, "password"),
  });
  redirect(error ? "/?notice=login" : "/");
}

export async function logout() {
  const client = await supabase();
  await client.auth.signOut({ scope: "local" });
  redirect("/");
}

export async function changeBooking(form: FormData) {
  const clinic = field(form, "clinic");
  const day = field(form, "day");
  const professional = field(form, "professional");
  const agendaProfessional = field(form, "agendaProfessional");
  const action = field(form, "operation");
  const appointment = field(form, "appointment");
  const revision = field(form, "revision");
  const start = field(form, "start");
  const patient = field(form, "patient").trim();

  const location = {
    clinic: validId(clinic) ? clinic : undefined,
    day: validDay(day) ? day : undefined,
    professional: validId(professional) ? professional : undefined,
    agendaProfessional: validId(agendaProfessional) ? agendaProfessional : undefined,
  };
  const statusChange = Object.hasOwn(statusActions, action);
  const needsSlot = action === "book" || action === "move";
  const editing = action === "move" && validId(appointment) ? appointment : undefined;
  if (!location.clinic || !location.day || (!needsSlot && action !== "cancel" && !statusChange)
    || (action !== "book" && (!validId(appointment) || !/^\d{1,10}$/.test(revision) || Number(revision) > 2147483647))
    || (needsSlot && (!location.professional || !Number.isFinite(Date.parse(start))))
    || (action === "book" && (!patient || Array.from(patient).length > 120))) {
    redirect(agendaUrl({ ...location, edit: editing, notice: "invalid" }));
  }

  const client = await supabase();
  const { error } = statusChange
    ? await client.rpc("agenda_set_status", { p_clinic: clinic, p_appointment: appointment, p_revision: Number(revision), p_status: action })
    : await client.rpc("agenda_change", {
      p_clinic: clinic,
      p_action: action,
      p_professional: action === "cancel" ? null : professional,
      p_start: action === "cancel" ? null : new Date(start).toISOString(),
      p_patient: action === "book" ? patient : null,
      p_appointment: action === "book" ? null : appointment,
      p_revision: action === "book" ? null : Number(revision),
    });

  const notices: Record<string, string> = {
    "23P01": "conflict", "40P01": "conflict", "42501": "forbidden",
    "22023": "invalid", P0001: "changed",
  };
  const success = statusChange ? action : action === "book" ? "booked" : action === "move" ? "moved" : "cancelled";
  redirect(agendaUrl({
    ...location,
    edit: error?.code === "23P01" || error?.code === "40P01" || error?.code === "22023" ? editing : undefined,
    notice: error ? notices[error.code] ?? "error" : success,
  }));
}
