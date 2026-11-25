import { randomUUID } from "node:crypto";
import { expect, test, type Page } from "@playwright/test";
import { clinicA, clinicB, localStack, professionalA, unwrap, type LocalUser } from "../scripts/local-supabase.mjs";

async function enter(page: Page, user: LocalUser) {
  await page.goto("/");
  await page.getByLabel("E-mail", { exact: true }).fill(user.email);
  await page.getByLabel("Senha", { exact: true }).fill(user.password);
  await page.getByRole("button", { name: "Entrar" }).click();
  await expect(page.getByRole("heading", { name: "Agenda diária" })).toBeVisible();
}

test("cadastra, busca, edita e arquiva sem expor o cadastro a outra clínica", async ({ page, browser }) => {
  const stack = localStack();
  const users: LocalUser[] = [];
  const suffix = randomUUID();
  const name = "João Fictício " + suffix;
  const updated = name + " Atualizado";
  let patient: string | null = null;
  const isolated = await browser.newContext();

  try {
    users.push(await stack.user(clinicA, "paciente-a"));
    users.push(await stack.user(clinicB, "paciente-b"));
    await enter(page, users[0]);
    await page.getByRole("link", { name: "Pacientes", exact: true }).click();
    await page.getByLabel("Nome completo").fill(name);
    await page.getByLabel("Telefone (opcional)", { exact: true }).fill("+55 (00) 00000-0000");
    await page.getByLabel("E-mail (opcional)", { exact: true }).fill("ficticio@example.test");
    await page.getByRole("button", { name: "Cadastrar paciente" }).click();
    await expect(page.getByRole("status")).toHaveText("Paciente cadastrado.");
    await expect(page.getByLabel("Telefone (opcional)", { exact: true })).toHaveValue("+5500000000000");
    patient = new URL(page.url()).searchParams.get("patient");
    const profileUrl = page.url();

    const member = stack.client();
    expect((await member.auth.signInWithPassword({ email: users[0].email, password: users[0].password })).error).toBeNull();
    const before = unwrap(await member.from("patients").select("revision").eq("id", patient).single());
    await page.getByLabel("Nome completo").fill(updated);
    await page.getByRole("button", { name: "Salvar cadastro" }).click();
    await expect(page.getByRole("status")).toHaveText("Cadastro atualizado.");
    expect((await member.rpc("patient_change", { p_clinic: clinicA, p_action: "archive", p_id: patient,
      p_revision: before?.revision })).error?.code).toBe("P0001");

    await page.getByRole("searchbox", { name: "Buscar por nome, telefone ou e-mail" }).fill("JOAO " + "FICTICIO " + suffix);
    await page.getByRole("button", { name: "Buscar", exact: true }).click();
    await expect(page).toHaveURL(/[?&]q=/);
    await expect(page.getByRole("link", { name: updated, exact: true })).toBeVisible();
    await page.getByRole("link", { name: updated, exact: true }).click();
    await page.getByRole("button", { name: "Arquivar cadastro" }).click();
    await expect(page.getByRole("status")).toHaveText("Cadastro arquivado.");
    await expect(page.getByRole("link", { name: "Agendar para este paciente" })).toHaveCount(0);
    expect((await member.rpc("agenda_book_for_patient", {
      p_clinic: clinicA, p_patient: patient, p_professional: professionalA, p_start: "2100-03-01T11:00:00Z",
    })).error?.code).toBe("P0001");
    await page.getByRole("button", { name: "Reativar cadastro" }).click();
    await expect(page.getByRole("status")).toHaveText("Cadastro reativado.");
    await expect(page.getByRole("link", { name: "Agendar para este paciente" })).toBeVisible();

    const other = await isolated.newPage();
    const url = new URL(profileUrl);
    await other.goto(url.origin);
    await other.getByLabel("E-mail", { exact: true }).fill(users[1].email);
    await other.getByLabel("Senha", { exact: true }).fill(users[1].password);
    await other.getByRole("button", { name: "Entrar" }).click();
    await expect(other.getByRole("heading", { name: "Agenda diária" })).toBeVisible();
    await other.goto(profileUrl);
    await expect(other.getByRole("main").getByRole("alert")).toHaveText("Você não tem acesso a esta clínica.");
    await expect(other.getByText(updated, { exact: true })).toHaveCount(0);
    const clientB = stack.client();
    expect((await clientB.auth.signInWithPassword({ email: users[1].email, password: users[1].password })).error).toBeNull();
    expect(unwrap(await clientB.rpc("patient_search", { p_clinic: clinicA, p_query: suffix }))).toEqual([]);
  } finally {
    await isolated.close();
    unwrap(await stack.admin.from("patients").delete().in("name", [name, updated]));
    for (const user of users) await stack.removeUser(user);
  }
});

