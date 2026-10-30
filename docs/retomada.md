# Retomada: Asa Saúde × Kentro

Situação em **30/10/2026**, quando o trabalho parou. A visão geral do projeto está em [`visao-geral.md`](visao-geral.md), e o que a API não entrega e o que falta validar está em [`pendencias.md`](pendencias.md) (P1 a P40). A implantação em vários clientes, ainda em aberto, está em [`implantacao-clientes.md`](implantacao-clientes.md).

## Onde paramos

| Item | Situação |
|---|---|
| Último commit | **0.16.0**: confirmação configurável e revisão de segurança, no GitHub |
| Conector no Doca | **0.16.5** (deploy em 30/10) |
| Instalação 29 (`apresentacao`) | **0.16.5**, ativa. O filtro inclui os usuários 508 e 509 e, desde 29/10, o perfil 0 (mudança feita fora daqui; confirmar se foi intencional) |
| Fila 19 (WhatsApp oficial) | Ligada pelo usuário em 29/10 |

## 30/10: paciente cadastrado precisa de nome, nascimento e telefone (0.16.6)

- A 0.16.5 mostrou o campo recusado: com `paciente_id`, a Asa exige também `nome`, `nascimento` e `telefone` ("preencha os campos indicados com *"). A marcação validada na 0.7 (nº 42655586) foi de paciente novo, que já manda esses campos.
- 0.16.6: para paciente cadastrado, o Conector relê o cadastro na Asa (`paciente-instituicao`, pela busca de CPF/telefone que o painel agora envia), confere o id e manda nome, nascimento (AAAA-MM-DD, como no paciente novo), telefone e CPF **do próprio cadastro**, para não alterar o paciente. Cadastro sem nascimento ou telefone: `PACIENTE_INCOMPLETO`.

## 30/10: causa da marcação que "dava certo" sem gravar (0.16.5)

- Diagnóstico da 0.16.4: a Asa respondeu em 383 ms com `"The given data was invalid."` (validação do Laravel), sem HTTP de erro. O Conector tratava isso como sucesso: era o "marcado" que não aparecia.
- 0.16.5: `validacaoDa` reconhece essa recusa (com ou sem `errors`, qualquer status) e todo 4xx vira `ASA_RECUSOU`. A tela mostra "A Asa respondeu: <campo>: <motivo>". Falta ver qual campo a Asa recusa (paciente existente, convênio 5307, procedimento 1619420, agenda 358726).

## 30/10: marcação incerta (0.16.3)

- Depois da 0.16.1, a marcação deu `AGENDAMENTO_INCERTO`: a chamada de gravação à Asa ficou sem resposta (tempo esgotado ou conexão caída). O detalhe exato ainda não foi visto (o log do Doca tem "gravação sem confirmação da Asa" com `detalhe`).
- Correção (0.16.3): a gravação espera até 40 s; sem resposta (ou sem número), o Conector lê `horarios-agendados` do dia e, achando uma consulta ativa no horário do mesmo paciente (ou a única ativa ali), conclui como sucesso. Não achando, continua incerto.
- O painel: espera 60 s; com resultado incerto ou sem resposta, **mantém a chave** e o botão vira "Conferir na Asa", que só confere (antes, sem resposta do Conector, o painel gerava chave nova e permitia marcar duas vezes).

## 30/10: marcação "confirmada" que não aparece (0.16.1, em investigação)

- O usuário marcou pela extensão, a tela disse que deu certo, e a consulta não aparece em nenhuma tela.
- Causa provável: o Conector tratava qualquer resposta 200 da Asa como sucesso, mesmo sem o número da consulta.
- Na 0.16.1, sem o número a resposta é `AGENDAMENTO_SEM_NUMERO` (a tela pede para conferir a agenda), a tentativa fica `incerto` e o log registra o formato da resposta ("Asa respondeu ao agendamento sem o número da consulta"). Falta reproduzir e ler a mensagem da Asa.

## 30/10: confirmação configurável e revisão (0.16.0)

