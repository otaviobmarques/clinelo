import Link from "next/link";
import { redirect } from "next/navigation";
import { logout } from "../actions";
import { changeInbox } from "./actions";
import { agendaUrl, validId, type Clinic } from "../../lib/agenda";
import { channelLabels, inboxChannel, inboxLabels, inboxUrl, type InboxChannel, type InboxStatus } from "../../lib/inbox";
import { whatsappConfigured } from "../../lib/whatsapp";
import { supabase, supabaseSettings } from "../../lib/supabase";

export const dynamic = "force-dynamic";

type Thread = { id: string; subject: string; status: InboxStatus; updated_at: string; channel: InboxChannel; assignee_id: string | null; assignee_label: string | null };
type Note = { id: string; body: string; author_id: string | null; created_at: string; source: "internal" | "whatsapp" };
type Params = Record<string, string | string[] | undefined>;

const messages = {
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

function Fields({ clinic, thread, operation, status, channel }: {
  clinic: string; thread?: string; operation: string; status: InboxStatus; channel?: InboxChannel;
}) {
  return <>
    <input type="hidden" name="clinic" value={clinic} />
    <input type="hidden" name="thread" value={thread ?? ""} />
    <input type="hidden" name="operation" value={operation} />
    <input type="hidden" name="status" value={status} />
    <input type="hidden" name="channel" value={channel ?? ""} />
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
  const queueQuery = client.from("inbox_threads").select("id,subject,status,updated_at,channel,assignee_id,assignee_label")
    .eq("clinic_id", clinic.id).eq("status", status);
  if (channel) queueQuery.eq("channel", channel);
  const [queue, details] = await Promise.all([
    queueQuery.order("updated_at", { ascending: false }).order("id").range(start, start + pageSize),
    canSelectThread ? client.from("inbox_threads").select("id,subject,status,updated_at,channel,assignee_id,assignee_label")
      .eq("clinic_id", clinic.id).eq("id", requestedThread).maybeSingle() : null,
  ]);
  const threads = (queue.data ?? []) as Thread[];
  const thread = details?.data as Thread | undefined;
  const timeline = thread ? await client.from("inbox_notes").select("id,body,author_id,created_at,source")
    .eq("clinic_id", clinic.id).eq("thread_id", thread.id).order("created_at", { ascending: false })
    .order("id", { ascending: false }).range(historyStart, historyStart + historySize) : null;
  const notes = (timeline?.data ?? []) as Note[];
  const historyLink = (n: number) => inboxUrl(clinic.id, status, thread?.id, undefined, page, channel) + "&historyPage=" + n;
  const format = new Intl.DateTimeFormat("pt-BR", {
    timeZone: clinic.timezone, dateStyle: "short", timeStyle: "short",
  });
  const notice = requestedClinic && !selected ? "access" : query("notice");
  const success = ["create", "note", "close", "reopen", "claim", "release"].includes(notice);

  return <>
    <header className="topbar"><div className="topbar-inner">
      <Link href={agendaUrl({ clinic: clinic.id })} className="button secondary">Voltar à agenda</Link>
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
      {(queue.error || details?.error || timeline?.error) && <p className="notice" role="alert">
        Parte da caixa está indisponível. Atualize a página para tentar novamente.
      </p>}
      {canSelectThread && !details?.error && !thread && <p className="notice" role="alert">Atendimento indisponível.</p>}
      <div className="columns">
        <section className="card booking-card" aria-labelledby="queue-title">
          <h2 id="queue-title">Atendimentos</h2>
          <nav className="inbox-nav" aria-label="Filtrar atendimentos">
            {(["open", "closed"] as const).map((filter) => <Link key={filter} href={inboxUrl(clinic.id, filter, undefined, undefined, 1, channel)}
              className="secondary button" aria-current={filter === status ? "page" : undefined}>{inboxLabels[filter]}</Link>)}
          </nav>
          <nav className="inbox-nav" aria-label="Filtrar por origem">
            {([undefined, "manual", "whatsapp"] as const).map((origin) => <Link
              key={origin ?? "all"} href={inboxUrl(clinic.id, status, undefined, undefined, 1, origin)}
              className="secondary button" aria-current={origin === channel ? "page" : undefined}>
              {origin ? channelLabels[origin] : "Todas as origens"}
            </Link>)}
          </nav>
          {!queue.error && threads.length === 0 && <p className="empty">Nenhum atendimento neste filtro.</p>}
          <ul className="inbox-list">
            {threads.slice(0, pageSize).map((item) => <li key={item.id}>
              <Link aria-current={thread?.id === item.id ? "page" : undefined}
                href={inboxUrl(clinic.id, status, item.id, undefined, page, channel)}>{item.subject}</Link>
              {" "}<span className="tag">{channelLabels[item.channel]}</span>
              {item.status === "open" && <span className="subtle"> · {item.assignee_label ?? "Sem responsável"} </span>}
              <time className="subtle" dateTime={item.updated_at}>{format.format(new Date(item.updated_at))}</time>
            </li>)}
          </ul>
          {(page > 1 || threads.length > pageSize) && <nav className="inbox-nav" aria-label="Páginas de atendimentos">
            {page > 1 && <Link href={inboxUrl(clinic.id, status, undefined, undefined, page - 1, channel)}>Anterior</Link>}
            {threads.length > pageSize && <Link href={inboxUrl(clinic.id, status, undefined, undefined, page + 1, channel)}>Próxima</Link>}
          </nav>}
          {thread && <article className="inbox-thread">
            <h2>{thread.subject}</h2>
            <p className="subtle">{thread.status === "open" ? "Em aberto" : "Encerrado"} · {channelLabels[thread.channel]}</p>
            {thread.status === "open" && <div>
              <p>Responsável: {thread.assignee_label ?? "Sem responsável"}</p>
              {(!thread.assignee_id || thread.assignee_id === user.id) && <form action={changeInbox}>
                <Fields clinic={clinic.id} thread={thread.id} status={status} channel={channel} operation={thread.assignee_id ? "release" : "claim"} />
                <button className="secondary">{thread.assignee_id ? "Devolver à fila" : "Assumir atendimento"}</button>
              </form>}
            </div>}
            <form action={changeInbox} className="filters">
              <Fields clinic={clinic.id} thread={thread.id} operation={thread.status === "open" ? "close" : "reopen"} status={thread.status} channel={channel} />
              <button className="secondary">{thread.status === "open" ? "Encerrar atendimento" : "Reabrir atendimento"}</button>
            </form>
            {thread.status === "open" && <form key={thread.id} action={changeInbox} className="filters">
              <Fields clinic={clinic.id} thread={thread.id} operation="note" status={thread.status} channel={channel} />
              <label>Nota interna<textarea name="text" maxLength={2000} required rows={4} /></label>
              <button>Adicionar nota</button>
            </form>}
            <h3>Histórico</h3>
            {!timeline?.error && !notes.length && <p className="empty">{historyPage === 1 ? "Nenhum registro neste atendimento." : "Nenhum registro nesta página."}</p>}
            <ul className="inbox-list">
              {notes.slice(0, historySize).map((note) => <li key={note.id}>
                <p className="inbox-note">{note.body}</p>
                <span className="subtle">{note.source === "whatsapp" ? "WhatsApp" : note.author_id === user.id ? "Você" : "Recepção"} ·{" "}
                  <time dateTime={note.created_at}>{format.format(new Date(note.created_at))}</time></span>
              </li>)}
            </ul>
            {!timeline?.error && (historyPage > 1 || notes.length > historySize) && <nav className="inbox-nav" aria-label="Páginas do histórico">
              {historyPage > 1 && <Link href={historyLink(historyPage - 1)}>Mais recentes</Link>}
              {notes.length > historySize && <Link href={historyLink(historyPage + 1)}>Mais antigos</Link>}
            </nav>}
          </article>}
        </section>
        <aside className="card booking-card">
          <h2>Novo atendimento</h2>
          <form action={changeInbox} className="filters">
            <Fields clinic={clinic.id} operation="create" status={status} channel={channel} />
            <label>Assunto<input name="text" maxLength={120} required /></label>
            <button>Criar atendimento</button>
          </form>
          <p className="subtle">As notas são visíveis para a equipe desta clínica. {whatsappConfigured(clinic.id)
            ? "WhatsApp Business oficial configurado para recebimento." : "WhatsApp Business oficial desconectado."}</p>
        </aside>
      </div>
    </main>
  </>;
}
