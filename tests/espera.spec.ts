import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import { clinicA, clinicB, localStack, professionalA, unwrap, type LocalUser } from "../scripts/local-supabase.mjs";

test("registra preferência, preserva a espera em conflito e conclui uma única reserva", async ({ page }) => {
  const stack = localStack();
  const patient = randomUUID();
  const blocker = randomUUID();
  const name = "Paciente fictício " + patient;
  const date = new Date();
  date.setUTCDate(date.getUTCDate() + 175);
  while ([0, 6].includes(date.getUTCDay())) date.setUTCDate(date.getUTCDate() + 1);
  const day = date.toISOString().slice(0, 10);
  const users: LocalUser[] = [];

  try {
    users.push(await stack.user(clinicA, "espera-a"));
    users.push(await stack.user(clinicB, "espera-b"));
    unwrap(await stack.admin.from("patients").insert({ id: patient, clinic_id: clinicA, name }));
    await page.goto("/");
    await page.getByLabel("E-mail", { exact: true }).fill(users[0].email);
    await page.getByLabel("Senha", { exact: true }).fill(users[0].password);
    await page.getByRole("button", { name: "Entrar" }).click();
    await expect(page.getByRole("heading", { name: "Agenda diária" })).toBeVisible();
    await page.goto(`/pacientes?clinic=${clinicA}&patient=${patient}`);
    await page.getByRole("link", { name: "Adicionar à lista de espera" }).click();
    await page.getByRole("combobox", { name: "Profissional da preferência" }).selectOption(professionalA);
    await page.getByLabel("Data inicial", { exact: true }).fill(day);
    await page.getByLabel("Data final", { exact: true }).fill(day);
    await page.getByRole("button", { name: "Registrar preferência" }).click();
    await expect(page.getByRole("status")).toHaveText("Preferência registrada.");
    const request = new URL(page.url()).searchParams.get("request");
    const time = page.getByRole("combobox", { name: "Horário disponível" });
    await expect(time.locator("option", { hasText: "08:00" })).toHaveCount(1);

    const member = stack.client();
    const other = stack.client();
    for (const [client, user] of [[member, users[0]], [other, users[1]]] as const) {
      expect((await client.auth.signInWithPassword({ email: user.email, password: user.password })).error).toBeNull();
    }
    expect(unwrap(await other.from("waiting_requests").select("id").eq("id", request))).toEqual([]);
    expect((await member.rpc("waiting_request_change", {
      p_clinic: clinicA, p_action: "create", p_patient: patient, p_professional: professionalA, p_from: day, p_until: day,
    })).error?.code).toBe("23505");
    unwrap(await stack.admin.from("appointments").insert({
      id: blocker, clinic_id: clinicA, professional_id: professionalA, patient_name: "Consulta fictícia concorrente",
      starts_at: day + "T11:00:00Z", ends_at: day + "T11:30:00Z",
    }));
    await time.selectOption({ label: "08:00" });
    await page.getByRole("button", { name: "Agendar pela lista de espera" }).click();
    await expect(page.getByRole("main").getByRole("alert")).toHaveText("A vaga acabou de ser ocupada. Consulte outro horário.");
    expect(unwrap(await member.from("waiting_requests").select("status,appointment_id").eq("id", request).single()))
      .toEqual({ status: "waiting", appointment_id: null });
    await time.selectOption({ label: "08:30" });
    await page.getByRole("button", { name: "Agendar pela lista de espera" }).click();
    await expect(page.getByRole("status")).toHaveText("Consulta agendada pela lista de espera.");
    const linked = unwrap(await member.from("waiting_requests").select("status,appointment_id").eq("id", request).single());
    expect(linked?.status).toBe("booked");
    expect((await member.rpc("waiting_request_change", {
      p_clinic: clinicA, p_action: "book", p_request: request, p_start: day + "T12:00:00Z",
    })).error?.code).toBe("P0001");
    await page.getByRole("link", { name: "Ver consulta na agenda" }).click();
    await expect(page.getByRole("article").filter({ hasText: name })).toContainText("08:30");
  } finally {
    unwrap(await stack.admin.from("waiting_requests").delete().eq("patient_id", patient));
    unwrap(await stack.admin.from("appointments").delete().eq("patient_id", patient));
    unwrap(await stack.admin.from("appointments").delete().eq("id", blocker));
    unwrap(await stack.admin.from("patients").delete().eq("id", patient));
    for (const user of users) await stack.removeUser(user);
  }
});