test("agenda um paciente da caixa e preserva os dois vínculos no histórico", async ({ page }) => {
  const stack = localStack();
  const user = await stack.user(clinicA, "agenda-paciente");
  const patient = randomUUID();
  const thread = randomUUID();
  const name = "Pessoa Fictícia " + patient;
  const date = new Date();
  date.setUTCDate(date.getUTCDate() + 147);
  while ([0, 6].includes(date.getUTCDay())) date.setUTCDate(date.getUTCDate() + 1);
  const day = date.toISOString().slice(0, 10);

  try {
    unwrap(await stack.admin.from("patients").insert({ id: patient, clinic_id: clinicA, name }));
    unwrap(await stack.admin.from("inbox_threads").insert({ id: thread, clinic_id: clinicA, subject: "Conversa fictícia" }));
    await enter(page, user);
    await page.goto(`/caixa?clinic=${clinicA}&thread=${thread}`);
    await page.getByRole("link", { name: "Agendar com paciente cadastrado" }).click();
    await page.getByRole("link", { name, exact: true }).click();
    await page.getByRole("link", { name: "Agendar para este paciente" }).click();
    await expect(page.getByRole("link", { name: "Voltar à ficha" })).toBeVisible();
    await expect(page.getByLabel("Nome do paciente")).toHaveCount(0);
    await page.getByLabel("Data", { exact: true }).fill(day);
    await page.getByRole("button", { name: "Consultar vagas" }).click();
    await expect(page).toHaveURL(new RegExp("day=" + day));
    await page.getByRole("combobox", { name: "Horário", exact: true }).selectOption({ label: "08:00 – 08:30" });
    await page.getByRole("button", { name: "Agendar consulta" }).click();
    await expect(page.getByRole("status")).toHaveText("Agendamento criado.");
    const row = unwrap(await stack.admin.from("appointments").select("patient_id,inbox_thread_id")
      .eq("patient_name", name).single());
    expect(row).toEqual({ patient_id: patient, inbox_thread_id: thread });

    await page.getByRole("link", { name: "Voltar à ficha" }).click();
    const history = page.getByRole("region", { name: "Consultas de " + name });
    const visitLink = history.getByRole("link", { name: /08:00/ });
    await expect(visitLink).toBeVisible();
    await visitLink.click();
    const visit = page.getByRole("article").filter({ hasText: name });
    await expect(visit.getByRole("link", { name: "Ver atendimento" })).toBeVisible();
    await visit.getByText("Cancelar", { exact: true }).click();
    await visit.getByRole("button", { name: "Confirmar cancelamento" }).click();
    await expect(page.getByRole("status")).toHaveText("Agendamento cancelado.");
    await visit.getByRole("link", { name: "Ver ficha do paciente" }).click();
    await expect(history.getByText(/Cancelado/)).toBeVisible();
  } finally {
    unwrap(await stack.admin.from("appointments").delete().eq("patient_id", patient));
    unwrap(await stack.admin.from("patients").delete().eq("id", patient));
    unwrap(await stack.admin.from("inbox_threads").delete().eq("id", thread));
    await stack.removeUser(user);
  }
});

test("localiza por contato e vincula ou desvincula uma consulta antiga", async ({ page }) => {
  const stack = localStack();
  const user = await stack.user(clinicA, "vinculo-legado");
  const appointment = randomUUID();
  const patient = randomUUID();
  const homonym = randomUUID();
  const name = "Pessoa Fictícia " + appointment;
  const email = patient + "@example.test";
  const lastWeek = new Date();
  lastWeek.setUTCDate(lastWeek.getUTCDate() - 35);
  const day = lastWeek.toISOString().slice(0, 10);

  try {
    unwrap(await stack.admin.from("patients").insert([
      { id: patient, clinic_id: clinicA, name, phone: "+5500000000000", email },
      { id: homonym, clinic_id: clinicA, name, email: homonym + "@example.test" },
    ]));
    unwrap(await stack.admin.from("appointments").insert({
      id: appointment, clinic_id: clinicA, professional_id: professionalA, patient_name: name,
      starts_at: day + "T11:00:00Z", ends_at: day + "T11:30:00Z",
    }));
    const member = stack.client();
    expect((await member.auth.signInWithPassword({ email: user.email, password: user.password })).error).toBeNull();
    unwrap(await member.rpc("agenda_set_status", {
      p_clinic: clinicA, p_appointment: appointment, p_revision: 0, p_status: "attended",
    }));

    await enter(page, user);
    await page.goto(`/?day=${day}&agendaProfessional=${professionalA}`);
    const visit = page.getByRole("article").filter({ hasText: name });
    await visit.getByRole("link", { name: "Vincular à ficha" }).click();
    const search = page.getByRole("searchbox", { name: "Buscar por nome, telefone ou e-mail" });
    await search.fill("+55 (00) 00000-0000");
    await page.getByRole("button", { name: "Buscar", exact: true }).click();
    const directory = page.getByRole("region", { name: "Cadastros da clínica" });
    await expect(directory.getByRole("link", { name, exact: true })).toHaveCount(1);
    await search.fill(email.toUpperCase());
    await page.getByRole("button", { name: "Buscar", exact: true }).click();
    await expect(page).toHaveURL(/q=.*%40EXAMPLE.TEST/);
    await expect(directory.getByRole("link", { name, exact: true })).toHaveCount(1);
    await directory.getByRole("link", { name, exact: true }).click();
    await page.getByRole("button", { name: "Confirmar vínculo desta consulta" }).click();
    await expect(page.getByRole("status")).toHaveText("Consulta vinculada à ficha.");
    const history = page.getByRole("region", { name: "Consultas de " + name });
    await expect(history.getByText(/Atendido/)).toBeVisible();

    const link = (p_patient: string, p_revision: number, p_clinic = clinicA) => member.rpc("patient_link_visit", {
      p_clinic, p_patient, p_appointment: appointment, p_revision,
    });
    expect((await link(homonym, 2)).error?.code).toBe("P0001");
    expect((await link(homonym, 2, clinicB)).error?.code).toBe("42501");
    unwrap(await member.rpc("agenda_undo_attendance", { p_clinic: clinicA, p_appointment: appointment, p_revision: 2 }));

    await history.getByRole("link", { name: /08:00/ }).click();
    await visit.getByRole("link", { name: "Ver histórico" }).click();
    await expect(page.getByText("Consulta vinculada a uma ficha", { exact: true })).toBeVisible();
    await visit.getByRole("link", { name: "Ver ficha do paciente" }).click();
    await history.getByText("Desvincular consulta", { exact: true }).click();
    await history.getByRole("button", { name: "Confirmar desvinculação" }).click();
    await expect(page.getByRole("status")).toHaveText("Consulta desvinculada da ficha.");
    await expect(history.getByText("Nenhuma consulta vinculada nesta página.")).toBeVisible();
    const original = unwrap(await member.from("appointments").select("patient_id,patient_name").eq("id", appointment).single());
    expect(original).toEqual({ patient_id: null, patient_name: name });
  } finally {
    unwrap(await stack.admin.from("appointments").delete().eq("id", appointment));
    unwrap(await stack.admin.from("patients").delete().in("id", [patient, homonym]));
    await stack.removeUser(user);
  }
});

