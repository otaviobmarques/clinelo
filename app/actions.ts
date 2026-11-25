"use server";

import { redirect } from "next/navigation";
import { supabase } from "../lib/supabase";
import { agendaUrl, validDay, validId } from "../lib/agenda";

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
  const editing = action === "move" && validId(appointment) ? appointment : undefined;
  if (!location.clinic || !location.day || !["book", "move", "cancel"].includes(action)
    || (action !== "book" && (!validId(appointment) || !/^\d{1,10}$/.test(revision) || Number(revision) > 2147483647))
    || (action !== "cancel" && (!location.professional || !Number.isFinite(Date.parse(start))))
    || (action === "book" && (!patient || Array.from(patient).length > 120))) {
    redirect(agendaUrl({ ...location, edit: editing, notice: "invalid" }));
  }

  const client = await supabase();
  const { error } = await client.rpc("agenda_change", {
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
  const success = action === "book" ? "booked" : action === "move" ? "moved" : "cancelled";
  redirect(agendaUrl({
    ...location,
    edit: error?.code === "23P01" || error?.code === "40P01" || error?.code === "22023" ? editing : undefined,
    notice: error ? notices[error.code] ?? "error" : success,
  }));
}
