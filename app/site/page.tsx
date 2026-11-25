import type { Metadata } from "next";
import Link from "next/link";
import styles from "./site.module.css";

export const metadata: Metadata = {
  title: "Clinelo | Agenda e recepção digital para clínicas",
  description: "Organize consultas, encaixes e a fila da recepção em um só lugar. Mais controle para sua clínica e menos interrupções durante os atendimentos.",
};

const benefits = [
  { title: "Uma vaga abriu. A recepção sabe quem chamar.", copy: "Consulte a lista de espera por data e profissional e transforme um encaixe em consulta sem recadastrar o paciente." },
  { title: "Remarcar sem fazer a clínica parar.", copy: "Confira as vagas antes de oferecer um horário. O Clinelo valida o conflito na hora de salvar, mesmo quando duas pessoas agendam ao mesmo tempo." },
  { title: "Troque o turno sem perder o contexto.", copy: "A equipe acompanha quem assumiu cada atendimento, consulta o histórico da conversa e vê a consulta vinculada na caixa compartilhada." },
];

export default function Site() {
  return (
    <main className={styles.site}>
      <header className={styles.header}>
        <a className={styles.brand} href="#inicio">Clinelo<span>.</span></a>
        <nav aria-label="Navegação do site">
          <a href="#recursos">Recursos</a>
          <Link className={styles.navLogin} href="/">Entrar <span aria-hidden="true">↗</span></Link>
        </nav>
      </header>
      <section id="inicio" className={styles.hero}>
        <div className={styles.heroCopy}>
          <p className={styles.eyebrow}>Recepção digital para clínicas</p>
          <h1>Sua clínica sob controle. <em>Sua atenção no paciente.</em></h1>
          <p className={styles.lead}>Quando a agenda depende de mensagens soltas, até um encaixe vira interrupção. O Clinelo reúne horários, pacientes e a fila da recepção para que sua equipe possa resolver mais sem chamar você a cada mudança.</p>
          <div className={styles.actions}>
            <Link className={styles.primary} href="/">Acessar o piloto <span aria-hidden="true">↗</span></Link>
            <a href="#recursos">Conhecer os recursos <span aria-hidden="true">↓</span></a>
          </div>
        </div>
        <figure className={styles.preview}>
          <div className={styles.previewHeader}><strong>Agenda da clínica</strong><span>Quarta-feira</span></div>
          <div className={styles.previewBody}>
            <div className={styles.slot}><time>09:00</time><div><strong>Consulta de retorno</strong><small>Agenda do profissional</small></div><span>Confirmada</span></div>
            <div className={styles.slot}><time>09:30</time><div><strong>Horário disponível</strong><small>Paciente na lista de espera</small></div><span>Vaga</span></div>
            <div className={styles.slot}><time>10:00</time><div><strong>Primeira consulta</strong><small>Agendamento da recepção</small></div><span>Agendada</span></div>
          </div>
          <figcaption>Exemplo de um dia na agenda do Clinelo</figcaption>
        </figure>
      </section>
      <section id="recursos" className={styles.resources}>
        <p className={styles.eyebrow}>Agenda, lista de espera e caixa compartilhada</p>
        <h2>Menos trabalho para manter o dia em ordem.</h2>
        <div className={styles.cards}>
          {benefits.map(({ title, copy }) => <article key={title}><h3>{title}</h3><p>{copy}</p></article>)}
        </div>
      </section>
      <section className={styles.close}>
        <div>
          <p className={styles.eyebrow}>Para equipes médicas e odontológicas</p>
          <h2>Deixe a recepção cuidar da agenda enquanto você atende.</h2>
          <p>Experimente o fluxo com dados fictícios no piloto do Clinelo.</p>
        </div>
        <Link className={styles.primary} href="/">Acessar o piloto <span aria-hidden="true">↗</span></Link>
      </section>
      <footer className={styles.footer}><strong>Clinelo</strong><span>Uma solução da Domma Tecnologia</span></footer>
    </main>
  );
}
