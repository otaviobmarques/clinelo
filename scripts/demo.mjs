import { existsSync, writeFileSync } from "node:fs";
import { clinicA, clinicB, localStack, unwrap } from "./local-supabase.mjs";

const writeEnv = process.argv.includes("--env");
if (writeEnv && existsSync(".env.local")) {
  console.error("O arquivo .env.local já existe. Use npm run demo para criar contas sem sobrescrevê-lo.");
  process.exit(1);
}

const stack = localStack();
const users = [];
try {
  users.push(await stack.user(clinicA, "horizonte"));
  users.push(await stack.user(clinicB, "sorriso"));
  unwrap(await stack.admin.from("clinic_members").update({ can_manage_hours: true })
    .eq("clinic_id", clinicA).eq("user_id", users[0].id));
  if (writeEnv) {
    writeFileSync(".env.local", `NEXT_PUBLIC_SUPABASE_URL=${stack.url}\nNEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=${stack.key}\n`, {
      flag: "wx", mode: 0o600,
    });
  }
} catch (error) {
  await Promise.all(users.map((user) => stack.removeUser(user)));
  throw error;
}

for (const { email, password } of users) {
  console.log(`E-mail: ${email}\nSenha local: ${password}\n`);
}
