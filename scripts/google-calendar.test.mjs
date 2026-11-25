import assert from "node:assert/strict";
import { generateKeyPairSync, verify } from "node:crypto";
import { test } from "node:test";
import { googleAvailability } from "../lib/google-calendar.ts";

const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const calendarId = "agenda-ficticia@example.test";
const config = {
  links: JSON.stringify({ clinicA: { professionalA: calendarId }, clinicB: { professionalB: "outra@example.test" } }),
  account: JSON.stringify({ client_email: "servico-ficticio@example.test", private_key: privateKey.export({ type: "pkcs8", format: "pem" }) }),
};
const slots = [
  { starts_at: "2026-12-01T11:00:00Z", ends_at: "2026-12-01T11:30:00Z" },
  { starts_at: "2026-12-01T11:30:00Z", ends_at: "2026-12-01T12:00:00Z" },
];
const token = () => Response.json({ access_token: "token-ficticio" });

test("ignora profissionais de outra clínica e evita chamadas sem vagas", async () => {
  const calls = [];
  const request = (...args) => calls.push(args);
  assert.deepEqual(await googleAvailability("clinicA", "professionalB", slots, config, request), { status: "disconnected" });
  assert.deepEqual(await googleAvailability("clinicA", "professionalA", [], config, request), { status: "no-slots" });
  assert.deepEqual(await googleAvailability("clinicA", "professionalA", slots, {}, request), { status: "disconnected" });
  assert.equal(calls.length, 0);
});

test("consulta apenas horários ocupados e marca sobreposição sem marcar intervalos adjacentes", async () => {
  const calls = [];
  const result = await googleAvailability("clinicA", "professionalA", slots, config, async (url, options) => {
    calls.push({ url, options });
    if (calls.length === 1) return token();
    return Response.json({
      calendars: { [calendarId]: { busy: [{ start: "2026-12-01T11:15:00Z", end: "2026-12-01T11:30:00Z" }] } },
    });
  });

  assert.deepEqual(result, { status: "checked", occupied: new Set([slots[0].starts_at]) });
  assert.equal(calls[0].url, "https://oauth2.googleapis.com/token");
  const [header, payload, signature] = calls[0].options.body.get("assertion").split(".");
  const claims = JSON.parse(Buffer.from(payload, "base64url"));
  assert.equal(claims.scope, "https://www.googleapis.com/auth/calendar.events.freebusy");
  assert.equal(claims.sub, undefined);
  assert.ok(verify("RSA-SHA256", Buffer.from(header + "." + payload), publicKey, Buffer.from(signature, "base64url")));
  assert.equal(calls[1].url, "https://www.googleapis.com/calendar/v3/freeBusy");
  assert.equal(calls[1].options.headers.Authorization, "Bearer token-ficticio");
  assert.equal(calls[1].options.cache, "no-store");
  assert.deepEqual(JSON.parse(calls[1].options.body), {
    timeMin: "2026-12-01T11:00:00.000Z",
    timeMax: "2026-12-01T12:00:00.000Z",
    items: [{ id: calendarId }],
  });
});

test("trata falta de permissão, dados inválidos e falhas de rede como indisponibilidade", async () => {
  const expected = { status: "unavailable" };
  for (const response of [
    Response.json({}, { status: 503 }),
    Response.json({ calendars: { [calendarId]: { errors: [{ reason: "notFound" }], busy: [] } } }),
    Response.json({ calendars: { [calendarId]: { busy: [{ start: "", end: "" }] } } }),
    Response.json({ calendars: { other: { busy: [] } } }),
  ]) {
    const result = await googleAvailability("clinicA", "professionalA", slots, config, async (url) =>
      url.endsWith("/token") ? token() : response,
    );
    assert.deepEqual(result, expected);
  }
  assert.deepEqual(await googleAvailability("clinicA", "professionalA", slots, config, async () => {
    throw new Error("falha de rede simulada");
  }), expected);
  assert.deepEqual(await googleAvailability("clinicA", "professionalA", slots, { links: config.links }), expected);
});
