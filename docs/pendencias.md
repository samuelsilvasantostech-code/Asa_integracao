# Pendências e pontos de observação

Situação em **29/10/2026**, na versão **0.12.0**. Esta lista existe para voltarmos ponto a ponto quando a construção terminar.
Cada item tem um código (P1, P2…) para ser citado nas conversas.

Legenda: **API** = a Asa não entrega · **Asa** = a Asa entrega, mas com comportamento diferente do documentado · **Kentro** = limitação do SDK ou da plataforma · **Nosso** = decisão ou dívida nossa · **Teste** = falta validar com dados reais.

## 1. O que a API da Asa não entrega

| Código | Tipo | Ponto | Efeito hoje | O que pedir à Asa ou fazer |
|---|---|---|---|---|
| P1 | API | **Não há leitura do financeiro:** nem contas a receber, nem saldo em aberto, nem pagamentos. | A aba Financeiro mostra só o que a Kentro lançou (tabela `cobrancas`), e não sabemos se a conta foi paga. | Pedir uma rota que liste as contas do paciente: valor, vencimento, situação e `id_externo`. |
| P2 | API | A conta a receber **não pode ser editada nem excluída** pela API. | Um lançamento errado só se corrige direto na Asa. | Pedir rotas de estorno e cancelamento, ou aceitar a limitação. |
| P3 | API | O `status` 0/1 de `gerar-conta-paciente` não está documentado (pago? em aberto?). | Não enviamos o campo. | Confirmar com a Asa, ou ver na Asa como fica a conta no primeiro lançamento de teste. |
| P4 | API | **Não há webhooks.** | Mudanças feitas na Asa só aparecem quando o painel consulta de novo. | Pedir webhooks de agendamento (criado, alterado, cancelado). |
| P5 | API | **Não há trava de horário:** agendar duas vezes cria duas consultas. | Contornado com chave de idempotência e revalidação do horário. Ainda sobra uma janela pequena se duas pessoas gravarem ao mesmo tempo. | Pedir que a Asa recuse o horário já ocupado. |
| P6 | API | `agendamentos-futuros` traz só as **10 próximas** consultas, e nenhuma passada. | Sem histórico de consultas, faltas ou atendimentos do paciente. | Pedir uma rota de histórico do paciente. |
| P7 | API | Não há rota para **ler uma consulta pelo id**. | Para conferir uma consulta, buscamos a lista do paciente ou a agenda do dia. | Pedir `GET agendamento/:id`. |
| P8 | API | `horarios-agendados` devolve `paciente.id` **nulo**. | Na Agenda, o paciente é achado pelo telefone. Sem telefone, não dá para remarcar nem cobrar pela folha do dia. | Pedir o `paciente_id` nessa rota. |
| P9 | API | Não há **busca de paciente por nome**. | A busca é só por CPF ou telefone. | Pedir a busca por nome. |
| P10 | API | `paciente-instituicao` não devolve o CPF (ele vem só de `agendamentos-futuros`). | Paciente sem consulta futura aparece sem CPF. | Pedir o CPF na rota de paciente. |
| P11 | API | Não há texto de **preparo do exame** (item C3 do escopo). | A mensagem da D-1 não leva o preparo. | Pedir o campo, ou cadastrar o preparo por procedimento no Conector. |
| P12 | API | `paciente-create-edit` **sobrescreve** o cadastro quando o CPF já existe. | Não usamos essa rota, e por isso "Atualizar cadastro" (A3) não foi feito. | Pedir uma edição parcial (só os campos enviados), ou montar uma tela que mostre o cadastro atual antes de gravar. |
| P13 | API | `agendamento-disparados` não tem volta. | Só marcamos depois que a mensagem saiu. | Nada, só cuidado. |
| P14 | API | `horarios-atendimento` recusa datas passadas. | A Agenda de dias passados mostra só as consultas, sem os horários livres. | Nada. |

## 2. Comportamentos da Asa diferentes do documentado

