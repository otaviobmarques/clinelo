import { randomUUID } from "node:crypto";
import { expect, test, type Page } from "@playwright/test";
import { clinicA, clinicB, professionalA, localStack, unwrap, type LocalUser } from "../scripts/local-supabase.mjs";

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
    const time = page.getByRole("combobox", { name: "Horário", exact: true });
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
    const staff = unwrap(await stack.admin.from("professionals").select("id,name").eq("clinic_id", clinicA)) ?? [];
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

test("confirma e registra comparecimento ou falta conforme o horário", async ({ page }) => {
  const stack = localStack();
  const user = await stack.user(clinicA, "situacao-agenda");
  const day = (offset: number) => {
    const value = new Date();
    value.setUTCDate(value.getUTCDate() + offset);
    return value.toISOString().slice(0, 10);
  };
  const past = day(-21);
  const future = day(42);
  const cases = [
    { id: randomUUID(), date: future, hour: "11", action: "Confirmar consulta", label: "Confirmado", notice: "Consulta confirmada." },
    { id: randomUUID(), date: past, hour: "11", action: "Registrar comparecimento", label: "Atendido", notice: "Comparecimento registrado." },
    { id: randomUUID(), date: past, hour: "12", action: "Registrar falta", label: "Faltou", notice: "Falta registrada." },
  ];
  const name = (id: string) => "Paciente fictício " + id;

  try {
    unwrap(await stack.admin.from("appointments").insert(cases.map(({ id, date, hour }) => ({
      id, clinic_id: clinicA, professional_id: professionalA, patient_name: name(id),
      starts_at: `${date}T${hour}:00:00Z`, ends_at: `${date}T${hour}:30:00Z`,
    }))));
    const member = stack.client();
    expect((await member.auth.signInWithPassword({ email: user.email, password: user.password })).error).toBeNull();
    const payload = { p_clinic: clinicA, p_appointment: cases[0].id, p_revision: 0 };
    expect((await member.rpc("agenda_set_status", { ...payload, p_status: "absent" })).error?.code).toBe("P0001");
    expect((await member.rpc("agenda_set_status", { ...payload, p_clinic: clinicB, p_status: "confirmed" })).error?.code).toBe("42501");

    await enter(page, user);
    for (const item of cases) {
      await page.goto(`/?day=${item.date}&agendaProfessional=${professionalA}`);
      const visit = page.getByRole("article").filter({ hasText: name(item.id) });
      await visit.getByText("Situação da consulta", { exact: true }).click();
      await visit.getByRole("button", { name: item.action, exact: true }).click();
      await expect(page.getByRole("status")).toHaveText(item.notice);
      await expect(visit.getByText(item.label, { exact: true })).toBeVisible();
      await expect(page.getByRole("combobox", { name: "Profissional da agenda" })).toHaveValue(professionalA);
    }
    await expect(page.getByText("1 atendido · 1 falta")).toBeVisible();
    const statusFilter = page.getByRole("combobox", { name: "Situação da agenda" });
    const apply = page.getByRole("button", { name: "Filtrar agenda" });
    await statusFilter.selectOption("attended");
    await apply.click();
    await expect(page.getByRole("article").filter({ hasText: name(cases[2].id) })).toHaveCount(0);
    await expect(page.getByRole("article").filter({ hasText: name(cases[1].id) })).toBeVisible();
    await expect(page.getByText("1 atendido · 1 falta")).toBeVisible();
    await page.getByRole("button", { name: "Consultar vagas" }).click();
    await expect(page).toHaveURL(/[?&]agendaStatus=attended(?:&|$)/);
    await statusFilter.selectOption("open");
    await apply.click();
    await expect(page.getByText("Nenhum agendamento corresponde aos filtros.")).toBeVisible();
    await statusFilter.selectOption("");
    await apply.click();
    await expect(page.getByRole("article").filter({ hasText: name(cases[2].id) })).toBeVisible();
    expect((await member.rpc("agenda_change", { p_clinic: clinicA, p_appointment: cases[0].id,
      p_revision: 0, p_action: "cancel" })).error?.code).toBe("P0001");
    expect((await member.rpc("agenda_set_status", { ...payload, p_appointment: cases[1].id, p_revision: 1,
      p_status: "absent" })).error?.code).toBe("P0001");

    const visit = page.getByRole("article").filter({ hasText: name(cases[1].id) });
    await visit.getByRole("link", { name: "Ver histórico" }).click();
    const history = page.getByRole("region", { name: "Histórico da consulta" });
    await expect(history.getByText("Agendado → Atendido")).toBeVisible();
    await expect(history.getByText("Agendamento criado")).toBeVisible();
    await history.getByText("Corrigir comparecimento ou falta", { exact: true }).click();
    await history.getByRole("button", { name: "Desfazer registro de presença" }).click();
    await expect(page.getByRole("status")).toHaveText("Registro de presença desfeito.");
    await expect(history.getByText("Atendido → Agendado")).toBeVisible();
    await expect(history.getByText("Agendado → Atendido")).toBeVisible();
    await expect(visit.getByText("Agendado", { exact: true })).toBeVisible();

    const undo = { p_clinic: clinicA, p_appointment: cases[1].id, p_revision: 1 };
    expect((await member.rpc("agenda_undo_attendance", undo)).error?.code).toBe("P0001");
    expect((await member.rpc("agenda_undo_attendance", { ...undo, p_clinic: clinicB })).error?.code).toBe("42501");
    expect((await stack.client().from("appointment_events").select("id")).error?.code).toBe("42501");
  } finally {
    unwrap(await stack.admin.from("appointments").delete().in("id", cases.map(({ id }) => id)));
    await stack.removeUser(user);
  }
});

