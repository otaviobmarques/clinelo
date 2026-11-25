import { Navigation } from "../navigation";
import Link from "next/link";
import { redirect } from "next/navigation";
import { logout } from "../actions";
import { changeWaiting } from "./actions";
import { agendaUrl, localDay, shiftDay, validDay, validId, type Clinic, type Professional, type Slot } from "../../lib/agenda";
import { patientsUrl } from "../../lib/patients";
import { receptionUrl } from "../../lib/reception";
import { supabase, supabaseSettings } from "../../lib/supabase";
import { waitingUrl } from "../../lib/waiting";

export const dynamic = "force-dynamic";

type Request = {
  id: string; patient_id: string; professional_id: string; date_from: string; date_until: string;
  status: "waiting" | "booked" | "withdrawn"; appointment_id: string | null;
};
const metrics = "id,patient_id,professional_id,date_from,date_until,status,appointment_id";
const messages = {
  create: "Preferência registrada.", book: "Consulta agendada pela lista de espera.", withdraw: "Solicitação retirada.",
  invalid: "Confira o profissional, o intervalo de até 30 dias e a vaga escolhida.",
  duplicate: "Esta preferência já está na lista.", changed: "A solicitação ou o cadastro está indisponível.",
  conflict: "A vaga acabou de ser ocupada. Consulte outro horário.", forbidden: "Você não tem acesso a esta clínica.",
  error: "Não foi possível concluir a operação.",
};

