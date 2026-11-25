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
    await expect(page.getByText("Google Agenda", { exact: false })).toContainText("Desconectada");
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
    await expect(page.getByRole("combobox", { name: "Clínica", exact: true })).toHaveValue(clinicB);
    await expect(page.getByRole("main").getByRole("alert")).toHaveText("Você não tem acesso à clínica solicitada.");
    await expect(page.getByRole("article").filter({ hasText: name })).toHaveCount(0);
  } finally {
    unwrap(await stack.admin.from("appointments").delete().eq("patient_name", name));
    for (const user of users) await stack.removeUser(user);
  }
});

test("filtra a agenda por profissional sem mudar a consulta de vagas", async ({ page }) => {
  const stack = localStack();
  const user = await stack.user(clinicA, "filtro-agenda");
  const marker = randomUUID();
  const day = new Date();
  day.setUTCDate(day.getUTCDate() + 35);
  while ([0, 6].includes(day.getUTCDay())) day.setUTCDate(day.getUTCDate() + 1);
  const date = day.toISOString().slice(0, 10);
  const marina = `Paciente fictício Marina ${marker}`;
  const lucas = `Paciente fictício Lucas ${marker}`;

  try {
    const staff = unwrap(await stack.admin.from("professionals").select("id,name").eq("clinic_id", clinicA));
    const marinaId = staff.find(({ name }) => name.includes("Marina"))!.id;
    const lucasId = staff.find(({ name }) => name.includes("Lucas"))!.id;
    unwrap(await stack.admin.from("appointments").insert([
      { clinic_id: clinicA, professional_id: marinaId, patient_name: marina, starts_at: date + "T11:00:00Z", ends_at: date + "T11:30:00Z" },
      { clinic_id: clinicA, professional_id: lucasId, patient_name: lucas, starts_at: date + "T11:00:00Z", ends_at: date + "T11:30:00Z" },
    ]));

    await enter(page, user);
    await page.goto(`/?day=${date}&professional=${lucasId}`);
    const visit = (name: string) => page.getByRole("article").filter({ hasText: name });
    const listFilter = page.getByRole("combobox", { name: "Profissional da agenda" });
    const slotFilter = page.getByRole("combobox", { name: "Profissional", exact: true });
    await expect(visit(marina)).toBeVisible();
    await expect(visit(lucas)).toBeVisible();

    await listFilter.selectOption(marinaId);
    await page.getByRole("button", { name: "Filtrar agenda" }).click();
    await expect(visit(lucas)).toHaveCount(0);
    await expect(visit(marina)).toBeVisible();
    await expect(page.getByText("1 em aberto · 0 cancelados")).toBeVisible();
    await expect(slotFilter).toHaveValue(lucasId);

    await page.getByRole("button", { name: "Consultar vagas" }).click();
    await expect(listFilter).toHaveValue(marinaId);
    await page.getByRole("link", { name: "Próximo dia" }).click();
    await expect(page.getByText("Nenhum agendamento para este profissional no dia.")).toBeVisible();
    await page.getByRole("link", { name: "Dia anterior" }).click();
    await expect(visit(marina)).toBeVisible();

    await visit(marina).getByText("Cancelar", { exact: true }).click();
    await visit(marina).getByRole("button", { name: "Confirmar cancelamento" }).click();
    await expect(page.getByRole("status")).toHaveText("Agendamento cancelado.");
    await expect(listFilter).toHaveValue(marinaId);
    await expect(slotFilter).toHaveValue(lucasId);
    await expect(page.getByText("0 em aberto · 1 cancelados")).toBeVisible();

    await listFilter.selectOption("");
    await page.getByRole("button", { name: "Filtrar agenda" }).click();
    await expect(visit(lucas)).toBeVisible();
    await expect(visit(marina)).toBeVisible();
  } finally {
    unwrap(await stack.admin.from("appointments").delete().in("patient_name", [marina, lucas]));
    await stack.removeUser(user);
  }
});
