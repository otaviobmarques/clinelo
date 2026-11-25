"use server";

import { redirect } from "next/navigation";
import { validId } from "../../lib/agenda";
import { gradeUrl } from "../../lib/grade";
import { supabase } from "../../lib/supabase";

export async function saveHours(form: FormData) {
  const get = (name: string) => String(form.get(name) ?? "");
  const clinic = get("clinic");
  const professional = get("professional");
  const weekday = Number(get("weekday"));
  const operation = get("operation");
  const revision = get("revision");
  const fields = ["opens", "closes", "break_from", "break_until"].map(get);
  const validWeekday = Number.isInteger(weekday) && weekday >= 1 && weekday <= 7;
  const location = {
    clinic: validId(clinic) ? clinic : undefined,
    professional: validId(professional) ? professional : undefined,
    weekday: validWeekday ? weekday : undefined,
  };
  if (!location.clinic || !location.professional || !validWeekday || (revision && !validId(revision))
    || !["set", "closed", "default"].includes(operation)
    || (operation === "set" && fields.some((value) => value && !/^([01]\d|2[0-4]):(00|30)$/.test(value)))) {
    redirect(gradeUrl({ ...location, notice: "invalid" }));
  }

  const [opens, closes, breakFrom, breakUntil] = operation === "set" ? fields : [];
  const client = await supabase();
  const { error } = await client.rpc("agenda_manage_hours", {
    p_clinic: clinic, p_professional: professional, p_weekday: weekday, p_action: operation, p_revision: revision || null,
    p_opens: opens || null, p_closes: closes || null, p_break_from: breakFrom || null, p_break_until: breakUntil || null,
  });
  const notices: Record<string, string> = {
    "42501": "forbidden", "23514": "invalid", "22023": "invalid", "22008": "invalid", "22P02": "invalid", P0001: "changed",
  };
  redirect(gradeUrl({ ...location, notice: error ? notices[error.code] ?? "error" : "saved" }));
}
