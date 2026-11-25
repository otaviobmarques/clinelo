# Clinelo

Recepção digital para clínicas médicas e odontológicas da Domma Tecnologia. A Agenda do Produto reúne os atendimentos do dia, mostra as vagas por profissional e permite agendar, remarcar e cancelar consultas. A consulta de disponibilidade no Google Agenda é opcional. A caixa compartilhada organiza os atendimentos internos da equipe. O recebimento pelo WhatsApp Business oficial é opcional.

## Executar localmente

Use Node.js 22 ou superior, Docker em execução e uma versão 2.x recente da [Supabase CLI](https://supabase.com/docs/guides/local-development/cli/getting-started) disponível no PATH. A configuração local usa PostgreSQL 17. As portas padrão são 3000 (Next.js), 54321 (API) e 54322 (PostgreSQL).

```bash
npm ci
npm run db -- start
npm run demo -- --env
npm run dev
```

Abra [http://localhost:3000](http://localhost:3000) e use uma das duas contas fictícias exibidas pelo comando `demo`. Cada conta pertence a uma clínica diferente. A conta Horizonte pode administrar a grade fictícia. As senhas são geradas localmente a cada execução. Use `npm run demo` para gerar novas contas quando o arquivo `.env.local` já existir. O arquivo contém a URL e a chave pública do ambiente local. A chave administrativa é usada exclusivamente pelos scripts locais de provisionamento e teste.

A carga inicial inclui três profissionais e consultas fictícias no próximo dia útil a partir da criação do banco. Navegue até esse dia ou selecione outra data e um profissional no formulário de vagas.

## Regras da agenda

- O dia segue o fuso da clínica. O campo **Profissional da agenda** filtra a lista e os totais do dia. **Situação da agenda** refina a lista sem alterar os totais. **Buscar paciente** encontra trechos do nome na data selecionada, ignorando maiúsculas e acentos. Use **Bloquear uma vaga** para reservar um intervalo de 30 minutos para um compromisso interno. Consulte os bloqueios ativos no filtro de situação e use **Liberar horário** para devolver a vaga à agenda. A escolha de profissional na consulta de vagas é independente. **Ver vagas da semana** compara sete dias a partir da data selecionada. Escolha um dia com vagas para abrir a consulta diária. Os totais da semana vêm da Agenda do Produto. Os avisos do Google aparecem na consulta do dia. A grade padrão tem horários de 30 minutos, das 8h às 18h, de segunda a sexta-feira.
- A remarcação pode trocar data, horário e profissional da mesma clínica. A revisão da consulta impede que uma operação anterior sobrescreva uma mudança mais recente.
- A recepção pode confirmar a consulta antes do fim do horário, registrar comparecimento a partir do início e registrar falta a partir do fim. A situação aparece na agenda, com totais de atendidos e faltas. A consulta cancelada continua visível no dia e libera a vaga. A restrição de exclusão do PostgreSQL valida sobreposições inclusive durante gravações concorrentes.
- A sessão do Supabase Auth identifica o usuário. As políticas de linha filtram as leituras por vínculo com a clínica. A operação de escrita verifica o vínculo novamente e executa em uma transação no banco.

- Na agenda, **Ver histórico** mostra criação, remarcações e mudanças de situação registradas desde a aplicação da migração. Registros de comparecimento ou falta podem ser desfeitos, retornando à situação anterior e acrescentando a correção ao histórico.

## Grade por profissional

Use **Administrar grade** no Clinelo para salvar horários e pausas, fechar um dia ou restaurar o padrão. O atalho aparece para membros autorizados na clínica. A administração habilita o acesso definindo `can_manage_hours = true` no vínculo correspondente em `clinic_members`.

Em **Exceções por data**, selecione uma data para fechar o dia ou ajustar os horários e a pausa. A agenda consulta primeiro a exceção da data, depois a grade semanal do profissional e, por fim, a grade padrão da clínica. Remover a exceção volta a aplicar a regra seguinte. Consultas existentes continuam visíveis. **Consultas fora da grade** lista reservas futuras afetadas, com atalhos para a agenda. A agenda diária sinaliza essas reservas para conferência. Em uma pilha local existente, aplique a migração com `npm run db -- migration up`.

A grade também pode ser administrada na tabela `professional_hours` do Supabase. Use o UUID da clínica e do profissional e `weekday` de 1 (segunda) até 7 (domingo). Uma linha define a abertura e o fechamento daquele dia da semana, com pausa opcional. Use múltiplos de 30 minutos e horários no fuso da clínica.

- Para fechar um dia da semana, mantenha os quatro horários nulos.
- Para retomar a grade padrão, remova a linha correspondente.
- A nova grade vale para próximas reservas, remarcações e bloqueios. O histórico e as consultas já marcadas são preservados.

Exemplo com a clínica e a profissional fictícias do ambiente local:

```sql
insert into public.professional_hours (clinic_id, professional_id, weekday, opens_at, closes_at, break_from, break_until)
values ('10000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000001',
  1, '09:00', '17:00', '12:00', '13:00')
on conflict (clinic_id, professional_id, weekday) do update set
  opens_at = excluded.opens_at, closes_at = excluded.closes_at,
  break_from = excluded.break_from, break_until = excluded.break_until;
```

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


## Cadastro de pacientes

Acesse **Pacientes** pela agenda. A ficha tem nome e contatos opcionais, busca por nome e histórico de consultas vinculadas. Pode ser editada, arquivada e reativada pela equipe da clínica. Um cadastro arquivado preserva seu histórico e fica indisponível para novos agendamentos.

Use **Agendar para este paciente** na ficha ou **Agendar com paciente cadastrado** em um atendimento aberto da caixa. A agenda usa o nome do cadastro e grava o vínculo na mesma transação da reserva. Consultas anteriores ao cadastro continuam disponíveis na agenda. O histórico da ficha reúne as reservas vinculadas explicitamente e o nome gravado em cada reserva é preservado.

## Caixa compartilhada

Acesse **Caixa compartilhada** pelo painel da recepção. Crie um atendimento com um assunto e adicione notas internas. Os membros da mesma clínica podem consultar o histórico, encerrar e reabrir o atendimento. A caixa mostra o tempo desde a entrada ou o retorno à fila e prioriza os mais antigos em **Sem responsável**. A caixa separa os atendimentos em aberto dos encerrados e permite filtrar por origem manual ou WhatsApp em cada fila. A origem também aparece ao lado de cada atendimento. Use **Buscar por assunto** para localizar um trecho do assunto sem distinção entre maiúsculas e minúsculas ou acentos comuns do português. A busca respeita a clínica, a fila, a origem e o filtro de responsável selecionados. Na fila em aberto, filtre por **Meus atendimentos** ou **Sem responsável**, e use **Assumir atendimento** ou **Devolver à fila**. A atribuição é liberada ao encerrar ou remover o vínculo do responsável. O nome do perfil aparece para colegas quando disponível. Nos demais casos, a fila mostra um identificador de atendente. A carga de desenvolvimento inclui um atendimento fictício por clínica. Em uma pilha local existente, aplique a nova migração com `npm run db -- migration up` para preservar os registros atuais.

As operações verificam o vínculo no banco e serializam mudanças do mesmo atendimento. Se o atendimento já estiver encerrado, reabra antes de adicionar uma nota. Além dos registros manuais, a caixa pode receber mensagens de texto do WhatsApp Business oficial quando configurado.

## WhatsApp Business oficial

A integração usa os webhooks da WhatsApp Cloud API. Quando habilitada, novas mensagens de texto entram no histórico da caixa da clínica vinculada. Uma mensagem nova reabre o atendimento do mesmo contato, e reentregas do mesmo evento são ignoradas. O histórico identifica a origem como WhatsApp. O remetente é agrupado por um identificador derivado do telefone, e seu número bruto fica fora do cadastro do atendimento. Este recorte cobre recebimento de texto. Anexos, envio de mensagens e eventos de status ficam fora do fluxo.

1. Aplique a migração e disponibilize o endpoint `/api/whatsapp` via HTTPS no servidor do Clinelo.
2. Configure no servidor `WHATSAPP_APP_SECRET` com o segredo do aplicativo Meta e `WHATSAPP_VERIFY_TOKEN` com um token aleatório para a verificação inicial do webhook. Configure `WHATSAPP_CONTACT_SECRET` com outro segredo aleatório, estável por ambiente. Sua troca muda o agrupamento de novos eventos por contato.
3. Configure `WHATSAPP_CLINICS_JSON` com um objeto que mapeia cada **Phone Number ID** da Meta ao UUID da clínica. Exemplo fictício `{"10001":"10000000-0000-4000-8000-000000000002"}`. Configure também `SUPABASE_SERVICE_ROLE_KEY` com a chave administrativa do Supabase, exclusivamente no servidor. Mantenha os segredos fora do repositório e do prefixo `NEXT_PUBLIC_`.
4. No painel da Meta, registre o callback HTTPS e o token de verificação. Assine o campo `messages` da conta do WhatsApp Business. O status **Configurado** na interface indica que há parâmetros no servidor para aquela clínica. Confirme a entrega com um evento de teste da Meta antes de usar o canal.

Para testar localmente com mensagens e assinaturas fictícias, execute `CLINELO_TEST_WHATSAPP=1 npm run test:ui -- tests/whatsapp.spec.ts` com o Supabase local em execução e `.env.local` gerado pelo comando `demo`. O teste cobre verificação do callback, assinatura inválida, número sem vínculo, reentrega simultânea, reabertura e isolamento.

Na caixa, abra um atendimento em andamento e escolha **Agendar consulta para este atendimento**. A reserva e o vínculo são gravados juntos. As consultas vinculadas aparecem na conversa com a situação atual e um atalho para a data da agenda.