test("associa a conversa à ficha e reaproveita o paciente para consultar vagas", async ({ page }) => {
  const stack = localStack();
  const user = await stack.user(clinicA, "paciente-conversa");
  const thread = randomUUID();
  const patient = randomUUID();
  const otherPatient = randomUUID();
  const subject = "Conversa fictícia " + thread;
  const name = "Pessoa Fictícia " + patient;

  try {
    unwrap(await stack.admin.from("patients").insert([
      { id: patient, clinic_id: clinicA, name },
      { id: otherPatient, clinic_id: clinicB, name: "Pessoa de outra clínica fictícia" },
    ]));
    const row = unwrap(await stack.admin.from("inbox_threads").insert({ id: thread, clinic_id: clinicA, subject })
      .select("patient_link_revision").single());
    const member = stack.client();
    expect((await member.auth.signInWithPassword({ email: user.email, password: user.password })).error).toBeNull();
    const link = { p_clinic: clinicA, p_thread: thread, p_patient: patient, p_revision: row?.patient_link_revision };
    expect((await member.rpc("inbox_link_patient", { ...link, p_patient: otherPatient })).error?.code).toBe("P0001");

    await enter(page, user);
    await page.goto(`/caixa?clinic=${clinicA}&thread=${thread}`);
    await page.getByRole("link", { name: "Vincular paciente ao atendimento" }).click();
    await page.getByRole("link", { name, exact: true }).click();
    await page.getByRole("button", { name: "Confirmar vínculo do atendimento" }).click();
    await expect(page.getByRole("status")).toHaveText("Paciente vinculado ao atendimento.");
    await expect(page.getByText("Atendimento vinculado à ficha do paciente.")).toBeVisible();
    expect((await member.rpc("inbox_link_patient", { ...link, p_unlink: true })).error?.code).toBe("P0001");
    await page.getByRole("link", { name: "Agendar para o paciente vinculado" }).click();
    await expect(page.getByRole("link", { name: "Voltar à ficha" })).toBeVisible();
    await expect(page).toHaveURL(new RegExp("patientId=" + patient));
    await expect(page.getByLabel("Nome do paciente")).toHaveCount(0);
    await page.getByRole("link", { name: "Voltar à ficha" }).click();
    const conversations = page.getByRole("region", { name: "Atendimentos de " + name });
    await expect(conversations.getByRole("link", { name: subject })).toBeVisible();
    await conversations.getByRole("link", { name: subject }).click();
    await page.getByText("Remover vínculo do paciente", { exact: true }).click();
    await page.getByRole("button", { name: "Confirmar remoção do vínculo" }).click();
    await expect(page.getByRole("status")).toHaveText("Paciente desvinculado do atendimento.");
    await expect(page.getByText("Vínculo com a ficha do paciente removido.")).toBeVisible();
    await expect(page.getByRole("link", { name: "Vincular paciente ao atendimento" })).toBeVisible();
  } finally {
    unwrap(await stack.admin.from("inbox_threads").delete().eq("id", thread));
    unwrap(await stack.admin.from("patients").delete().in("id", [patient, otherPatient]));
    await stack.removeUser(user);
  }
});
