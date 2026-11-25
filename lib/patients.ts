export type Patient = {
  id: string;
  name: string;
  phone: string | null;
  email: string | null;
  archived: boolean;
  revision: string;
};

export function patientsUrl(values: {
  clinic?: string; patient?: string; q?: string; archived?: string; notice?: string; page?: number; historyPage?: number; thread?: string;
} = {}) {
  const params = new URLSearchParams();
  for (const [name, value] of Object.entries(values)) if (value) params.set(name, String(value));
  return params.size ? "/pacientes?" + params : "/pacientes";
}
