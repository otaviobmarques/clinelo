import { execFileSync } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";

export const clinicA = "10000000-0000-4000-8000-000000000001";
export const clinicB = "10000000-0000-4000-8000-000000000002";
export const professionalA = "20000000-0000-4000-8000-000000000001";
export const professionalB = "20000000-0000-4000-8000-000000000003";

export function unwrap({ data, error }) {
  if (error) throw new Error(`${error.code ?? ""} ${error.message}`.trim());
  return data;
}

export function localStack() {
  const status = JSON.parse(execFileSync("npm", ["run", "--silent", "db", "--", "status", "-o", "json"], {
    encoding: "utf-8", stdio: ["ignore", "pipe", "pipe"],
  }));
  const url = new URL(status.API_URL);
  if (!["127.0.0.1", "localhost"].includes(url.hostname)) throw new Error("Use o Supabase local.");
  const key = status.PUBLISHABLE_KEY ?? status.ANON_KEY;
  const options = { auth: { persistSession: false, autoRefreshToken: false } };
  const admin = createClient(url.href, status.SERVICE_ROLE_KEY, options);

  return {
    url: url.origin, key, admin,
    client: () => createClient(url.href, key, options),
    async user(clinic, label) {
      const email = `${label}.${randomUUID().slice(0, 8)}@clinelo.example`;
      const password = randomBytes(24).toString("base64url");
      const { user } = unwrap(await admin.auth.admin.createUser({ email, password, email_confirm: true }));
      try {
        unwrap(await admin.from("clinic_members").insert({ clinic_id: clinic, user_id: user.id }));
      } catch (error) {
        await admin.auth.admin.deleteUser(user.id);
        throw error;
      }
      return { id: user.id, email, password, clinic };
    },
    async removeUser(user) {
      unwrap(await admin.from("clinic_members").delete().eq("user_id", user.id));
      unwrap(await admin.auth.admin.deleteUser(user.id));
    },
  };
}
