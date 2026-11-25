import { writeFileSync } from "node:fs";
import { clinicA, clinicB, localStack } from "./local-supabase.mjs";

const stack = localStack();
if (process.argv.includes("--env")) {
  writeFileSync(".env.local", `NEXT_PUBLIC_SUPABASE_URL=${stack.url}\nNEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=${stack.key}\n`, {
    flag: "wx", mode: 0o600,
  });
}
const users = [];
try {
  users.push(await stack.user(clinicA, "horizonte"));
  users.push(await stack.user(clinicB, "sorriso"));
} catch (error) {
  await Promise.all(users.map((user) => stack.removeUser(user)));
  throw error;
}

for (const { email, password } of users) {
  console.log(`E-mail: ${email}\nSenha local: ${password}\n`);
}
