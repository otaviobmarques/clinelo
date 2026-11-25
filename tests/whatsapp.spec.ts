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
  const manual = "Atendimento manual fictício " + id;
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

    const origins = page.getByRole("navigation", { name: "Filtrar por origem" });
    const whatsappFilter = origins.getByRole("link", { name: "WhatsApp", exact: true });
    await whatsappFilter.click();
    await expect(whatsappFilter).toHaveAttribute("aria-current", "page");
    const queue = page.getByRole("region", { name: "Atendimentos" });
    const whatsappLink = queue.locator(`a[href^="/caixa?"][href*="thread=${threadId}"]`);
    await expect(whatsappLink).toBeVisible();
    await whatsappLink.click();
    await page.getByRole("button", { name: "Encerrar atendimento" }).click();
    await expect(page.getByRole("status")).toHaveText("Atendimento encerrado.");
    await expect(page).toHaveURL(/[?&]channel=whatsapp(?:&|$)/);
    await expect(whatsappLink).toBeVisible();
    await page.getByRole("button", { name: "Reabrir atendimento" }).click();
    await expect(page.getByRole("status")).toHaveText("Atendimento reaberto.");

    await page.getByLabel("Assunto", { exact: true }).fill(manual);
    await page.getByRole("button", { name: "Criar atendimento" }).click();
    await expect(page.getByRole("status")).toHaveText("Atendimento criado.");
    await expect(origins.getByRole("link", { name: "Manual" })).toHaveAttribute("aria-current", "page");
    await expect(queue.getByRole("link", { name: manual })).toBeVisible();
    await expect(whatsappLink).toHaveCount(0);
    await whatsappFilter.click();
    await expect(whatsappFilter).toHaveAttribute("aria-current", "page");
    await expect(whatsappLink).toBeVisible();
    await expect(queue.getByRole("link", { name: manual })).toHaveCount(0);

    // As duas mensagens recebidas ficam à frente destas 99 notas antigas.
    // O horário idêntico exige que a consulta desempate os registros pelo ID.
    const oldNotes = Array.from({ length: 99 }, (_, index) => ({
      id: randomUUID(), clinic_id: clinicB, thread_id: threadId, author_id: users[0].id,
      created_at: "2020-01-01T12:00:00Z", body: `Nota fictícia ${id} ${index}`,
    }));
    unwrap(await stack.admin.from("inbox_notes").insert(oldNotes));
    await page.reload();
    await whatsappLink.click();
    const history = page.locator("article.inbox-thread .inbox-note");
    const navigation = page.getByRole("navigation", { name: "Páginas do histórico" });
    await expect(history).toHaveCount(100);
    const firstPage = await history.allTextContents();
    await navigation.getByRole("link", { name: "Mais antigos" }).click();
    await expect(history).toHaveCount(1);
    const location = new URL(page.url());
    for (const [key, value] of Object.entries({ clinic: clinicB, thread: threadId, channel: "whatsapp", historyPage: "2" })) {
      expect(location.searchParams.get(key)).toBe(value);
    }
    const secondPage = await history.allTextContents();
    expect([...firstPage, ...secondPage].sort()).toEqual([first, next, ...oldNotes.map(note => note.body)].sort());
    await expect(navigation.getByRole("link", { name: "Mais antigos" })).toHaveCount(0);
    await navigation.getByRole("link", { name: "Mais recentes" }).click();
    await expect(history).toHaveText(firstPage);
    await expect(navigation.getByRole("link", { name: "Mais recentes" })).toHaveCount(0);
  } finally {
    if (threadId) unwrap(await stack.admin.from("inbox_threads").delete().eq("id", threadId));
    unwrap(await stack.admin.from("inbox_threads").delete().eq("subject", manual));
    for (const user of users) await stack.removeUser(user);
  }
});

