import { Navigation } from "../navigation";
import { randomUUID } from "node:crypto";
import { receptionUrl } from "../../lib/reception";
import { QueueWait } from "./queue-wait";
import Link from "next/link";
import { redirect } from "next/navigation";
import { logout } from "../actions";
import { changeInbox } from "./actions";
import { agendaUrl, localDay, statusLabels, validId, type Booking, type Clinic } from "../../lib/agenda";
import { channelLabels, inboxAssignment, inboxChannel, inboxLabels, inboxSearch, inboxUrl, type InboxAssignment, type InboxChannel, type InboxStatus } from "../../lib/inbox";
import { whatsappPhones } from "../../lib/whatsapp";
import { replySettings } from "../../lib/whatsapp-reply";
import { replyOnWhatsapp } from "./whatsapp-actions";
import { linkPatientThread } from "../pacientes/actions";
import { patientsUrl } from "../../lib/patients";
import { supabase, supabaseSettings } from "../../lib/supabase";

export const dynamic = "force-dynamic";

type Thread = { id: string; subject: string; status: InboxStatus; updated_at: string; channel: InboxChannel; assignee_id: string | null; assignee_label: string | null; queued_at: string | null; patient_id: string | null; patient_link_revision: string };
type Note = { id: string; body: string; author_id: string | null; created_at: string; source: "internal" | "whatsapp" };
type Params = Record<string, string | string[] | undefined>;

const replyLabels = {
  sending: "Pendente de confirmação", accepted: "Aceita pela Meta",
  rejected: "Envio recusado", unknown: "Envio sem confirmação",
};

const messages = {
  replyAccepted: "Resposta aceita pela Meta.",
  replyRejected: "O envio da resposta foi recusado.",
  replyUnknown: "Envio sem confirmação. Confira o histórico antes de tentar novamente.",
  replyUnavailable: "Resposta indisponível. Confira o atendimento e a janela de 24 horas.",
  patientLinked: "Paciente vinculado ao atendimento.",
  patientUnlinked: "Paciente desvinculado do atendimento.",
  claim: "Você assumiu o atendimento.",
  release: "Atendimento devolvido à fila.",
  create: "Atendimento criado.",
  note: "Nota adicionada.",
  close: "Atendimento encerrado.",
  reopen: "Atendimento reaberto.",
  invalid: "Confira os dados informados.",
  changed: "O atendimento mudou. Confira o status antes de continuar.",
  access: "Você não tem acesso a esta clínica.",
  error: "Não foi possível concluir a operação. Tente novamente.",
};

function Fields({ clinic, thread, operation, status, channel, assignment, search }: {
  clinic: string; thread?: string; operation: string; status: InboxStatus; channel?: InboxChannel; assignment?: InboxAssignment; search: string;
}) {
  return <>
    <input type="hidden" name="clinic" value={clinic} />
    <input type="hidden" name="thread" value={thread ?? ""} />
    <input type="hidden" name="operation" value={operation} />
    <input type="hidden" name="status" value={status} />
    <input type="hidden" name="channel" value={channel ?? ""} />
    <input type="hidden" name="assignment" value={assignment ?? ""} />
    <input type="hidden" name="q" value={search} />
  </>;
}

