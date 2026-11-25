"use server";

import { redirect } from "next/navigation";
import { agendaPatientQuery, validId } from "../../lib/agenda";
import { patientsUrl } from "../../lib/patients";
import { supabase } from "../../lib/supabase";

export async function savePatient(form: FormData) {
  const get = (name: string) => String(form.get(name) ?? "");
  const clinic = get("clinic");
  const patient = get("patient");
  const revision = get("revision");
  const appointment = get("appointment");
  const thread = get("thread");
  const operation = get("operation");
  const name = get("name").trim();
  const phone = get("phone").replace(/[\s().-]/g, "");
  const email = get("email").trim();
  const location = {
    clinic: validId(clinic) ? clinic : undefined,
    patient: validId(patient) ? patient : undefined,
    appointment: validId(appointment) ? appointment : undefined,
    thread: validId(thread) ? thread : undefined,
    q: agendaPatientQuery(get("q")),
    archived: get("archived") === "1" ? "1" : undefined,
  };
  const writesDetails = operation === "create" || operation === "update";
  if (!location.clinic || !["create", "update", "archive", "restore"].includes(operation)
    || (operation !== "create" && (!location.patient || !validId(revision)))
    || (writesDetails && (!name || Array.from(name).length > 120
      || (phone && !/^[+]?\d{7,15}$/.test(phone))
      || (email && (email.length > 254 || !/^[^\s@]+@[^\s@]+[.][^\s@]+$/.test(email)))))) {
    redirect(patientsUrl({ ...location, notice: "invalid" }));
  }

  const client = await supabase();
  const { data, error } = await client.rpc("patient_change", {
    p_clinic: clinic, p_action: operation, p_id: location.patient ?? null, p_revision: revision || null,
    p_name: writesDetails ? name : null, p_phone: writesDetails ? phone || null : null,
    p_email: writesDetails ? email || null : null,
  });
  if (error) {
    const code = error.code === "42501" ? "forbidden" : error.code === "P0001" ? "changed"
      : ["23514", "22023"].includes(error.code) ? "invalid" : "error";
    redirect(patientsUrl({ ...location, notice: code }));
  }
  redirect(patientsUrl({
    ...location, patient: data, q: operation === "create" ? undefined : location.q,
    archived: operation === "archive" ? "1" : undefined, notice: operation,
  }));
}

export async function linkPatientVisit(form: FormData) {
  const get = (name: string) => String(form.get(name) ?? "");
  const clinic = get("clinic");
  const patient = get("patient");
  const appointment = get("appointment");
  const revision = get("revision");
  const unlink = get("operation") === "unlink";
  const location = {
    clinic: validId(clinic) ? clinic : undefined,
    patient: validId(patient) ? patient : undefined,
    appointment: !unlink && validId(appointment) ? appointment : undefined,
    archived: get("archived") === "1" ? "1" : undefined,
  };
  if (!location.clinic || !location.patient || !validId(appointment)
    || !/^\d{1,10}$/.test(revision) || Number(revision) > 2147483647
    || (!unlink && get("operation") !== "link")) {
    redirect(patientsUrl({ ...location, notice: "invalid" }));
  }
  const client = await supabase();
  const { error } = await client.rpc("patient_link_visit", {
    p_clinic: clinic, p_patient: patient, p_appointment: appointment, p_revision: Number(revision), p_unlink: unlink,
  });
  redirect(patientsUrl({
    ...location, appointment: error ? location.appointment : undefined,
    notice: error ? error.code === "42501" ? "forbidden" : error.code === "P0001" ? "changed" : "error"
      : unlink ? "unlinked" : "linked",
  }));
}