test("responde pela API simulada, respeita a janela e isola as respostas", async ({ request, page }) => {
  const stack = localStack();
  const id = randomUUID();
  const phone = "10001";
  const inbound = "Contato de teste " + id;
  const member = await stack.user(clinicB, "whatsapp-resposta");
  const outsider = await stack.user(clinicA, "whatsapp-resposta-outra");
  let thread: string | undefined;

  async function deliver(timestamp: number, suffix: string) {
    const body = JSON.stringify({ object: "whatsapp_business_account", entry: [{ changes: [{
      field: "messages", value: {
        messaging_product: "whatsapp", metadata: { phone_number_id: phone },
        messages: [{ type: "text", from: "10002", id: id + suffix, timestamp: String(timestamp), text: { body: inbound } }],
      },
    }] }] });
    const signature = createHmac("sha256", process.env.CLINELO_TEST_META_SECRET!).update(body).digest("hex");
    expect((await request.post("/api/whatsapp", {
      data: body, headers: { "Content-Type": "application/json", "x-hub-signature-256": "sha256=" + signature },
    })).status()).toBe(200);
  }

  try {
    const now = Math.floor(Date.now() / 1000);
    await deliver(now - 25 * 3600, "-expired");
    thread = unwrap(await stack.admin.from("inbox_notes").select("thread_id").eq("body", inbound).single())!.thread_id;
    await page.goto("/");
    await page.getByLabel("E-mail").fill(member.email);
    await page.getByLabel("Senha").fill(member.password);
    await page.getByRole("button", { name: "Entrar" }).click();
    await expect(page.getByText("WhatsApp Business oficial")).toContainText("Configurado");
    const path = `/caixa?clinic=${clinicB}&thread=${thread}`;
    await page.goto(path);
    const send = page.getByRole("button", { name: "Enviar pelo WhatsApp" });
    await expect(send).toHaveCount(0);

    await deliver(now, "-recent");
    await page.reload();
    const message = page.getByLabel("Mensagem para o contato");
    await message.fill("Resposta fictícia " + id);
    await send.click();
    await expect(page.getByRole("status")).toHaveText("Resposta aceita pela Meta.");

    await message.fill("Resposta fictícia sem confirmação");
    await send.click();
    await expect(page.getByText("Envio sem confirmação", { exact: false }).first()).toBeVisible();
    const stored = unwrap(await stack.admin.from("whatsapp_replies").select("body,status").eq("thread_id", thread));
    expect(stored).toEqual(expect.arrayContaining([
      { body: "Resposta fictícia " + id, status: "accepted" },
      { body: "Resposta fictícia sem confirmação", status: "unknown" },
    ]));
    expect(stored).toHaveLength(2);

    const external = stack.client();
    expect((await external.auth.signInWithPassword({ email: outsider.email, password: outsider.password })).error).toBeNull();
    expect(unwrap(await external.from("whatsapp_replies").select("id").eq("thread_id", thread))).toEqual([]);
    expect(unwrap(await external.rpc("whatsapp_reply_available", { p_clinic: clinicB, p_thread: thread, p_phones: [phone] }))).toBe(false);
    const reservation = { p_actor: member.id, p_clinic: clinicB, p_thread: thread, p_nonce: randomUUID(), p_body: "Reserva fictícia", p_phones: [phone] };
    expect((await external.rpc("whatsapp_reserve_reply", reservation)).error?.code).toBe("42501");
    expect((await stack.admin.rpc("whatsapp_reserve_reply", { ...reservation, p_actor: outsider.id })).error?.code).toBe("42501");
    const attempts = await Promise.all([stack.admin.rpc("whatsapp_reserve_reply", reservation), stack.admin.rpc("whatsapp_reserve_reply", reservation)]);
    expect(attempts.map((attempt) => unwrap(attempt)!.length).sort()).toEqual([0, 1]);

    await page.getByRole("button", { name: "Encerrar atendimento" }).click();
    await expect(send).toHaveCount(0);
  } finally {
    if (thread) unwrap(await stack.admin.from("inbox_threads").delete().eq("id", thread));
    await stack.removeUser(member);
    await stack.removeUser(outsider);
  }
});
