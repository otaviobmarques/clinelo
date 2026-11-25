import { randomUUID } from "node:crypto";
import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import { clinicA, clinicB, professionalA, localStack, unwrap, type LocalUser } from "../scripts/local-supabase.mjs";

async function signIn(page: Page, user: LocalUser) {
  await page.goto("/");
  await page.getByLabel("E-mail").fill(user.email);
  await page.getByLabel("Senha").fill(user.password);
  await page.getByRole("button", { name: "Entrar" }).click();
  await expect(page.getByRole("link", { name: "Caixa compartilhada" })).toBeVisible();
}

test("compartilha notas entre colegas e isola o atendimento de outras clínicas", async ({ page, browser }) => {
  const stack = localStack();
  const users: LocalUser[] = [];
  const contexts: BrowserContext[] = [];
  const subject = "Atendimento fictício " + randomUUID();
  const note = "Confirmar o retorno da próxima semana.";

  try {
    users.push(await stack.user(clinicA, "recepcao"));
    users.push(await stack.user(clinicA, "colega"));
    users.push(await stack.user(clinicB, "outra-clinica"));

    await signIn(page, users[0]);
    await page.getByRole("link", { name: "Caixa compartilhada" }).click();
    await page.getByLabel("Assunto", { exact: true }).fill(subject);
    await page.getByRole("button", { name: "Criar atendimento" }).click();
    await expect(page.getByRole("status")).toHaveText("Atendimento criado.");
    const assignments = page.getByRole("navigation", { name: "Filtrar por responsável" });
    await assignments.getByRole("link", { name: "Sem responsável" }).click();
    await expect(assignments.getByRole("link", { name: "Sem responsável" })).toHaveAttribute("aria-current", "page");
    await page.getByRole("link", { name: subject, exact: true }).click();
    await page.getByRole("button", { name: "Assumir atendimento" }).click();
    await expect(page.getByRole("status")).toHaveText("Você assumiu o atendimento.");
    await expect(assignments.getByRole("link", { name: "Meus atendimentos" })).toHaveAttribute("aria-current", "page");
    await page.getByRole("button", { name: "Devolver à fila" }).click();
    await expect(page.getByRole("status")).toHaveText("Atendimento devolvido à fila.");
    await expect(assignments.getByRole("link", { name: "Sem responsável" })).toHaveAttribute("aria-current", "page");
    await page.getByRole("button", { name: "Assumir atendimento" }).click();
    await expect(page.getByRole("status")).toHaveText("Você assumiu o atendimento.");
    await page.getByLabel("Nota interna").fill(note);
    await page.getByRole("button", { name: "Adicionar nota" }).click();
    await expect(page.getByRole("status")).toHaveText("Nota adicionada.");
    await expect(page.getByText(note, { exact: true })).toBeVisible();
    const threadUrl = page.url();
    const thread = new URL(threadUrl).searchParams.get("thread");

    const colleague = await browser.newContext({ baseURL: new URL(threadUrl).origin });
    contexts.push(colleague);
    const colleaguePage = await colleague.newPage();
    await signIn(colleaguePage, users[1]);
    await colleaguePage.getByRole("link", { name: "Caixa compartilhada" }).click();
    await colleaguePage.getByRole("link", { name: subject, exact: true }).click();
    await expect(colleaguePage.getByText(note, { exact: true })).toBeVisible();
    await expect(colleaguePage.getByText("Responsável: Atendente " + users[0].id.slice(0, 8), { exact: true })).toBeVisible();
    await expect(colleaguePage.getByRole("button", { name: "Assumir atendimento" })).toHaveCount(0);
    const competing = stack.client();
    expect((await competing.auth.signInWithPassword({ email: users[1].email, password: users[1].password })).error).toBeNull();
    for (const release of [false, true]) {
      expect((await competing.rpc("inbox_assign_self", { p_clinic: clinicA, p_thread: thread, p_release: release })).error?.code).toBe("P0001");
    }
    await colleaguePage.getByRole("button", { name: "Encerrar atendimento" }).click();
    await expect(colleaguePage.getByRole("status")).toHaveText("Atendimento encerrado.");
    await expect(colleaguePage.getByLabel("Nota interna")).toHaveCount(0);

    const member = stack.client();
    expect((await member.auth.signInWithPassword({ email: users[0].email, password: users[0].password })).error).toBeNull();
    const action = (client: ReturnType<typeof stack.client>, p_action: string, p_clinic = clinicA) => client.rpc("inbox_change", {
      p_clinic, p_action, p_thread: thread, p_text: "Nota fictícia",
    });
    expect((await action(member, "note")).error?.code).toBe("P0001");
    expect((await member.from("inbox_threads").update({ status: "open" }).eq("id", thread)).error?.code).toBe("42501");

    const other = await browser.newContext({ baseURL: new URL(threadUrl).origin });
    contexts.push(other);
    const otherPage = await other.newPage();
    await signIn(otherPage, users[2]);
    await otherPage.goto(threadUrl);
    await expect(otherPage.getByRole("main").getByRole("alert")).toHaveText("Você não tem acesso a esta clínica.");
    await expect(otherPage.getByText(note, { exact: true })).toHaveCount(0);

    const scope = stack.client();
    expect((await scope.auth.signInWithPassword({ email: users[2].email, password: users[2].password })).error).toBeNull();
    expect(unwrap(await scope.from("inbox_notes").select("id").eq("thread_id", thread))).toEqual([]);
    expect((await action(scope, "reopen")).error?.code).toBe("42501");
    expect((await action(scope, "note", clinicB)).error?.code).toBe("P0001");

    await colleaguePage.getByRole("button", { name: "Reabrir atendimento" }).click();
    await expect(colleaguePage.getByRole("status")).toHaveText("Atendimento reaberto.");
    await expect(colleaguePage.getByRole("button", { name: "Assumir atendimento" })).toBeVisible();
    await expect(colleaguePage.getByLabel("Nota interna")).toBeVisible();

    const race = await Promise.all([member, competing].map((client) =>
      client.rpc("inbox_assign_self", { p_clinic: clinicA, p_thread: thread, p_release: false }),
    ));
    expect(race.filter(({ error }) => error === null)).toHaveLength(1);
    expect(race.find(({ error }) => error)?.error?.code).toBe("P0001");
    const winner = users[race[0].error ? 1 : 0];
    const assignee = () => stack.admin.from("inbox_threads").select("assignee_id,assignee_label").eq("id", thread).single();
    expect(unwrap(await assignee())).toMatchObject({ assignee_id: winner.id });
    unwrap(await stack.admin.from("clinic_members").delete().eq("clinic_id", clinicA).eq("user_id", winner.id));
    expect(unwrap(await assignee())).toEqual({ assignee_id: null, assignee_label: null });
  } finally {
    for (const context of contexts) await context.close();
    unwrap(await stack.admin.from("inbox_threads").delete().eq("subject", subject));
    for (const user of users) await stack.removeUser(user);
  }
});

