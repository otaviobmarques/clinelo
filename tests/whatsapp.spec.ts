import { createHmac, randomInt, randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import { clinicA, clinicB, localStack, unwrap, type LocalUser } from "../scripts/local-supabase.mjs";

test.skip(process.env.CLINELO_TEST_WHATSAPP !== "1", "Ative o webhook fictício para este teste.");

test("recebe texto assinado, ignora reenvios e isola a caixa da clínica", async ({ request, page }) => {
  const stack = localStack();
  const users: LocalUser[] = [];
  const id = randomUUID();
  const endpoint = "/api/whatsapp";
  const phone = "10001";
  const from = String(randomInt(1_000_000_000, 9_999_999_999));
  const first = "Primeira mensagem fictícia " + id;
  const next = "Nova mensagem fictícia " + id;
  let threadId: string | undefined;

  function post(text: string, messageId: string, phoneId = phone, validSignature = true) {
    const body = JSON.stringify({ object: "whatsapp_business_account", entry: [{ changes: [{
      field: "messages", value: {
        messaging_product: "whatsapp", metadata: { phone_number_id: phoneId },
        messages: [{ type: "text", from, id: messageId, text: { body: text } }],
      },
    }] }] });
    const digest = createHmac("sha256", process.env.CLINELO_TEST_META_SECRET!).update(body).digest("hex");
    return request.post(endpoint, {
      data: body,
      headers: { "Content-Type": "application/json", "x-hub-signature-256": "sha256=" + (validSignature ? digest : "0".repeat(64)) },
    });
  }

  try {
    const challenge = { "hub.mode": "subscribe", "hub.challenge": "12345", "hub.verify_token": process.env.CLINELO_TEST_META_VERIFY! };
    expect(await (await request.get(endpoint, { params: challenge })).text()).toBe("12345");
    expect((await request.get(endpoint, { params: { ...challenge, "hub.verify_token": "" } })).status()).toBe(403);
    expect((await post(first, id, phone, false)).status()).toBe(403);
    expect((await post(first, id, "99999")).status()).toBe(200);
    expect(unwrap(await stack.admin.from("inbox_notes").select("id").eq("body", first))).toEqual([]);

    const responses = await Promise.all([post(first, id), post(first, id)]);
    expect(responses.map((response) => response.status())).toEqual([200, 200]);
    const notes = unwrap(await stack.admin.from("inbox_notes").select("thread_id,clinic_id,source").eq("body", first));
    expect(notes).toHaveLength(1);
    const row = notes![0];
    expect(row).toMatchObject({ clinic_id: clinicB, source: "whatsapp" });
    threadId = row.thread_id;

    users.push(await stack.user(clinicB, "whatsapp-recepcao"));
    users.push(await stack.user(clinicA, "whatsapp-outra"));
    const member = stack.client();
    const other = stack.client();
    for (const [client, user] of [[member, users[0]], [other, users[1]]] as const) {
      expect((await client.auth.signInWithPassword({ email: user.email, password: user.password })).error).toBeNull();
    }
    expect(unwrap(await other.from("inbox_notes").select("id").eq("thread_id", threadId))).toEqual([]);
    expect((await member.rpc("whatsapp_receive", {
      p_clinic: clinicB, p_phone: phone, p_contact: "0".repeat(64), p_message: id, p_body: first,
    })).error?.code).toBe("42501");
    unwrap(await member.rpc("inbox_change", { p_clinic: clinicB, p_action: "close", p_thread: threadId }));
    expect((await post(first, id)).status()).toBe(200);
    expect(unwrap(await member.from("inbox_threads").select("status").eq("id", threadId).single())).toEqual({ status: "closed" });
    expect((await post(next, id + "-next")).status()).toBe(200);
    expect(unwrap(await member.from("inbox_threads").select("status").eq("id", threadId).single())).toEqual({ status: "open" });

    await page.goto("/");
    await page.getByLabel("E-mail").fill(users[0].email);
    await page.getByLabel("Senha").fill(users[0].password);
    await page.getByRole("button", { name: "Entrar" }).click();
    await expect(page.getByText("WhatsApp Business oficial")).toContainText("Configurado");
    await page.goto(`/caixa?clinic=${clinicB}&thread=${threadId}`);
    await expect(page.getByText(next, { exact: true })).toBeVisible();
    await expect(page.getByText("WhatsApp ·", { exact: false }).filter({ has: page.locator("time") })).toHaveCount(2);
  } finally {
    if (threadId) unwrap(await stack.admin.from("inbox_threads").delete().eq("id", threadId));
    for (const user of users) await stack.removeUser(user);
  }
});
