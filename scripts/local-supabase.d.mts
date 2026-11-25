import type { SupabaseClient } from "@supabase/supabase-js";

export const clinicA: string;
export const clinicB: string;
export const professionalA: string;
export const professionalB: string;

export type LocalUser = { id: string; email: string; password: string; clinic: string };

export function unwrap<T>(result: { data: T; error: { code?: string; message: string } | null }): T;

export function localStack(): {
  url: string;
  key: string;
  admin: SupabaseClient;
  serviceRoleKey: string;
  client: () => SupabaseClient;
  user: (clinic: string, label: string) => Promise<LocalUser>;
  removeUser: (user: LocalUser) => Promise<void>;
};