export default async function Inbox({ searchParams }: { searchParams: Promise<Params> }) {
  if (!supabaseSettings()) redirect("/");
  const client = await supabase();
  const { data: { user } } = await client.auth.getUser();
  if (!user) redirect("/");

  const params = await searchParams;
  const query = (key: string) => typeof params[key] === "string" ? params[key] : "";
  const status = query("status") === "closed" ? "closed" : "open";
  const assignment = status === "open" ? inboxAssignment(query("assignment")) : undefined;
  const search = inboxSearch(query("q"));
  const channel = inboxChannel(query("channel"));
  const requestedClinic = query("clinic");
  const requestedThread = query("thread");
  const page = /^\d{1,5}$/.test(query("page")) ? Math.max(1, Number(query("page"))) : 1;
  const historyPage = /^\d{1,5}$/.test(query("historyPage")) ? Math.max(1, Number(query("historyPage"))) : 1;
  const historySize = 100;
  const historyStart = (historyPage - 1) * historySize;
  const pageSize = 25;
  const start = (page - 1) * pageSize;
  const clinicsResult = await client.from("clinics").select("id,name,timezone").order("name");
  const clinics = (clinicsResult.data ?? []) as Clinic[];
  const selected = clinics.find(({ id }) => id === requestedClinic);
  const clinic = selected ?? clinics[0];

  if (!clinic) return <main className="workspace">
    <h1>Caixa compartilhada</h1>
    <p>{clinicsResult.error ? "Caixa indisponível. Tente novamente." : "Nenhuma clínica vinculada."}</p>
    <Link href="/">Voltar à agenda</Link>
  </main>;

  const canSelectThread = (!requestedClinic || selected) && validId(requestedThread);
  const filters = { clinic: clinic.id, status, channel, assignment, query: search } as const;
  const queueSource = search
    ? client.rpc("inbox_search", { p_clinic: clinic.id, p_query: search })
    : client.from("inbox_threads");
  const queueQuery = queueSource.select("id,subject,status,updated_at,channel,assignee_id,assignee_label,queued_at,patient_id,patient_link_revision")
    .eq("clinic_id", clinic.id).eq("status", status);
  if (channel) queueQuery.eq("channel", channel);
  if (assignment === "mine") queueQuery.eq("assignee_id", user.id);
  if (assignment === "unassigned") queueQuery.is("assignee_id", null);
  if (status === "open" && assignment === "unassigned") {
    queueQuery.order("queued_at", { ascending: true, nullsFirst: false });
  }
  const [queue, details] = await Promise.all([
    queueQuery.order("updated_at", { ascending: false }).order("id").range(start, start + pageSize),
    canSelectThread ? client.from("inbox_threads").select("id,subject,status,updated_at,channel,assignee_id,assignee_label,queued_at,patient_id,patient_link_revision")
      .eq("clinic_id", clinic.id).eq("id", requestedThread).maybeSingle() : null,
  ]);
  const threads = (queue.data ?? []) as Thread[];
  const thread = details?.data as Thread | undefined;
  const phones = whatsappPhones(clinic.id);
  const repliesConfigured = phones.length > 0 && Boolean(replySettings(process.env));
  const [timeline, linkedBookings, patientResult, replies, availability] = thread ? await Promise.all([
    client.from("inbox_notes").select("id,body,author_id,created_at,source")
      .eq("clinic_id", clinic.id).eq("thread_id", thread.id).order("created_at", { ascending: false })
      .order("id", { ascending: false }).range(historyStart, historyStart + historySize),
    client.from("appointments").select("id,starts_at,status,professional_id").eq("clinic_id", clinic.id)
      .eq("inbox_thread_id", thread.id).order("starts_at", { ascending: false }).order("id"),
    thread.patient_id ? client.from("patients").select("id,name,archived").eq("clinic_id", clinic.id)
      .eq("id", thread.patient_id).maybeSingle() : null,
    thread.channel === "whatsapp" ? client.from("whatsapp_replies").select("id,body,status,created_at")
      .eq("clinic_id", clinic.id).eq("thread_id", thread.id)
      .order("created_at", { ascending: false }).order("id", { ascending: false })
      .range(historyStart, historyStart + historySize) : null,
    thread.channel === "whatsapp" && repliesConfigured
      ? client.rpc("whatsapp_reply_available", { p_clinic: clinic.id, p_thread: thread.id, p_phones: phones }) : null,
  ]) : [null, null, null, null, null];
  const linkedPatient = patientResult?.data;
  const notes = (timeline?.data ?? []) as Note[];
  const historyLink = (n: number) => inboxUrl({ ...filters, thread: thread?.id, page, historyPage: n });
  const format = new Intl.DateTimeFormat("pt-BR", {
    timeZone: clinic.timezone, dateStyle: "short", timeStyle: "short",
  });
  const notice = requestedClinic && !selected ? "access" : query("notice");
  const success = ["create", "note", "close", "reopen", "claim", "release", "patientLinked", "patientUnlinked", "replyAccepted"].includes(notice);

  return <>
    <Navigation clinic={clinic.id} /><header className="topbar"><div className="topbar-inner">
      <nav className="date-nav" aria-label="Recepção">
        <Link href={receptionUrl(clinic.id)} className="secondary button">Painel</Link>
        <Link href={agendaUrl({ clinic: clinic.id })} className="button secondary">Voltar à agenda</Link>
      </nav>
      <form action={logout}><button className="secondary">Sair</button></form>
    </div></header>
    <main className="workspace">
      <div className="heading">
        <div><h1>Caixa compartilhada</h1><p>{clinic.name}</p></div>
        <form className="clinic-picker" method="get">
          <label>Clínica<select name="clinic" defaultValue={clinic.id}>
            {clinics.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
          </select></label>
          <button className="secondary">Abrir</button>
        </form>
      </div>
      {Object.hasOwn(messages, notice) && <p className={success ? "notice success" : "notice"} role={success ? "status" : "alert"}>
        {messages[notice as keyof typeof messages]}
      </p>}
      {(queue.error || details?.error || timeline?.error || linkedBookings?.error || patientResult?.error || replies?.error || availability?.error) && <p className="notice" role="alert">
        Parte da caixa está indisponível. Atualize a página para tentar novamente.
      </p>}
      {canSelectThread && !details?.error && !thread && <p className="notice" role="alert">Atendimento indisponível.</p>}
      <div className="columns">
        <section className="card booking-card" aria-labelledby="queue-title">
          <h2 id="queue-title">Atendimentos</h2>
          <form method="get" role="search" className="inbox-search" key={search}>
            <input type="hidden" name="clinic" value={clinic.id} />
            <input type="hidden" name="status" value={status} />
            {channel && <input type="hidden" name="channel" value={channel} />}
            {assignment && <input type="hidden" name="assignment" value={assignment} />}
            <label>Buscar por assunto<input name="q" type="search" defaultValue={search} maxLength={120} /></label>
            <button className="secondary">Buscar</button>
            {search && <Link className="secondary button" href={inboxUrl({ ...filters, query: undefined })}>Limpar busca</Link>}
          </form>
          <nav className="inbox-nav" aria-label="Filtrar atendimentos">
            {(["open", "closed"] as const).map((filter) => <Link key={filter} href={inboxUrl({ ...filters, status: filter })}
              className="secondary button" aria-current={filter === status ? "page" : undefined}>{inboxLabels[filter]}</Link>)}
          </nav>
          <nav className="inbox-nav" aria-label="Filtrar por origem">
            {([undefined, "manual", "whatsapp"] as const).map((origin) => <Link
              key={origin ?? "all"} href={inboxUrl({ ...filters, channel: origin })}
              className="secondary button" aria-current={origin === channel ? "page" : undefined}>
              {origin ? channelLabels[origin] : "Todas as origens"}
            </Link>)}
          </nav>
          {status === "open" && <nav className="inbox-nav" aria-label="Filtrar por responsável">
            {([
              [undefined, "Toda a equipe"], ["mine", "Meus atendimentos"], ["unassigned", "Sem responsável"],
            ] as const).map(([value, label]) => <Link key={label}
              href={inboxUrl({ ...filters, assignment: value })}
              className="secondary button" aria-current={value === assignment ? "page" : undefined}>{label}</Link>)}
          </nav>}
          {!queue.error && threads.length === 0 && <p className="empty">{search ? "Nenhum atendimento encontrado." : "Nenhum atendimento neste filtro."}</p>}
          <ul className="inbox-list">
            {threads.slice(0, pageSize).map((item) => <li key={item.id}>
              <Link aria-current={thread?.id === item.id ? "page" : undefined}
                href={inboxUrl({ ...filters, thread: item.id, page })}>{item.subject}</Link>
              {" "}<span className="tag">{channelLabels[item.channel]}</span>
              {item.status === "open" && <span className="subtle"> · {item.assignee_id === user.id ? "Você" : item.assignee_label ?? "Sem responsável"} </span>}
              {item.queued_at && <QueueWait since={item.queued_at} timezone={clinic.timezone} />}
              <time className="subtle" dateTime={item.updated_at}>{format.format(new Date(item.updated_at))}</time>
            </li>)}
          </ul>
          {(page > 1 || threads.length > pageSize) && <nav className="inbox-nav" aria-label="Páginas de atendimentos">
            {page > 1 && <Link href={inboxUrl({ ...filters, page: page - 1 })}>Anterior</Link>}
            {threads.length > pageSize && <Link href={inboxUrl({ ...filters, page: page + 1 })}>Próxima</Link>}
          </nav>}
          {thread && <article className="inbox-thread">
            <h2>{thread.subject}</h2>
            <p className="subtle">{thread.status === "open" ? "Em aberto" : "Encerrado"} · {channelLabels[thread.channel]}</p>
            {thread.status === "open" && <div>
              <p>Responsável: {thread.assignee_id === user.id ? "Você" : thread.assignee_label ?? "Sem responsável"}</p>
              {(!thread.assignee_id || thread.assignee_id === user.id) && <form action={changeInbox}>
                <Fields clinic={clinic.id} thread={thread.id} status={status} channel={channel} assignment={assignment} search={search} operation={thread.assignee_id ? "release" : "claim"} />
                <button className="secondary">{thread.assignee_id ? "Devolver à fila" : "Assumir atendimento"}</button>
              </form>}
            </div>}
            <form action={changeInbox} className="filters">
              <Fields clinic={clinic.id} thread={thread.id} operation={thread.status === "open" ? "close" : "reopen"} status={thread.status} channel={channel} assignment={assignment} search={search} />
              <button className="secondary">{thread.status === "open" ? "Encerrar atendimento" : "Reabrir atendimento"}</button>
            </form>
            {thread.status === "open" && <form key={thread.id} action={changeInbox} className="filters">
              <Fields clinic={clinic.id} thread={thread.id} operation="note" status={thread.status} channel={channel} assignment={assignment} search={search} />
              <label>Nota interna<textarea name="text" maxLength={2000} required rows={4} /></label>
              <button>Adicionar nota</button>
            </form>}
            <h3>Paciente vinculado</h3>
            {linkedPatient ? <>
              <Link href={patientsUrl({ clinic: clinic.id, patient: linkedPatient.id,
                archived: linkedPatient.archived ? "1" : undefined })}>{linkedPatient.name}</Link>
              {linkedPatient.archived && <span className="tag">Arquivado</span>}
              <details>
                <summary>Remover vínculo do paciente</summary>
                <form action={linkPatientThread} className="filters">
                  <input type="hidden" name="clinic" value={clinic.id} />
                  <input type="hidden" name="thread" value={thread.id} />
                  <input type="hidden" name="patient" value={linkedPatient.id} />
                  <input type="hidden" name="revision" value={thread.patient_link_revision} />
                  <input type="hidden" name="status" value={thread.status} />
                  <button className="secondary" name="operation" value="unlink">Confirmar remoção do vínculo</button>
                </form>
              </details>
            </> : !thread.patient_id && <Link href={patientsUrl({ clinic: clinic.id, thread: thread.id, linkThread: "1" })}>
              Vincular paciente ao atendimento
            </Link>}
            <h3>Consultas vinculadas</h3>
            {thread.status === "open" && <Link className="secondary button"
              href={agendaUrl({ clinic: clinic.id, thread: thread.id }) + "#vagas"}>Agendar consulta para este atendimento</Link>}
            {thread.status === "open" && <p className="subtle">{linkedPatient && !linkedPatient.archived
              ? <Link href={agendaUrl({ clinic: clinic.id, thread: thread.id, patientId: linkedPatient.id }) + "#vagas"}>Agendar para o paciente vinculado</Link>
              : <Link href={patientsUrl({ clinic: clinic.id, thread: thread.id })}>Agendar com paciente cadastrado</Link>}
            </p>}
            {Boolean(linkedBookings?.data?.length) && <ul className="inbox-list">
              {linkedBookings?.data?.map((item) => <li key={item.id}>
                <Link href={agendaUrl({ clinic: clinic.id, day: localDay(clinic.timezone, new Date(item.starts_at)),
                  agendaProfessional: item.professional_id }) + "#consulta-" + item.id}>
                  {format.format(new Date(item.starts_at))}
                </Link>{" "}· {statusLabels[item.status as Booking["status"]]}
              </li>)}
            </ul>}
            {thread.channel === "whatsapp" && <>
              <h3>Respostas pelo WhatsApp</h3>
              {availability?.data === true ? <form action={replyOnWhatsapp.bind(null, randomUUID())} className="filters">
                <Fields clinic={clinic.id} thread={thread.id} operation="reply" status={status} channel={channel} assignment={assignment} search={search} />
                <label>Mensagem para o contato<textarea name="reply" maxLength={4096} required /></label>
                <button>Enviar pelo WhatsApp</button>
              </form> : <p className="subtle">{repliesConfigured
                ? "O envio exige um atendimento aberto e uma mensagem do contato nas últimas 24 horas."
                : "Respostas pelo WhatsApp desconectadas."}</p>}
              <ul className="inbox-list">
                {replies?.data?.slice(0, historySize).map((reply) => <li key={reply.id}>
                  <p className="inbox-note">{reply.body}</p>
                  <span className="subtle">{replyLabels[reply.status as keyof typeof replyLabels]} ·{" "}
                    <time dateTime={reply.created_at}>{format.format(new Date(reply.created_at))}</time></span>
                </li>)}
              </ul>
            </>}
            <h3>Histórico</h3>
            {!timeline?.error && !notes.length && <p className="empty">{historyPage === 1 ? "Nenhum registro neste atendimento." : "Nenhum registro nesta página."}</p>}
            <ul className="inbox-list">
              {notes.slice(0, historySize).map((note) => <li key={note.id}>
                <p className="inbox-note">{note.body}</p>
                <span className="subtle">{note.source === "whatsapp" ? "WhatsApp" : note.author_id === user.id ? "Você" : "Recepção"} ·{" "}
                  <time dateTime={note.created_at}>{format.format(new Date(note.created_at))}</time></span>
              </li>)}
            </ul>
            {!timeline?.error && (historyPage > 1 || notes.length > historySize || (replies?.data?.length ?? 0) > historySize) && <nav className="inbox-nav" aria-label="Páginas do histórico">
              {historyPage > 1 && <Link href={historyLink(historyPage - 1)}>Mais recentes</Link>}
              {(notes.length > historySize || (replies?.data?.length ?? 0) > historySize) && <Link href={historyLink(historyPage + 1)}>Mais antigos</Link>}
            </nav>}
          </article>}
        </section>
        <aside className="card booking-card">
          <h2>Novo atendimento</h2>
          <form action={changeInbox} className="filters">
            <Fields clinic={clinic.id} operation="create" status={status} channel={channel} assignment={assignment} search={search} />
            <label>Assunto<input name="text" maxLength={120} required /></label>
            <button>Criar atendimento</button>
          </form>
          <p className="subtle">As notas são visíveis para a equipe desta clínica. {repliesConfigured
            ? "WhatsApp Business oficial configurado para receber e responder."
            : phones.length ? "WhatsApp Business oficial configurado para recebimento." : "WhatsApp Business oficial desconectado."}</p>
        </aside>
      </div>
    </main>
  </>;
}