| Código | Tipo | Ponto | Como tratamos |
|---|---|---|---|
| P15 | Asa | "Paciente não localizado" volta como **HTTP 403**, o mesmo código da credencial recusada. | Só tratamos como credencial quando a mensagem fala em "autoriza". |
| P16 | Asa | O Cloudflare bloqueia o User-Agent de biblioteca (`403 / 1010`). | O Conector se identifica como `Kentro-Asa-Connector/x.y`. |
| P17 | Asa | O formato de `get-procedimentos-instituicao` difere da documentação, e o valor 0 é comum. | Normalizador próprio. O valor 0 fica escondido. |
| P18 | Asa | `horarios-agendados` traz o estado "pendente" para consulta só agendada, além de chaves fora do documentado. | Normalizador tolerante, que registra as chaves no log quando não reconhece. |
| P19 | Asa | As datas vêm em três formatos diferentes. | Normalizadores em `normalizar.ts`. |
| P20 | Asa | Prestador, procedimento e convênio só aparecem com "Permite agendamento online" marcado. | Avisar na implantação de cada clínica. |
| P37 | Asa | O `tipo` de `api-agendamento-procedimentos` não separa exame de consulta (exames de laboratório vêm como "consulta"), e a clínica de teste tem mais de 1.000 procedimentos com agenda online. | Lista única em ordem alfabética, com filtro. A primeira carga leva alguns segundos e fica guardada por 1 h. |
| P21 | Asa | A credencial de exemplo publicada na coleção é recusada em produção. | Cada clínica precisa de um token real. |

## 3. Limitações da Kentro (SDK e plataforma)

| Código | Tipo | Ponto | Efeito / contorno |
|---|---|---|---|
| P22 | Kentro | O campo do **perfil do usuário** em `omni.session.getUser()` não está documentado. | "Só administradores lançam cobrança" depende dele. Se não for reconhecido, o console registra os nomes dos campos. |
| P23 | Kentro | `omni.storage` é por usuário e por navegador. | A chave da instalação fica na config `apiKey` da instalação. |
| P24 | Kentro | A config da instalação (`/base/config/extensioninstalls`) exige **superusuário**. | O administrador da clínica não cadastra a chave sozinho: isso entra no roteiro de implantação. |
| P25 | Kentro | A chave da instalação chega ao navegador de todo atendente. | Risco aceito. As gravações conferem o paciente e a consulta, e a troca de token exige a chave de administrador. |
| P26 | Kentro | `mainNav` não vira ícone. | Usamos `topMenu` com `fullscreen` e ícone branco. |

## 4. Dívidas e decisões nossas

| Código | Tipo | Ponto | O que fazer |
|---|---|---|---|
| P27 | Nosso | "Quem pode lançar cobrança" é aplicado **só no painel**: o Conector não conhece o usuário da Kentro. | Avaliar uma assinatura do usuário vinda da Kentro, se existir. |
| P28 | Nosso | ~~O `/health` sempre informa `versao: 0.1.0`.~~ | **Resolvido na 0.13.0**: a versão vem do `manifest.json`. |
| P29 | Nosso | O push no GitHub não faz deploy no Doca: alguém clica em "Fazer deploy". | Avaliar o deploy automático no Doca. |
| P30 | Nosso | Não há roteiro escrito de **implantação de clínica real**: tenant, chave, instalação, token, filas e template. | Escrever antes do primeiro cliente. |
| P31 | Nosso | Não há testes automáticos da extensão (só do Conector). | Testar `core.js` e `cobranca.js`. |

## 5. Falta validar com dados reais

| Código | Tipo | O quê | Versão |
|---|---|---|---|
| P32 | Teste | Remarcar e Cancelar pelo painel lateral | 0.8.0 |
| P33 | Teste | Tela cheia: marcar, confirmar presença, remarcar, marcar falta, cancelar e buscar paciente | 0.11.x |
| P34 | Teste | Financeiro: ligar em Configurar, lançar cobrança e ver como fica na Asa (fecha P3 e P22) | 0.12.0 |
| P35 | Teste | Confirmação D-1: criar os fluxos na fila 19 e testar só com o número do usuário | 0.10.0 |
| P38 | Nosso | Sem limite de chamadas por clínica: quem tem a chave da instalação (todo atendente) pode disparar chamadas à Asa sem teto. | Proposto: limite por clínica no Conector. Aguarda aprovação. |
| P39 | Nosso | `confirmacoes` guarda o telefone do paciente sem prazo. | Proposto: apagar depois de 90 dias (LGPD). Aguarda aprovação. |
| P40 | Nosso | Qualquer atendente altera a confirmação (inclusive ligar para todos os pacientes), e o nome gravado na trilha vem do navegador. | Decisão do usuário em 30/10. Reavaliar se houver incidente. |
| P36 | Teste | Agendar por exame: o procedimento buscado já deve vir escolhido no formulário. A Asa pode não trazer o id do procedimento no horário; nesse caso, ele é casado pelo nome | 0.13.0 |