- **Lista de espera fora do escopo por enquanto** (decisão do usuário).
- **Tela própria "Confirmação Asa"** (admin, supervisor e atendente, por decisão do usuário). Configurar ficou só com token e financeiro.
  - Variáveis do template oficial (1 a 10): cada uma recebe um campo da consulta ou um texto fixo. O **id do template continua no fluxo** (a Kentro não aceita variável nele, e o SDK não lista templates; decisão: "template fixo, parâmetros livres").
  - Antecedência de 1 a 7 dias, canal, modo teste, as cinco respostas com prévia e "respostas aceitas" (sinônimos dos botões, um por linha, sem repetir entre botões).
  - Na sexta, com a opção ligada, saem também os lembretes que cairiam no sábado e no domingo, para qualquer antecedência.
  - As respostas ao paciente só têm nome, data, hora, profissional e clínica; a prévia mostra exatamente isso.
- Fluxo `disparo-cloud.dsl`: distribui até 10 variáveis (`%%TEMPLATE_DATA%%`), validado na Kentro.
- **Segurança:** o log de requisição não leva a query string (CPF e telefone da busca de paciente), o 404 não repete a URL, e erro inesperado responde `ERRO_INTERNO`. `npm audit`: 0 vulnerabilidades.
- **Desempenho:** especialidades e prestadores em cache por 5 min por clínica; o cache de exames tem teto de 50 buscas.
- Revisão de código (code-review high) aplicada, menos o ponto da permissão, que é decisão do usuário.

## 30/10: acabamento visual da Agenda (0.15.0)

- A cor da hora é o status, agora com fundo também na confirmada (verde), além de falta e remarcação (âmbar). Atendida fica cinza e cancelada riscada.
- **Linha do agora**, na cor de lembrete, na folha de hoje (dia, semana e lado a lado). Ela é refeita a cada minuto, e o que já passou fica apagado.
- Na semana, os dias que já passaram ficam com o título apagado.
- O painel lateral vazio virou um **resumo do que está na tela**: confirmadas, a confirmar, faltas e remarcações, atendidas, canceladas e horários livres. Cada linha usa a amostra da hora da folha, então o resumo serve também de legenda.
- `daySummary` agora conta atendidas à parte das confirmadas.
- Testado só localmente (Chrome headless, dados falsos, tema claro e escuro).

## 30/10: semana e lado a lado (0.14.0)

- Na tela cheia, um seletor **Dia | Semana | Lado a lado** fica ao lado do profissional. A escolha é lembrada no navegador.
  - **Semana**: o profissional escolhido, de segunda a domingo. As setas andam uma semana.
  - **Lado a lado**: todos os profissionais da especialidade no dia, até 8 colunas (o aviso diz quantos ficaram de fora).
  - O título de cada coluna abre aquele dia na visão Dia. Consultas e horários livres funcionam nas colunas como no dia: confirmar, falta, remarcar, cancelar, cobrar e marcar.
- **Só na extensão.** Cada coluna usa a rota `/v1/agenda/dia`, que já existia, com no máximo 3 pedidos ao mesmo tempo. Uma semana custa até 14 chamadas à Asa.
- Testado localmente com dados falsos (Chrome headless). Falta o teste na Kentro com dados reais.
- O usuário definiu que a extensão será instalada para **todos os clientes**. A estrutura de implantação (chave por cliente, vínculo com a instância) ficou registrada em `implantacao-clientes.md`, para ser desenhada.

## O que foi feito nesta sessão (29/10)

- **0.9.0**: novo visual do painel, com o cartão de consulta.
- **0.10.0**: Confirmação de véspera (D-1).
  - No Conector: rotas `/v1/confirmacao/{lote,enviados,resposta}`, migração 004 e chave `x-automation-key`.
  - Na extensão: seção "Confirmação de véspera" em Configurar e selo na aba Consultas.
  - Modelos dos fluxos em `automations/confirmacao-d1/` (WAMD e Cloud), validados mas **não criados** na Kentro.
