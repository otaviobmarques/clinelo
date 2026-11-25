import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

export type ReplyResult = "accepted" | "rejected" | "unknown";

export function replySettings(env: NodeJS.ProcessEnv) {
  const token = env.WHATSAPP_ACCESS_TOKEN;
  const encoded = env.WHATSAPP_RECIPIENT_KEY;
  const version = env.WHATSAPP_GRAPH_VERSION ?? "v24.0";
  if (!token || !encoded || !/^[A-Za-z0-9+/]{43}=$/.test(encoded) || !/^v\d{1,3}\.0$/.test(version)) return null;
  return { token, secret: Buffer.from(encoded, "base64"), version };
}

type Contact = { clinic: string; phone: string; contact: string };

function scope({ clinic, phone, contact }: Contact) {
  return Buffer.from(clinic + "/" + phone + "/" + contact);
}

export function protectRecipient(recipient: string, context: Contact, secret: Buffer) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", secret, iv);
  cipher.setAAD(scope(context));
  const encrypted = Buffer.concat([cipher.update(recipient, "utf8"), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), encrypted]).toString("base64url");
}

export function openRecipient(value: string, context: Contact, secret: Buffer) {
  const data = Buffer.from(value, "base64url");
  const decipher = createDecipheriv("aes-256-gcm", secret, data.subarray(0, 12));
  decipher.setAAD(scope(context));
  decipher.setAuthTag(data.subarray(12, 28));
  const recipient = Buffer.concat([decipher.update(data.subarray(28)), decipher.final()]).toString("utf8");
  if (!/^\d{1,32}$/.test(recipient)) throw new Error("Destinatário inválido.");
  return recipient;
}

export async function sendWhatsappText(
  settings: NonNullable<ReturnType<typeof replySettings>>, phone: string, recipient: string,
  body: string, transport: typeof fetch = fetch,
): Promise<ReplyResult> {
  try {
    const response = await transport(`https://graph.facebook.com/${settings.version}/${phone}/messages`, {
      method: "POST",
      headers: { Authorization: `Bearer ${settings.token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ messaging_product: "whatsapp", recipient_type: "individual", to: recipient, type: "text", text: { body, preview_url: false } }),
      signal: AbortSignal.timeout(8_000),
      redirect: "error",
      cache: "no-store",
    });
    if (response.ok) {
      const data = await response.json();
      return typeof data?.messages?.[0]?.id === "string" && data.messages[0].id ? "accepted" : "unknown";
    }
    return response.status >= 400 && response.status < 500 && ![408, 429].includes(response.status)
      ? "rejected" : "unknown";
  } catch {
    return "unknown";
  }
}
