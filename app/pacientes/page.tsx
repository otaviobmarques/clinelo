import Link from "next/link";
import { redirect } from "next/navigation";
import { logout } from "../actions";
import { savePatient } from "./actions";
import { agendaPatientQuery, agendaUrl, localDay, statusLabels, validId, type Booking, type Clinic } from "../../lib/agenda";
import { inboxUrl } from "../../lib/inbox";
import { patientsUrl, type Patient } from "../../lib/patients";
import { supabase, supabaseSettings } from "../../lib/supabase";

export const dynamic = "force-dynamic";

const messages = {
  create: "Paciente cadastrado.",
  update: "Cadastro atualizado.",
  archive: "Cadastro arquivado.",
  restore: "Cadastro reativado.",
  invalid: "Confira o nome e os dados de contato informados.",
  forbidden: "Você não tem acesso a esta clínica.",
  changed: "O cadastro foi alterado. Confira os dados antes de continuar.",
  error: "Não foi possível concluir a operação.",
};

const patientFields = "id,name,phone,email,archived,revision";

function readPage(value: string) {
  return /^\d{1,5}$/.test(value) ? Math.max(1, Number(value)) : 1;
}

function Fields({ clinic, patient, thread, q, archived }: {
  clinic: string; patient?: Patient; thread?: string; q: string; archived?: string;
}) {
  return <>
    <input type="hidden" name="clinic" value={clinic} />
    <input type="hidden" name="patient" value={patient?.id ?? ""} />
    <input type="hidden" name="revision" value={patient?.revision ?? ""} />
    <input type="hidden" name="thread" value={thread ?? ""} />
    <input type="hidden" name="q" value={q} />
    <input type="hidden" name="archived" value={archived ?? ""} />
  </>;
}

function ContactFields({ patient }: { patient?: Patient }) {
  return <>
    <label>Nome completo<input name="name" defaultValue={patient?.name} required maxLength={120} /></label>
    <label>Telefone (opcional)<input type="tel" name="phone" defaultValue={patient?.phone ?? ""} maxLength={30} /></label>
    <label>E-mail (opcional)<input type="email" name="email" defaultValue={patient?.email ?? ""} maxLength={254} /></label>
  </>;
}

