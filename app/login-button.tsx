"use client";

import { useFormStatus } from "react-dom";

export function LoginButton() {
  const { pending } = useFormStatus();
  return <button type="submit" disabled={pending} aria-busy={pending}>
    {pending ? "Entrando…" : "Entrar"}
  </button>;
}
