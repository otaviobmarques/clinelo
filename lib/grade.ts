export const weekdays = ["Segunda-feira", "Terça-feira", "Quarta-feira", "Quinta-feira", "Sexta-feira", "Sábado", "Domingo"];

export function gradeUrl(values: { clinic?: string; professional?: string; weekday?: number; notice?: string } = {}) {
  const params = new URLSearchParams();
  for (const [name, value] of Object.entries(values)) if (value) params.set(name, String(value));
  return params.size ? "/grade?" + params : "/grade";
}
