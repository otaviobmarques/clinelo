import Link from "next/link";
import { changeBooking, login, logout } from "./actions";
import {
  agendaUrl, localDay, messages, shiftDay, statusLabels, validDay, validId,
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
  const success = ["booked", "moved", "cancelled"].includes(code);
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
  const edit = validId(query("edit")) ? query("edit") : "";
  const [staff, agenda, target] = await Promise.all([
    client.from("professionals").select("id,name").eq("clinic_id", clinic.id).order("name"),
    client.rpc("agenda_day", { p_clinic: clinic.id, p_day: day }),
    edit ? client.from("appointments").select("*").eq("clinic_id", clinic.id).eq("id", edit).maybeSingle() : null,
  ]);
  const professionals = (staff.data ?? []) as Professional[];
  const bookings = (agenda.data ?? []) as Booking[];
  const candidate = target?.data as Booking | undefined;
  const moving = candidate && ["scheduled", "confirmed"].includes(candidate.status) ? candidate : undefined;
  const professional = [query("professional"), moving?.professional_id]
    .map((id) => professionals.find((person) => person.id === id)).find(Boolean) ?? professionals[0];
  const slotResult = professional ? await client.rpc("agenda_slots", {
    p_clinic: clinic.id, p_professional: professional.id, p_day: day,
  }) : null;
  const slots = (slotResult?.data ?? []) as Slot[];
  const google = professional && (!requestedClinic || selectedClinic) ? await googleAvailability(
    clinic.id, professional.id, slots, {
      links: process.env.GOOGLE_CALENDAR_LINKS_JSON,
      account: process.env.GOOGLE_CALENDAR_SERVICE_ACCOUNT_JSON,
    },
  ) : { status: "disconnected" as const };
  const scope = { clinic: clinic.id, day, professional: professional?.id, edit: moving?.id };
  const dayLabel = new Intl.DateTimeFormat("pt-BR", {
    dateStyle: "full", timeZone: "UTC",
  }).format(new Date(day + "T12:00:00Z"));
  const time = new Intl.DateTimeFormat("pt-BR", {
    timeZone: clinic.timezone, hour: "2-digit", minute: "2-digit",
  });
  const formatTime = (value: string) => time.format(new Date(value));
  const counts = {
    active: bookings.filter(({ status }) => status === "scheduled" || status === "confirmed").length,
    cancelled: bookings.filter(({ status }) => status === "cancelled").length,
  };

  return <>
    <header className="topbar"><div className="topbar-inner">
      <Brand />
      <nav className="date-nav" aria-label="Recepção">
        <Link href={inboxUrl(clinic.id)} className="secondary button">Caixa compartilhada</Link>
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
            <div><h2 id="day-title">{dayLabel}</h2><p className="subtle">{counts.active} em aberto · {counts.cancelled} cancelados</p></div>
            <nav className="date-nav" aria-label="Navegar pela agenda">
              {validDay(shiftDay(day, -1)) && <Link className="secondary button" aria-label="Dia anterior" href={agendaUrl({ ...scope, day: shiftDay(day, -1) })}>‹</Link>}
              <Link className="secondary button" href={agendaUrl({ ...scope, day: today })}>Hoje</Link>
              {validDay(shiftDay(day, 1)) && <Link className="secondary button" aria-label="Próximo dia" href={agendaUrl({ ...scope, day: shiftDay(day, 1) })}>›</Link>}
            </nav>
          </div>
          <div className="visits">
            {!agenda.error && !bookings.length && <p className="empty">Nenhum agendamento para este dia.</p>}
            {bookings.map((booking) => <article className="visit" key={booking.id}>
              <div className="visit-time"><strong>{formatTime(booking.starts_at)}</strong><span>{formatTime(booking.ends_at)}</span></div>
              <div className="visit-details">
                <strong>{booking.patient_name}</strong>
                <span>{professionals.find(({ id }) => id === booking.professional_id)?.name ?? "Profissional"}</span>
              </div>
              <span className={booking.status === "cancelled" ? "tag" : "tag active"}>{statusLabels[booking.status]}</span>
              {["scheduled", "confirmed"].includes(booking.status) && <div className="visit-actions">
                <Link href={agendaUrl({ ...scope, professional: booking.professional_id, edit: booking.id }) + "#vagas"}>Remarcar</Link>
                <details>
                  <summary>Cancelar</summary>
                  <form action={changeBooking}>
                    <input type="hidden" name="clinic" value={clinic.id} />
                    <input type="hidden" name="day" value={day} />
                    <input type="hidden" name="professional" value={professional?.id ?? ""} />
                    <input type="hidden" name="operation" value="cancel" />
                    <input type="hidden" name="appointment" value={booking.id} />
                    <input type="hidden" name="revision" value={booking.revision} />
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
            {moving && <p className="subtle">{moving.patient_name} · <Link href={agendaUrl({ ...scope, edit: undefined })}>Sair da remarcação</Link></p>}
            <form method="get" className="filters" key={`filters-${agendaUrl(scope)}`}>
              <input type="hidden" name="clinic" value={clinic.id} />
              {moving && <input type="hidden" name="edit" value={moving.id} />}
              <label>Data<input type="date" name="day" defaultValue={day} required /></label>
              <label>Profissional<select name="professional" defaultValue={professional?.id ?? ""} disabled={!professional}>
                {!professional && <option value="">Nenhum profissional cadastrado</option>}
                {professionals.map((person) => <option key={person.id} value={person.id}>{person.name}</option>)}
              </select></label>
              <button className="secondary">Consultar vagas</button>
            </form>
            {professional && !slotResult?.error && <form action={changeBooking} className="booking-form" key={`booking-${agendaUrl(scope)}`}>
              <input type="hidden" name="clinic" value={clinic.id} />
              <input type="hidden" name="day" value={day} />
              <input type="hidden" name="professional" value={professional.id} />
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
          <Integrations googleStatus={google.status} whatsapp={whatsappConfigured(clinic.id)} />
        </aside>
      </div>
    </main>
  </>;
}
