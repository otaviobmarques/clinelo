"use client";

import { useEffect, useState } from "react";

export function QueueWait({ since, timezone }: { since: string; timezone: string }) {
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    setNow(Date.now());
    const timer = window.setInterval(() => setNow(Date.now()), 60000);
    return () => window.clearInterval(timer);
  }, []);
  const entered = new Date(since);
  const exact = entered.toLocaleString("pt-BR", { timeZone: timezone });
  const minutes = now === null ? null : Math.max(0, Math.floor((now - entered.getTime()) / 60000));
  const elapsed = minutes === null ? null : minutes < 60 ? minutes + " min" :
    Math.floor(minutes / 60) + " h " + minutes % 60 + " min";
  return <div className="subtle"><time dateTime={since} title={exact}>
    {elapsed === null ? "Na fila desde " + exact : "Na fila há " + elapsed}
  </time></div>;
}
