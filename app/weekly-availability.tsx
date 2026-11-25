import Link from "next/link";
import { agendaUrl, shiftDay, validDay } from "../lib/agenda";

export type AvailabilityDay = { day: string; available: number; first_start: string | null };

type Props = {
  scope: Record<string, string | undefined>;
  day: string;
  timezone: string;
  professionalName: string;
  days: AvailabilityDay[];
  failed: boolean;
};

export function WeeklyAvailability({ scope, day, timezone, professionalName, days, failed }: Props) {
  const date = new Intl.DateTimeFormat("pt-BR", {
    weekday: "short", day: "2-digit", month: "2-digit", timeZone: "UTC",
  });
  const time = new Intl.DateTimeFormat("pt-BR", { hour: "2-digit", minute: "2-digit", timeZone: timezone });
  const previous = shiftDay(day, -7);
  const next = shiftDay(day, 7);

  return <section className="card booking-card week-card" aria-labelledby="week-title">
    <div className="week-heading">
      <div><h2 id="week-title">Vagas nos próximos 7 dias</h2><p className="subtle">{professionalName}</p></div>
      <nav className="date-nav" aria-label="Navegar pelas semanas">
        {validDay(previous) && <Link className="secondary button" aria-label="Sete dias anteriores"
          href={agendaUrl({ ...scope, day: previous, week: "1" }) + "#semana"}>‹</Link>}
        {validDay(next) && validDay(shiftDay(next, 6)) && <Link className="secondary button" aria-label="Sete dias seguintes"
          href={agendaUrl({ ...scope, day: next, week: "1" }) + "#semana"}>›</Link>}
      </nav>
    </div>
    {failed && <p className="notice" role="alert">Não foi possível consultar as vagas da semana. Atualize a página para tentar novamente.</p>}
    {!failed && <ul className="week-days">
      {days.map((item) => <li key={item.day}>
        <time dateTime={item.day}>{date.format(new Date(item.day + "T12:00:00Z"))}</time>
        {item.available > 0
          ? <Link href={agendaUrl({ ...scope, day: item.day, week: undefined }) + "#vagas"}>
            {item.available} {item.available === 1 ? "vaga" : "vagas"}
            {item.first_start && " · a partir de " + time.format(new Date(item.first_start))}
          </Link>
          : <span className="subtle">Sem vagas</span>}
      </li>)}
    </ul>}
    <p className="subtle">Vagas da Agenda do Produto. A agenda do dia exibe os avisos do Google Agenda quando configurada.</p>
  </section>;
}
