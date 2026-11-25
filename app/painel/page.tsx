import Link from "next/link";
import { redirect } from "next/navigation";
import { logout } from "../actions";
import { QueueWait } from "../caixa/queue-wait";
import { agendaStatusFilters, agendaUrl, localDay, statusLabels, type Booking, type Clinic } from "../../lib/agenda";
import { channelLabels, inboxUrl } from "../../lib/inbox";
import { patientsUrl } from "../../lib/patients";
import { type ReceptionDashboard } from "../../lib/reception";
import { supabase, supabaseSettings } from "../../lib/supabase";

export const dynamic = "force-dynamic";

const visitStatuses: Booking["status"][] = ["scheduled", "confirmed", "attended", "absent", "cancelled"];

export default async function ReceptionPage({ searchParams }: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  if (!supabaseSettings()) redirect("/");
  const client = await supabase();
  const { data: { user } } = await client.auth.getUser();
  if (!user) redirect("/");

  const params = await searchParams;
  const requested = typeof params.clinic === "string" ? params.clinic : "";
  const clinicResult = await client.from("clinics").select("id,name,timezone").order("name");
  const clinics = (clinicResult.data ?? []) as Clinic[];
  const clinic = requested ? clinics.find(({ id }) => id === requested) : clinics[0];
  if (!clinic) return <main className="workspace">
    <h1>Painel da recepção</h1>
    <p role="alert">{clinicResult.error ? "Não foi possível carregar as clínicas." : requested
      ? "Você não tem acesso a esta clínica." : "Nenhuma clínica vinculada."}</p>
    <Link href="/painel">Abrir meu painel</Link>
  </main>;

  const day = localDay(clinic.timezone);
  const { data, error } = await client.rpc("reception_dashboard", { p_clinic: clinic.id, p_day: day });
  const dashboard = data as ReceptionDashboard | null;
  const date = new Intl.DateTimeFormat("pt-BR", { dateStyle: "full", timeZone: "UTC" });
  const time = new Intl.DateTimeFormat("pt-BR", { hour: "2-digit", minute: "2-digit", timeZone: clinic.timezone });

  return <>
    <header className="topbar"><div className="topbar-inner">
      <nav className="date-nav" aria-label="Recepção">
        <Link className="button secondary" href={agendaUrl({ clinic: clinic.id, day })}>Agenda</Link>
        <Link className="button secondary" href={inboxUrl({ clinic: clinic.id })}>Caixa compartilhada</Link>
        <Link className="button secondary" href={patientsUrl({ clinic: clinic.id })}>Pacientes</Link>
      </nav>
      <form action={logout}><button className="secondary">Sair</button></form>
    </div></header>
    <main className="workspace">
      <div className="heading">
        <div><h1>Painel da recepção</h1><p>{clinic.name} · {date.format(new Date(day + "T12:00:00Z"))}</p></div>
        {clinics.length > 1 && <form method="get" className="clinic-picker">
          <label>Clínica<select name="clinic" defaultValue={clinic.id}>
            {clinics.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
          </select></label>
          <button className="secondary">Abrir</button>
        </form>}
      </div>
      {error || !dashboard ? <p className="notice" role="alert">Não foi possível carregar o painel. Atualize a página para tentar novamente.</p>
        : <div className="columns reception-columns">
          <section className="card booking-card" aria-labelledby="reception-visits">
            <h2 id="reception-visits">Consultas de hoje</h2>
            <ul className="reception-metrics">
              {visitStatuses.map((status) => <li key={status}>
                <Link href={agendaUrl({ clinic: clinic.id, day, agendaStatus: status })}>
                  <span>{agendaStatusFilters[status]}</span><strong>{dashboard.appointments[status]}</strong>
                </Link>
              </li>)}
            </ul>
            <h3>Próximos horários</h3>
            {!dashboard.next.length && <p className="empty">Nenhuma consulta nos próximos horários de hoje.</p>}
            <ul className="inbox-list">
              {dashboard.next.map((visit) => <li key={visit.id}>
                <Link href={agendaUrl({ clinic: clinic.id, day, professional: visit.professional_id,
                  agendaProfessional: visit.professional_id }) + "#consulta-" + visit.id}>{visit.patient_name}</Link>
                <p className="subtle">{time.format(new Date(visit.starts_at))} · {visit.professional_name} · {statusLabels[visit.status]}</p>
              </li>)}
            </ul>
          </section>
          <section className="card booking-card" aria-labelledby="reception-inbox">
            <h2 id="reception-inbox">Caixa de atendimento</h2>
            <ul className="reception-metrics">
              <li><Link href={inboxUrl({ clinic: clinic.id, status: "open" })}>
                <span>Em aberto</span><strong>{dashboard.queue.open}</strong>
              </Link></li>
              <li><Link href={inboxUrl({ clinic: clinic.id, status: "open", assignment: "unassigned" })}>
                <span>Sem responsável</span><strong>{dashboard.queue.unassigned}</strong>
              </Link></li>
              <li><Link href={inboxUrl({ clinic: clinic.id, status: "open", assignment: "mine" })}>
                <span>Meus atendimentos</span><strong>{dashboard.queue.mine}</strong>
              </Link></li>
            </ul>
            <h3>Aguardando responsável</h3>
            {!dashboard.waiting.length && <p className="empty">Nenhum atendimento aguardando responsável.</p>}
            <ul className="inbox-list">
              {dashboard.waiting.map((item) => <li key={item.id}>
                <Link href={inboxUrl({ clinic: clinic.id, status: "open", assignment: "unassigned", thread: item.id })}>{item.subject}</Link>
                {" "}<span className="tag">{channelLabels[item.channel]}</span>
                {item.queued_at ? <QueueWait since={item.queued_at} timezone={clinic.timezone} />
                  : <p className="subtle">Horário de entrada indisponível.</p>}
              </li>)}
            </ul>
          </section>
        </div>}
    </main>
  </>;
}
