import Link from "next/link";
import { redirect } from "next/navigation";
import { logout } from "../actions";
import { saveHours } from "./actions";
import { agendaUrl, type Clinic, type Professional } from "../../lib/agenda";
import { gradeUrl, weekdays } from "../../lib/grade";
import { supabase, supabaseSettings } from "../../lib/supabase";

export const dynamic = "force-dynamic";

type Params = Record<string, string | string[] | undefined>;
type Hours = {
  weekday: number;
  opens_at: string | null;
  closes_at: string | null;
  break_from: string | null;
  break_until: string | null;
  revision: string;
};

const notices = {
  saved: "Grade atualizada.",
  forbidden: "Você não tem permissão para editar esta grade.",
  changed: "Esta grade foi alterada. Confira os horários antes de salvar novamente.",
  invalid: "Confira a abertura, o fechamento e a pausa. Use intervalos de 30 minutos.",
  error: "Não foi possível salvar a grade.",
};

function time(value?: string | null) {
  return value?.slice(0, 5) ?? "";
}

const halfHours = Array.from({ length: 49 }, (_, index) =>
  String(Math.floor(index / 2)).padStart(2, "0") + (index % 2 ? ":30" : ":00"),
);

function TimeField({ label, name, value, required = false }: {
  label: string; name: string; value: string; required?: boolean;
}) {
  return <label>{label}<select name={name} defaultValue={value} required={required}>
    <option value="">Selecione</option>
    {halfHours.map((option) => <option key={option}>{option}</option>)}
  </select></label>;
}

export default async function Grade({ searchParams }: { searchParams: Promise<Params> }) {
  if (!supabaseSettings()) redirect("/");
  const client = await supabase();
  const { data: { user } } = await client.auth.getUser();
  if (!user) redirect("/");

  const params = await searchParams;
  const query = (name: string) => typeof params[name] === "string" ? params[name] : "";
  const requested = query("clinic");
  const memberships = await client.from("clinic_members").select("clinic_id")
    .eq("user_id", user.id).eq("can_manage_hours", true);
  const ids = memberships.data?.map(({ clinic_id }) => clinic_id) ?? [];
  const clinicsResult = ids.length ? await client.from("clinics").select("id,name,timezone").in("id", ids).order("name") : null;
  const clinics = (clinicsResult?.data ?? []) as Clinic[];
  const clinic = requested ? clinics.find(({ id }) => id === requested) : clinics[0];

  if (!clinic) return <main className="workspace">
    <h1>Grade de atendimento</h1>
    <p role="alert">{memberships.error || clinicsResult?.error
      ? "Não foi possível verificar o acesso à grade." : "Você não tem permissão para editar a grade desta clínica."}</p>
    <Link href="/">Voltar à agenda</Link>
  </main>;

  const staff = await client.from("professionals").select("id,name").eq("clinic_id", clinic.id).order("name");
  const professionals = (staff.data ?? []) as Professional[];
  const professional = professionals.find(({ id }) => id === query("professional")) ?? professionals[0];
  const weekday = /^[1-7]$/.test(query("weekday")) ? Number(query("weekday")) : 1;
  const result = professional ? await client.from("professional_hours")
    .select("weekday,opens_at,closes_at,break_from,break_until,revision")
    .eq("clinic_id", clinic.id).eq("professional_id", professional.id) : null;
  const rows = (result?.data ?? []) as Hours[];
  const current = rows.find((row) => row.weekday === weekday);
  const notice = query("notice");

  return <>
    <header className="topbar"><div className="topbar-inner">
      <Link href={agendaUrl({ clinic: clinic.id, professional: professional?.id })} className="secondary button">Voltar à agenda</Link>
      <form action={logout}><button className="secondary">Sair</button></form>
    </div></header>
    <main className="workspace">
      <div className="heading">
        <div><h1>Grade de atendimento</h1><p>{clinic.name}</p></div>
        {clinics.length > 1 && <form method="get" className="clinic-picker">
          <label>Clínica<select name="clinic" defaultValue={clinic.id}>
            {clinics.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
          </select></label>
          <button className="secondary">Abrir</button>
        </form>}
      </div>
      {Object.hasOwn(notices, notice) && <p className={notice === "saved" ? "notice success" : "notice"} role={notice === "saved" ? "status" : "alert"}>
        {notices[notice as keyof typeof notices]}
      </p>}
      {(staff.error || result?.error) ? <p role="alert">Não foi possível carregar a grade.</p>
        : !professional ? <p>Nenhum profissional cadastrado.</p>
        : <div className="columns">
          <section className="card booking-card" aria-labelledby="grade-week">
            <h2 id="grade-week">Semana de {professional.name}</h2>
            <form method="get" className="clinic-picker inbox-nav">
              <input type="hidden" name="clinic" value={clinic.id} />
              <label>Profissional<select name="professional" defaultValue={professional.id}>
                {professionals.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
              </select></label>
              <button className="secondary">Abrir grade</button>
            </form>
            <ul className="inbox-list">
              {weekdays.map((label, index) => {
                const number = index + 1;
                const row = rows.find((item) => item.weekday === number);
                const summary = !row ? (number < 6 ? "Padrão · 08:00 – 18:00" : "Padrão · Fechado")
                  : row.opens_at ? time(row.opens_at) + " – " + time(row.closes_at) : "Fechado";
                return <li key={label}>
                  <Link aria-current={number === weekday ? "page" : undefined}
                    href={gradeUrl({ clinic: clinic.id, professional: professional.id, weekday: number })}>{label}</Link>
                  <p className="subtle">{summary}{row?.break_from && " · Pausa " + time(row.break_from) + " – " + time(row.break_until)}</p>
                </li>;
              })}
            </ul>
          </section>
          <section className="card booking-card" aria-labelledby="grade-edit">
            <h2 id="grade-edit">{weekdays[weekday - 1]}</h2>
            <p className="subtle">Os horários seguem o fuso da clínica e a grade de 30 minutos.</p>
            <form className="filters" action={saveHours} key={professional.id + "/" + weekday + "/" + (current?.revision ?? "default")}>
              <input type="hidden" name="clinic" value={clinic.id} />
              <input type="hidden" name="professional" value={professional.id} />
              <input type="hidden" name="weekday" value={weekday} />
              <input type="hidden" name="revision" value={current?.revision ?? ""} />
              <TimeField label="Abertura" name="opens" value={time(current?.opens_at) || (weekday < 6 ? "08:00" : "")} required />
              <TimeField label="Fechamento" name="closes" value={time(current?.closes_at) || (weekday < 6 ? "18:00" : "")} required />
              <TimeField label="Início da pausa (opcional)" name="break_from" value={time(current?.break_from)} />
              <TimeField label="Fim da pausa (opcional)" name="break_until" value={time(current?.break_until)} />
              <button name="operation" value="set">Salvar horários</button>
              <button className="secondary" name="operation" value="closed" formNoValidate>Fechar o dia</button>
              {current && <button className="secondary" name="operation" value="default" formNoValidate>Restaurar padrão</button>}
            </form>
          </section>
        </div>}
    </main>
  </>;
}
