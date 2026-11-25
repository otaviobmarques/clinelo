import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import { clinicB, localStack, type LocalUser, unwrap } from "../scripts/local-supabase.mjs";

test("resume a agenda de hoje e prioriza a fila da clínica", async ({ page }) => {
  const stack = localStack();
  const clinic = randomUUID();
  const professional = randomUUID();
  const older = randomUUID();
  const recent = randomUUID();
  const visit = randomUUID();
  const ids = [visit, randomUUID(), randomUUID(), randomUUID()];
  const team: LocalUser[] = [];
  const now = Date.now();
  const at = (minutes: number) => new Date(now + minutes * 60_000).toISOString();
  const offset = 12 - new Date(now).getUTCHours();
  const timezone = offset === 0 ? "Etc/UTC" : "Etc/GMT" + (offset > 0 ? "-" : "+") + Math.abs(offset);
  const title = "Clínica Fictícia " + clinic;
  const olderSubject = "Atendimento mais antigo " + older;
  const recentSubject = "Atendimento recente " + recent;

  try {
    unwrap(await stack.admin.from("clinics").insert({ id: clinic, name: title, timezone }));
    unwrap(await stack.admin.from("professionals").insert({ id: professional, clinic_id: clinic, name: "Dra. Fictícia" }));
    team.push(await stack.user(clinic, "painel-a"));
    team.push(await stack.user(clinicB, "painel-b"));
    unwrap(await stack.admin.from("appointments").insert([
      { id: ids[0], clinic_id: clinic, professional_id: professional, patient_name: "Próxima consulta fictícia",
        starts_at: at(30), ends_at: at(60), status: "scheduled" },
      { id: ids[1], clinic_id: clinic, professional_id: professional, patient_name: "Consulta fictícia atendida",
        starts_at: at(-60), ends_at: at(-30), status: "attended" },
      { id: ids[2], clinic_id: clinic, professional_id: professional, patient_name: "Bloqueio fictício",
        starts_at: at(60), ends_at: at(90), is_block: true },
      { id: ids[3], clinic_id: clinic, professional_id: professional, patient_name: "Consulta de ontem",
        starts_at: at(-1440), ends_at: at(-1410), status: "confirmed" },
    ]));
    unwrap(await stack.admin.from("inbox_threads").insert([
      { id: older, clinic_id: clinic, subject: olderSubject },
      { id: recent, clinic_id: clinic, subject: recentSubject },
      { clinic_id: clinic, subject: "Atendimento atribuído", assignee_id: team[0].id, assignee_label: "Recepção fictícia" },
      { clinic_id: clinic, subject: "Atendimento encerrado", status: "closed" },
    ]));
    unwrap(await stack.admin.from("inbox_threads").update({ queued_at: at(-65) }).eq("id", older));
    unwrap(await stack.admin.from("inbox_threads").update({ queued_at: at(-10) }).eq("id", recent));

    await page.goto("/");
    await page.getByLabel("E-mail", { exact: true }).fill(team[0].email);
    await page.getByLabel("Senha", { exact: true }).fill(team[0].password);
    await page.getByRole("button", { name: "Entrar" }).click();
    await page.getByRole("link", { name: "Painel", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Painel da recepção" })).toBeVisible();
    const appointments = page.getByRole("region", { name: "Consultas de hoje" });
    await expect(appointments.getByRole("link", { name: "Agendados 1" })).toBeVisible();
    await expect(appointments.getByRole("link", { name: "Atendidos 1" })).toBeVisible();
    await expect(appointments.getByRole("link", { name: "Confirmados 0" })).toBeVisible();
    await expect(appointments.getByRole("link", { name: "Próxima consulta fictícia" })).toBeVisible();
    await expect(appointments.getByText("Bloqueio fictício")).toHaveCount(0);
    const box = page.getByRole("region", { name: "Caixa de atendimento" });
    await expect(box.getByRole("link", { name: "Em aberto 3" })).toBeVisible();
    await expect(box.getByRole("link", { name: "Sem responsável 2" })).toBeVisible();
    await expect(box.getByRole("link", { name: "Meus atendimentos 1" })).toBeVisible();
    const waiting = box.getByRole("list").last();
    await expect(waiting.getByRole("listitem").first()).toContainText(olderSubject);
    await expect(waiting.getByRole("listitem").last()).toContainText(recentSubject);
    await waiting.getByRole("link", { name: olderSubject }).click();
    await expect(page.getByRole("heading", { name: olderSubject })).toBeVisible();
    await expect(page).toHaveURL(/[?&]assignment=unassigned/);

    const other = stack.client();
    expect((await other.auth.signInWithPassword({ email: team[1].email, password: team[1].password })).error).toBeNull();
    expect(unwrap(await other.rpc("reception_dashboard", { p_clinic: clinic, p_day: at(0).slice(0, 10) }))).toBeNull();
    expect((await stack.client().rpc("reception_dashboard", { p_clinic: clinic, p_day: at(0).slice(0, 10) })).error?.code).toBe("42501");
  } finally {
    unwrap(await stack.admin.from("appointments").delete().eq("clinic_id", clinic));
    unwrap(await stack.admin.from("inbox_threads").delete().eq("clinic_id", clinic));
    for (const user of team) await stack.removeUser(user);
    unwrap(await stack.admin.from("professionals").delete().eq("clinic_id", clinic));
    unwrap(await stack.admin.from("clinics").delete().eq("id", clinic));
  }
});
