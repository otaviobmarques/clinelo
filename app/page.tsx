import Link from "next/link";
import { WeeklyAvailability, type AvailabilityDay } from "./weekly-availability";
import { changeBooking, login, logout } from "./actions";
import {
  agendaPatientKey, agendaPatientQuery, agendaStatusFilter, agendaStatusFilters, agendaUrl, bookingIsOpen, localDay, messages, shiftDay, statusActions, statusLabels, validDay, validId,
  type Booking, type Clinic, type Professional, type Slot,
} from "../lib/agenda";
import { whatsappConfigured } from "../lib/whatsapp";
import { gradeUrl } from "../lib/grade";
import { patientsUrl } from "../lib/patients";
import { inboxUrl } from "../lib/inbox";
import { googleAvailability, type GoogleAvailability } from "../lib/google-calendar";
import { supabase, supabaseSettings } from "../lib/supabase";

export const dynamic = "force-dynamic";

type Params = Record<string, string | string[] | undefined>;

function Brand() {
  return <div className="brand"><span className="mark" aria-hidden="true">+</span>
    <div><strong>Clinelo</strong><small>Domma Tecnologia</small></div></div>;
}

const googleLabels = {
  disconnected: "Desconectada",
  unavailable: "Indisponível",
  "no-slots": "Configurada",
  checked: "Conectada",
};

function Integrations({ googleStatus, whatsapp }: { googleStatus: GoogleAvailability["status"]; whatsapp: boolean }) {
  return <section className="integrations" aria-labelledby="channels-title">
    <h2 id="channels-title">Canais da recepção</h2>
    <ul>
      <li>Agenda do Produto <span className="tag active">Ativa</span></li>
      <li>Google Agenda <span className={googleStatus === "checked" ? "tag active" : "tag"}>{googleLabels[googleStatus]}</span></li>
      <li>Caixa compartilhada <span className="tag active">Ativa</span></li>
      <li>WhatsApp Business oficial <span className="tag">{whatsapp ? "Configurado" : "Desconectado"}</span></li>
    </ul>
  </section>;
}

function Notice({ code }: { code: string }) {
  if (!Object.hasOwn(messages, code)) return null;
  const success = ["booked", "moved", "cancelled", "blocked", "unblocked", "attendanceUndone"].includes(code) || Object.hasOwn(statusActions, code);
  return <p className={success ? "notice success" : "notice"} role={success ? "status" : "alert"}>
    {messages[code as keyof typeof messages]}
  </p>;
}

