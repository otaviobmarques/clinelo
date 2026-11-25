import { sign } from "node:crypto";
import type { Slot } from "./agenda";

const tokenUrl = "https://oauth2.googleapis.com/token";
const freeBusyUrl = "https://www.googleapis.com/calendar/v3/freeBusy";

export type GoogleAvailability =
  | { status: "disconnected" | "unavailable" | "no-slots" }
  | { status: "checked"; occupied: Set<string> };

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Objeto inválido");
  return value as Record<string, unknown>;
}

function text(value: unknown): string {
  if (typeof value !== "string" || !value.trim()) throw new Error("Campo inválido");
  return value;
}

function own(record: Record<string, unknown>, key: string) {
  return Object.hasOwn(record, key) ? record[key] : undefined;
}

function assertion(account: Record<string, unknown>) {
  const now = Math.floor(Date.now() / 1000);
  const encode = (value: object) => Buffer.from(JSON.stringify(value)).toString("base64url");
  const header = encode({ alg: "RS256", typ: "JWT" });
  const claims = encode({
    iss: text(account.client_email),
    scope: "https://www.googleapis.com/auth/calendar.events.freebusy",
    aud: tokenUrl,
    iat: now,
    exp: now + 300,
  });
  const payload = header + "." + claims;
  return payload + "." + sign("RSA-SHA256", Buffer.from(payload), text(account.private_key)).toString("base64url");
}

export async function googleAvailability(
  clinic: string,
  professional: string,
  slots: Slot[],
  config: { links?: string; account?: string },
  request = fetch,
): Promise<GoogleAvailability> {
  if (!config.links) return { status: "disconnected" };

  try {
    const clinicLinks = own(object(JSON.parse(config.links)), clinic);
    const linked = clinicLinks === undefined ? undefined : own(object(clinicLinks), professional);
    if (linked === undefined) return { status: "disconnected" };
    const calendarId = text(linked);
    if (!config.account) return { status: "unavailable" };
    if (!slots.length) return { status: "no-slots" };

    const signal = AbortSignal.timeout(4000);
    const tokenResponse = await request(tokenUrl, {
      method: "POST", cache: "no-store", signal,
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
        assertion: assertion(object(JSON.parse(config.account))),
      }),
    });
    if (!tokenResponse.ok) return { status: "unavailable" };
    const accessToken = text(object(await tokenResponse.json()).access_token);

    const response = await request(freeBusyUrl, {
      method: "POST", cache: "no-store", signal,
      headers: { Authorization: "Bearer " + accessToken, "Content-Type": "application/json" },
      body: JSON.stringify({
        timeMin: new Date(Math.min(...slots.map((slot) => Date.parse(slot.starts_at)))).toISOString(),
        timeMax: new Date(Math.max(...slots.map((slot) => Date.parse(slot.ends_at)))).toISOString(),
        items: [{ id: calendarId }],
      }),
    });
    if (!response.ok) return { status: "unavailable" };
    const calendars = object(object(await response.json()).calendars);
    const calendar = object(own(calendars, calendarId));
    if ((calendar.errors && (!Array.isArray(calendar.errors) || calendar.errors.length))
      || !Array.isArray(calendar.busy)) return { status: "unavailable" };

    const busy = calendar.busy.map((item) => {
      const interval = object(item);
      const start = Date.parse(text(interval.start));
      const end = Date.parse(text(interval.end));
      if (!Number.isFinite(start) || !Number.isFinite(end) || start >= end) throw new Error("Intervalo inválido");
      return { start, end };
    });
    const occupied = slots.filter((slot) => busy.some(({ start, end }) =>
      Date.parse(slot.starts_at) < end && Date.parse(slot.ends_at) > start,
    ));
    return { status: "checked", occupied: new Set(occupied.map((slot) => slot.starts_at)) };
  } catch {
    return { status: "unavailable" };
  }
}
