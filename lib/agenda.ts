export type Clinic = { id: string; name: string; timezone: string };
export type Professional = { id: string; name: string };
export type Slot = { starts_at: string; ends_at: string };
export type Booking = Slot & {
  id: string;
  professional_id: string;
  patient_name: string;
  status: keyof typeof statusLabels;
  revision: number;
};

export const statusLabels = {
  scheduled: "Agendado",
  confirmed: "Confirmado",
  cancelled: "Cancelado",
  attended: "Atendido",
  absent: "Faltou",
};

export const agendaStatusFilters = {
  open: "Em aberto",
  scheduled: "Agendados",
  confirmed: "Confirmados",
  attended: "Atendidos",
  absent: "Faltas",
  cancelled: "Cancelados",
} as const;

export type AgendaStatusFilter = keyof typeof agendaStatusFilters;

export function agendaStatusFilter(value: string): AgendaStatusFilter | undefined {
  return Object.hasOwn(agendaStatusFilters, value) ? value as AgendaStatusFilter : undefined;
}

export function bookingIsOpen({ status }: Booking) {
  return status === "scheduled" || status === "confirmed";
}

export const statusActions = {
  confirmed: "Confirmar consulta",
  attended: "Registrar comparecimento",
  absent: "Registrar falta",
} as const;

export const messages = {
  booked: "Agendamento criado.",
  moved: "Agendamento remarcado.",
  cancelled: "Agendamento cancelado.",
  confirmed: "Consulta confirmada.",
  attended: "Comparecimento registrado.",
  absent: "Falta registrada.",
  conflict: "O horário acabou de ser ocupado. Escolha outra vaga.",
  changed: "O agendamento já foi alterado. Confira a agenda atualizada.",
  invalid: "Confira os dados e selecione um horário disponível.",
  forbidden: "Você não tem acesso a esta clínica.",
  error: "Não foi possível concluir a operação. Tente novamente.",
  login: "Não foi possível entrar. Confira seu e-mail e sua senha.",
} as const;

export function validId(value: string) {
  return /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(value);
}

export function validDay(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || value.startsWith("0000")) return false;
  const date = new Date(value + "T00:00:00Z");
  return Number.isFinite(+date) && date.toISOString().slice(0, 10) === value;
}

export function localDay(timeZone: string) {
  const parts = new Intl.DateTimeFormat("pt-BR", {
    timeZone, year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts();
  const part = (name: string) => parts.find(({ type }) => type === name)?.value;
  return [part("year"), part("month"), part("day")].join("-");
}

export function shiftDay(day: string, offset: number) {
  const date = new Date(day + "T00:00:00Z");
  date.setUTCDate(date.getUTCDate() + offset);
  return date.toISOString().slice(0, 10);
}

export function agendaUrl(values: Record<string, string | undefined>) {
  const params = new URLSearchParams();
  for (const [name, value] of Object.entries(values)) if (value) params.set(name, value);
  return params.size ? "/?" + params : "/";
}
