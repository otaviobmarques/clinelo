# Clinelo

Recepção digital para clínicas médicas e odontológicas da Domma Tecnologia. A Agenda do Produto reúne os atendimentos do dia, mostra as vagas por profissional e permite agendar, remarcar e cancelar consultas. A interface exibe Google Agenda, caixa compartilhada e WhatsApp Business oficial como desconectados.

## Executar localmente

Requisitos: Node.js 22 ou superior, Docker em execução e [Supabase CLI](https://supabase.com/docs/guides/local-development/cli/getting-started) disponível no PATH. O ambiente foi validado com Supabase CLI 2.76.8 e PostgreSQL 17. As portas locais padrão são 3000 (Next.js), 54321 (API) e 54322 (PostgreSQL).

```bash
npm ci
npm run db -- start
npm run demo -- --env
npm run dev
```

Abra [http://localhost:3000](http://localhost:3000) e use uma das duas contas fictícias exibidas pelo comando `demo`. Cada conta pertence a uma clínica diferente. As senhas são geradas localmente a cada execução. Use `npm run demo` para gerar novas contas quando o arquivo `.env.local` já existir. O arquivo contém a URL e a chave pública do ambiente local. A chave administrativa é usada exclusivamente pelos scripts locais de provisionamento e teste.

A carga inicial inclui três profissionais e consultas fictícias no próximo dia útil a partir da criação do banco. Navegue até esse dia ou selecione outra data e um profissional no formulário de vagas.

## Regras da agenda

- O dia segue o fuso da clínica. Nesta primeira entrega, a grade tem horários de 30 minutos, das 8h às 18h, de segunda a sexta-feira.
- A remarcação pode trocar data, horário e profissional da mesma clínica. A revisão da consulta impede que uma operação anterior sobrescreva uma mudança mais recente.
- A consulta cancelada continua visível no dia e libera a vaga. A restrição de exclusão do PostgreSQL valida sobreposições inclusive durante gravações concorrentes.
- A sessão do Supabase Auth identifica o usuário. As políticas de linha filtram as leituras por vínculo com a clínica. A operação de escrita verifica o vínculo novamente e executa em uma transação no banco.

## Testes

Com a pilha local em execução:

```bash
# Reinicia apenas o banco local e reaplica as duas migrações e os dados fictícios.
npm run db -- db reset
npm run typecheck
npm run build
npm run test:agenda
npx playwright install chromium
npm run test:ui
```

Os testes criam contas e consultas fictícias temporárias no Supabase local. A suíte da API cobre vagas, conflitos concorrentes, intervalos adjacentes, reversão de remarcação em conflito, revisão desatualizada, cancelamento e isolamento entre clínicas. O teste de navegador percorre o fluxo pela interface e alterna entre as contas das duas clínicas. Caso prefira usar um Chromium já instalado, defina `PLAYWRIGHT_CHROMIUM_EXECUTABLE` com o caminho do executável. Execute os testes com a porta 3000 livre.
