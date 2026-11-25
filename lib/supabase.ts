import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

export function supabaseSettings() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  return url && key ? { url, key } : null;
}

export async function supabase() {
  const settings = supabaseSettings();
  if (!settings) throw new Error("Configuração do Supabase ausente.");
  const jar = await cookies();
  return createServerClient(settings.url, settings.key, {
    cookies: {
      getAll: () => jar.getAll(),
      setAll(values) {
        try {
          values.forEach(({ name, value, options }) => jar.set(name, value, options));
        } catch {
          // A renovação de cookies durante a renderização é feita pelo proxy.
        }
      },
    },
  });
}
