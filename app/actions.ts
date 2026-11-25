"use server";

import { redirect } from "next/navigation";
import { supabase } from "../lib/supabase";
import { agendaPatientQuery, agendaStatusFilter, agendaUrl, statusActions, validDay, validId } from "../lib/agenda";

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
  const thread = field(form, "thread");
  const revision = field(form, "revision");
  const start = field(form, "start");
  const history = field(form, "history");
  const patientId = field(form, "patientId");
  const patient = field(form, "patient").trim();

  const location = {
    clinic: validId(clinic) ? clinic : undefined,
    day: validDay(day) ? day : undefined,
    professional: validId(professional) ? professional : undefined,
    agendaProfessional: validId(agendaProfessional) ? agendaProfessional : undefined,
    patientQuery: agendaPatientQuery(field(form, "patientQuery")),
    block: action === "block" ? "1" : undefined,
    agendaStatus: agendaStatusFilter(field(form, "agendaStatus")),
    history: validId(history) ? history : undefined,
    patientId: validId(patientId) ? patientId : undefined,
    thread: validId(thread) ? thread : undefined,
    week: field(form, "week") === "1" ? "1" : undefined,
  };
  const undoAttendance = action === "undoAttendance";
  const statusChange = Object.hasOwn(statusActions, action);
  const creates = action === "book" || action === "block";
  const needsSlot = creates || action === "move";
  const cancels = action === "cancel" || action === "unblock";
  const editing = action === "move" && validId(appointment) ? appointment : undefined;
  if (!location.clinic || !location.day || (!needsSlot && !cancels && !statusChange && !undoAttendance)
    || (!creates && (!validId(appointment) || !/^\d{1,10}$/.test(revision) || Number(revision) > 2147483647))
    || (needsSlot && (!location.professional || !Number.isFinite(Date.parse(start))))
    || (action === "book" && ((thread && !location.thread) || (patientId && !location.patientId) || (!patientId && !patient)))
    || (creates && Array.from(patient).length > 120) || (action === "block" && (thread || patientId))) {
    redirect(agendaUrl({ ...location, edit: editing, notice: "invalid" }));
  }

  const client = await supabase();
  const { error } = action === "book" && location.patientId
    ? await client.rpc("agenda_book_for_patient", {
      p_clinic: clinic, p_patient: location.patientId, p_professional: professional,
      p_start: new Date(start).toISOString(), p_thread: location.thread ?? null,
    })
    : undoAttendance
    ? await client.rpc("agenda_undo_attendance", { p_clinic: clinic, p_appointment: appointment, p_revision: Number(revision) })
    : action === "block"
    ? await client.rpc("agenda_block", {
      p_clinic: clinic, p_professional: professional, p_start: new Date(start).toISOString(), p_reason: patient,
    })
    : action === "book" && location.thread
    ? await client.rpc("agenda_book_from_inbox", {
      p_clinic: clinic, p_thread: location.thread, p_professional: professional,
      p_start: new Date(start).toISOString(), p_patient: patient,
    })
    : statusChange
    ? await client.rpc("agenda_set_status", { p_clinic: clinic, p_appointment: appointment, p_revision: Number(revision), p_status: action })
    : await client.rpc("agenda_change", {
      p_clinic: clinic,
      p_action: cancels ? "cancel" : action,
      p_professional: cancels ? null : professional,
      p_start: cancels ? null : new Date(start).toISOString(),
      p_patient: action === "book" ? patient : null,
      p_appointment: action === "book" ? null : appointment,
      p_revision: action === "book" ? null : Number(revision),
    });

  const notices: Record<string, string> = {
    "23P01": "conflict", "40P01": "conflict", "42501": "forbidden",
    "22023": "invalid", P0001: "changed",
  };
  const success = undoAttendance ? "attendanceUndone" : action === "block" ? "blocked" : action === "unblock" ? "unblocked" : statusChange ? action : action === "book" ? "booked" : action === "move" ? "moved" : "cancelled";
  redirect(agendaUrl({
    ...location,
    block: error ? location.block : undefined,
    edit: error?.code === "23P01" || error?.code === "40P01" || error?.code === "22023" ? editing : undefined,
    notice: error ? (location.patientId && action === "book" && error.code === "P0001" ? "patientUnavailable"
      : location.thread && action === "book" && error.code === "P0001" ? "threadUnavailable" : notices[error.code] ?? "error") : success,
  }));
}