- **0.11.0**: **Asa em tela cheia** (`agenda.html` e `agenda.js`).
  - Agenda do dia por profissional, com consultas marcadas e horários livres, e resumo do dia.
  - Busca de paciente por CPF ou telefone.
  - Marcar, remarcar, cancelar, confirmar presença e marcar falta.
  - No Conector: `GET /v1/agenda/dia` e `POST /v1/agendamentos/:id/status`, mais a migração 005.
  - Conferido com dados reais: a consulta 42655586 aparece às 08:00 de 29/10, com o Dr. Demonstração
    (59632). A Asa devolve o estado dela como "pendente", que a tela mostra como "Agendada".
- **0.11.1**: a Agenda virou **ícone na barra superior** (`topMenu` em `fullscreen`), no mesmo formato do
  Monitor de Atendimento, com ícone branco `icon-agenda.svg`. Como `mainNav`, ela não aparecia como ícone.
- **0.11.2**: ícone branco `icon-config.svg` para "Configurar Asa Saúde".

## 0.12.0: Financeiro (29/10, à tarde)

- Lançar conta a receber na Asa: aba Financeiro e botão "Cobrar" no cartão da consulta, no painel; e "Lançar cobrança" na Agenda (consulta do dia e paciente buscado).
- Liga e desliga em Configurar → Financeiro, e lá também se escolhe quem lança (administradores ou todos). Nasce **desligado**.
- A Asa só cria a conta (sem ler, editar ou excluir). O histórico mostrado é o que a Kentro lançou, pela tabela `cobrancas`. Detalhes em `asa-api.md`.
- **A conferir no primeiro teste:**
  - o perfil do usuário vem de `omni.session.getUser()`, cujo campo não está documentado. Se o botão não aparecer para o admin, o console mostra `[Asa] perfil do usuário não reconhecido; campos: …`;
  - o que o `status` 0/1 da Asa significa (pago ou em aberto). Hoje ele não é enviado.

## Próximos passos, em ordem

> Atualizado em 30/10: deploy da 0.14.0 e refresh da 29; o usuário testa semana e lado a lado e, depois, decide o desenho da implantação em vários clientes (`implantacao-clientes.md`). Os itens abaixo são de 29/10. Os itens 1 (deploy da 0.12.0), "visão da semana", "vários profissionais" e "agendar exame" já foram feitos.

1. Fazer o deploy da 0.12.0 no Doca e rodar `extension_installs_refresh_manifest` na 29. Ligar o Financeiro em Configurar.
2. O usuário testa a tela cheia com o login 509, **só com consultas próprias**, porque tudo grava na Asa:
   marcar → confirmar presença → remarcar → marcar falta ou cancelar.
3. Melhorias de funcionalidade da Asa: o usuário quer priorizar isso. Ideias ainda não discutidas:
   - visão da semana;
   - vários profissionais lado a lado;
   - aba Financeiro (`api-gerar-conta-paciente`);
   - agendar exame pelo procedimento.
4. Depois, as automações:
   - gerar a chave de automação (`POST /admin/tenants/<id>/chave-automacao`, com a admin key colada pelo usuário);
   - criar a URA de resposta e a automação de disparo pela fila 19, com um template aprovado
     (5 variáveis e os botões Confirmar, Remarcar e Cancelar);
   - criar a agenda **pausada**;
   - testar em modo teste, só com o número do usuário. Roteiro em `automations/confirmacao-d1/README.md`.

## Regras que valem sempre

- **O push não faz deploy.** O usuário clica em "Fazer deploy" no Doca (o modo automático bloqueia esse clique).
  Só diga que está no ar depois de conferir o `manifest.json` servido pelo Conector.
- Ícones de `topMenu` vão em **branco**, porque a barra superior é escura.
- A extensão é genérica, para várias clínicas: canal, fila, template e textos são configuração, nunca valores fixos.
- Segredos (admin key, token da Asa) o usuário cola. Não se digitam segredos em formulários.
- Não usar a credencial de teste publicada no Postman da Asa. Nunca mandar mensagem para paciente real.