export default async function WaitingPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  if (!supabaseSettings()) redirect("/");
  const client = await supabase();
  const { data: { user } } = await client.auth.getUser();
  if (!user) redirect("/");
  const params = await searchParams;
  const query = (key: string) => typeof params[key] === "string" ? params[key] : "";
  const clinicsResult = await client.from("clinics").select("id,name,timezone").order("name");
  const clinics = (clinicsResult.data ?? []) as Clinic[];
  const clinic = query("clinic") ? clinics.find(({ id }) => id === query("clinic")) : clinics[0];
  if (!clinic) return <main className="workspace">
    <h1>Lista de espera</h1>
    <p role="alert">{clinicsResult.error ? "Não foi possível carregar as clínicas." : "Clínica indisponível para este usuário."}</p>
    <Link href="/painel">Abrir painel</Link>
  </main>;

  const today = localDay(clinic.timezone);
  const history = query("history") === "1" ? "1" : undefined;
  const page = /^\d{1,5}$/.test(query("page")) ? Math.max(1, Number(query("page"))) : 1;
  const scope = { clinic: clinic.id, history };
  const list = client.from("waiting_requests").select(metrics).eq("clinic_id", clinic.id);
  if (history) list.or("status.neq.waiting,date_until.lt." + today);
  else list.eq("status", "waiting").gte("date_until", today);

  const [queue, selected, selectedPatient, staff] = await Promise.all([
    list.order("created_at").order("id").range((page - 1) * 25, page * 25),
    validId(query("request")) ? client.from("waiting_requests").select(metrics).eq("clinic_id", clinic.id)
      .eq("id", query("request")).maybeSingle() : null,
    validId(query("patient")) ? client.from("patients").select("id,name,archived").eq("clinic_id", clinic.id)
      .eq("id", query("patient")).maybeSingle() : null,
    client.from("professionals").select("id,name").eq("clinic_id", clinic.id).order("name"),
  ]);
  const rows = (queue.data ?? []) as Request[];
  const request = selected?.data as Request | undefined;
  const patient = selectedPatient?.data;
  const professionals = (staff.data ?? []) as Professional[];
  const patientIds = [...new Set([...rows.map(({ patient_id }) => patient_id), ...(request ? [request.patient_id] : [])])];
  const firstDay = request && today > request.date_from ? today : request?.date_from;
  const dates: string[] = [];
  if (request && request.status === "waiting" && firstDay) {
    for (let offset = 0; offset < 30; offset++) {
      const day = shiftDay(firstDay, offset);
      if (!validDay(day) || day > request.date_until) break;
      dates.push(day);
    }
  }
  const day = dates.includes(query("day")) ? query("day") : dates[0];
  const [namesResult, slotsResult, bookingResult] = await Promise.all([
    patientIds.length ? client.from("patients").select("id,name,archived").eq("clinic_id", clinic.id).in("id", patientIds) : null,
    request && day ? client.rpc("agenda_slots", { p_clinic: clinic.id, p_professional: request.professional_id, p_day: day }) : null,
    request?.appointment_id ? client.from("appointments").select("id,starts_at,professional_id").eq("clinic_id", clinic.id)
      .eq("id", request.appointment_id).maybeSingle() : null,
  ]);
  const names = new Map(namesResult?.data?.map((item) => [item.id, item]) ?? []);
  const slots = (slotsResult?.data ?? []) as Slot[];
  const booking = bookingResult?.data;
  const formatDate = new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeZone: "UTC" });
  const formatTime = new Intl.DateTimeFormat("pt-BR", { hour: "2-digit", minute: "2-digit", timeZone: clinic.timezone });
  const showDate = (value: string) => formatDate.format(new Date(value + "T12:00:00Z"));
  const notice = query("notice");
  const success = ["create", "book", "withdraw"].includes(notice);

  return <>
    <Navigation clinic={clinic.id} /><header className="topbar"><div className="topbar-inner">
      <nav className="date-nav" aria-label="Recepção">
        <Link className="secondary button" href={receptionUrl(clinic.id)}>Painel</Link>
        <Link className="secondary button" href={agendaUrl({ clinic: clinic.id })}>Agenda</Link>
        <Link className="secondary button" href={patientsUrl({ clinic: clinic.id })}>Pacientes</Link>
      </nav>
      <form action={logout}><button className="secondary">Sair</button></form>
    </div></header>
    <main className="workspace">
      <div className="heading"><div><h1>Lista de espera</h1><p>{clinic.name}</p></div>
        {clinics.length > 1 && <form method="get" className="clinic-picker">
          <label>Clínica<select name="clinic" defaultValue={clinic.id}>{clinics.map((item) =>
            <option value={item.id} key={item.id}>{item.name}</option>)}</select></label>
          <button className="secondary">Abrir</button>
        </form>}
      </div>
      {Object.hasOwn(messages, notice) && <p className={success ? "notice success" : "notice"} role={success ? "status" : "alert"}>
        {messages[notice as keyof typeof messages]}
      </p>}
      {(queue.error || selected?.error || staff.error || selectedPatient?.error || namesResult?.error || bookingResult?.error) &&
        <p className="notice" role="alert">Não foi possível carregar parte da lista.</p>}
      <div className="columns">
        <section className="card booking-card" aria-labelledby="waiting-queue">
          <h2 id="waiting-queue">Preferências registradas</h2>
          <nav className="inbox-nav" aria-label="Filtrar solicitações">
            <Link className="secondary button" aria-current={!history ? "page" : undefined}
              href={waitingUrl({ clinic: clinic.id })}>Em espera</Link>
            <Link className="secondary button" aria-current={history ? "page" : undefined}
              href={waitingUrl({ clinic: clinic.id, history: "1" })}>Histórico</Link>
          </nav>
          {!queue.error && !rows.length && <p className="empty">Nenhuma solicitação nesta lista.</p>}
          <ul className="inbox-list">{rows.slice(0, 25).map((item) => <li key={item.id}>
            <Link href={waitingUrl({ ...scope, request: item.id, page })} aria-current={item.id === request?.id ? "page" : undefined}>
              {names.get(item.patient_id)?.name ?? "Paciente"}
            </Link>
            <p className="subtle">{professionals.find(({ id }) => id === item.professional_id)?.name} · {showDate(item.date_from)} a {showDate(item.date_until)}</p>
          </li>)}</ul>
          {(page > 1 || rows.length > 25) && <nav className="inbox-nav" aria-label="Páginas da lista">
            {page > 1 && <Link href={waitingUrl({ ...scope, page: page - 1 })}>Anterior</Link>}
            {rows.length > 25 && <Link href={waitingUrl({ ...scope, page: page + 1 })}>Próxima</Link>}
          </nav>}
        </section>
        <aside className="card booking-card">
          {patient && !patient.archived && !request ? <>
            <h2>Incluir na lista de espera</h2>
            <p className="subtle">{patient.name}</p>
            <form action={changeWaiting} className="filters">
              <input type="hidden" name="clinic" value={clinic.id} />
              <input type="hidden" name="patient" value={patient.id} />
              <label>Profissional da preferência<select name="professional" required defaultValue="">
                <option value="" disabled>Selecione</option>
                {professionals.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
              </select></label>
              <label>Data inicial<input name="from" type="date" min={today} defaultValue={today} required /></label>
              <label>Data final<input name="until" type="date" min={today} defaultValue={today} required /></label>
              <button name="operation" value="create">Registrar preferência</button>
            </form>
          </> : request ? <>
            <h2>{names.get(request.patient_id)?.name ?? "Solicitação"}</h2>
            <p className="subtle">{request.status === "booked" ? "Agendada" : request.status === "withdrawn" ? "Retirada"
              : dates.length ? "Em espera" : "Preferência expirada"}</p>
            {booking && <Link href={agendaUrl({ clinic: clinic.id, day: localDay(clinic.timezone, new Date(booking.starts_at)),
              agendaProfessional: booking.professional_id, professional: booking.professional_id }) + "#consulta-" + booking.id}>Ver consulta na agenda</Link>}
            {request.status === "waiting" && <>
              {day && !names.get(request.patient_id)?.archived && <>
                <form method="get" className="filters" key={day}>
                  <input type="hidden" name="clinic" value={clinic.id} />
                  <input type="hidden" name="request" value={request.id} />
                  <label>Data para consultar vagas<select name="day" defaultValue={day}>
                    {dates.map((date) => <option key={date} value={date}>{showDate(date)}</option>)}
                  </select></label>
                  <button className="secondary">Consultar vagas</button>
                </form>
                {slotsResult?.error ? <p role="alert">Não foi possível consultar as vagas.</p>
                  : slots.length ? <form action={changeWaiting} className="filters" key={"slots-" + day}>
                    <input type="hidden" name="clinic" value={clinic.id} />
                    <input type="hidden" name="request" value={request.id} />
                    <input type="hidden" name="day" value={day} />
                    <label>Horário disponível<select name="start" required defaultValue="">
                      <option value="" disabled>Selecione</option>
                      {slots.map((slot) => <option key={slot.starts_at} value={slot.starts_at}>
                        {formatTime.format(new Date(slot.starts_at))}
                      </option>)}
                    </select></label>
                    <p className="subtle">Vagas da Agenda do Produto. <Link href={agendaUrl({ clinic: clinic.id, day, professional: request.professional_id }) + "#vagas"}>
                      Conferir avisos do Google na agenda diária
                    </Link></p>
                    <button name="operation" value="book">Agendar pela lista de espera</button>
                  </form> : <p className="empty">Nenhuma vaga nesta data.</p>}
              </>}
              <details className="filters">
                <summary>Retirar da lista</summary>
                <form action={changeWaiting} className="filters">
                  <input type="hidden" name="clinic" value={clinic.id} />
                  <input type="hidden" name="request" value={request.id} />
                  <button className="secondary" name="operation" value="withdraw">Confirmar retirada</button>
                </form>
              </details>
            </>}
          </> : <>
            <h2>Registrar preferência</h2>
            <p className="subtle">Abra uma ficha ativa para adicionar um paciente à lista.</p>
            <Link href={patientsUrl({ clinic: clinic.id })}>Buscar paciente</Link>
          </>}
        </aside>
      </div>
    </main>
  </>;
}