test("busca por assunto combina acentos, texto literal e filtros da clínica", async ({ page }) => {
  const stack = localStack();
  const user = await stack.user(clinicA, "busca");
  const marker = randomUUID();
  const rows = [
    { clinic_id: clinicA, subject: `Revisão % ${marker}`, status: "open" },
    { clinic_id: clinicA, subject: `Revisão X ${marker}`, status: "open" },
    { clinic_id: clinicA, subject: `Revisão % ${marker} encerrada`, status: "closed" },
    { clinic_id: clinicB, subject: `Revisão % ${marker} outra clínica`, status: "open" },
  ];
  const [matching, wildcard, closed, other] = rows.map(({ subject }) => subject);

  try {
    unwrap(await stack.admin.from("inbox_threads").insert(rows));
    await signIn(page, user);
    await page.getByRole("link", { name: "Caixa compartilhada" }).click();
    const search = page.getByRole("search");
    const term = "REVISAO % " + marker;
    const input = search.getByRole("searchbox", { name: "Buscar por assunto" });
    const queue = page.getByRole("region", { name: "Atendimentos" });
    await input.fill(term);
    await search.getByRole("button", { name: "Buscar", exact: true }).click();

    await expect(page).toHaveURL(/[?&]q=/);
    await expect(queue.getByRole("link", { name: matching, exact: true })).toBeVisible();
    for (const subject of [wildcard, closed, other]) {
      await expect(queue.getByRole("link", { name: subject, exact: true })).toHaveCount(0);
    }

    await queue.getByRole("link", { name: "WhatsApp", exact: true }).click();
    await expect(queue.getByText("Nenhum atendimento encontrado.")).toBeVisible();
    await expect(input).toHaveValue(term);
    await queue.getByRole("link", { name: "Todas as origens" }).click();
    await expect(queue.getByRole("link", { name: matching, exact: true })).toBeVisible();
    await queue.getByRole("link", { name: "Encerrados" }).click();
    await expect(queue.getByRole("link", { name: closed, exact: true })).toBeVisible();
    await expect(input).toHaveValue(term);
    await search.getByRole("link", { name: "Limpar busca" }).click();
    await expect(input).toHaveValue("");
  } finally {
    unwrap(await stack.admin.from("inbox_threads").delete().in("subject", rows.map(({ subject }) => subject)));
    await stack.removeUser(user);
  }
});

