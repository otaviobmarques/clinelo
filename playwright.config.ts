import { randomBytes } from "node:crypto";
import { clinicB, localStack } from "./scripts/local-supabase.mjs";
import { defineConfig } from "@playwright/test";

const whatsappEnabled = process.env.CLINELO_TEST_WHATSAPP === "1";
const whatsappEnv = whatsappEnabled ? {
  WHATSAPP_APP_SECRET: process.env.CLINELO_TEST_META_SECRET ??= randomBytes(24).toString("hex"),
  WHATSAPP_VERIFY_TOKEN: process.env.CLINELO_TEST_META_VERIFY ??= randomBytes(24).toString("hex"),
  WHATSAPP_CONTACT_SECRET: randomBytes(24).toString("hex"),
  WHATSAPP_CLINICS_JSON: JSON.stringify({ "10001": clinicB }),
  WHATSAPP_ACCESS_TOKEN: "token-ficticio",
  WHATSAPP_RECIPIENT_KEY: randomBytes(32).toString("base64"),
  WHATSAPP_GRAPH_VERSION: "v24.0",
  NODE_OPTIONS: [process.env.NODE_OPTIONS, "--import=./scripts/mock-whatsapp.mjs"].filter(Boolean).join(" "),
  SUPABASE_SERVICE_ROLE_KEY: localStack().serviceRoleKey,
} : undefined;

export default defineConfig({
  testDir: "./tests",
  use: {
    baseURL: "http://127.0.0.1:3000",
    launchOptions: { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE },
  },
  webServer: {
    command: "npm run dev -- --hostname 127.0.0.1",
    url: "http://127.0.0.1:3000",
    timeout: 60_000,
    env: whatsappEnv,
  },
});
