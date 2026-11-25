import Link from "next/link";
import { WeeklyAvailability, type AvailabilityDay } from "./weekly-availability";
import { changeBooking, login, logout } from "./actions";
import {
  agendaStatusFilter, agendaStatusFilters, agendaUrl, bookingIsOpen, localDay, messages, shiftDay, statusActions, statusLabels, validDay, validId,
  type Booking, type Clinic, type Professional, type Slot,
} from "../lib/agenda";
import { whatsappConfigured } from "../lib/whatsapp";
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
  const success = ["booked", "moved", "cancelled"].includes(code) || Object.hasOwn(statusActions, code);
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
  const requestedThread = !edit ? query("thread") : "";
  const [staff, target, originResult] = await Promise.all([
    client.from("professionals").select("id,name").eq("clinic_id", clinic.id).order("name"),
    edit ? client.from("appointments").select("*").eq("clinic_id", clinic.id).eq("id", edit).maybeSingle() : null,
    validId(requestedThread) && (!requestedClinic || selectedClinic)
      ? client.from("inbox_threads").select("id,subject,status").eq("clinic_id", clinic.id)
        .eq("id", requestedThread).maybeSingle() : null,
  ]);
  const origin = originResult?.data;
  const validOrigin = !requestedThread || origin?.status === "open";
  const professionals = (staff.data ?? []) as Professional[];
  const agendaProfessional = professionals.find(({ id }) => id === query("agendaProfessional"));
  const dayQuery = client.rpc("agenda_day", { p_clinic: clinic.id, p_day: day });
  if (agendaProfessional) dayQuery.eq("professional_id", agendaProfessional.id);
  const candidate = target?.data as Booking | undefined;
  const moving = candidate && ["scheduled", "confirmed"].includes(candidate.status) ? candidate : undefined;
  const professional = [query("professional"), moving?.professional_id]
    .map((id) => professionals.find((person) => person.id === id)).find(Boolean) ?? professionals[0];
  const [agenda, slotResult, weekResult] = await Promise.all([
    dayQuery,
    professional ? client.rpc("agenda_slots", {
      p_clinic: clinic.id, p_professional: professional.id, p_day: day,
    }) : null,
    week && professional ? client.rpc("agenda_week", {
      p_clinic: clinic.id, p_professional: professional.id, p_from: day,
    }) : null,
  ]);
  const bookings = (agenda.data ?? []) as Booking[];
  const agendaStatus = agendaStatusFilter(query("agendaStatus"));
  const visibleBookings = agendaStatus === "open"
    ? bookings.filter(bookingIsOpen)
    : agendaStatus ? bookings.filter(({ status }) => status === agendaStatus) : bookings;
  const slots = (slotResult?.data ?? []) as Slot[];
  const google = professional && (!requestedClinic || selectedClinic) ? await googleAvailability(
    clinic.id, professional.id, slots, {
      links: process.env.GOOGLE_CALENDAR_LINKS_JSON,
      account: process.env.GOOGLE_CALENDAR_SERVICE_ACCOUNT_JSON,
    },
  ) : { status: "disconnected" as const };
  const scope = { clinic: clinic.id, day, professional: professional?.id, agendaProfessional: agendaProfessional?.id, agendaStatus, week: week ? "1" : undefined, thread: validId(requestedThread) ? requestedThread : undefined, edit: moving?.id };
  const dayLabel = new Intl.DateTimeFormat("pt-BR", {
    dateStyle: "full", timeZone: "UTC",
  }).format(new Date(day + "T12:00:00Z"));
  const time = new Intl.DateTimeFormat("pt-BR", {
    timeZone: clinic.timezone, hour: "2-digit", minute: "2-digit",
  });
  const formatTime = (value: string) => time.format(new Date(value));
  const counts = {
    active: bookings.filter(bookingIsOpen).length,
    cancelled: bookings.filter(({ status }) => status === "cancelled").length,
    attended: bookings.filter(({ status }) => status === "attended").length,
    absent: bookings.filter(({ status }) => status === "absent").length,
  };

  const now = Date.now();
  const visitFields = (booking: Booking) => <>
    <input type="hidden" name="clinic" value={clinic.id} />
    <input type="hidden" name="day" value={day} />
    <input type="hidden" name="professional" value={professional?.id ?? ""} />
    <input type="hidden" name="agendaProfessional" value={agendaProfessional?.id ?? ""} />
    {agendaStatus && <input type="hidden" name="agendaStatus" value={agendaStatus} />}
    {week && <input type="hidden" name="week" value="1" />}
    {scope.thread && <input type="hidden" name="thread" value={scope.thread} />}
    <input type="hidden" name="appointment" value={booking.id} />
    <input type="hidden" name="revision" value={booking.revision} />
  </>;

  return <>
    <header className="topbar"><div className="topbar-inner">
      <Brand />
      <nav className="date-nav" aria-label="Recepção">
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
      {(staff.error || agenda.error || target?.error || slotResult?.error) &&
        <p className="notice" role="alert">Parte da agenda está indisponível. Atualize a página para tentar novamente.</p>}
      {edit && !moving && !target?.error &&
        <p className="notice" role="alert">Este agendamento está indisponível para remarcação.</p>}
      <div className="columns">
        <section className="card agenda" aria-labelledby="day-title">
          <div className="agenda-head">
            <div><h2 id="day-title">{dayLabel}</h2><p className="subtle">{counts.active} em aberto · {counts.cancelled} cancelados</p>
              <p className="subtle">{counts.attended} {counts.attended === 1 ? "atendido" : "atendidos"} · {counts.absent} {counts.absent === 1 ? "falta" : "faltas"}</p></div>
            <nav className="date-nav" aria-label="Navegar pela agenda">
              {validDay(shiftDay(day, -1)) && <Link className="secondary button" aria-label="Dia anterior" href={agendaUrl({ ...scope, day: shiftDay(day, -1) })}>‹</Link>}
              <Link className="secondary button" href={agendaUrl({ ...scope, day: today })}>Hoje</Link>
              {validDay(shiftDay(day, 1)) && <Link className="secondary button" aria-label="Próximo dia" href={agendaUrl({ ...scope, day: shiftDay(day, 1) })}>›</Link>}
            </nav>
          </div>
          <form method="get" className="agenda-list-filter"
            key={`agenda-list-${agendaProfessional?.id ?? "all"}-${agendaStatus ?? "all"}`}>
            <input type="hidden" name="clinic" value={clinic.id} />
            <input type="hidden" name="day" value={day} />
            {week && <input type="hidden" name="week" value="1" />}
            {scope.thread && <input type="hidden" name="thread" value={scope.thread} />}
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
            <button className="secondary">Filtrar agenda</button>
          </form>
          <div className="visits">
            {!agenda.error && !visibleBookings.length && <p className="empty">{agendaStatus ? "Nenhum agendamento corresponde aos filtros." : agendaProfessional ? "Nenhum agendamento para este profissional no dia." : "Nenhum agendamento para este dia."}</p>}
            {visibleBookings.map((booking) => <article className="visit" id={"consulta-" + booking.id} key={booking.id}>
              <div className="visit-time"><strong>{formatTime(booking.starts_at)}</strong><span>{formatTime(booking.ends_at)}</span></div>
              <div className="visit-details">
                <strong>{booking.patient_name}</strong>
                <span>{professionals.find(({ id }) => id === booking.professional_id)?.name ?? "Profissional"}</span>
                {booking.inbox_thread_id && <Link href={inboxUrl({ clinic: clinic.id, thread: booking.inbox_thread_id })}>Ver atendimento</Link>}
              </div>
              <span className={booking.status === "cancelled" ? "tag" : "tag active"}>{statusLabels[booking.status]}</span>
              {bookingIsOpen(booking) && <div className="visit-actions">
                <Link href={agendaUrl({ ...scope, professional: booking.professional_id, edit: booking.id }) + "#vagas"}>Remarcar</Link>
                {(booking.status === "scheduled" || Date.parse(booking.starts_at) <= now) && <details>
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
                  <summary>Cancelar</summary>
                  <form action={changeBooking}>
                    {visitFields(booking)}
                    <input type="hidden" name="operation" value="cancel" />
                    <button className="danger">Confirmar cancelamento</button>
                  </form>
                </details>
              </div>}
            </article>)}
          </div>
        </section>
        <aside>
          <section className="card booking-card" id="vagas" aria-labelledby="booking-title">
            <h2 id="booking-title">{moving ? "Remarcar consulta" : "Novo agendamento"}</h2>
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
              {week && <input type="hidden" name="week" value="1" />}
              {scope.thread && <input type="hidden" name="thread" value={scope.thread} />}
              <input type="hidden" name="clinic" value={clinic.id} />
              {moving && <input type="hidden" name="edit" value={moving.id} />}
              <label>Data<input type="date" name="day" defaultValue={day} required /></label>
              <label>Profissional<select name="professional" defaultValue={professional?.id ?? ""} disabled={!professional}>
                {!professional && <option value="">Nenhum profissional cadastrado</option>}
                {professionals.map((person) => <option key={person.id} value={person.id}>{person.name}</option>)}
              </select></label>
              <button className="secondary">Consultar vagas</button>
            </form>
            {professional && validOrigin && !slotResult?.error && <form action={changeBooking} className="booking-form" key={`booking-${agendaUrl(scope)}`}>
              <input type="hidden" name="clinic" value={clinic.id} />
              <input type="hidden" name="day" value={day} />
              <input type="hidden" name="professional" value={professional.id} />
              <input type="hidden" name="agendaProfessional" value={agendaProfessional?.id ?? ""} />
              {agendaStatus && <input type="hidden" name="agendaStatus" value={agendaStatus} />}
              {week && <input type="hidden" name="week" value="1" />}
              {scope.thread && <input type="hidden" name="thread" value={scope.thread} />}
              <input type="hidden" name="operation" value={moving ? "move" : "book"} />
              {moving && <>
                <input type="hidden" name="appointment" value={moving.id} />
                <input type="hidden" name="revision" value={moving.revision} />
              </>}
              <p className="subtle">Vagas em {dayLabel} · {professional.name}</p>
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
                {!moving && <label>Nome do paciente<input name="patient" maxLength={120} required /></label>}
                <button>{moving ? "Salvar remarcação" : "Agendar consulta"}</button>
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