test("compara sete dias de vagas e abre o dia selecionado", async ({ page }) => {
  const stack = localStack();
  const user = await stack.user(clinicA, "vagas-semanais");
  const id = randomUUID();
  const monday = new Date();
  monday.setUTCDate(monday.getUTCDate() + 56);
  while (monday.getUTCDay() !== 1) monday.setUTCDate(monday.getUTCDate() + 1);
  const offset = (days: number) => new Date(+monday + days * 86_400_000).toISOString().slice(0, 10);
  const date = offset(0);

  try {
    unwrap(await stack.admin.from("appointments").insert({
      id, clinic_id: clinicA, professional_id: professionalA, patient_name: "Paciente fictício " + id,
      starts_at: date + "T11:00:00Z", ends_at: date + "T11:30:00Z",
    }));
    const member = stack.client();
    expect((await member.auth.signInWithPassword({ email: user.email, password: user.password })).error).toBeNull();
    expect(unwrap(await member.rpc("agenda_week", { p_clinic: clinicB, p_professional: professionalA, p_from: date }))).toEqual([]);

    await enter(page, user);
    await page.goto(`/?day=${date}&professional=${professionalA}`);
    await page.getByRole("link", { name: "Ver vagas da semana" }).click();
    const week = page.getByRole("region", { name: "Vagas nos próximos 7 dias" });
    const row = (value: string) => week.getByRole("listitem").filter({ has: page.locator(`time[datetime="${value}"]`) });
    await expect(week.getByRole("listitem")).toHaveCount(7);
    await expect(row(date)).toContainText("19 vagas · a partir de 08:30");
    await expect(row(offset(1))).toContainText("20 vagas · a partir de 08:00");
    await expect(row(offset(5))).toContainText("Sem vagas");
    await expect(row(offset(6))).toContainText("Sem vagas");

    await week.getByRole("link", { name: "Sete dias seguintes" }).click();
    await expect(row(offset(7))).toBeVisible();
    await week.getByRole("link", { name: "Sete dias anteriores" }).click();
    await row(offset(1)).getByRole("link").click();
    await expect(week).toHaveCount(0);
    await expect(page.getByLabel("Data", { exact: true })).toHaveValue(offset(1));
    await expect(page.getByRole("combobox", { name: "Profissional", exact: true })).toHaveValue(professionalA);
    await expect(page.getByRole("combobox", { name: "Horário", exact: true }).locator("option", { hasText: "08:00 – 08:30" })).toHaveCount(1);
  } finally {
    unwrap(await stack.admin.from("appointments").delete().eq("id", id));
    await stack.removeUser(user);
  }
});

test("busca paciente e bloqueia ou devolve uma vaga sem sobrepor consultas", async ({ page }) => {
  const stack = localStack();
  const user = await stack.user(clinicA, "bloqueio-agenda");
  const marker = randomUUID();
  const patient = "Paciente fictício João " + marker;
  const reason = "Compromisso interno fictício " + marker;
  const target = new Date();
  target.setUTCDate(target.getUTCDate() + 91);
  while ([0, 6].includes(target.getUTCDay())) target.setUTCDate(target.getUTCDate() + 1);
  const date = target.toISOString().slice(0, 10);

  try {
    unwrap(await stack.admin.from("appointments").insert({
      clinic_id: clinicA, professional_id: professionalA, patient_name: patient,
      starts_at: date + "T12:00:00Z", ends_at: date + "T12:30:00Z",
    }));
    const member = stack.client();
    expect((await member.auth.signInWithPassword({ email: user.email, password: user.password })).error).toBeNull();
    expect((await member.rpc("agenda_block", {
      p_clinic: clinicA, p_professional: professionalA, p_start: date + "T12:00:00Z", p_reason: reason,
    })).error?.code).toBe("23P01");

    await enter(page, user);
    await page.goto(`/?day=${date}&professional=${professionalA}`);
    await page.getByRole("link", { name: "Bloquear uma vaga" }).click();
    await expect(page.getByRole("heading", { name: "Bloquear horário" })).toBeVisible();
    const time = page.getByRole("combobox", { name: "Horário", exact: true });
    await time.selectOption({ label: "08:00 – 08:30" });
    await page.getByLabel("Motivo do bloqueio (opcional)", { exact: true }).fill(reason);
    await page.getByRole("button", { name: "Confirmar bloqueio" }).click();
    await expect(page.getByRole("status")).toHaveText("Horário bloqueado.");
    await expect(time.locator("option", { hasText: "08:00 – 08:30" })).toHaveCount(0);
    const block = page.getByRole("article").filter({ hasText: reason });
    const consultation = page.getByRole("article").filter({ hasText: patient });
    await expect(block.getByText("Bloqueado", { exact: true })).toBeVisible();

    const status = page.getByRole("combobox", { name: "Situação da agenda" });
    const search = page.getByRole("searchbox", { name: "Buscar paciente" });
    const filter = page.getByRole("button", { name: "Filtrar agenda" });
    await status.selectOption("blocked");
    await filter.click();
    await expect(consultation).toHaveCount(0);
    await expect(block).toBeVisible();
    await block.getByText("Liberar horário", { exact: true }).click();
    await block.getByRole("button", { name: "Confirmar liberação" }).click();
    await expect(page.getByRole("status")).toHaveText("Bloqueio liberado.");
    await expect(time.locator("option", { hasText: "08:00 – 08:30" })).toHaveCount(1);
    await status.selectOption("");
    await search.fill("JOAO " + marker);
    await filter.click();
    await expect(consultation).toBeVisible();
    await expect(block).toHaveCount(0);
  } finally {
    unwrap(await stack.admin.from("appointments").delete().in("patient_name", [patient, reason]));
    await stack.removeUser(user);
  }
});

