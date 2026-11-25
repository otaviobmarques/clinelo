export function waitingUrl(values: {
  clinic?: string; patient?: string; request?: string; day?: string; notice?: string; history?: string; page?: number;
} = {}) {
  const params = new URLSearchParams();
  for (const [name, value] of Object.entries(values)) if (value) params.set(name, String(value));
  return params.size ? "/espera?" + params : "/espera";
}
