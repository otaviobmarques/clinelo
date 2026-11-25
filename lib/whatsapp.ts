import { createHmac, timingSafeEqual } from "node:crypto";

type Settings = { appSecret: string; verifyToken: string; contactSecret: string; clinics: Map<string, string> };
type PayloadObject = Record<string, unknown>;

function object(value: unknown): PayloadObject {
  return value && typeof value === "object" && !Array.isArray(value) ? value as PayloadObject : {};
}

function list(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

export function whatsappSettings(env: NodeJS.ProcessEnv): Settings | null {
  const { WHATSAPP_APP_SECRET: appSecret, WHATSAPP_VERIFY_TOKEN: verifyToken,
    WHATSAPP_CONTACT_SECRET: contactSecret, WHATSAPP_CLINICS_JSON: links } = env;
  if (!appSecret || !verifyToken || !contactSecret || !links || !env.SUPABASE_SERVICE_ROLE_KEY) return null;
  try {
    const entries = Object.entries(object(JSON.parse(links)));
    if (!entries.length || entries.some(([phone, clinic]) => !/^\d{1,32}$/.test(phone)
      || typeof clinic !== "string" || !/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(clinic))) return null;
    return { appSecret, verifyToken, contactSecret, clinics: new Map(entries.map(([phone, clinic]) => [phone, String(clinic).toLowerCase()])) };
  } catch {
    return null;
  }
}

export function equalText(left: string, right: string) {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}

export function signedByMeta(raw: Uint8Array, header: string | null, secret: string) {
  if (!header || !/^sha256=[a-f0-9]{64}$/.test(header)) return false;
  return equalText(header, "sha256=" + createHmac("sha256", secret).update(raw).digest("hex"));
}

export function deliveries(payload: unknown, settings: Settings) {
  const envelope = object(payload);
  const result: { clinic: string; phone: string; contact: string; message: string; body: string; recipient: string; inboundAt: string | null }[] = [];
  if (envelope.object !== "whatsapp_business_account") return result;
  for (const entry of list(envelope.entry)) {
    for (const change of list(object(entry).changes)) {
      const { field, value } = object(change);
      const event = object(value);
      const phone = object(event.metadata).phone_number_id;
      const clinic = typeof phone === "string" ? settings.clinics.get(phone) : undefined;
      if (field !== "messages" || typeof phone !== "string" || !clinic || event.messaging_product !== "whatsapp") continue;
      for (const incoming of list(event.messages)) {
        const { from, id, text, type, timestamp } = object(incoming);
        const body = object(text).body;
        if (type !== "text" || typeof from !== "string" || !/^\d{1,32}$/.test(from)
          || typeof id !== "string" || !id.trim() || id.length > 512 || id.includes("\0")
          || typeof body !== "string" || !body.trim() || body.includes("\0") || Array.from(body.trim()).length > 4096) continue;
        const contact = createHmac("sha256", settings.contactSecret)
          .update(clinic + "/" + phone + "/" + from).digest("hex");
        const seconds = typeof timestamp === "string" && /^\d{1,10}$/.test(timestamp) ? Number(timestamp) : 0;
        const inboundAt = seconds > 0 && seconds * 1000 <= Date.now() ? new Date(seconds * 1000).toISOString() : null;
        result.push({ clinic, phone, contact, message: id, body: body.trim(), recipient: from, inboundAt });
      }
    }
  }
  return result;
}

export function whatsappPhones(clinic: string) {
  const settings = whatsappSettings(process.env);
  return [...(settings?.clinics ?? [])].filter(([, owner]) => owner === clinic).map(([phone]) => phone);
}

export function whatsappConfigured(clinic: string) {
  return whatsappPhones(clinic).length > 0;
}
