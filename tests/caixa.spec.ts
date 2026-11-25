import { randomUUID } from "node:crypto";
import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import { clinicA, clinicB, localStack, unwrap, type LocalUser } from "../scripts/local-supabase.mjs";

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
    await page.getByLabel("Assunto").fill(subject);
    await page.getByRole("button", { name: "Criar atendimento" }).click();
    await expect(page.getByRole("status")).toHaveText("Atendimento criado.");
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
    await expect(colleaguePage.getByLabel("Nota interna")).toBeVisible();
  } finally {
    for (const context of contexts) await context.close();
    unwrap(await stack.admin.from("inbox_threads").delete().eq("subject", subject));
    for (const user of users) await stack.removeUser(user);
  }
});