export default async function PatientsPage({ searchParams }: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  if (!supabaseSettings()) redirect("/");
  const client = await supabase();
  const { data: { user } } = await client.auth.getUser();
  if (!user) redirect("/");

  const params = await searchParams;
  const query = (name: string) => typeof params[name] === "string" ? params[name] : "";
  const requestedClinic = query("clinic");
  const requestedPatient = query("patient");
  const requestedThread = query("thread");
  const q = agendaPatientQuery(query("q"));
  const archived = query("archived") === "1" ? "1" : undefined;
  const page = readPage(query("page"));
  const historyPage = readPage(query("historyPage"));
  const clinicsResult = await client.from("clinics").select("id,name,timezone").order("name");
  const clinics = (clinicsResult.data ?? []) as Clinic[];
  const clinic = requestedClinic ? clinics.find(({ id }) => id === requestedClinic) : clinics[0];

  if (!clinic) return <main className="workspace">
    <h1>Pacientes</h1>
    <p role="alert">{clinicsResult.error ? "Não foi possível carregar as clínicas."
      : requestedClinic ? "Você não tem acesso a esta clínica." : "Nenhuma clínica vinculada."}</p>
    <Link href="/">Voltar à agenda</Link>
  </main>;

  const source = q ? client.rpc("patient_search", { p_clinic: clinic.id, p_query: q }) : client.from("patients");
  const [listResult, profileResult, threadResult] = await Promise.all([
    source.select(patientFields).eq("clinic_id", clinic.id).eq("archived", Boolean(archived))
      .order("name").order("id").range((page - 1) * 25, page * 25),
    validId(requestedPatient) ? client.from("patients").select(patientFields)
      .eq("clinic_id", clinic.id).eq("id", requestedPatient).maybeSingle() : null,
    validId(requestedThread) ? client.from("inbox_threads").select("id,subject,status")
      .eq("clinic_id", clinic.id).eq("id", requestedThread).maybeSingle() : null,
  ]);
  const patients = Array.isArray(listResult.data) ? listResult.data as Patient[] : [];
  const patient = profileResult?.data as Patient | undefined;
  const thread = validId(requestedThread) ? requestedThread : undefined;
  const treatment = threadResult?.data;
  const scoped = { clinic: clinic.id, q, archived, thread };
  const notice = query("notice");
  const ok = ["create", "update", "archive", "restore"].includes(notice);
  const [history, staff] = patient ? await Promise.all([
    client.from("appointments").select("id,professional_id,starts_at,status").eq("clinic_id", clinic.id)
      .eq("patient_id", patient.id).order("starts_at", { ascending: false }).order("id")
      .range((historyPage - 1) * 20, historyPage * 20),
    client.from("professionals").select("id,name").eq("clinic_id", clinic.id),
  ]) : [null, null];
  const visits = (history?.data ?? []) as Pick<Booking, "id" | "professional_id" | "starts_at" | "status">[];
  const professionalNames = new Map(staff?.data?.map(({ id, name }) => [id, name]) ?? []);
  const timestamp = new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short", timeZone: clinic.timezone });

  return <>
    <header className="topbar"><div className="topbar-inner">
      <Link className="secondary button" href={agendaUrl({ clinic: clinic.id })}>Voltar à agenda</Link>
      <form action={logout}><button className="secondary">Sair</button></form>
    </div></header>
    <main className="workspace">
      <div className="heading"><div><h1>Pacientes</h1><p>{clinic.name}</p></div>
        {clinics.length > 1 && <form method="get" className="clinic-picker">
          <label>Clínica<select name="clinic" defaultValue={clinic.id}>
            {clinics.map((item) => <option value={item.id} key={item.id}>{item.name}</option>)}
          </select></label>
          <button className="secondary">Abrir</button>
        </form>}
      </div>
      {requestedThread && treatment?.status !== "open" && <p className="notice" role="alert">
        Atendimento indisponível para agendamento. <Link href={patientsUrl({ ...scoped, thread: undefined })}>Abrir cadastro geral</Link>
      </p>}
      {treatment?.status === "open" && <p className="notice success">Atendimento: {treatment.subject} ·{" "}
        <Link href={inboxUrl({ clinic: clinic.id, thread: treatment.id })}>Voltar à conversa</Link></p>}
      {Object.hasOwn(messages, notice) && <p className={ok ? "notice success" : "notice"} role={ok ? "status" : "alert"}>
        {messages[notice as keyof typeof messages]}
      </p>}
      {(listResult.error || profileResult?.error) && <p className="notice" role="alert">Não foi possível carregar parte dos cadastros.</p>}
      {requestedPatient && !patient && !profileResult?.error && <p className="notice" role="alert">Cadastro indisponível.</p>}
      <div className="columns">
        <section className="card booking-card" aria-labelledby="patients-list">
          <h2 id="patients-list">Cadastros da clínica</h2>
          <form method="get" role="search" className="inbox-search" key={q}>
            <input type="hidden" name="clinic" value={clinic.id} />
            {thread && <input type="hidden" name="thread" value={thread} />}
            {archived && <input type="hidden" name="archived" value={archived} />}
            <label>Buscar por nome<input type="search" name="q" defaultValue={q} maxLength={120} /></label>
            <button className="secondary">Buscar</button>
            {q && <Link className="secondary button" href={patientsUrl({ ...scoped, q: undefined })}>Limpar busca</Link>}
          </form>
          <nav className="inbox-nav" aria-label="Filtrar cadastros">
            <Link className="secondary button" aria-current={!archived ? "page" : undefined}
              href={patientsUrl({ ...scoped, archived: undefined })}>Ativos</Link>
            <Link className="secondary button" aria-current={archived ? "page" : undefined}
              href={patientsUrl({ ...scoped, archived: "1" })}>Arquivados</Link>
          </nav>
          {!listResult.error && !patients.length && <p className="empty">Nenhum paciente encontrado.</p>}
          <ul className="inbox-list">
            {patients.slice(0, 25).map((item) => <li key={item.id}>
              <Link aria-current={item.id === patient?.id ? "page" : undefined}
                href={patientsUrl({ ...scoped, patient: item.id, page })}>{item.name}</Link>
              {item.phone && <p className="subtle">{item.phone}</p>}
            </li>)}
          </ul>
          {(page > 1 || patients.length > 25) && <nav className="inbox-nav" aria-label="Páginas de pacientes">
            {page > 1 && <Link href={patientsUrl({ ...scoped, page: page - 1 })}>Anterior</Link>}
            {patients.length > 25 && <Link href={patientsUrl({ ...scoped, page: page + 1 })}>Próxima</Link>}
          </nav>}
          {patient && <section className="inbox-thread" aria-labelledby="patient-history">
            <h2 id="patient-history">Consultas de {patient.name}</h2>
            {!patient.archived && (!requestedThread || treatment?.status === "open") && <Link className="secondary button"
              href={agendaUrl({ clinic: clinic.id, patientId: patient.id, thread: treatment?.id }) + "#vagas"}>Agendar para este paciente</Link>}
            {history?.error || staff?.error ? <p role="alert">Não foi possível carregar as consultas.</p>
              : !visits.length ? <p className="empty">Nenhuma consulta vinculada nesta página.</p>
              : <ul className="inbox-list">{visits.slice(0, 20).map((item) => {
                const start = new Date(item.starts_at);
                return <li key={item.id}>
                  <Link href={agendaUrl({ clinic: clinic.id, day: localDay(clinic.timezone, start),
                    agendaProfessional: item.professional_id, professional: item.professional_id }) + "#consulta-" + item.id}>
                    {timestamp.format(start)}
                  </Link>
                  <p className="subtle">{professionalNames.get(item.professional_id) ?? "Profissional"} · {statusLabels[item.status]}</p>
                </li>;
              })}</ul>}
            {(historyPage > 1 || visits.length > 20) && <nav className="inbox-nav" aria-label="Páginas das consultas">
              {historyPage > 1 && <Link href={patientsUrl({ ...scoped, patient: patient.id, page, historyPage: historyPage - 1 })}>Mais recentes</Link>}
              {visits.length > 20 && <Link href={patientsUrl({ ...scoped, patient: patient.id, page, historyPage: historyPage + 1 })}>Mais antigas</Link>}
            </nav>}
          </section>}
        </section>
        <aside className="card booking-card">
          <h2>{patient ? "Ficha do paciente" : "Novo paciente"}</h2>
          {patient && <p className="subtle">{patient.name} · {patient.archived ? "Arquivado" : "Ativo"} ·{" "}
            <Link href={patientsUrl(scoped)}>Novo cadastro</Link></p>}
          {!patient?.archived && <form className="filters" action={savePatient} key={patient?.revision ?? "create"}>
            <Fields {...scoped} patient={patient} />
            <ContactFields patient={patient} />
            <button name="operation" value={patient ? "update" : "create"}>{patient ? "Salvar cadastro" : "Cadastrar paciente"}</button>
          </form>}
          {patient && <form className="filters" action={savePatient}>
            <Fields {...scoped} patient={patient} />
            {patient.archived && <p className="subtle">{[patient.phone, patient.email].filter(Boolean).join(" · ")}</p>}
            <button className="secondary" name="operation" value={patient.archived ? "restore" : "archive"}>
              {patient.archived ? "Reativar cadastro" : "Arquivar cadastro"}
            </button>
          </form>}
        </aside>
      </div>
    </main>
  </>;
}