test("agenda a partir da conversa e mantém o vínculo no cancelamento", async ({ page }) => {
  const stack = localStack();
  const user = await stack.user(clinicA, "vinculo-agenda");
  const thread = randomUUID();
  const otherThread = randomUUID();
  const patient = "Paciente fictício " + thread;
  const date = new Date();
  date.setUTCDate(date.getUTCDate() + 77);
  while ([0, 6].includes(date.getUTCDay())) date.setUTCDate(date.getUTCDate() + 1);
  const day = date.toISOString().slice(0, 10);

  try {
    unwrap(await stack.admin.from("inbox_threads").insert([
      { id: thread, clinic_id: clinicA, subject: "Agendamento fictício" },
      { id: otherThread, clinic_id: clinicB, subject: "Outra clínica fictícia" },
    ]));
    const member = stack.client();
    expect((await member.auth.signInWithPassword({ email: user.email, password: user.password })).error).toBeNull();
    expect((await member.rpc("agenda_book_from_inbox", {
      p_clinic: clinicA, p_thread: otherThread, p_professional: professionalA, p_start: day + "T11:00:00Z", p_patient: patient,
    })).error?.code).toBe("P0001");
    expect(unwrap(await member.from("appointments").select("id").eq("patient_name", patient))).toEqual([]);

    await signIn(page, user);
    await page.goto(`/caixa?clinic=${clinicA}&thread=${thread}`);
    await page.getByRole("link", { name: "Agendar consulta para este atendimento" }).click();
    await expect(page.getByRole("link", { name: "Voltar ao atendimento" })).toBeVisible();
    await page.getByLabel("Data", { exact: true }).fill(day);
    await page.getByRole("button", { name: "Consultar vagas" }).click();
    await expect(page).toHaveURL(new RegExp("day=" + day));
    await page.getByLabel("Horário").selectOption({ label: "08:00 – 08:30" });
    await page.getByLabel("Nome do paciente").fill(patient);
    await page.getByRole("button", { name: "Agendar consulta" }).click();
    await expect(page.getByRole("status")).toHaveText("Agendamento criado.");
    await page.getByRole("link", { name: "Voltar ao atendimento" }).click();
    const linked = page.getByRole("listitem").filter({ hasText: "08:00" });
    await expect(linked).toContainText("Agendado");
    await linked.getByRole("link").click();
    const visit = page.getByRole("article").filter({ hasText: patient });
    await visit.getByText("Cancelar", { exact: true }).click();
    await visit.getByRole("button", { name: "Confirmar cancelamento" }).click();
    await expect(page.getByRole("status")).toHaveText("Agendamento cancelado.");
    await visit.getByRole("link", { name: "Ver atendimento" }).click();
    await expect(linked).toContainText("Cancelado");
  } finally {
    unwrap(await stack.admin.from("appointments").delete().eq("patient_name", patient));
    unwrap(await stack.admin.from("inbox_threads").delete().in("id", [thread, otherThread]));
    await stack.removeUser(user);
  }
});
