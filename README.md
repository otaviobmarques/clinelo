# Clinelo

Recepção digital para clínicas médicas e odontológicas da Domma Tecnologia. A Agenda do Produto reúne os atendimentos do dia, mostra as vagas por profissional e permite agendar, remarcar e cancelar consultas. A consulta de disponibilidade no Google Agenda é opcional. A caixa compartilhada organiza os atendimentos internos da equipe. WhatsApp Business oficial aparece como desconectado.

## Executar localmente

Use Node.js 22 ou superior, Docker em execução e uma versão 2.x recente da [Supabase CLI](https://supabase.com/docs/guides/local-development/cli/getting-started) disponível no PATH. A configuração local usa PostgreSQL 17. As portas padrão são 3000 (Next.js), 54321 (API) e 54322 (PostgreSQL).

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
# Reinicia apenas o banco local e reaplica as migrações e os dados fictícios.
npm run db -- db reset
npm run typecheck
npm run build
npm run test:agenda
npx playwright install chromium
npm run test:ui
```

Os testes criam contas e consultas fictícias temporárias no Supabase local. A suíte da API cobre vagas, conflitos concorrentes, intervalos adjacentes, reversão de remarcação em conflito, revisão desatualizada, cancelamento e isolamento entre clínicas. O teste de navegador percorre o fluxo pela interface e alterna entre as contas das duas clínicas. Caso prefira usar um Chromium já instalado, defina `PLAYWRIGHT_CHROMIUM_EXECUTABLE` com o caminho do executável. Execute os testes com a porta 3000 livre.

## Google Agenda

A integração opcional consulta horários ocupados para as vagas exibidas na Agenda do Produto. A recepção recebe um aviso quando há sobreposição ou quando a consulta externa falha. A consulta é informativa. As gravações continuam regidas pela Agenda do Produto e pela validação transacional do PostgreSQL.

1. Ative a Google Calendar API em um projeto do Google Cloud e crie uma conta de serviço. Compartilhe cada calendário com o e-mail da conta de serviço usando a permissão **Ver apenas disponibilidade (ocultar detalhes)**. A política de compartilhamento da organização precisa permitir esse acesso.
2. Configure `GOOGLE_CALENDAR_SERVICE_ACCOUNT_JSON` no ambiente do servidor com o JSON da conta de serviço. O Clinelo lê `client_email` e `private_key`.
3. Configure `GOOGLE_CALENDAR_LINKS_JSON` no ambiente do servidor. Use os UUIDs da clínica e do profissional cadastrados no Clinelo e o ID do calendário compartilhado. Exemplo com identificadores fictícios:

   ```json
   {
     "10000000-0000-4000-8000-000000000001": {
       "20000000-0000-4000-8000-000000000001": "agenda-ficticia@example.test"
     }
   }
   ```

4. Reinicie o aplicativo e consulte um dia com vagas futuras para o profissional vinculado. Use calendários fictícios em desenvolvimento. Guarde a chave no ambiente do servidor e mantenha ambas as variáveis fora do repositório.

A chamada FreeBusy envia o ID do calendário e o intervalo de consulta. Ela retorna períodos ocupados. Nomes de pacientes e detalhes dos eventos ficam fora da consulta. Use `npm run test:google` para verificar a integração com respostas simuladas do provedor.

## Caixa compartilhada

Acesse **Caixa compartilhada** pelo painel da recepção. Crie um atendimento com um assunto e adicione notas internas. Os membros da mesma clínica podem consultar o histórico, encerrar e reabrir o atendimento. A caixa separa os atendimentos em aberto dos encerrados. A carga de desenvolvimento inclui um atendimento fictício por clínica. Em uma pilha local existente, aplique a nova migração com `npm run db -- migration up` para preservar os registros atuais.

As operações verificam o vínculo no banco e serializam mudanças do mesmo atendimento. Se o atendimento já estiver encerrado, reabra antes de adicionar uma nota. Esta versão registra atendimentos manualmente. O WhatsApp Business oficial segue desconectado.