export default async function Page({ searchParams }: { searchParams: Promise<Params> }) {
  const params = await searchParams;
  const query = (name: string) => typeof params[name] === "string" ? params[name] : "";
  if (!supabaseSettings()) return <main className="login-shell"><Brand />
    <section className="card"><h1>Configure o Clinelo</h1>
      <p>Preencha as variáveis do Supabase no arquivo <code>.env.local</code> seguindo o README.</p></section>
  </main>;

  const client = await supabase();
  const { data: { user } } = await client.auth.getUser();
  if (!user) return <main className="login-shell"><Brand />
    <section className="card login">
      <h1>Acesse sua recepção</h1>
      <p>Entre com a conta vinculada à sua clínica.</p>
      <Notice code={query("notice")} />
      <form action={login}>
        <label>E-mail<input type="email" name="email" autoComplete="username" required /></label>
        <label>Senha<input type="password" name="password" autoComplete="current-password" required /></label>
        <button>Entrar</button>
      </form>
    </section>
  </main>;

  const clinicResult = await client.from("clinics").select("id,name,timezone").order("name");
  const clinics = (clinicResult.data ?? []) as Clinic[];
  const requestedClinic = query("clinic");
  const selectedClinic = clinics.find(({ id }) => id === requestedClinic);
  const clinic = selectedClinic ?? clinics[0];

  if (!clinic) return <main className="login-shell"><Brand />
    <section className="card">
      <h1>{clinicResult.error ? "Agenda indisponível" : "Nenhuma clínica vinculada"}</h1>
      <p>{clinicResult.error ? "Atualize a página para tentar novamente." : "Solicite ao administrador o vínculo da sua conta."}</p>
      <form action={logout}><button>Sair</button></form>
    </section>
  </main>;

  const today = localDay(clinic.timezone);
  const day = validDay(query("day")) ? query("day") : today;
  const week = query("week") === "1" && validDay(shiftDay(day, 6));
  const edit = validId(query("edit")) ? query("edit") : "";
  const history = validId(query("history")) && (!requestedClinic || selectedClinic) ? query("history") : undefined;
  const requestedThread = !edit ? query("thread") : "";
  const requestedPatient = !edit ? query("patientId") : "";
  const [staff, target, originResult, historyBooking, gradeAccess, patientResult] = await Promise.all([
    client.from("professionals").select("id,name").eq("clinic_id", clinic.id).order("name"),
    edit ? client.from("appointments").select("*").eq("clinic_id", clinic.id).eq("id", edit).maybeSingle() : null,
    validId(requestedThread) && (!requestedClinic || selectedClinic)
      ? client.from("inbox_threads").select("id,subject,status").eq("clinic_id", clinic.id)
        .eq("id", requestedThread).maybeSingle() : null,
    history ? client.from("appointments").select("*").eq("clinic_id", clinic.id)
      .eq("id", history).eq("is_block", false).maybeSingle() : null,
    client.from("clinic_members").select("can_manage_hours").eq("clinic_id", clinic.id).eq("user_id", user.id).maybeSingle(),
    validId(requestedPatient) && (!requestedClinic || selectedClinic) ? client.from("patients").select("id,name,archived")
      .eq("clinic_id", clinic.id).eq("id", requestedPatient).maybeSingle() : null,
  ]);
  const selectedPatient = patientResult?.data;
  const validPatient = !requestedPatient || selectedPatient?.archived === false;
  const origin = originResult?.data;
  const validOrigin = !requestedThread || origin?.status === "open";
  const professionals = (staff.data ?? []) as Professional[];
  const agendaProfessional = professionals.find(({ id }) => id === query("agendaProfessional"));
  const dayQuery = client.rpc("agenda_day", { p_clinic: clinic.id, p_day: day });
  if (agendaProfessional) dayQuery.eq("professional_id", agendaProfessional.id);
  const candidate = target?.data as Booking | undefined;
  const moving = candidate && !candidate.is_block && ["scheduled", "confirmed"].includes(candidate.status) ? candidate : undefined;
  const professional = [query("professional"), moving?.professional_id]
    .map((id) => professionals.find((person) => person.id === id)).find(Boolean) ?? professionals[0];
  const weekday = new Date(day + "T12:00:00Z").getUTCDay() || 7;
  const [agenda, slotResult, weekResult, historyResult, hoursResult, dateHoursResult, outsideHours] = await Promise.all([
    dayQuery,
    professional ? client.rpc("agenda_slots", {
      p_clinic: clinic.id, p_professional: professional.id, p_day: day,
    }) : null,
    week && professional ? client.rpc("agenda_week", {
      p_clinic: clinic.id, p_professional: professional.id, p_from: day,
    }) : null,
    historyBooking?.data ? client.from("appointment_events")
      .select("id,revision,occurred_at,actor_id,previous_status,status,previous_start,starts_at,previous_professional,professional_id")
      .eq("clinic_id", clinic.id).eq("appointment_id", historyBooking.data.id).order("id", { ascending: false }).limit(50) : null,
    professional ? client.from("professional_hours").select("opens_at,closes_at,break_from,break_until")
      .eq("clinic_id", clinic.id).eq("professional_id", professional.id).eq("weekday", weekday).maybeSingle() : null,
    professional ? client.from("professional_date_hours").select("opens_at,closes_at,break_from,break_until")
      .eq("clinic_id", clinic.id).eq("professional_id", professional.id).eq("day", day).maybeSingle() : null,
    client.rpc("agenda_outside_hours", { p_clinic: clinic.id, p_from: day, p_through: day,
      p_professional: agendaProfessional?.id ?? null }).select("id"),
  ]);
  const outsideRows = Array.isArray(outsideHours.data) ? outsideHours.data as { id: string }[] : [];
  const outsideIds = new Set(outsideRows.map(({ id }) => id));
  const bookings = (agenda.data ?? []) as Booking[];
  const agendaStatus = agendaStatusFilter(query("agendaStatus"));
  const patientQuery = agendaPatientQuery(query("patientQuery"));
  const patientKey = agendaPatientKey(patientQuery);
  const blocking = query("block") === "1" && !moving && !requestedThread && !requestedPatient;
  const visibleBookings = bookings.filter((booking) => {
    if (agendaStatus === "blocked") return booking.is_block && bookingIsOpen(booking) && !patientKey;
    if (booking.is_block) return !agendaStatus && !patientKey;
    if (agendaStatus === "open" && !bookingIsOpen(booking)) return false;
    if (agendaStatus && agendaStatus !== "open" && booking.status !== agendaStatus) return false;
    return !patientKey || agendaPatientKey(booking.patient_name).includes(patientKey);
  });
  const hours = dateHoursResult?.data ?? hoursResult?.data;
  const slots = (slotResult?.data ?? []) as Slot[];
  const google = professional && (!requestedClinic || selectedClinic) ? await googleAvailability(
    clinic.id, professional.id, slots, {
      links: process.env.GOOGLE_CALENDAR_LINKS_JSON,
      account: process.env.GOOGLE_CALENDAR_SERVICE_ACCOUNT_JSON,
    },
  ) : { status: "disconnected" as const };
  const scope = { clinic: clinic.id, day, professional: professional?.id, agendaProfessional: agendaProfessional?.id, agendaStatus, patientQuery, history, patientId: validId(requestedPatient) ? requestedPatient : undefined, block: blocking ? "1" : undefined, week: week ? "1" : undefined, thread: validId(requestedThread) ? requestedThread : undefined, edit: moving?.id };
  const dayLabel = new Intl.DateTimeFormat("pt-BR", {
    dateStyle: "full", timeZone: "UTC",
  }).format(new Date(day + "T12:00:00Z"));
  const time = new Intl.DateTimeFormat("pt-BR", {
    timeZone: clinic.timezone, hour: "2-digit", minute: "2-digit",
  });
  const formatTime = (value: string) => time.format(new Date(value));
  const consultations = bookings.filter(({ is_block }) => !is_block);
  const blockCount = bookings.filter((item) => item.is_block && bookingIsOpen(item)).length;
  const counts = {
    active: consultations.filter(bookingIsOpen).length,
    cancelled: consultations.filter(({ status }) => status === "cancelled").length,
    attended: consultations.filter(({ status }) => status === "attended").length,
    absent: consultations.filter(({ status }) => status === "absent").length,
  };

  const now = Date.now();
  const audited = historyBooking?.data as Booking | undefined;
  const events = historyResult?.data ?? [];
  const latest = events[0];
  const undoable = audited && latest && ["attended", "absent"].includes(audited.status)
    && latest.revision === audited.revision && latest.status === audited.status
    && ["scheduled", "confirmed"].includes(latest.previous_status ?? "");
  const historyDate = new Intl.DateTimeFormat("pt-BR", { timeZone: clinic.timezone, dateStyle: "short", timeStyle: "short" });
  const professionalName = (id: string) => professionals.find((person) => person.id === id)?.name ?? "Profissional";
  const visitFields = (booking: Booking) => <>
    <input type="hidden" name="clinic" value={clinic.id} />
    <input type="hidden" name="day" value={day} />
    <input type="hidden" name="professional" value={professional?.id ?? ""} />
    <input type="hidden" name="agendaProfessional" value={agendaProfessional?.id ?? ""} />
    {agendaStatus && <input type="hidden" name="agendaStatus" value={agendaStatus} />}
    {patientQuery && <input type="hidden" name="patientQuery" value={patientQuery} />}
    {week && <input type="hidden" name="week" value="1" />}
    {scope.thread && <input type="hidden" name="thread" value={scope.thread} />}
    {scope.patientId && <input type="hidden" name="patientId" value={scope.patientId} />}
    {history && <input type="hidden" name="history" value={history} />}
    <input type="hidden" name="appointment" value={booking.id} />
    <input type="hidden" name="revision" value={booking.revision} />
  </>;

  return <>
    <header className="topbar"><div className="topbar-inner">
      <Brand />
      <nav className="date-nav" aria-label="Recepção">
        {gradeAccess.data?.can_manage_hours && <Link href={gradeUrl({ clinic: clinic.id })} className="secondary button">Administrar grade</Link>}
        <Link href={patientsUrl({ clinic: clinic.id })} className="secondary button">Pacientes</Link>
        <Link href={inboxUrl({ clinic: clinic.id })} className="secondary button">Caixa compartilhada</Link>
        <form action={logout}><button className="secondary">Sair</button></form>
      </nav>
    </div></header>
    <main className="workspace">
      <div className="heading">
        <div><p className="eyebrow">RECEPÇÃO DIGITAL</p><h1>Agenda diária</h1><p>{clinic.name}</p></div>
        <form method="get" className="clinic-picker">
          <label>Clínica<select name="clinic" defaultValue={clinic.id}>
            {clinics.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
          </select></label>
          <button className="secondary">Abrir</button>
        </form>
      </div>
      {requestedClinic && !selectedClinic
        ? <p className="notice" role="alert">Você não tem acesso à clínica solicitada.</p>
        : <Notice code={query("notice")} />}
      {(staff.error || agenda.error || outsideHours.error || target?.error || slotResult?.error) &&
        <p className="notice" role="alert">Parte da agenda está indisponível. Atualize a página para tentar novamente.</p>}
      {edit && !moving && !target?.error &&
        <p className="notice" role="alert">Este agendamento está indisponível para remarcação.</p>}
      <div className="columns">
        <section className="card agenda" aria-labelledby="day-title">
          <div className="agenda-head">
            <div><h2 id="day-title">{dayLabel}</h2><p className="subtle">{counts.active} em aberto · {counts.cancelled} cancelados</p>
              {blockCount > 0 && <p className="subtle">{blockCount} {blockCount === 1 ? "bloqueio ativo" : "bloqueios ativos"}</p>}
              <p className="subtle">{counts.attended} {counts.attended === 1 ? "atendido" : "atendidos"} · {counts.absent} {counts.absent === 1 ? "falta" : "faltas"}</p></div>
            <nav className="date-nav" aria-label="Navegar pela agenda">
              {validDay(shiftDay(day, -1)) && <Link className="secondary button" aria-label="Dia anterior" href={agendaUrl({ ...scope, day: shiftDay(day, -1) })}>‹</Link>}
              <Link className="secondary button" href={agendaUrl({ ...scope, day: today })}>Hoje</Link>
              {validDay(shiftDay(day, 1)) && <Link className="secondary button" aria-label="Próximo dia" href={agendaUrl({ ...scope, day: shiftDay(day, 1) })}>›</Link>}
            </nav>
          </div>
          <form method="get" className="agenda-list-filter"
            key={`agenda-list-${agendaProfessional?.id ?? "all"}-${agendaStatus ?? "all"}-${patientQuery}`}>
            <input type="hidden" name="clinic" value={clinic.id} />
            <input type="hidden" name="day" value={day} />
            {week && <input type="hidden" name="week" value="1" />}
            {scope.thread && <input type="hidden" name="thread" value={scope.thread} />}
              {scope.patientId && <input type="hidden" name="patientId" value={scope.patientId} />}
            {blocking && <input type="hidden" name="block" value="1" />}
            {professional && <input type="hidden" name="professional" value={professional.id} />}
            {moving && <input type="hidden" name="edit" value={moving.id} />}
            {professionals.length > 1 && <label>Profissional da agenda<select name="agendaProfessional" defaultValue={agendaProfessional?.id ?? ""}>
              <option value="">Todos os profissionais</option>
              {professionals.map((person) => <option key={person.id} value={person.id}>{person.name}</option>)}
            </select></label>}
            <label>Situação da agenda<select name="agendaStatus" defaultValue={agendaStatus ?? ""}>
              <option value="">Todas as situações</option>
              {Object.entries(agendaStatusFilters).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select></label>
            <label>Buscar paciente<input name="patientQuery" type="search" defaultValue={patientQuery} maxLength={120} /></label>
            <button className="secondary">Filtrar agenda</button>
          </form>
          <div className="visits">
            {!agenda.error && !visibleBookings.length && <p className="empty">{agendaStatus || patientQuery ? "Nenhum agendamento corresponde aos filtros." : agendaProfessional ? "Nenhum agendamento para este profissional no dia." : "Nenhum agendamento para este dia."}</p>}
            {visibleBookings.map((booking) => <article className="visit" id={"consulta-" + booking.id} key={booking.id}>
              <div className="visit-time"><strong>{formatTime(booking.starts_at)}</strong><span>{formatTime(booking.ends_at)}</span></div>
              <div className="visit-details">
                <strong>{booking.patient_name}</strong>
                <span>{professionals.find(({ id }) => id === booking.professional_id)?.name ?? "Profissional"}</span>
                {!booking.is_block && <Link href={agendaUrl({ ...scope, history: booking.id }) + "#historico-consulta"}>Ver histórico</Link>}
                {outsideIds.has(booking.id) && <span className="tag warning-tag">Fora da grade atual</span>}
                {booking.patient_id && <Link href={patientsUrl({ clinic: clinic.id, patient: booking.patient_id })}>Ver ficha do paciente</Link>}
                {booking.inbox_thread_id && <Link href={inboxUrl({ clinic: clinic.id, thread: booking.inbox_thread_id })}>Ver atendimento</Link>}
              </div>
              <span className={booking.status === "cancelled" ? "tag" : "tag active"}>{booking.is_block ? bookingIsOpen(booking) ? "Bloqueado" : "Liberado" : statusLabels[booking.status]}</span>
              {bookingIsOpen(booking) && <div className="visit-actions">
                {!booking.is_block && <Link href={agendaUrl({ ...scope, block: undefined, professional: booking.professional_id, edit: booking.id }) + "#vagas"}>Remarcar</Link>}
                {!booking.is_block && (booking.status === "scheduled" || Date.parse(booking.starts_at) <= now) && <details>
                  <summary>Situação da consulta</summary>
                  <form action={changeBooking} className="visit-status">
                    {visitFields(booking)}
                    {booking.status === "scheduled" && Date.parse(booking.ends_at) > now &&
                      <button className="secondary" name="operation" value="confirmed">{statusActions.confirmed}</button>}
                    {Date.parse(booking.starts_at) <= now &&
                      <button className="secondary" name="operation" value="attended">{statusActions.attended}</button>}
                    {Date.parse(booking.ends_at) <= now &&
                      <button className="secondary" name="operation" value="absent">{statusActions.absent}</button>}
                  </form>
                </details>}
                <details>
                  <summary>{booking.is_block ? "Liberar horário" : "Cancelar"}</summary>
                  <form action={changeBooking}>
                    {visitFields(booking)}
                    <input type="hidden" name="operation" value={booking.is_block ? "unblock" : "cancel"} />
                    <button className="danger">{booking.is_block ? "Confirmar liberação" : "Confirmar cancelamento"}</button>
                  </form>
                </details>
              </div>}
            </article>)}
          </div>
          {history && <section id="historico-consulta" className="booking-card" aria-labelledby="history-title">
            <h2 id="history-title">Histórico da consulta</h2>
            <Link href={agendaUrl({ ...scope, history: undefined })}>Fechar histórico</Link>
            {audited && <p className="subtle">{audited.patient_name}</p>}
            {(historyBooking?.error || historyResult?.error) ? <p role="alert">Não foi possível carregar o histórico.</p>
              : !audited ? <p>Consulta indisponível.</p>
              : !events.length && <p className="empty">Nenhuma alteração registrada desde a ativação do histórico.</p>}
            {events.length === 50 && <p className="subtle">50 alterações mais recentes.</p>}
            {Boolean(events.length) && <ul className="inbox-list">
              {events.map((event) => <li key={event.id}>
                <p>{event.previous_status === null ? "Agendamento criado" : event.previous_status !== event.status
                  ? statusLabels[event.previous_status as Booking["status"]] + " → " + statusLabels[event.status as Booking["status"]]
                  : "Agendamento remarcado"}</p>
                {event.previous_start && (event.previous_start !== event.starts_at || event.previous_professional !== event.professional_id) &&
                  <p className="subtle">{historyDate.format(new Date(event.previous_start))} · {professionalName(event.previous_professional)}
                    {" → "}{historyDate.format(new Date(event.starts_at))} · {professionalName(event.professional_id)}</p>}
                <span className="subtle">{historyDate.format(new Date(event.occurred_at))} · {event.actor_id === user.id ? "Você" : event.actor_id ? "Recepção" : "Sistema"}</span>
              </li>)}
            </ul>}
            {undoable && <details>
              <summary>Corrigir comparecimento ou falta</summary>
              <form action={changeBooking} className="filters">
                {visitFields(audited)}
                <input type="hidden" name="operation" value="undoAttendance" />
                <button className="secondary">Desfazer registro de presença</button>
              </form>
            </details>}
          </section>}
        </section>
        <aside>
          <section className="card booking-card" id="vagas" aria-labelledby="booking-title">
            <h2 id="booking-title">{moving ? "Remarcar consulta" : blocking ? "Bloquear horário" : "Novo agendamento"}</h2>
            {!moving && !requestedThread && !requestedPatient && <Link href={agendaUrl({ ...scope, block: blocking ? undefined : "1" }) + "#vagas"}>
              {blocking ? "Voltar ao agendamento" : "Bloquear uma vaga"}
            </Link>}
            {selectedPatient && <p className="subtle">Paciente: {selectedPatient.name} ·{" "}
              <Link href={patientsUrl({ clinic: clinic.id, patient: selectedPatient.id, thread: scope.thread })}>Voltar à ficha</Link></p>}
            {!validPatient && <p className="notice" role="alert">Cadastro indisponível para agendamento.{" "}
              <Link href={patientsUrl({ clinic: clinic.id, thread: scope.thread })}>Escolher paciente</Link></p>}
            {origin && <p className="subtle">Atendimento: {origin.subject} ·{" "}
              <Link href={inboxUrl({ clinic: clinic.id, status: origin.status === "closed" ? "closed" : "open", thread: origin.id })}>
                Voltar ao atendimento
              </Link>
            </p>}
            {!validOrigin && <p className="notice" role="alert">
              Atendimento indisponível para agendamento.{" "}
              <Link href={agendaUrl({ ...scope, thread: undefined })}>Agendar sem vínculo</Link>
            </p>}
            {moving && <p className="subtle">{moving.patient_name} · <Link href={agendaUrl({ ...scope, edit: undefined })}>Sair da remarcação</Link></p>}
            <form method="get" className="filters" key={`filters-${agendaUrl(scope)}`}>
              <input type="hidden" name="agendaProfessional" value={agendaProfessional?.id ?? ""} />
              {agendaStatus && <input type="hidden" name="agendaStatus" value={agendaStatus} />}
              {patientQuery && <input type="hidden" name="patientQuery" value={patientQuery} />}
              {week && <input type="hidden" name="week" value="1" />}
              {scope.thread && <input type="hidden" name="thread" value={scope.thread} />}
              {scope.patientId && <input type="hidden" name="patientId" value={scope.patientId} />}
              <input type="hidden" name="clinic" value={clinic.id} />
              {moving && <input type="hidden" name="edit" value={moving.id} />}
              {blocking && <input type="hidden" name="block" value="1" />}
              <label>Data<input type="date" name="day" defaultValue={day} required /></label>
              <label>Profissional<select name="professional" defaultValue={professional?.id ?? ""} disabled={!professional}>
                {!professional && <option value="">Nenhum profissional cadastrado</option>}
                {professionals.map((person) => <option key={person.id} value={person.id}>{person.name}</option>)}
              </select></label>
              <button className="secondary">Consultar vagas</button>
            </form>
            {professional && validOrigin && validPatient && !slotResult?.error && <form action={changeBooking} className="booking-form" key={`booking-${agendaUrl(scope)}`}>
              <input type="hidden" name="clinic" value={clinic.id} />
              <input type="hidden" name="day" value={day} />
              <input type="hidden" name="professional" value={professional.id} />
              <input type="hidden" name="agendaProfessional" value={agendaProfessional?.id ?? ""} />
              {agendaStatus && <input type="hidden" name="agendaStatus" value={agendaStatus} />}
              {patientQuery && <input type="hidden" name="patientQuery" value={patientQuery} />}
              {week && <input type="hidden" name="week" value="1" />}
              {scope.thread && <input type="hidden" name="thread" value={scope.thread} />}
              {scope.patientId && <input type="hidden" name="patientId" value={scope.patientId} />}
              <input type="hidden" name="operation" value={moving ? "move" : blocking ? "block" : "book"} />
              {moving && <>
                <input type="hidden" name="appointment" value={moving.id} />
                <input type="hidden" name="revision" value={moving.revision} />
              </>}
              <p className="subtle">Vagas em {dayLabel} · {professional.name}</p>
              {dateHoursResult?.data && <p className="subtle">Exceção de horário para esta data.</p>}
              {hours && <p className="subtle">{hours.opens_at
                ? <>Horário de trabalho {hours.opens_at.slice(0, 5)} – {hours.closes_at?.slice(0, 5)}
                  {hours.break_from && <> · Pausa {hours.break_from.slice(0, 5)} – {hours.break_until?.slice(0, 5)}</>}
                </>
                : "Profissional sem atendimento nesta data."}</p>}
              {google.status === "checked" && <p className="subtle">
                {google.occupied.size
                  ? "Os horários ocupados no Google Agenda estão sinalizados para conferência."
                  : "O Google Agenda está livre nas vagas listadas."}
              </p>}
              {google.status === "unavailable" && <p className="subtle" role="status">
                Não foi possível verificar o Google Agenda. Confira a agenda externa antes de agendar.
              </p>}
              {slots.length > 0 ? <>
                <label>Horário<select name="start" defaultValue="" required>
                  <option value="" disabled>Selecione um horário</option>
                  {slots.map((slot) => <option key={slot.starts_at} value={slot.starts_at}>{formatTime(slot.starts_at)} – {formatTime(slot.ends_at)}
                    {google.status === "checked" && google.occupied.has(slot.starts_at) && " · Ocupado no Google"}
                  </option>)}
                </select></label>
                {!moving && !selectedPatient && <label>{blocking ? "Motivo do bloqueio (opcional)" : "Nome do paciente"}
                  <input name="patient" maxLength={120} required={!blocking} />
                </label>}
                <button>{moving ? "Salvar remarcação" : blocking ? "Confirmar bloqueio" : "Agendar consulta"}</button>
              </> : <p className="empty">Nenhuma vaga disponível para esta data.</p>}
            </form>}
          </section>
          {professional && validDay(shiftDay(day, 6)) && <div id="semana" className="week-section">
            {week
              ? <><WeeklyAvailability scope={scope} day={day} timezone={clinic.timezone} professionalName={professional.name}
                days={(weekResult?.data ?? []) as AvailabilityDay[]} failed={Boolean(weekResult?.error)} />
                <Link className="secondary button" href={agendaUrl({ ...scope, week: undefined }) + "#vagas"}>Ocultar visão semanal</Link></>
              : <Link className="secondary button" href={agendaUrl({ ...scope, week: "1" }) + "#semana"}>Ver vagas da semana</Link>}
          </div>}
          <Integrations googleStatus={google.status} whatsapp={whatsappConfigured(clinic.id)} />
        </aside>
      </div>
    </main>
  </>;
}
