import { createClient } from "@supabase/supabase-js";
import { deliveries, equalText, signedByMeta, whatsappSettings } from "../../../lib/whatsapp";

import { protectRecipient, replySettings } from "../../../lib/whatsapp-reply";

export const runtime = "nodejs";
const maxBytes = 3 * 1024 * 1024;

async function readBody(request: Request) {
  const reader = request.body?.getReader();
  if (!reader) return Buffer.alloc(0);
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) return Buffer.concat(chunks, bytes);
      bytes += value.byteLength;
      if (bytes > maxBytes) {
        await reader.cancel();
        return null;
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
}

export function GET(request: Request) {
  const settings = whatsappSettings(process.env);
  if (!settings) return new Response(null, { status: 503 });
  const params = new URL(request.url).searchParams;
  const challenge = params.get("hub.challenge");
  if (params.get("hub.mode") !== "subscribe" || !challenge
    || !equalText(params.get("hub.verify_token") ?? "", settings.verifyToken)) {
    return new Response(null, { status: 403 });
  }
  return new Response(challenge, { headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" } });
}

export async function POST(request: Request) {
  const settings = whatsappSettings(process.env);
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!settings || !url || !key) return new Response(null, { status: 503 });
  const header = request.headers.get("x-hub-signature-256");
  if (!header) return new Response(null, { status: 403 });

  let payload: unknown;
  try {
    const raw = await readBody(request);
    if (!raw) return new Response(null, { status: 413 });
    if (!signedByMeta(raw, header, settings.appSecret)) return new Response(null, { status: 403 });
    payload = JSON.parse(raw.toString("utf-8"));
  } catch {
    return new Response(null, { status: 400 });
  }

  const messages = deliveries(payload, settings);
  if (!messages.length) return new Response(null, { status: 200 });

  try {
    const client = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
    const replies = replySettings(process.env);
    for (const message of messages) {
      const { error } = await client.rpc("whatsapp_receive_reply_context", {
        p_clinic: message.clinic, p_phone: message.phone, p_contact: message.contact,
        p_message: message.message, p_body: message.body,
        p_cipher: replies && message.inboundAt ? protectRecipient(message.recipient, message, replies.secret) : null,
        p_inbound_at: replies ? message.inboundAt : null,
      });
      if (error) return new Response(null, { status: 503 });
    }
    return new Response(null, { status: 200 });
  } catch {
    return new Response(null, { status: 503 });
  }
}