test("usa a grade do profissional com pausa, dia fechado e sábado", async ({ page }) => {
  const stack = localStack();
  const user = await stack.user(clinicA, "grade-profissional");
  const monday = new Date();
  monday.setUTCDate(monday.getUTCDate() + 105);
  while (monday.getUTCDay() !== 1) monday.setUTCDate(monday.getUTCDate() + 1);
  const day = (offset = 0) => new Date(+monday + offset * 86_400_000).toISOString().slice(0, 10);
  const patient = "Paciente fictício " + randomUUID();
  const prior = patient + " anterior";
  const key = { clinic_id: clinicA, professional_id: professionalA };

  try {
    unwrap(await stack.admin.from("appointments").insert({
      ...key, patient_name: prior, starts_at: day() + "T12:00:00Z", ends_at: day() + "T12:30:00Z",
    }));
    unwrap(await stack.admin.from("professional_hours").insert([
      { ...key, weekday: 1, opens_at: "10:00", closes_at: "14:00", break_from: "12:00", break_until: "13:00" },
      { ...key, weekday: 2 },
      { ...key, weekday: 6, opens_at: "07:00", closes_at: "08:00" },
    ]));
    const member = stack.client();
    expect((await member.auth.signInWithPassword({ email: user.email, password: user.password })).error).toBeNull();
    const rpc = (date: string, hour: string, action = "book", appointment?: string) =>
      member.rpc("agenda_change", { p_clinic: clinicA, p_professional: professionalA,
        p_start: date + "T" + hour + ":00Z", p_patient: patient, p_action: action,
        p_appointment: appointment, p_revision: appointment ? 0 : undefined });
    expect((await rpc(day(), "11:00")).error?.code).toBe("22023");
    expect((await rpc(day(1), "13:00")).error?.code).toBe("22023");
    const saturday = unwrap(await rpc(day(5), "10:00"));
    expect((await rpc(day(), "15:00", "move", saturday)).error?.code).toBe("22023");
    expect((await member.from("professional_hours").delete().eq("professional_id", professionalA)).error?.code).toBe("42501");

    await enter(page, user);
    await page.goto(`/?day=${day()}&professional=${professionalA}`);
    await expect(page.getByText("Horário de trabalho 10:00 – 14:00 · Pausa 12:00 – 13:00")).toBeVisible();
    await expect(page.getByRole("article").filter({ hasText: prior })).toBeVisible();
    const time = page.getByRole("combobox", { name: "Horário", exact: true });
    await expect(time.locator("option", { hasText: "12:00 – 12:30" })).toHaveCount(0);
    await page.getByRole("link", { name: "Ver vagas da semana" }).click();
    const week = page.getByRole("region", { name: "Vagas nos próximos 7 dias" });
    await expect(week.getByRole("link", { name: "6 vagas · a partir de 10:00" })).toBeVisible();
    await expect(week.getByRole("link", { name: "1 vaga · a partir de 07:30" })).toBeVisible();
    await page.getByRole("link", { name: "Próximo dia" }).click();
    await expect(page.getByText("Profissional sem atendimento nesta data.")).toBeVisible();
  } finally {
    unwrap(await stack.admin.from("professional_hours").delete().eq("clinic_id", clinicA).eq("professional_id", professionalA));
    unwrap(await stack.admin.from("appointments").delete().in("patient_name", [patient, prior]));
    await stack.removeUser(user);
  }
});
