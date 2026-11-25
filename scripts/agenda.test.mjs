import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { clinicA, clinicB, localStack, professionalA, professionalB, unwrap } from "./local-supabase.mjs";

const nextWeek = new Date();
nextWeek.setUTCDate(nextWeek.getUTCDate() + 7);
while ([0, 6].includes(nextWeek.getUTCDay())) nextWeek.setUTCDate(nextWeek.getUTCDate() + 1);
const day = nextWeek.toISOString().slice(0, 10);
const name = `Paciente fictício ${randomUUID()}`;

test("API da agenda com Supabase local", async (t) => {
  const stack = localStack();
  const users = [];
  t.after(async () => {
    unwrap(await stack.admin.from("appointments").delete().eq("patient_name", name));
    for (const user of users) await stack.removeUser(user);
  });
  const userA = await stack.user(clinicA, "teste-a");
  users.push(userA);
  const userB = await stack.user(clinicB, "teste-b");
  users.push(userB);

  const a = stack.client();
  const b = stack.client();
  const anon = stack.client();
  for (const [client, { email, password }] of [[a, userA], [b, userB]]) {
    unwrap(await client.auth.signInWithPassword({ email, password }));
  }
  const slots = (client = a, clinic = clinicA, professional = professionalA) =>
    client.rpc("agenda_slots", { p_clinic: clinic, p_professional: professional, p_day: day });
  const agenda = (client = a, clinic = clinicA) =>
    client.rpc("agenda_day", { p_clinic: clinic, p_day: day });
  const change = (client, action, params) => client.rpc("agenda_change", {
    p_clinic: clinicA, p_action: action, ...params,
  });
  const book = (start) => ({ p_professional: professionalA, p_start: start, p_patient: name });
  const [first, second, third] = unwrap(await slots());
  const start = first.starts_at;
  let id;

  await t.test("retorna vagas da grade e recusa horários fora dela", async () => {
    assert.ok(third);
    assert.equal(Date.parse(first.ends_at) - Date.parse(start), 30 * 60_000);
    assert.equal((await change(a, "book", book(new Date(Date.parse(start) + 60_000).toISOString()))).error?.code, "22023");
    assert.equal((await change(a, "book", { ...book(start), p_professional: professionalB })).error?.code, "22023");
  });

  await t.test("aceita somente uma reserva concorrente e permite intervalos adjacentes", async () => {
    const attempts = await Promise.all([change(a, "book", book(start)), change(a, "book", book(start))]);
    const successes = attempts.filter(({ error }) => !error);
    assert.equal(successes.length, 1);
    assert.equal(attempts.find(({ error }) => error)?.error.code, "23P01");
    id = successes[0].data;
    assert.equal(second.starts_at, first.ends_at);
    unwrap(await change(a, "book", book(second.starts_at)));
    assert.equal(unwrap(await slots()).some((slot) => slot.starts_at === start), false);
    assert.equal(unwrap(await agenda()).find((item) => item.id === id).patient_name, name);
  });

  await t.test("isola clínicas e bloqueia escrita direta ou anônima", async () => {
    assert.deepEqual(unwrap(await b.from("clinics").select("id")), [{ id: clinicB }]);
    assert.deepEqual(unwrap(await b.from("clinic_members").select("clinic_id")), [{ clinic_id: clinicB }]);
    assert.deepEqual(unwrap(await b.from("appointments").select("id").eq("id", id)), []);
    assert.deepEqual(unwrap(await b.from("professionals").select("id").eq("clinic_id", clinicA)), []);
    assert.deepEqual(unwrap(await agenda(b)), []);
    assert.deepEqual(unwrap(await slots(b)), []);
    assert.ok(unwrap(await slots(b, clinicB, professionalB)).length > 0);
    assert.equal((await change(b, "cancel", { p_appointment: id, p_revision: 0 })).error?.code, "42501");
    assert.equal((await change(b, "cancel", { p_clinic: clinicB, p_appointment: id, p_revision: 0 })).error?.code, "P0001");
    assert.equal((await change(anon, "book", book(start))).error?.code, "42501");
    assert.equal((await a.from("appointments").update({ status: "cancelled" }).eq("id", id)).error?.code, "42501");
  });

  await t.test("reverte remarcação em conflito, aceita nova vaga e cancela com revisão", async () => {
    const appointment = { p_appointment: id, p_revision: 0 };
    assert.equal((await change(a, "move", { ...book(second.starts_at), ...appointment })).error?.code, "23P01");
    assert.equal(unwrap(await agenda()).find((item) => item.id === id).starts_at, start);
    unwrap(await change(a, "move", { ...book(third.starts_at), ...appointment }));
    assert.equal(unwrap(await agenda()).find((item) => item.id === id).starts_at, third.starts_at);
    assert.ok(unwrap(await slots()).some((slot) => slot.starts_at === start));
    assert.equal((await change(a, "cancel", appointment)).error?.code, "P0001");
    unwrap(await change(a, "cancel", { ...appointment, p_revision: 1 }));
    assert.equal(unwrap(await agenda()).find((item) => item.id === id).status, "cancelled");
    assert.ok(unwrap(await slots()).some((slot) => slot.starts_at === third.starts_at));
  });
});
