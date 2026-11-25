import { randomUUID } from "node:crypto";
import { expect, test, type Page } from "@playwright/test";
import { clinicA, clinicB, localStack, unwrap, type LocalUser } from "../scripts/local-supabase.mjs";

async function enter(page: Page, user: LocalUser) {
  await page.goto("/");
  await page.getByLabel("E-mail").fill(user.email);
  await page.getByLabel("Senha").fill(user.password);
  await page.getByRole("button", { name: "Entrar" }).click();
  await expect(page.getByRole("heading", { name: "Agenda diária" })).toBeVisible();
}

test("recepção agenda, remarca e cancela sem expor outra clínica", async ({ page }) => {
  const stack = localStack();
  const users: LocalUser[] = [];
  const name = `Paciente fictício ${randomUUID()}`;
  const day = new Date();
  day.setUTCDate(day.getUTCDate() + 14);
  while ([0, 6].includes(day.getUTCDay())) day.setUTCDate(day.getUTCDate() + 1);

  try {
    users.push(await stack.user(clinicA, "navegador-a"));
    users.push(await stack.user(clinicB, "navegador-b"));
    await enter(page, users[0]);
    await expect(page.getByText("Clínica Horizonte · Demo", { exact: true }).first()).toBeVisible();
    await expect(page.getByText("WhatsApp Business oficial")).toContainText("Desconectado");
    await page.getByLabel("Data", { exact: true }).fill(day.toISOString().slice(0, 10));
    await page.getByRole("button", { name: "Consultar vagas" }).click();
    const time = page.getByLabel("Horário");
    await expect(time.locator("option").nth(2)).toBeAttached();
    await time.selectOption({ index: 1 });
    await page.getByLabel("Nome do paciente").fill(name);
    await page.getByRole("button", { name: "Agendar consulta" }).click();
    await expect(page.getByRole("status")).toHaveText("Agendamento criado.");
    const visit = page.getByRole("article").filter({ hasText: name });
    await expect(visit).toContainText("08:00");

    await visit.getByRole("link", { name: "Remarcar" }).click();
    await expect(page.getByRole("heading", { name: "Remarcar consulta" })).toBeVisible();
    await time.selectOption({ label: "08:30 – 09:00" });
    await page.getByRole("button", { name: "Salvar remarcação" }).click();
    await expect(page.getByRole("status")).toHaveText("Agendamento remarcado.");
    await expect(visit).toContainText("08:30");

    await visit.getByText("Cancelar", { exact: true }).click();
    await visit.getByRole("button", { name: "Confirmar cancelamento" }).click();
    await expect(page.getByRole("status")).toHaveText("Agendamento cancelado.");
    await expect(visit.getByText("Cancelado", { exact: true })).toBeVisible();
    await expect(time.locator("option", { hasText: "08:30 – 09:00" })).toHaveCount(1);

    const otherClinicUrl = page.url();
    await page.getByRole("button", { name: "Sair", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Acesse sua recepção" })).toBeVisible();
    await enter(page, users[1]);
    await page.goto(otherClinicUrl);
    await expect(page.getByLabel("Clínica", { exact: true })).toHaveValue(clinicB);
    await expect(page.getByRole("article").filter({ hasText: name })).toHaveCount(0);
  } finally {
    unwrap(await stack.admin.from("appointments").delete().eq("patient_name", name));
    for (const user of users) await stack.removeUser(user);
  }
});
